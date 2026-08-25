import { describe, expect, it } from 'vitest';
import { AgentRole } from '@modelmesh/types';
import type { DAGNode, ExecutionPlan, ProviderModel, SubTaskResult } from '@modelmesh/types';
import type { SubTaskExecutor } from '../../src/core/orchestrator/executor';
import type { FailureRecovery, RecoveryAction } from '../../src/core/orchestrator/recovery';
import { WorkloadScheduler } from '../../src/core/orchestrator/scheduler';
import {
  makeExecContext,
  makeModel,
  makeNode,
  makePlan,
  makeResult,
  makeTrace,
  stubPersistence,
} from '../helpers/factories';

/**
 * The scheduler contract (CLAUDE.md §10 "On the DAG Scheduler"):
 * run the whole ready set concurrently, never start a node before its
 * dependencies succeeded, and never let one dead branch kill the others.
 */

type ExecuteFn = (node: DAGNode) => Promise<SubTaskResult>;

interface Dispatched {
  id: string;
  node: DAGNode;
}

const makeExecutor = (
  execute: ExecuteFn,
): { executor: SubTaskExecutor; dispatched: Dispatched[] } => {
  const dispatched: Dispatched[] = [];
  const executor = {
    executeSubTask: async (node: DAGNode): Promise<SubTaskResult> => {
      dispatched.push({ id: node.id, node });
      return execute(node);
    },
  } as unknown as SubTaskExecutor;
  return { executor, dispatched };
};

interface RecoveryStub {
  handleSubTaskFailure?: (node: DAGNode) => Promise<RecoveryAction>;
  findFallbackModel?: () => Promise<ProviderModel | null>;
  isCriticalFailure?: () => boolean;
  replan?: (
    plan: ExecutionPlan,
    failed: Set<string>,
    results: Map<string, SubTaskResult>,
  ) => Promise<ExecutionPlan | null>;
}

const makeRecovery = (overrides: RecoveryStub = {}): FailureRecovery =>
  ({
    handleSubTaskFailure: async (): Promise<RecoveryAction> => ({
      action: 'FAIL',
      reason: 'no_fallback_available',
    }),
    findFallbackModel: async (): Promise<ProviderModel | null> => null,
    isCriticalFailure: (): boolean => false,
    replan: async (): Promise<ExecutionPlan | null> => null,
    canProceedWithPartial: (): boolean => true,
    ...overrides,
  }) as unknown as FailureRecovery;

describe('WorkloadScheduler — batching', () => {
  it('runs every node of a ready batch concurrently', async () => {
    let inFlight = 0;
    let peak = 0;

    const { executor } = makeExecutor(async (node) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return makeResult(node.id);
    });

    const plan = makePlan([makeNode('a'), makeNode('b'), makeNode('c')]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    const outcome = await scheduler.execute(plan, makeExecContext());

    expect(peak).toBe(3);
    expect(outcome.results.size).toBe(3);
    expect(outcome.failed.size).toBe(0);
  });

  it('never dispatches a node before its dependencies have succeeded', async () => {
    const finished: string[] = [];
    const { executor, dispatched } = makeExecutor(async (node) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      finished.push(node.id);
      return makeResult(node.id);
    });

    const plan = makePlan([
      makeNode('a'),
      makeNode('b'),
      makeNode('synthesis', { role: AgentRole.SYNTHESIZER, dependencies: ['a', 'b'] }),
    ]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    await scheduler.execute(plan, makeExecContext());

    const synthesisDispatchIndex = dispatched.findIndex((entry) => entry.id === 'synthesis');
    expect(synthesisDispatchIndex).toBe(2);
    expect(finished.slice(0, 2).sort()).toEqual(['a', 'b']);
  });
});

