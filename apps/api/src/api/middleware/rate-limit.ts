import type { FastifyReply, FastifyRequest } from 'fastify';
import { RedisKeys, type KeyValueStore } from '../../infra/store';

/**
 * Sliding-window rate limiting, backed by the shared KV store so the counters
 * are correct across instances when Redis is present and still work when it is
 * not. Limits come from docs/04-API-SPEC.md.
 */

export interface RateLimitRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

export interface RateLimitState {
  allowed: boolean;
  remaining: number;
  resetSeconds: number;
}

export const checkRateLimit = async (
  store: KeyValueStore,
  identity: string,
  rule: RateLimitRule,
): Promise<RateLimitState> => {
  const key = RedisKeys.rateLimit(rule.bucket, identity);
  const count = await store.incrby(key, 1);

  if (count === 1) await store.expire(key, rule.windowSeconds);
  const ttl = await store.ttl(key);

  return {
    allowed: count <= rule.limit,
    remaining: Math.max(0, rule.limit - count),
    resetSeconds: ttl > 0 ? ttl : rule.windowSeconds,
  };
};

/** Per-route guard. Identity is the API key when present, else the peer IP. */
export const rateLimitHook =
  (store: KeyValueStore, rule: RateLimitRule) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const header = request.headers['x-api-key'];
    const identity = (Array.isArray(header) ? header[0] : header) ?? request.ip;

    const state = await checkRateLimit(store, identity, rule);
    reply.header('X-RateLimit-Limit', rule.limit);
    reply.header('X-RateLimit-Remaining', state.remaining);
    reply.header('X-RateLimit-Reset', state.resetSeconds);

    if (!state.allowed) {
      reply.header('Retry-After', state.resetSeconds);
      await reply.status(429).send({
        error: {
          code: 'RATE_LIMIT_GLOBAL',
          message: `Rate limit exceeded: ${rule.limit} requests per ${rule.windowSeconds}s`,
          retryAfterSeconds: state.resetSeconds,
        },
      });
    }
  };
