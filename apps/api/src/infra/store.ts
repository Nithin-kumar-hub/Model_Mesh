/**
 * Ephemeral key/value + sorted-set store.
 *
 * Redis in production (BullMQ, semantic cache, rate limits, key health).
 * An in-process implementation with identical semantics keeps the whole system
 * runnable — and the test suite hermetic — with no Redis on the machine.
 */
import Redis from 'ioredis';
import { config } from '../config';
import { logger } from './logger';

export interface KeyValueStore {
  readonly kind: 'redis' | 'memory';
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  setex(key: string, ttlSeconds: number, value: string): Promise<void>;
  del(...keys: string[]): Promise<void>;
  exists(key: string): Promise<boolean>;
  incrby(key: string, amount: number): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
  ttl(key: string): Promise<number>;
  keys(pattern: string): Promise<string[]>;
  zadd(key: string, score: number, member: string): Promise<void>;
  zrem(key: string, member: string): Promise<void>;
  /** Members ordered by score, highest first. */
  zrevrange(key: string, start: number, stop: number): Promise<string[]>;
  zscore(key: string, member: string): Promise<number | null>;
  /** Best-effort distributed lock. Returns false when already held. */
  acquireLock(key: string, ttlSeconds: number): Promise<boolean>;
  releaseLock(key: string): Promise<void>;
  flushPrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

// ─── In-process implementation ────────────────────────────────────────────

interface Entry {
  value: string;
  expiresAtMs: number | null;
}

export class MemoryStore implements KeyValueStore {
  readonly kind = 'memory' as const;
  private readonly entries = new Map<string, Entry>();
  private readonly sortedSets = new Map<string, Map<string, number>>();

  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAtMs !== null && entry.expiresAtMs <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  async get(key: string): Promise<string | null> {
    return this.live(key)?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.entries.set(key, { value, expiresAtMs: this.live(key)?.expiresAtMs ?? null });
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    this.entries.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    for (const key of keys) {
      this.entries.delete(key);
      this.sortedSets.delete(key);
    }
  }

  async exists(key: string): Promise<boolean> {
    return this.live(key) !== undefined;
  }

  async incrby(key: string, amount: number): Promise<number> {
    const current = Number(this.live(key)?.value ?? 0);
    const next = current + amount;
    this.entries.set(key, { value: String(next), expiresAtMs: this.live(key)?.expiresAtMs ?? null });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    const entry = this.live(key);
    if (entry) entry.expiresAtMs = Date.now() + ttlSeconds * 1000;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.live(key);
    if (!entry) return -2;
    if (entry.expiresAtMs === null) return -1;
    return Math.ceil((entry.expiresAtMs - Date.now()) / 1000);
  }