describe('WorkloadScheduler — dependency results', () => {
  it('injects upstream output into dependencyContext, never into the untrusted slice', async () => {
    const { executor, dispatched } = makeExecutor(async (node) =>
      makeResult(node.id, { output: `OUTPUT_OF_${node.id}` }),
    );

    const plan = makePlan([
      makeNode('analysis', { contextSlice: 'UNTRUSTED SOURCE MATERIAL' }),
      makeNode('synthesis', {
        role: AgentRole.SYNTHESIZER,
        dependencies: ['analysis'],
        contextSlice: '',
      }),
    ]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    await scheduler.execute(plan, makeExecContext());

    const synthesis = dispatched.find((entry) => entry.id === 'synthesis')?.node;
    expect(synthesis?.dependencyContext).toContain('OUTPUT_OF_analysis');
    // Rule 6: the untrusted channel must not absorb agent output.
    expect(synthesis?.contextSlice).toBe('');
  });

  it('leaves a dependency-free node untouched', async () => {
    const { executor, dispatched } = makeExecutor(async (node) => makeResult(node.id));
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    await scheduler.execute(makePlan([makeNode('solo')]), makeExecContext());

    expect(dispatched[0]?.node.dependencyContext).toBeUndefined();
  });
});

describe('WorkloadScheduler — failure containment', () => {
  it('skips a node whose only dependency failed', async () => {
    const { executor } = makeExecutor(async (node) => {
      if (node.id === 'a') throw new Error('boom');
      return makeResult(node.id);
    });

    const { db, updates } = stubPersistence();
    const trace = makeTrace();
    const plan = makePlan([makeNode('a'), makeNode('b', { dependencies: ['a'] })]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), db);

    const outcome = await scheduler.execute(plan, makeExecContext({ emit: trace.emit }));

    expect([...outcome.failed]).toEqual(['a']);
    expect([...outcome.skipped]).toEqual(['b']);
    expect(updates.find((update) => update.nodeId === 'b')?.patch).toMatchObject({
      status: 'skipped',
      errorCode: 'dependency_unavailable',
    });
    expect(trace.names()).toContain('subtask_skipped');
  });

  it('runs a synthesis on the surviving analyses when only some dependencies failed', async () => {
    const { executor, dispatched } = makeExecutor(async (node) => {
      if (node.id === 'b') throw new Error('boom');
      return makeResult(node.id, { output: `OUTPUT_OF_${node.id}` });
    });

    const plan = makePlan([
      makeNode('a'),
      makeNode('b'),
      makeNode('synthesis', { role: AgentRole.SYNTHESIZER, dependencies: ['a', 'b'] }),
    ]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    const outcome = await scheduler.execute(plan, makeExecContext());

    expect(outcome.results.has('synthesis')).toBe(true);
    expect([...outcome.failed]).toEqual(['b']);

    const synthesis = dispatched.find((entry) => entry.id === 'synthesis')?.node;
    expect(synthesis?.dependencyContext).toContain('OUTPUT_OF_a');
    expect(synthesis?.dependencyContext).not.toContain('OUTPUT_OF_b');
  });

  it('does not let an unrelated branch die with a failing one', async () => {
    const { executor } = makeExecutor(async (node) => {
      if (node.id === 'left') throw new Error('boom');
      return makeResult(node.id);
    });

    const plan = makePlan([
      makeNode('left'),
      makeNode('right'),
      makeNode('right_child', { dependencies: ['right'] }),
    ]);
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), stubPersistence().db);

    const outcome = await scheduler.execute(plan, makeExecContext());

    expect([...outcome.results.keys()].sort()).toEqual(['right', 'right_child']);
    expect([...outcome.failed]).toEqual(['left']);
  });
});

describe('WorkloadScheduler — recovery', () => {
  it('retries on a swapped model and clears the failure when the retry lands', async () => {
    let attempts = 0;
    const { executor, dispatched } = makeExecutor(async (node) => {
      attempts += 1;
      if (attempts === 1) throw new Error('rate limited');
      return makeResult(node.id);
    });

    const fallback = makeModel({ provider: 'mock', model: 'mock-vision-pro' });
    const trace = makeTrace();
    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        handleSubTaskFailure: async (): Promise<RecoveryAction> => ({
          action: 'SWAP_MODEL',
          model: fallback,
          reason: 'rate_limited_swap_model',
        }),
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(
      makePlan([makeNode('x')]),
      makeExecContext({ emit: trace.emit }),
    );

    expect(outcome.failed.size).toBe(0);
    expect(outcome.results.has('x')).toBe(true);
    expect(dispatched[1]?.node.assignedModel).toBe('mock-vision-pro');
    expect(
      trace.events.some((event) => event.recovery === 'rate_limited_swap_model'),
    ).toBe(true);
  });

  it('moves an optional node from failed to skipped when recovery says SKIP', async () => {
    const { executor } = makeExecutor(async () => {
      throw new Error('boom');
    });

    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        handleSubTaskFailure: async (): Promise<RecoveryAction> => ({
          action: 'SKIP',
          reason: 'optional_subtask_dropped',
        }),
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(
      makePlan([makeNode('critique', { role: AgentRole.CRITIC, optional: true })]),
      makeExecContext(),
    );

    expect(outcome.failed.size).toBe(0);
    expect([...outcome.skipped]).toEqual(['critique']);
  });

  it('keeps a subtask failed when the recovery attempt also fails', async () => {
    const { executor } = makeExecutor(async () => {
      throw new Error('boom');
    });

    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        handleSubTaskFailure: async (): Promise<RecoveryAction> => ({
          action: 'SWAP_MODEL',
          model: makeModel(),
          reason: 'model_fallback',
        }),
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(makePlan([makeNode('x')]), makeExecContext());

    expect([...outcome.failed]).toEqual(['x']);
    expect(outcome.results.size).toBe(0);
  });
});

