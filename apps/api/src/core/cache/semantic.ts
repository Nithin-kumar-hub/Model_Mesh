import { createHash } from 'node:crypto';
import type { AgentRole, ProviderName, SubTaskResult } from '@modelmesh/types';
import { config } from '../../config';
import { logger } from '../../infra/logger';
import type { Persistence } from '../../infra/persistence';
import type { CacheEntryRecord } from '../../infra/records';
import { RedisKeys, type KeyValueStore } from '../../infra/store';
import { cosineSimilarity, normalizeForCache } from '../../infra/text';

export interface CacheLookup {
  role: AgentRole;
  provider: ProviderName;
  model: string;
  prompt: string;
}

export interface CachedCompletion {
  text: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  confidence: number;
  /** 'exact' = same prompt hash; 'semantic' = similar prompt above threshold. */
  matchType: 'exact' | 'semantic';
  similarity: number;
}

/** Task types whose answers stay valid far longer than a conversation. */
const LONG_LIVED_TASK_TYPES = new Set([
  'DOCUMENT_ANALYSIS',
  'PDF_EXTRACTION',
  'DOCUMENT_QA',
  'OCR',
  'IMAGE_ANALYSIS',
]);

/** Roles whose answers are inherently per-user and must not be shared. */
const NEVER_CACHE_ROLES = new Set<string>([]);

const SEMANTIC_SCAN_LIMIT = 40;
/** Minimum length ratio before a similarity score is trusted. */
const LENGTH_RATIO_FLOOR = 0.9;

/**
 * Two-tier response cache.
 *
 * Tier 1: exact hash of (provider, model, normalized prompt) — a straight hit.
 * Tier 2: cosine similarity against recent same-role entries, gated at 0.95
 *         (CLAUDE.md §10), which catches re-phrased repeats.
 *
 * Redis holds the hot copy; PostgreSQL holds the durable copy plus hit counts
 * so cache effectiveness shows up in telemetry.
 */
export class SemanticCache {
  constructor(
    private readonly store: KeyValueStore,
    private readonly db: Persistence,
  ) {}

  buildKey(lookup: CacheLookup): string {
    return createHash('sha256')
      .update(`${lookup.provider}|${lookup.model}|${normalizeForCache(lookup.prompt)}`)
      .digest('hex');
  }

  ttlSecondsFor(taskType: string | null | undefined): number {
    return taskType && LONG_LIVED_TASK_TYPES.has(taskType)
      ? config.cache.documentTtlSeconds
      : config.cache.defaultTtlSeconds;
  }

  cacheable(role: AgentRole, hasImages: boolean): boolean {
    if (!config.features.semanticCache) return false;
    if (NEVER_CACHE_ROLES.has(role)) return false;
    // Image payloads aren't part of the prompt hash, so a "hit" would be wrong.
    return !hasImages;
  }

  async get(lookup: CacheLookup): Promise<CachedCompletion | null> {
    if (!config.features.semanticCache) return null;

    const cacheKey = this.buildKey(lookup);

    const hot = await this.store.get(RedisKeys.cacheEntry(cacheKey));
    if (hot) {
      const parsed = JSON.parse(hot) as CachedCompletion;
      await this.db.incrementCacheHit(cacheKey).catch(() => undefined);
      return { ...parsed, matchType: 'exact', similarity: 1 };
    }

    const durable = await this.db.getCacheEntry(cacheKey);
    if (durable) {
      await this.warm(cacheKey, durable);
      await this.db.incrementCacheHit(cacheKey).catch(() => undefined);
      return this.toCompletion(durable, 'exact', 1);
    }

    return this.findSimilar(lookup);
  }

  private async findSimilar(lookup: CacheLookup): Promise<CachedCompletion | null> {
    const candidates = await this.db.listCacheEntriesByRole(lookup.role, SEMANTIC_SCAN_LIMIT);
    if (candidates.length === 0) return null;

    const needle = normalizeForCache(lookup.prompt);
    let best: { entry: CacheEntryRecord; similarity: number } | null = null;

    for (const entry of candidates) {
      const candidate = normalizeForCache(entry.prompt);

      // Bag-of-words similarity overstates equivalence on repetitive text: a
      // prompt with 45% of the code removed still shares most of its
      // vocabulary. Require comparable length before trusting the score.
      const ratio = Math.min(needle.length, candidate.length) / Math.max(1, Math.max(needle.length, candidate.length));
      if (ratio < LENGTH_RATIO_FLOOR) continue;

      const similarity = cosineSimilarity(needle, candidate);
      if (!best || similarity > best.similarity) best = { entry, similarity };
    }

    if (!best || best.similarity < config.cache.similarityThreshold) return null;

    await this.db.incrementCacheHit(best.entry.cacheKey).catch(() => undefined);
    logger.debug(
      { role: lookup.role, similarity: Number(best.similarity.toFixed(3)) },
      'Semantic cache hit',
    );
    return this.toCompletion(best.entry, 'semantic', best.similarity);
  }

  async set(
    lookup: CacheLookup,
    result: Pick<SubTaskResult, 'output' | 'confidence' | 'actualInputTokens' | 'actualOutputTokens' | 'role'>,
    ttlSeconds: number,
  ): Promise<void> {
    if (!config.features.semanticCache || ttlSeconds <= 0) return;

    const cacheKey = this.buildKey(lookup);
    const entry: CacheEntryRecord = {
      cacheKey,
      prompt: lookup.prompt,
      response: result.output,
      provider: lookup.provider,
      model: lookup.model,
      role: result.role,
      confidence: result.confidence,
      inputTokens: result.actualInputTokens,
      outputTokens: result.actualOutputTokens,
      hitCount: 0,
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + ttlSeconds * 1000),
    };

    await this.db.putCacheEntry(entry).catch((error: Error) => {
      logger.debug({ err: error.message }, 'Durable cache write failed');
    });
    await this.warm(cacheKey, entry, ttlSeconds);
  }

  private async warm(cacheKey: string, entry: CacheEntryRecord, ttlSeconds?: number): Promise<void> {
    const ttl = ttlSeconds ?? Math.max(1, Math.ceil((entry.expiresAt.getTime() - Date.now()) / 1000));
    await this.store.setex(
      RedisKeys.cacheEntry(cacheKey),
      ttl,
      JSON.stringify(this.toCompletion(entry, 'exact', 1)),
    );
  }

  private toCompletion(
    entry: CacheEntryRecord,
    matchType: 'exact' | 'semantic',
    similarity: number,
  ): CachedCompletion {
    return {
      text: entry.response,
      provider: entry.provider as ProviderName,
      model: entry.model,
      inputTokens: entry.inputTokens,
      outputTokens: entry.outputTokens,
      confidence: entry.confidence ?? 0.75,
      matchType,
      similarity,
    };
  }

  async purgeExpired(): Promise<number> {
    return this.db.purgeExpiredCache();
  }
}
