#!/usr/bin/env tsx
/**
 * ModelMesh — register provider API keys with a running backend.
 *
 * Reads the comma-separated key lists from the environment (the same variables
 * `apps/api/src/config.ts` reads) and POSTs each key to
 * `POST /api/v1/providers/keys`. The backend stores keys AES-256-GCM encrypted and
 * de-duplicates by SHA-256 hash, so re-running this is idempotent — an existing key
 * is simply re-activated.
 *
 * Real keys are never required: with none configured the backend enables its
 * deterministic mock provider and the whole pipeline still runs. This script exits
 * 0 in that case and says so.
 *
 * Usage:
 *   pnpm run seed
 *   API_URL=http://192.168.1.20:3000 pnpm run seed
 *
 * Deliberately imports nothing but Node builtins: it is invoked from the repo root
 * where the API's node_modules are not on the resolution path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PROVIDERS = ['gemini', 'groq', 'together', 'mistral', 'openrouter'] as const;
type Provider = (typeof PROVIDERS)[number];

/** The env var per provider — must stay in step with config.ts. */
const KEY_ENV_VAR: Record<Provider, string> = {
  gemini: 'GEMINI_API_KEYS',
  groq: 'GROQ_API_KEYS',
  together: 'TOGETHER_API_KEYS',
  mistral: 'MISTRAL_API_KEYS',
  openrouter: 'OPENROUTER_API_KEYS',
};

/** `POST /providers/keys` enforces 8..400 chars (apps/api/src/api/routes/providers.ts). */
const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 400;

const REPO_ROOT = resolve(__dirname, '..');

/**
 * Same precedence as `config.ts`: the repo `.env` then an app-local one, and an
 * already-exported shell variable always wins.
 */
const loadEnvFiles = (): void => {
  for (const candidate of [resolve(REPO_ROOT, '.env'), resolve(REPO_ROOT, 'apps/api/.env')]) {
    if (!existsSync(candidate)) continue;

    for (const rawLine of readFileSync(candidate, 'utf8').split('\n')) {
      const line = rawLine.trim();
      if (line.length === 0 || line.startsWith('#')) continue;

      const separator = line.indexOf('=');
      if (separator <= 0) continue;

      const name = line.slice(0, separator).trim();
      if (process.env[name] !== undefined) continue;

      let value = line.slice(separator + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[name] = value;
    }
  }
};

const parseKeyList = (value: string | undefined): string[] => {
  if (!value) return [];
  return [...new Set(value.split(',').map((entry) => entry.trim()).filter((entry) => entry.length > 0))];
};

/** Only ever printed in this shape; the plaintext key is never logged. */
const mask = (key: string): string =>
  key.length <= 8 ? '*'.repeat(key.length) : `${key.slice(0, 4)}…${key.slice(-4)}`;

interface KeyToSeed {
  provider: Provider;
  key: string;
  priority: number;
  label: string;
}

const collectKeys = (): KeyToSeed[] => {
  const collected: KeyToSeed[] = [];

  for (const provider of PROVIDERS) {
    const keys = parseKeyList(process.env[KEY_ENV_VAR[provider]]);
    keys.forEach((key, index) => {
      if (key.length < MIN_KEY_LENGTH || key.length > MAX_KEY_LENGTH) {
        console.warn(
          `  ! ${provider} key #${index + 1} is ${key.length} chars; the backend accepts ${MIN_KEY_LENGTH}–${MAX_KEY_LENGTH}. Skipped.`,
        );
        return;
      }
      collected.push({
        provider,
        key,
        // Lower is tried first, so the order they were listed in is honoured.
        priority: index + 1,
        label: `${provider}-${index + 1}`,
      });
    });
  }

  return collected;
};

const main = async (): Promise<number> => {
  loadEnvFiles();

  const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const apiSecret = process.env.API_SECRET ?? 'dev-secret-change-me';
  const keys = collectKeys();

  console.log(`ModelMesh key seeder → ${baseUrl}`);

  if (keys.length === 0) {
    console.log(
      '\nNo provider keys found in the environment.\n' +
        `Set any of ${PROVIDERS.map((provider) => KEY_ENV_VAR[provider]).join(', ')} in .env (comma-separated for multiple keys).\n` +
        'Nothing to do — the backend runs the full pipeline on its mock provider without keys.',
    );
    return 0;
  }

  // Fail fast with a useful message rather than five connection errors.
  try {
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (error) {
    console.error(
      `\nCannot reach ${baseUrl}/health (${(error as Error).message}).\n` +
        'Start the backend first: pnpm --filter @modelmesh/api dev',
    );
    return 1;
  }

  let registered = 0;
  let failed = 0;

  for (const entry of keys) {
    const label = `${entry.provider} ${mask(entry.key)}`;
    try {
      const response = await fetch(`${baseUrl}/api/v1/providers/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-API-Key': apiSecret },
        body: JSON.stringify({
          provider: entry.provider,
          key: entry.key,
          priority: entry.priority,
          label: entry.label,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        keyId?: string;
        maskedKey?: string;
        status?: string;
        error?: { code?: string; message?: string };
      };

      if (response.status === 201) {
        registered += 1;
        console.log(`  ✓ ${label} → ${payload.maskedKey ?? 'registered'} (${payload.status ?? 'active'})`);
      } else if (response.status === 401) {
        failed += 1;
        console.error(`  ✗ ${label} → 401 UNAUTHORIZED. API_SECRET does not match the server's.`);
      } else {
        failed += 1;
        console.error(
          `  ✗ ${label} → HTTP ${response.status} ${payload.error?.code ?? ''} ${payload.error?.message ?? ''}`.trimEnd(),
        );
      }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${label} → ${(error as Error).message}`);
    }
  }

  console.log(`\n${registered} key(s) registered, ${failed} failed.`);
  if (registered > 0) {
    console.log('Check the pool: curl -H "X-API-Key: $API_SECRET" ' + `${baseUrl}/api/v1/providers/status`);
  }

  return failed > 0 ? 1 : 0;
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('Seeder crashed:', error);
    process.exit(1);
  });
