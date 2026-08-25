import type { ProviderErrorKind, ProviderName, ProviderStatus } from '@modelmesh/types';
import { config } from '../config';
import { decrypt, encrypt, maskKey, sha256 } from '../infra/crypto';
import { logger } from '../infra/logger';
import type { Persistence } from '../infra/persistence';
import type { ProviderKeyRecord } from '../infra/records';
import { RedisKeys, type KeyValueStore } from '../infra/store';
import { clamp } from '../infra/text';

export interface KeyLease {
  keyId: string;
  apiKey: string;
  provider: ProviderName;
}

const MOCK_LEASE: KeyLease = { keyId: 'key_mock', apiKey: 'mock', provider: 'mock' };

/** Rolling window length for the health score (CLAUDE.md §10). */
const HEALTH_WINDOW = 100;
const DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS = 60;

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * Owns the per-provider key pool: health, quota, rate-limit state.
 *
 * Health is a rolling success rate over the last 100 calls held in the KV
 * store; PostgreSQL keeps the lifetime counters. Selection is always
 * highest-health-first among keys that are not cooling down.
 */
export class KeyManager {
  constructor(
    private readonly store: KeyValueStore,
    private readonly db: Persistence,
  ) {}

  /** Import keys from the environment and prime the health index. */
  async bootstrap(): Promise<{ imported: number; total: number }> {
    let imported = 0;

    for (const [provider, keys] of Object.entries(config.providerKeys) as Array<[ProviderName, string[]]>) {
      for (const [index, rawKey] of keys.entries()) {
        const keyHash = sha256(rawKey);
        const existing = await this.db.findProviderKeyByHash(keyHash);
        if (existing) {
          await this.indexKey(existing);
          continue;
        }

        const record = await this.db.createProviderKey({
          provider,
          maskedKey: maskKey(rawKey),
          encryptedKey: encrypt(rawKey),
          keyHash,
          label: `${provider}-env-${index + 1}`,
          priority: index + 1,
        });
        await this.indexKey(record);
        imported += 1;
      }
    }

    const all = await this.db.listProviderKeys();
    for (const record of all) await this.indexKey(record);

    logger.info(
      { imported, total: all.length, mockEnabled: config.mockProviderEnabled },
      'Key pool ready',
    );
    return { imported, total: all.length };
  }

  async addKey(input: {
    provider: ProviderName;
    key: string;
    priority?: number;
    label?: string;
    quotaLimit?: number;
  }): Promise<ProviderKeyRecord> {
    const keyHash = sha256(input.key);
    const existing = await this.db.findProviderKeyByHash(keyHash);
    if (existing) {
      await this.db.updateProviderKey(existing.id, { active: true });
      await this.indexKey(existing);
      return existing;
    }

    const record = await this.db.createProviderKey({
      provider: input.provider,
      maskedKey: maskKey(input.key),
      encryptedKey: encrypt(input.key),
      keyHash,
      label: input.label ?? null,
      priority: input.priority ?? 1,
      quotaLimit: input.quotaLimit ?? null,
    });
    await this.indexKey(record);
    return record;
  }

  private async indexKey(record: ProviderKeyRecord): Promise<void> {
    if (!record.active) {
      await this.store.zrem(RedisKeys.keyManager(record.provider), record.id);
      return;
    }
    // Priority breaks health ties without overtaking a healthier key.
    const score = record.healthScore + (1 / Math.max(1, record.priority)) * 0.001;
    await this.store.zadd(RedisKeys.keyManager(record.provider), score, record.id);
  }

  /**
   * Highest-health key that is not rate-limited, quota-exhausted, or excluded.
   */
  async getBestKey(provider: ProviderName, exclude: string[] = []): Promise<KeyLease | null> {
    if (provider === 'mock') {
      return config.mockProviderEnabled && !exclude.includes(MOCK_LEASE.keyId) ? MOCK_LEASE : null;
    }

    const ranked = await this.store.zrevrange(RedisKeys.keyManager(provider), 0, -1);

    for (const keyId of ranked) {
      if (exclude.includes(keyId)) continue;
      if (await this.store.exists(RedisKeys.keyRateLimit(keyId))) continue;

      const record = await this.db.getProviderKey(keyId);
      if (!record?.active) {
        await this.store.zrem(RedisKeys.keyManager(provider), keyId);
        continue;
      }
      if (record.quotaLimit !== null && record.quotaUsed >= record.quotaLimit) continue;

      try {
        return { keyId, apiKey: decrypt(record.encryptedKey), provider };
      } catch (error) {
        logger.error({ keyId, err: (error as Error).message }, 'Key decryption failed — deactivating');
        await this.db.updateProviderKey(keyId, { active: false, lastErrorCode: 'DECRYPT_FAILED' });
        await this.store.zrem(RedisKeys.keyManager(provider), keyId);
      }
    }

    return null;
  }