  async keys(pattern: string): Promise<string[]> {
    const regex = new RegExp(`^${pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
    const found: string[] = [];
    for (const key of [...this.entries.keys()]) {
      if (this.live(key) && regex.test(key)) found.push(key);
    }
    return found;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    const set = this.sortedSets.get(key) ?? new Map<string, number>();
    set.set(member, score);
    this.sortedSets.set(key, set);
  }

  async zrem(key: string, member: string): Promise<void> {
    this.sortedSets.get(key)?.delete(member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const set = this.sortedSets.get(key);
    if (!set) return [];
    const ordered = [...set.entries()].sort((a, b) => b[1] - a[1]).map(([member]) => member);
    const end = stop < 0 ? ordered.length + stop + 1 : stop + 1;
    return ordered.slice(start, end);
  }

  async zscore(key: string, member: string): Promise<number | null> {
    return this.sortedSets.get(key)?.get(member) ?? null;
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    if (this.live(key)) return false;
    await this.setex(key, ttlSeconds, '1');
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.entries.delete(key);
  }

  async flushPrefix(prefix: string): Promise<void> {
    for (const key of [...this.entries.keys()]) if (key.startsWith(prefix)) this.entries.delete(key);
    for (const key of [...this.sortedSets.keys()]) if (key.startsWith(prefix)) this.sortedSets.delete(key);
  }

  async close(): Promise<void> {
    this.entries.clear();
    this.sortedSets.clear();
  }
}

// ─── Redis implementation ─────────────────────────────────────────────────

export class RedisStore implements KeyValueStore {
  readonly kind = 'redis' as const;

  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string): Promise<void> {
    await this.redis.set(key, value);
  }

  async setex(key: string, ttlSeconds: number, value: string): Promise<void> {
    await this.redis.setex(key, Math.max(1, Math.ceil(ttlSeconds)), value);
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async exists(key: string): Promise<boolean> {
    return (await this.redis.exists(key)) === 1;
  }

  async incrby(key: string, amount: number): Promise<number> {
    return this.redis.incrby(key, amount);
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.redis.expire(key, Math.max(1, Math.ceil(ttlSeconds)));
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async keys(pattern: string): Promise<string[]> {
    // SCAN rather than KEYS: never block the server on a large keyspace.
    const found: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
      cursor = next;
      found.push(...batch);
    } while (cursor !== '0');
    return found;
  }

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.redis.zadd(key, score, member);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.redis.zrem(key, member);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.redis.zrevrange(key, start, stop);
  }

  async zscore(key: string, member: string): Promise<number | null> {
    const score = await this.redis.zscore(key, member);
    return score === null ? null : Number(score);
  }

  async acquireLock(key: string, ttlSeconds: number): Promise<boolean> {
    const result = await this.redis.set(key, '1', 'EX', Math.max(1, Math.ceil(ttlSeconds)), 'NX');
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async flushPrefix(prefix: string): Promise<void> {
    const keys = await this.keys(`${prefix}*`);
    if (keys.length > 0) await this.redis.del(...keys);
  }

  async close(): Promise<void> {
    await this.redis.quit().catch(() => this.redis.disconnect());
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────

export interface StoreHandle {
  store: KeyValueStore;
  /** Present only when a live Redis connection exists — BullMQ needs the raw client. */
  redis: Redis | null;
}

const connectRedis = async (url: string): Promise<Redis | null> => {
  const client = new Redis(url, {
    lazyConnect: true,
    maxRetriesPerRequest: null, // required by BullMQ
    enableOfflineQueue: false,
    retryStrategy: (attempt) => (attempt > 3 ? null : Math.min(attempt * 200, 1000)),
  });

  client.on('error', (error: Error) => {
    logger.debug({ err: error.message }, 'redis error');
  });

  try {
    await client.connect();
    await client.ping();
    return client;
  } catch (error) {
    client.disconnect();
    logger.warn({ err: (error as Error).message }, 'Redis unavailable');
    return null;
  }
};

export const createStore = async (): Promise<StoreHandle> => {
  const mode = config.datastore.cache;
  const url = config.datastore.redisUrl;

  if (mode === 'memory' || !url) {
    if (mode === 'redis') logger.warn('CACHE_BACKEND=redis but REDIS_URL is empty — using memory store');
    return { store: new MemoryStore(), redis: null };
  }

  const redis = await connectRedis(url);
  if (redis) {
    logger.info({ backend: 'redis' }, 'Cache backend ready');
    return { store: new RedisStore(redis), redis };
  }

  if (mode === 'redis') throw new Error('CACHE_BACKEND=redis but Redis could not be reached');
  logger.warn({ backend: 'memory' }, 'Falling back to in-process cache store');
  return { store: new MemoryStore(), redis: null };
};

/** Redis key namespaces (docs/05-DATA-MODELS.md). */
export const RedisKeys = {
  keyManager: (provider: string) => `key:manager:${provider}`,
  keyRateLimit: (id: string) => `key:ratelimit:${id}`,
  keyLatency: (id: string) => `key:latency:${id}`,
  taskState: (id: string) => `task:state:${id}`,
  cacheEntry: (hash: string) => `cache:${hash}`,
  cacheIndex: (role: string) => `cache:index:${role}`,
  providerQuota: (provider: string, day: string) => `provider:quota:${provider}:${day}`,
  providerLatency: (provider: string) => `provider:latency:${provider}`,
  subtaskLock: (id: string) => `subtask:lock:${id}`,
  contextMemory: (sessionId: string) => `context:memory:${sessionId}`,
  rateLimit: (bucket: string, id: string) => `ratelimit:${bucket}:${id}`,
} as const;
