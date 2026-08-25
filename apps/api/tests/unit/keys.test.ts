import { beforeEach, describe, expect, it } from 'vitest';
import { MemoryPersistence } from '../../src/infra/persistence';
import { MemoryStore } from '../../src/infra/store';
import { KeyManager } from '../../src/keys/manager';
import { KeyRotator } from '../../src/keys/rotator';

/**
 * Multi-key management (CLAUDE.md §10 "On the Key Manager").
 *
 * Health is a rolling success rate, 429 cools a key down and rotates, 401 is
 * terminal, and raw key material never leaves the manager.
 */

const RAW_KEY_A = 'AIzaSy-test-key-alpha-0000000001';
const RAW_KEY_B = 'AIzaSy-test-key-bravo-0000000002';

let store: MemoryStore;
let db: MemoryPersistence;
let keys: KeyManager;

beforeEach(() => {
  store = new MemoryStore();
  db = new MemoryPersistence();
  keys = new KeyManager(store, db);
});

describe('KeyManager — selection', () => {
  it('hands back the decrypted key it was given', async () => {
    const record = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const lease = await keys.getBestKey('gemini');

    expect(lease).not.toBeNull();
    expect(lease?.keyId).toBe(record.id);
    expect(lease?.apiKey).toBe(RAW_KEY_A);
    expect(lease?.provider).toBe('gemini');
  });

  it('returns null for a provider with no keys', async () => {
    expect(await keys.getBestKey('groq')).toBeNull();
    expect(await keys.hasAvailableKey('groq')).toBe(false);
  });

  it('does not re-import a key it already holds', async () => {
    const first = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const second = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A, label: 'again' });

    expect(second.id).toBe(first.id);
    expect(await db.listProviderKeys('gemini')).toHaveLength(1);
  });

  it('skips an excluded key', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });

    const lease = await keys.getBestKey('gemini', [a.id]);
    expect(lease?.keyId).not.toBe(a.id);
  });

  it('prefers the healthier key', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const b = await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });

    // Three failures on A, one success on B.
    for (let i = 0; i < 3; i++) await keys.recordFailure(a.id, 'SERVER_ERROR');
    await keys.recordSuccess(b.id, 'gemini', 100, 120);

    expect((await keys.getBestKey('gemini'))?.keyId).toBe(b.id);
    expect((await db.getProviderKey(a.id))?.healthScore).toBeLessThan(1);
    expect((await db.getProviderKey(b.id))?.healthScore).toBe(1);
  });

  it('breaks a health tie with priority', async () => {
    await keys.addKey({ provider: 'gemini', key: RAW_KEY_A, priority: 5 });
    const preferred = await keys.addKey({ provider: 'gemini', key: RAW_KEY_B, priority: 1 });

    expect((await keys.getBestKey('gemini'))?.keyId).toBe(preferred.id);
  });

  it('reports the mock provider as available without any configured key', async () => {
    const lease = await keys.getBestKey('mock');

    expect(lease?.keyId).toBe('key_mock');
    expect(await keys.getAvailableProviders()).toContain('mock');
  });
});

describe('KeyManager — rate limiting and quota', () => {
  it('rotates away from a rate-limited key for the cooldown window', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const b = await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });

    await keys.markRateLimited(a.id, 30);

    expect((await keys.getBestKey('gemini'))?.keyId).toBe(b.id);
    expect((await db.getProviderKey(a.id))?.isRateLimited).toBe(true);
  });

  it('reports no key when every key is cooling down', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const b = await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });

    await keys.markRateLimited(a.id, 30);
    await keys.markRateLimited(b.id, 30);

    expect(await keys.getBestKey('gemini')).toBeNull();
    expect(await keys.getAvailableProviders()).not.toContain('gemini');
  });

  it('never cools down the mock lease', async () => {
    await keys.markRateLimited('key_mock', 60);
    expect(await keys.getBestKey('mock')).not.toBeNull();
  });

  it('stops handing out a key that has exhausted its quota', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A, quotaLimit: 500 });

    await keys.recordSuccess(a.id, 'gemini', 600, 100);

    expect(await keys.getBestKey('gemini')).toBeNull();
    expect(await keys.quotaConsumedToday('gemini')).toBe(600);
  });

  it('clears the rate-limit flag after a success', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    await keys.markRateLimited(a.id, 30);

    await keys.recordSuccess(a.id, 'gemini', 100, 100);

    expect((await db.getProviderKey(a.id))?.isRateLimited).toBe(false);
  });
});