  async hasAvailableKey(provider: ProviderName): Promise<boolean> {
    return (await this.getBestKey(provider)) !== null;
  }

  /** Providers with at least one usable key right now. */
  async getAvailableProviders(): Promise<ProviderName[]> {
    const candidates: ProviderName[] = ['gemini', 'groq', 'together', 'mistral', 'openrouter', 'mock'];
    const available: ProviderName[] = [];
    for (const provider of candidates) {
      if (await this.hasAvailableKey(provider)) available.push(provider);
    }
    return available;
  }

  async markRateLimited(keyId: string, retryAfterSeconds = DEFAULT_RATE_LIMIT_COOLDOWN_SECONDS): Promise<void> {
    if (keyId === MOCK_LEASE.keyId) return;
    const cooldown = clamp(retryAfterSeconds, 1, 3600);

    await this.store.setex(RedisKeys.keyRateLimit(keyId), cooldown, '1');
    await this.db.updateProviderKey(keyId, {
      isRateLimited: true,
      rateLimitUntil: new Date(Date.now() + cooldown * 1000),
      lastErrorCode: 'RATE_LIMIT',
    });
    logger.warn({ keyId, cooldown }, 'Key rate-limited — rotating');
  }

  async recordSuccess(keyId: string, provider: ProviderName, tokensUsed: number, latencyMs: number): Promise<void> {
    await this.trackQuota(provider, tokensUsed);
    await this.trackLatency(provider, keyId, latencyMs);
    if (keyId === MOCK_LEASE.keyId) return;

    const record = await this.db.getProviderKey(keyId);
    if (!record) return;

    const health = await this.pushHealthOutcome(keyId, true);
    await this.db.updateProviderKey(keyId, {
      totalCalls: record.totalCalls + 1,
      successfulCalls: record.successfulCalls + 1,
      quotaUsed: record.quotaUsed + tokensUsed,
      lastUsedAt: new Date(),
      isRateLimited: false,
      rateLimitUntil: null,
      healthScore: health,
      avgLatencyMs: Math.round(record.avgLatencyMs === 0 ? latencyMs : record.avgLatencyMs * 0.8 + latencyMs * 0.2),
    });
    await this.indexKey({ ...record, healthScore: health });
  }

  async recordFailure(keyId: string, errorCode: ProviderErrorKind | string): Promise<void> {
    if (keyId === MOCK_LEASE.keyId) return;

    const record = await this.db.getProviderKey(keyId);
    if (!record) return;

    const health = await this.pushHealthOutcome(keyId, false);
    // An auth failure is terminal for that key — stop handing it out.
    const deactivate = errorCode === 'AUTH';

    await this.db.updateProviderKey(keyId, {
      totalCalls: record.totalCalls + 1,
      failedCalls: record.failedCalls + 1,
      lastErrorCode: String(errorCode),
      healthScore: health,
      ...(deactivate ? { active: false } : {}),
    });
    await this.indexKey({ ...record, healthScore: health, active: record.active && !deactivate });

    if (deactivate) logger.error({ keyId, provider: record.provider }, 'Key rejected by provider — deactivated');
  }

  /**
   * 5xx failures shave health without triggering rotation, so a transient
   * blip doesn't cost a healthy key its place in the queue.
   */
  async decrementHealth(keyId: string, amount: number): Promise<void> {
    if (keyId === MOCK_LEASE.keyId) return;
    const record = await this.db.getProviderKey(keyId);
    if (!record) return;

    const health = clamp(record.healthScore - amount, 0, 1);
    await this.db.updateProviderKey(keyId, { healthScore: health });
    await this.indexKey({ ...record, healthScore: health });
  }

