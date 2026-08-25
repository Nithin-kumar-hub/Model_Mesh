import supertest from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ExecutionPlan } from '@modelmesh/types';
import { AgentRole } from '@modelmesh/types';
import type { SubtaskExecutionContext } from '../../src/core/orchestrator/executor';
import type { ScheduleOutcome } from '../../src/core/orchestrator/scheduler';
import { buildServer, type BuiltServer } from '../../src/server';

/**
 * Truthful savings accounting under partial failure.
 *
 * `savedTokens` is measured against the naive baseline — the same roles, each
 * handed the whole master context. A run where three of five subtasks died must
 * only be credited for the two that ran; the earlier implementation counted all
 * five and reported ~80% "savings" for work it never did.
 *
 * The failure is injected at the scheduler boundary rather than through
 * MOCK_FAILURE_RATE so the arithmetic under test is deterministic: the mock's
 * injection is keyed on a prompt hash, which would make the executed set drift
 * whenever a role prompt changes.
 */

const API_KEY = 'test-secret';
const PREFIX = '/api/v1';

let server: BuiltServer;
let agent: supertest.Agent;
/** Subtasks whose results the wrapper discarded, i.e. the simulated failures. */
let discarded: string[] = [];

const JAVA_MODULE = (index: number): string =>
  [
    `## Module ${index}: Service${index}`,
    '',
    '```java',
    `public class Service${index} {`,
    '  private final Connection conn;',
    `  public User login${index}(String user, String password) throws Exception {`,
    '    Statement st = conn.createStatement();',
    '    ResultSet rs = st.executeQuery("SELECT * FROM users WHERE name=\'" + user + "\'");',
    '    if (rs.next()) { return new User(rs.getString("name")); }',
    '    return null;',
    '  }',
    `  public int compare${index}(List<Integer> values) {`,
    '    int worst = 0;',
    '    for (int a : values) { for (int b : values) { if (a * b > worst) worst = a * b; } }',
    '    return worst;',
    '  }',
    '}',
    '```',
  ].join('\n');

interface TaskView {
  status: string;
  result: { output: string; partial: boolean } | null;
  plan: { subtaskCount: number } | null;
  subtasks: Array<{ id: string; role: string; status: string }>;
  telemetry: { actualTokens: number | null; savedTokens: number | null; savingsPercent: number };
}

beforeAll(async () => {
  process.env.MOCK_FAILURE_RATE = '0';
  server = await buildServer({ enableStream: false });

  const scheduler = server.ctx.scheduler;
  const runSchedule = scheduler.execute.bind(scheduler);

  // Let the plan run for real, then drop every analysis result but the first —
  // exactly the state the pipeline sees when those subtasks fail outright.
  scheduler.execute = async (
    plan: ExecutionPlan,
    ctx: SubtaskExecutionContext,
  ): Promise<ScheduleOutcome> => {
    const outcome = await runSchedule(plan, ctx);

    const analyses = [...outcome.results.keys()].filter(
      (id) => outcome.results.get(id)?.role !== AgentRole.SYNTHESIZER,
    );
    discarded = analyses.slice(1);
    for (const id of discarded) {
      outcome.results.delete(id);
      outcome.failed.add(id);
    }

    return outcome;
  };

  await server.app.ready();
  agent = supertest(server.app.server);
}, 60_000);

afterAll(async () => {
  await server.close();
});

describe('savings accounting under partial failure', () => {
  let view: TaskView;
  let master = 0;
  let completedEvent: Record<string, unknown> | undefined;

  beforeAll(async () => {
    const text = `Analyze this backend for security vulnerabilities, performance problems, and architectural issues.\n\n${Array.from(
      { length: 80 },
      (_unused, index) => JAVA_MODULE(index),
    ).join('\n\n')}`;

    const submitted = await agent
      .post(`${PREFIX}/tasks`)
      .set('x-api-key', API_KEY)
      .send({ input: { type: 'code', text }, strategy: 'balanced' });
    expect(submitted.status).toBe(202);
    const { taskId } = submitted.body as { taskId: string };

    for (let attempt = 0; attempt < 120; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      const read = await agent.get(`${PREFIX}/tasks/${taskId}`).set('x-api-key', API_KEY);
      view = read.body as TaskView;
      if (view.status === 'completed' || view.status === 'failed') break;
    }

    const trace = await agent.get(`${PREFIX}/tasks/${taskId}/trace`).set('x-api-key', API_KEY);
    const events = (trace.body as { events: Array<Record<string, unknown>> }).events;
    master = Number(
      (events.find((event) => event.event === 'decomposed') as { masterContextTokens?: number } | undefined)
        ?.masterContextTokens ?? 0,
    );
    completedEvent = events.find((event) => event.event === 'completed');
  }, 90_000);

  it('still returns an answer, flagged partial', () => {
    expect(view.status).toBe('completed');
    expect(view.result?.partial).toBe(true);
    expect(view.result?.output.length).toBeGreaterThan(0);
    expect(discarded.length).toBeGreaterThan(0);
  });

  it('names the subtasks that did not produce a result', () => {
    expect(completedEvent?.partial).toBe(true);
    expect(completedEvent?.failedSubtasks).toEqual(expect.arrayContaining(discarded));
  });

  it('only credits savings for the subtasks that ran', () => {
    const executed = (view.plan?.subtaskCount ?? 0) - discarded.length;
    const baseline = (view.telemetry.savedTokens ?? 0) + (view.telemetry.actualTokens ?? 0);

    expect(master).toBeGreaterThan(10_000);
    expect(executed).toBeGreaterThan(0);
    expect(executed).toBeLessThan(view.plan?.subtaskCount ?? 0);

    // Each executed node is charged the full master context, and nothing else is.
    expect(baseline).toBeGreaterThan(master * executed);
    // Counting all the plan's nodes — the bug — would land above this line.
    expect(baseline).toBeLessThan(master * (view.plan?.subtaskCount ?? 0));
  });

  it('reports a savings percentage that is possible', () => {
    expect(view.telemetry.savingsPercent).toBeGreaterThan(0);
    expect(view.telemetry.savingsPercent).toBeLessThan(100);
    expect(view.telemetry.savedTokens ?? -1).toBeGreaterThanOrEqual(0);
  });
});