describe('WorkloadScheduler — re-planning', () => {
  it('counts a successful re-plan and still reports the subtasks that failed', async () => {
    const { executor } = makeExecutor(async (node) => {
      if (node.id === 'sec' || node.id === 'perf') throw new Error('injected 429');
      return makeResult(node.id);
    });

    let replanCalls = 0;
    const trace = makeTrace();
    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        isCriticalFailure: () => true,
        // Mirrors FailureRecovery.replan: the remainder, minus failed deps.
        replan: async (plan, failed, results) => {
          const remaining = plan.nodes
            .filter((node) => !results.has(node.id) && !failed.has(node.id))
            .map((node) => ({
              ...node,
              dependencies: node.dependencies.filter((dependency) => !failed.has(dependency)),
            }));
          if (remaining.length === 0) return null;
          replanCalls += 1;
          return makePlan(remaining);
        },
      }),
      stubPersistence().db,
    );

    const plan = makePlan([
      makeNode('sec'),
      makeNode('perf'),
      makeNode('coder'),
      makeNode('synthesis', {
        role: AgentRole.SYNTHESIZER,
        dependencies: ['sec', 'perf', 'coder'],
      }),
    ]);

    const outcome = await scheduler.execute(plan, makeExecContext({ emit: trace.emit }));

    expect(replanCalls).toBe(1);
    expect(outcome.replans).toBe(1);
    // The re-plan recovers the answer; it does not rewrite history.
    expect([...outcome.failed].sort()).toEqual(['perf', 'sec']);
    expect(outcome.results.has('synthesis')).toBe(true);
    expect(trace.find('replanning')).toMatchObject({ attempt: 1 });
  });

  it('stops at two re-plans', async () => {
    const { executor } = makeExecutor(async () => {
      throw new Error('everything fails');
    });

    let replanCalls = 0;
    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        isCriticalFailure: () => true,
        replan: async (plan) => {
          replanCalls += 1;
          // A pathological recovery engine that keeps offering the same work.
          return makePlan(plan.nodes.map((node) => ({ ...node, id: `${node.id}_${replanCalls}` })));
        },
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(makePlan([makeNode('a')]), makeExecContext());

    expect(outcome.replans).toBe(2);
    expect(replanCalls).toBe(2);
  });

  it('does not re-plan when the failure is not critical', async () => {
    const { executor } = makeExecutor(async (node) => {
      if (node.id === 'optional_extra') throw new Error('boom');
      return makeResult(node.id);
    });

    let replanCalls = 0;
    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        isCriticalFailure: () => false,
        replan: async () => {
          replanCalls += 1;
          return null;
        },
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(
      makePlan([makeNode('main'), makeNode('optional_extra')]),
      makeExecContext(),
    );

    expect(replanCalls).toBe(0);
    expect(outcome.replans).toBe(0);
    expect([...outcome.failed]).toEqual(['optional_extra']);
  });
});

describe('WorkloadScheduler — ensemble and deadlines', () => {
  it('keeps the more confident answer when a node requires an ensemble', async () => {
    const { executor } = makeExecutor(async (node) =>
      makeResult(node.id, {
        model: node.assignedModel ?? 'mock-balanced',
        confidence: node.assignedModel === 'mock-vision-pro' ? 0.93 : 0.61,
      }),
    );

    const trace = makeTrace();
    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({
        findFallbackModel: async () => makeModel({ model: 'mock-vision-pro' }),
      }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(
      makePlan([makeNode('critical', { requiresEnsemble: true })]),
      makeExecContext({ emit: trace.emit }),
    );

    expect(outcome.results.get('critical')?.confidence).toBe(0.93);
    expect(trace.events.some((event) => event.ensemble === true)).toBe(true);
  });

  it('falls back to the primary answer when the second ensemble call fails', async () => {
    const { executor } = makeExecutor(async (node) => {
      if (node.assignedModel === 'mock-vision-pro') throw new Error('boom');
      return makeResult(node.id, { confidence: 0.55 });
    });

    const scheduler = new WorkloadScheduler(
      executor,
      makeRecovery({ findFallbackModel: async () => makeModel({ model: 'mock-vision-pro' }) }),
      stubPersistence().db,
    );

    const outcome = await scheduler.execute(
      makePlan([makeNode('critical', { requiresEnsemble: true })]),
      makeExecContext(),
    );

    expect(outcome.results.get('critical')?.confidence).toBe(0.55);
  });

  it('skips remaining work once the deadline has passed', async () => {
    const { executor, dispatched } = makeExecutor(async (node) => makeResult(node.id));
    const { db, updates } = stubPersistence();
    const scheduler = new WorkloadScheduler(executor, makeRecovery(), db);

    const outcome = await scheduler.execute(
      makePlan([makeNode('a'), makeNode('b')]),
      makeExecContext({ deadlineAt: Date.now() - 1 }),
    );

    expect(dispatched).toHaveLength(0);
    expect(outcome.deadlineHit).toBe(true);
    expect([...outcome.skipped].sort()).toEqual(['a', 'b']);
    expect(updates.every((update) => update.patch.errorCode === 'deadline_exceeded')).toBe(true);
  });
});
