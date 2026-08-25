/**
 * Environment + derived configuration.
 *
 * Everything the app needs is resolved once, validated with envalid, and
 * exported as a frozen object. Nothing else in the codebase reads process.env.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { bool, cleanEnv, makeValidator, num, port, str } from 'envalid';
import type { ExecutionStrategy, ProviderName } from '@modelmesh/types';

// Load .env from the repo root first, then let an app-local .env win.
for (const candidate of [
  resolve(__dirname, '../../../.env'),
  resolve(__dirname, '../.env'),
]) {
  if (existsSync(candidate)) loadDotenv({ path: candidate, override: false });
}

/** Comma-separated list → trimmed, de-duplicated, non-empty entries. */
const csv = makeValidator<string[]>((input) => {
  if (!input) return [];
  const parts = input
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return [...new Set(parts)];
});

const env = cleanEnv(process.env, {
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),
  PORT: port({ default: 3000 }),
  HOST: str({ default: '0.0.0.0' }),
  LOG_LEVEL: str({
    choices: ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'],
    default: 'info',
  }),

  DATABASE_URL: str({ default: '' }),
  REDIS_URL: str({ default: '' }),
  PERSISTENCE: str({ choices: ['auto', 'prisma', 'memory'], default: 'auto' }),
  CACHE_BACKEND: str({ choices: ['auto', 'redis', 'memory'], default: 'auto' }),

  API_SECRET: str({ default: 'dev-secret-change-me' }),
  KEY_ENCRYPTION_SECRET: str({ default: 'dev-encryption-secret-change-me-please' }),

  GEMINI_API_KEYS: csv({ default: [] }),
  GROQ_API_KEYS: csv({ default: [] }),
  TOGETHER_API_KEYS: csv({ default: [] }),
  MISTRAL_API_KEYS: csv({ default: [] }),
  OPENROUTER_API_KEYS: csv({ default: [] }),

  ENABLE_SEMANTIC_CACHE: bool({ default: true }),
  ENABLE_PARALLEL_EXECUTION: bool({ default: true }),
  ENABLE_VERIFICATION: bool({ default: true }),
  ENABLE_MOCK_PROVIDER: bool({ default: true }),
  ENABLE_QUEUE: bool({ default: true }),
  MAX_PARALLEL_SUBTASKS: num({ default: 4 }),
  DEFAULT_STRATEGY: str({ choices: ['draft', 'balanced', 'premium'], default: 'balanced' }),

  TASK_TIMEOUT_MS: num({ default: 60_000 }),
  MAX_FILE_BYTES: num({ default: 20 * 1024 * 1024 }),
  MAX_ATTEMPTS_PER_SUBTASK: num({ default: 3 }),
  PROVIDER_TIMEOUT_MS: num({ default: 45_000 }),

  CACHE_TTL_DEFAULT_SECONDS: num({ default: 3600 }),
  CACHE_TTL_DOCUMENT_SECONDS: num({ default: 86_400 }),
  RATE_LIMIT_TASKS_PER_MIN: num({ default: 10 }),
  RATE_LIMIT_READS_PER_MIN: num({ default: 60 }),
});

const providerKeys: Record<Exclude<ProviderName, 'mock'>, string[]> = {
  gemini: env.GEMINI_API_KEYS,
  groq: env.GROQ_API_KEYS,
  together: env.TOGETHER_API_KEYS,
  mistral: env.MISTRAL_API_KEYS,
  openrouter: env.OPENROUTER_API_KEYS,
};

const realKeyCount = Object.values(providerKeys).reduce((sum, keys) => sum + keys.length, 0);

export const config = Object.freeze({
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  isDev: env.NODE_ENV === 'development',

  server: {
    port: env.PORT,
    host: env.HOST,
    logLevel: env.LOG_LEVEL,
    apiSecret: env.API_SECRET,
  },

  datastore: {
    databaseUrl: env.DATABASE_URL,
    redisUrl: env.REDIS_URL,
    /** auto = try the real backend, fall back to in-process on failure. */
    persistence: env.PERSISTENCE as 'auto' | 'prisma' | 'memory',
    cache: env.CACHE_BACKEND as 'auto' | 'redis' | 'memory',
  },

  security: {
    keyEncryptionSecret: env.KEY_ENCRYPTION_SECRET,
  },

  providerKeys,
  /**
   * With no real keys configured the deterministic mock provider carries the
   * pipeline, so the whole 15-layer flow stays demoable offline.
   */
  mockProviderEnabled: env.ENABLE_MOCK_PROVIDER || realKeyCount === 0,
  hasRealProviderKeys: realKeyCount > 0,

  features: {
    semanticCache: env.ENABLE_SEMANTIC_CACHE,
    parallelExecution: env.ENABLE_PARALLEL_EXECUTION,
    verification: env.ENABLE_VERIFICATION,
    queue: env.ENABLE_QUEUE,
  },

  execution: {
    maxParallelSubtasks: Math.max(1, env.MAX_PARALLEL_SUBTASKS),
    defaultStrategy: env.DEFAULT_STRATEGY as ExecutionStrategy,
    taskTimeoutMs: env.TASK_TIMEOUT_MS,
    maxAttemptsPerSubtask: Math.max(1, env.MAX_ATTEMPTS_PER_SUBTASK),
    providerTimeoutMs: env.PROVIDER_TIMEOUT_MS,
  },

  limits: {
    maxFileBytes: env.MAX_FILE_BYTES,
    tasksPerMinute: env.RATE_LIMIT_TASKS_PER_MIN,
    readsPerMinute: env.RATE_LIMIT_READS_PER_MIN,
  },

  cache: {
    defaultTtlSeconds: env.CACHE_TTL_DEFAULT_SECONDS,
    documentTtlSeconds: env.CACHE_TTL_DOCUMENT_SECONDS,
    /** Cosine-similarity floor for a semantic hit (CLAUDE.md §10). */
    similarityThreshold: 0.95,
  },
});

export type AppConfig = typeof config;