describe('KeyManager — health and lifecycle', () => {
  it('computes health as the rolling success rate', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });

    await keys.recordSuccess(a.id, 'gemini', 10, 10);
    await keys.recordFailure(a.id, 'SERVER_ERROR');
    await keys.recordSuccess(a.id, 'gemini', 10, 10);
    await keys.recordSuccess(a.id, 'gemini', 10, 10);

    const record = await db.getProviderKey(a.id);
    expect(record?.healthScore).toBeCloseTo(0.75, 5);
    expect(record?.totalCalls).toBe(4);
    expect(record?.failedCalls).toBe(1);
  });

  it('deactivates a key the provider rejected', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });

    await keys.recordFailure(a.id, 'AUTH');

    expect((await db.getProviderKey(a.id))?.active).toBe(false);
    expect(await keys.getBestKey('gemini')).toBeNull();
  });

  it('shaves health without deactivating on a transient error', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });

    await keys.decrementHealth(a.id, 0.1);

    const record = await db.getProviderKey(a.id);
    expect(record?.healthScore).toBeCloseTo(0.9, 5);
    expect(record?.active).toBe(true);
  });

  it('never exposes raw or encrypted key material', async () => {
    await keys.addKey({ provider: 'gemini', key: RAW_KEY_A, label: 'primary' });

    const display = await keys.listKeysForDisplay();
    const serialized = JSON.stringify(display);

    expect(display).toHaveLength(1);
    expect(serialized).not.toContain(RAW_KEY_A);
    expect(serialized).not.toContain('encryptedKey');
    expect(display[0]?.maskedKey).not.toBe(RAW_KEY_A);
    expect(display[0]?.maskedKey).toContain('*');
    expect(display[0]?.maskedKey.length).toBeLessThan(RAW_KEY_A.length);
  });

  it('summarizes provider status for the API', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });
    await keys.markRateLimited(a.id, 30);

    const report = await keys.statusReport({ gemini: ['gemini-1.5-flash'], mock: ['mock-balanced'] });
    const gemini = report.find((entry) => entry.provider === 'gemini');

    expect(gemini?.activeKeys).toBe(1);
    expect(gemini?.rateLimitedKeys).toBe(1);
    expect(gemini?.status).toBe('degraded');
    expect(gemini?.models).toEqual(['gemini-1.5-flash']);
    expect(report.some((entry) => entry.provider === 'mock')).toBe(true);
  });
});

describe('KeyRotator', () => {
  it('cools the key down and rotates on 429', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });
    const rotator = new KeyRotator(keys);

    const outcome = await rotator.classify(a.id, 'RATE_LIMIT', 1, 15);

    expect(outcome.action).toBe('ROTATE_KEY');
    expect(outcome.delayMs).toBe(0);
    expect((await keys.getBestKey('gemini'))?.keyId).not.toBe(a.id);
  });

  it('backs off on the same key for an early 5xx, then swaps provider', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const rotator = new KeyRotator(keys);

    const early = await rotator.classify(a.id, 'SERVER_ERROR', 1);
    expect(early.action).toBe('RETRY_SAME_KEY');
    expect(early.delayMs).toBeGreaterThan(0);
    // Not rotated away: a 5xx is usually the provider, not the key.
    expect((await keys.getBestKey('gemini'))?.keyId).toBe(a.id);

    const late = await rotator.classify(a.id, 'SERVER_ERROR', 3);
    expect(late.action).toBe('SWAP_PROVIDER');
    expect((await db.getProviderKey(a.id))?.healthScore).toBeLessThan(1);
  });

  it('retries a timeout once before swapping provider', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const rotator = new KeyRotator(keys);

    expect((await rotator.classify(a.id, 'TIMEOUT', 1)).action).toBe('RETRY_SAME_KEY');
    expect((await rotator.classify(a.id, 'TIMEOUT', 2)).action).toBe('SWAP_PROVIDER');
  });

  it('treats 401 as terminal for that key', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const rotator = new KeyRotator(keys);

    const outcome = await rotator.classify(a.id, 'AUTH', 1);

    expect(outcome.action).toBe('ROTATE_KEY');
    expect((await db.getProviderKey(a.id))?.active).toBe(false);
  });

  it('does not retry a request the provider rejected as malformed', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const rotator = new KeyRotator(keys);

    const outcome = await rotator.classify(a.id, 'BAD_REQUEST', 1);

    expect(outcome.action).toBe('SWAP_PROVIDER');
    expect(outcome.delayMs).toBe(0);
  });

  it('rotates once on an unknown error, then swaps provider', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const rotator = new KeyRotator(keys);

    expect((await rotator.classify(a.id, 'UNKNOWN', 1)).action).toBe('ROTATE_KEY');
    expect((await rotator.classify(a.id, 'UNKNOWN', 2)).action).toBe('SWAP_PROVIDER');
  });

  it('next() walks past the keys already tried', async () => {
    const a = await keys.addKey({ provider: 'gemini', key: RAW_KEY_A });
    const b = await keys.addKey({ provider: 'gemini', key: RAW_KEY_B });
    const rotator = new KeyRotator(keys);

    expect((await rotator.next('gemini', [a.id]))?.keyId).toBe(b.id);
    expect(await rotator.next('gemini', [a.id, b.id])).toBeNull();
  });
});
