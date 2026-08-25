#!/usr/bin/env tsx
/**
 * ModelMesh — end-to-end smoke test against a running backend.
 *
 * Submits one small text task, follows it to a terminal status, and prints what the
 * orchestrator actually did: the plan it chose, the parallel batches, the models it
 * used, and the honest token accounting (savings are only ever reported for
 * subtasks that produced a result).
 *
 * Requires no API keys. With none configured the backend runs its deterministic
 * mock provider, which exercises every layer of the pipeline offline.
 *
 * Usage:
 *   pnpm run test-providers
 *   API_URL=http://192.168.1.20:3000 pnpm run test-providers
 *
 * Deliberately imports nothing but Node builtins: it is invoked from the repo root
 * where the API's node_modules are not on the resolution path.
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..');

/** `RATE_LIMIT_READS_PER_MIN` defaults to 60, so stay well under one read/second. */
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 120_000;

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

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

interface ReadyResponse {
  status?: string;
  persistence?: { backend?: string; ok?: boolean };
  cache?: { backend?: string };
  execution?: { mode?: string };
  providers?: { available?: string[]; mockEnabled?: boolean };
}

interface SubtaskView {
  id: string;
  role?: string;
  status?: string;
  provider?: string | null;
  model?: string | null;
  dependencies?: string[];
  confidence?: number | null;
  tokens?: number;
  latencyMs?: number | null;
  failovers?: number;
  fromCache?: boolean;
  errorCode?: string | null;
}

interface TaskResponse {
  taskId: string;
  status: string;
  taskType?: string | null;
  strategy?: string;
  error?: { code?: string } | null;
  result?: { output: string; confidence?: number | null; partial?: boolean } | null;
  plan?: {
    strategy?: string;
    subtaskCount?: number;
    parallelGroups?: string[][];
    estimatedTokens?: number | null;
    reasoning?: string | null;
  } | null;
  subtasks?: SubtaskView[];
  verification?: { verified?: boolean; confidence?: number; issues?: string[]; verifiedBy?: string | null } | null;
  telemetry?: {
    totalMs?: number | null;
    estimatedTokens?: number | null;
    actualTokens?: number | null;
    savedTokens?: number | null;
    savingsPercent?: number;
    failovers?: number;
    cacheHits?: number;
    providerBreakdown?: Array<{ provider?: string; model?: string }>;
  } | null;
}

