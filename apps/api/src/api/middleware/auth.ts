import { timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { config } from '../../config';

/**
 * API-key auth. The Android client holds one shared secret (API_SECRET); the
 * comparison is constant-time so a wrong key leaks nothing through timing.
 */

const PUBLIC_ROUTES = new Set(['/health', '/ready', '/', '/api/v1/health']);

const matches = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
};

export const authPlugin = fp(async (app) => {
  app.decorateRequest('apiKeyId', '');

  app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
    if (PUBLIC_ROUTES.has(request.url.split('?')[0] ?? '')) return;

    const provided = request.headers['x-api-key'];
    const key = Array.isArray(provided) ? provided[0] : provided;

    if (!key || !matches(key, config.server.apiSecret)) {
      await reply.status(401).send({
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid X-API-Key header' },
      });
    }
  });
});

declare module 'fastify' {
  interface FastifyRequest {
    apiKeyId: string;
  }
}
