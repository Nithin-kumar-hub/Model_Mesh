import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    // The suite must never touch Postgres, Redis, or a real provider.
    env: {
      NODE_ENV: 'test',
      PERSISTENCE: 'memory',
      CACHE_BACKEND: 'memory',
      ENABLE_MOCK_PROVIDER: 'true',
      API_SECRET: 'test-secret',
      KEY_ENCRYPTION_SECRET: 'test-encryption-secret-at-least-32-chars',
      LOG_LEVEL: 'silent',
      GEMINI_API_KEYS: '',
      GROQ_API_KEYS: '',
      TOGETHER_API_KEYS: '',
      MISTRAL_API_KEYS: '',
      OPENROUTER_API_KEYS: '',
      // The integration suite submits more tasks per minute than a phone would.
      RATE_LIMIT_TASKS_PER_MIN: '1000',
      RATE_LIMIT_READS_PER_MIN: '100000',
    },
  },
  resolve: {
    alias: {
      '@modelmesh/types': resolve(__dirname, '../../packages/types/src/index.ts'),
    },
  },
});
