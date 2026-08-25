import pino from 'pino';
import { config } from '../config';

/**
 * Shared logger for code paths that run outside a Fastify request
 * (workers, schedulers, bootstrap). Fastify reuses this same instance.
 */
export const logger = pino({
  level: config.server.logLevel,
  base: { service: 'modelmesh-api' },
  redact: {
    paths: ['apiKey', '*.apiKey', 'key', '*.key', 'encryptedKey', '*.encryptedKey', 'req.headers["x-api-key"]'],
    censor: '[redacted]',
  },
  transport:
    config.isDev && config.server.logLevel !== 'silent'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss.l' } }
      : undefined,
});

export type Logger = pino.Logger;