  /** Rolling window of the last HEALTH_WINDOW outcomes → success rate. */
  private async pushHealthOutcome(keyId: string, success: boolean): Promise<number> {
    const storeKey = `key:health:${keyId}`;
    const history = ((await this.store.get(storeKey)) ?? '') + (success ? '1' : '0');
    const window = history.slice(-HEALTH_WINDOW);
    await this.store.set(storeKey, window);

    const successes = window.split('').filter((outcome) => outcome === '1').length;
    return window.length === 0 ? 1 : successes / window.length;
  }

  private async trackQuota(provider: ProviderName, tokensUsed: number): Promise<void> {
    if (tokensUsed <= 0) return;
    const quotaKey = RedisKeys.providerQuota(provider, today());
    await this.store.incrby(quotaKey, tokensUsed);
    await this.store.expire(quotaKey, 60 * 60 * 48);
  }

  private async trackLatency(provider: ProviderName, keyId: string, latencyMs: number): Promise<void> {
    for (const storeKey of [RedisKeys.providerLatency(provider), RedisKeys.keyLatency(keyId)]) {
      const previous = Number((await this.store.get(storeKey)) ?? 0);
      const next = previous === 0 ? latencyMs : previous * 0.8 + latencyMs * 0.2;
      await this.store.setex(storeKey, 60 * 60 * 24, String(Math.round(next)));
    }
  }

  async quotaConsumedToday(provider: ProviderName): Promise<number> {
    return Number((await this.store.get(RedisKeys.providerQuota(provider, today()))) ?? 0);
  }

  /**
   * Key inventory for the admin/debug view. Deliberately returns only masked
   * values and health metadata — encrypted material never leaves this class.
   */
  async listKeysForDisplay(): Promise<
    Array<{
      keyId: string;
      provider: ProviderName;
      maskedKey: string;
      label: string | null;
      priority: number;
      healthScore: number;
      totalCalls: number;
      failedCalls: number;
      quotaUsed: number;
      isRateLimited: boolean;
      active: boolean;
      lastUsedAt: string | null;
    }>
  > {
    const keys = await this.db.listProviderKeys();
    const display = [];

    for (const key of keys) {
      display.push({
        keyId: key.id,
        provider: key.provider,
        maskedKey: key.maskedKey,
        label: key.label,
        priority: key.priority,
        healthScore: Number(key.healthScore.toFixed(3)),
        totalCalls: key.totalCalls,
        failedCalls: key.failedCalls,
        quotaUsed: key.quotaUsed,
        isRateLimited: await this.store.exists(RedisKeys.keyRateLimit(key.id)),
        active: key.active,
        lastUsedAt: key.lastUsedAt?.toISOString() ?? null,
      });
    }

    return display;
  }

  /** Payload for GET /providers/status. */  async statusReport(modelsByProvider: Record<string, string[]>): Promise<ProviderStatus[]> {
    const providers: ProviderName[] = ['gemini', 'groq', 'together', 'mistral', 'openrouter'];
    const report: ProviderStatus[] = [];

    for (const provider of providers) {
      const keys = (await this.db.listProviderKeys(provider)).filter((key) => key.active);
      if (keys.length === 0) continue;

      let rateLimited = 0;
      for (const key of keys) {
        if (await this.store.exists(RedisKeys.keyRateLimit(key.id))) rateLimited += 1;
      }

      const activeKeys = keys.length - rateLimited;
      const healthScore =
        keys.reduce((sum, key) => sum + key.healthScore, 0) / Math.max(1, keys.length);
      const avgLatencyMs = Number((await this.store.get(RedisKeys.providerLatency(provider))) ?? 0);

      report.push({
        provider,
        status: activeKeys === 0 ? 'unavailable' : rateLimited > 0 || healthScore < 0.8 ? 'degraded' : 'healthy',
        activeKeys,
        rateLimitedKeys: rateLimited,
        avgLatencyMs,
        healthScore: Number(healthScore.toFixed(3)),
        quotaConsumedToday: await this.quotaConsumedToday(provider),
        models: modelsByProvider[provider] ?? [],
      });
    }

    if (config.mockProviderEnabled) {
      report.push({
        provider: 'mock',
        status: 'healthy',
        activeKeys: 1,
        rateLimitedKeys: 0,
        avgLatencyMs: Number((await this.store.get(RedisKeys.providerLatency('mock'))) ?? 0),
        healthScore: 1,
        quotaConsumedToday: await this.quotaConsumedToday('mock'),
        models: modelsByProvider.mock ?? [],
      });
    }

    return report;
  }
}