const main = async (): Promise<number> => {
  loadEnvFiles();

  const baseUrl = (process.env.API_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  const apiSecret = process.env.API_SECRET ?? 'dev-secret-change-me';
  const headers = { 'Content-Type': 'application/json', 'X-API-Key': apiSecret };

  console.log(`ModelMesh smoke test → ${baseUrl}\n`);

  // ── Readiness ──────────────────────────────────────────────────────────────
  let ready: ReadyResponse;
  try {
    const response = await fetch(`${baseUrl}/ready`);
    ready = (await response.json()) as ReadyResponse;
  } catch (error) {
    console.error(
      `Cannot reach ${baseUrl}/ready (${(error as Error).message}).\n` +
        'Start the backend first: pnpm --filter @modelmesh/api dev',
    );
    return 1;
  }

  const available = ready.providers?.available ?? [];
  console.log('Backend');
  console.log(`  status       ${ready.status ?? 'unknown'}`);
  console.log(`  persistence  ${ready.persistence?.backend ?? '?'} (ok: ${ready.persistence?.ok ?? '?'})`);
  console.log(`  cache        ${ready.cache?.backend ?? '?'}`);
  console.log(`  execution    ${ready.execution?.mode ?? '?'}`);
  console.log(`  providers    ${available.length > 0 ? available.join(', ') : 'none'}`);
  if (available.length === 1 && available[0] === 'mock') {
    console.log('  note         no real keys configured — running on the deterministic mock provider');
  }

  if (available.length === 0) {
    console.error('\nNo provider is available at all. Set ENABLE_MOCK_PROVIDER=true or seed a real key.');
    return 1;
  }

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitBody = {
    input: {
      type: 'text',
      text: 'List three concrete reasons per-subtask context slicing reduces token spend in a multi-agent pipeline.',
    },
    strategy: process.env.SMOKE_STRATEGY ?? 'balanced',
    preferences: { explainPlan: true, streamTrace: false },
  };

  const submitResponse = await fetch(`${baseUrl}/api/v1/tasks`, {
    method: 'POST',
    headers,
    body: JSON.stringify(submitBody),
  });

  if (submitResponse.status !== 202) {
    const text = await submitResponse.text();
    console.error(`\nSubmit failed: HTTP ${submitResponse.status} ${text}`);
    return 1;
  }

  const accepted = (await submitResponse.json()) as {
    taskId: string;
    estimatedMs?: number;
    executionMode?: string;
  };
  console.log(`\nSubmitted ${accepted.taskId} (mode: ${accepted.executionMode ?? '?'}, estimate: ${accepted.estimatedMs ?? '?'}ms)`);

  // ── Poll to a terminal status ──────────────────────────────────────────────
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let task: TaskResponse | null = null;
  let lastStatus = '';

  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);

    const response = await fetch(`${baseUrl}/api/v1/tasks/${accepted.taskId}`, { headers });
    if (response.status === 429) continue; // read budget exhausted; back off silently
    if (!response.ok) {
      console.error(`  poll failed: HTTP ${response.status}`);
      continue;
    }

    task = (await response.json()) as TaskResponse;
    if (task.status !== lastStatus) {
      lastStatus = task.status;
      console.log(`  status → ${task.status}`);
    }
    if (task.status === 'completed' || task.status === 'failed') break;
  }

  if (!task) {
    console.error('\nNever managed to read the task back.');
    return 1;
  }

  if (task.status !== 'completed' && task.status !== 'failed') {
    console.error(`\nTimed out after ${POLL_TIMEOUT_MS / 1000}s with status "${task.status}".`);
    return 1;
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log('\nPlan');
  console.log(`  taskType     ${task.taskType ?? '?'}`);
  console.log(`  strategy     ${task.plan?.strategy ?? task.strategy ?? '?'}`);
  console.log(`  subtasks     ${task.plan?.subtaskCount ?? task.subtasks?.length ?? 0}`);
  const groups = task.plan?.parallelGroups ?? [];
  if (groups.length > 0) {
    const widest = Math.max(...groups.map((group) => group.length));
    console.log(`  batches      ${groups.map((group) => `[${group.join(', ')}]`).join(' → ')}`);
    console.log(`  widest batch ${widest} (that is the parallelism, not a checklist)`);
  }
  if (task.plan?.reasoning) console.log(`  reasoning    ${task.plan.reasoning}`);

  console.log('\nSubtasks');
  for (const subtask of task.subtasks ?? []) {
    const route = subtask.provider ? `${subtask.provider}/${subtask.model ?? '?'}` : '—';
    const extras = [
      subtask.fromCache ? 'cached' : null,
      (subtask.failovers ?? 0) > 0 ? `${subtask.failovers} failover(s)` : null,
      subtask.errorCode ?? null,
    ].filter(Boolean);
    console.log(
      `  ${subtask.status?.padEnd(9) ?? '?'} ${subtask.id.padEnd(22)} ${(subtask.role ?? '?').padEnd(20)} ${route}` +
        `  ${subtask.tokens ?? 0} tok  ${subtask.latencyMs ?? 0}ms` +
        (extras.length > 0 ? `  [${extras.join(', ')}]` : ''),
    );
  }

  const telemetry = task.telemetry;
  console.log('\nTelemetry');
  console.log(`  totalMs      ${telemetry?.totalMs ?? '?'}`);
  console.log(`  tokens       estimated ${telemetry?.estimatedTokens ?? '?'} / actual ${telemetry?.actualTokens ?? '?'}`);
  console.log(`  saved        ${telemetry?.savedTokens ?? 0} (${telemetry?.savingsPercent ?? 0}% vs the naive baseline)`);
  console.log(`  failovers    ${telemetry?.failovers ?? 0}   cacheHits ${telemetry?.cacheHits ?? 0}`);
  const models = [...new Set((telemetry?.providerBreakdown ?? []).map((usage) => `${usage.provider}/${usage.model}`))];
  console.log(`  models used  ${models.length > 0 ? models.join(', ') : 'none recorded'}`);

  if (task.verification) {
    console.log('\nVerification');
    console.log(`  verified     ${task.verification.verified}  (confidence ${task.verification.confidence ?? '?'})`);
    if ((task.verification.issues ?? []).length > 0) {
      console.log(`  issues       ${task.verification.issues?.join('; ')}`);
    }
  }

  // ── Trace ──────────────────────────────────────────────────────────────────
  const traceResponse = await fetch(`${baseUrl}/api/v1/tasks/${accepted.taskId}/trace`, { headers });
  if (traceResponse.ok) {
    const trace = (await traceResponse.json()) as { events?: Array<{ event: string; ts?: number }> };
    const events = trace.events ?? [];
    console.log(`\nTrace (${events.length} events)`);
    console.log(`  ${events.map((entry) => `${entry.event}@${entry.ts ?? 0}ms`).join(' → ')}`);
  }

  if (task.status === 'failed') {
    console.error(`\nFAILED — ${task.error?.code ?? 'unknown error'}`);
    return 1;
  }

  const partial = task.result?.partial === true;
  console.log(`\nOutput${partial ? ' (PARTIAL — some subtasks produced nothing)' : ''}`);
  const output = task.result?.output ?? '';
  console.log(output.length > 800 ? `${output.slice(0, 800)}\n  …[${output.length} chars total]` : output);
  console.log(`\nconfidence ${task.result?.confidence ?? '?'}`);
  console.log(partial ? '\nCompleted with a partial result.' : '\nCompleted.');

  return 0;
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error('Smoke test crashed:', error);
    process.exit(1);
  });
