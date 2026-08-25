import { AgentRole } from '@modelmesh/types';
import type { DAGNode, ExecutionPlan, SubTaskResult } from '@modelmesh/types';
import { config } from '../../config';
import { logger } from '../../infra/logger';
import type { Persistence } from '../../infra/persistence';
import { sleep, truncateToTokens } from '../../infra/text';
import { DAG } from './dag';
import type { SubtaskExecutionContext, SubTaskExecutor } from './executor';
import type { FailureRecovery } from './recovery';

/**
 * Layer 9 — the scheduler.
 *
 * Walks the plan's batches in order and runs each batch concurrently. Two
 * invariants: a node never starts before all of its dependencies have
 * *succeeded*, and one node's failure never cancels an unrelated branch.
 */

export interface ScheduleOutcome {
  results: Map<string, SubTaskResult>;
  failed: Set<string>;
  skipped: Set<string>;
  replans: number;
  deadlineHit: boolean;
}

/** Upstream output injected into a synthesis node, capped per dependency. */
const MAX_DEPENDENCY_TOKENS = 2_600;
/** Past this fraction of the deadline, optional work is dropped. */
const OPTIONAL_DROP_THRESHOLD = 0.8;

export class WorkloadScheduler {
  constructor(
    private readonly executor: SubTaskExecutor,
    private readonly recovery: FailureRecovery,
    private readonly db: Persistence,
  ) {}

  async execute(plan: ExecutionPlan, ctx: SubtaskExecutionContext): Promise<ScheduleOutcome> {
    const results = new Map<string, SubTaskResult>();
    const failed = new Set<string>();
    const skipped = new Set<string>();
    let replans = 0;
    let deadlineHit = false;

    let activePlan = plan;
    let groups = [...activePlan.parallelGroups];
    let groupIndex = 0;

    while (groupIndex < groups.length) {
      const group = groups[groupIndex] ?? [];
      groupIndex += 1;

      const dag = new DAG(activePlan.nodes);
      const runnable: DAGNode[] = [];

      for (const nodeId of group) {
        if (results.has(nodeId) || failed.has(nodeId) || skipped.has(nodeId)) continue;

        const node = dag.nodes.get(nodeId);
        if (!node) continue;

        const unmet = node.dependencies.filter((dependency) => !results.has(dependency));
        if (unmet.length > 0) {
          const satisfiable = unmet.every((dependency) => failed.has(dependency) || skipped.has(dependency));
          const canDegrade =
            satisfiable && node.dependencies.some((dependency) => results.has(dependency));

          // Synthesis over the surviving analyses beats no answer at all.
          if (!canDegrade) {
            skipped.add(nodeId);
            await this.markSkipped(ctx, node, 'dependency_unavailable');
            continue;
          }
          logger.info({ subtaskId: nodeId, unmet }, 'Running node with degraded dependencies');
        }

        if (this.pastDeadline(ctx)) {
          deadlineHit = true;
          skipped.add(nodeId);
          await this.markSkipped(ctx, node, 'deadline_exceeded');
          continue;
        }

        if (node.optional && this.nearDeadline(ctx)) {
          skipped.add(nodeId);
          await this.markSkipped(ctx, node, 'optional_dropped_near_deadline');
          continue;
        }

        runnable.push(this.injectDependencyResults(node, results));
      }

      if (runnable.length === 0) continue;

      const settled = await Promise.allSettled(
        runnable.map((node) =>
          node.requiresEnsemble
            ? this.executeEnsemble(node, ctx)
            : this.executor.executeSubTask(node, ctx),
        ),
      );

      const justFailed: DAGNode[] = [];
      settled.forEach((outcome, index) => {
        const node = runnable[index];
        if (!node) return;
        if (outcome.status === 'fulfilled') {
          results.set(node.id, outcome.value);
        } else {
          failed.add(node.id);
          justFailed.push(node);
        }
      });

      if (justFailed.length === 0) continue;

      // Second chance: a different model with the same capabilities.
      for (const node of justFailed) {
        if (this.pastDeadline(ctx)) break;

        const action = await this.recovery.handleSubTaskFailure(
          node,
          new Error('subtask attempts exhausted'),
          config.execution.maxAttemptsPerSubtask,
        );

        if (action.action === 'SKIP') {
          failed.delete(node.id);
          skipped.add(node.id);
          await this.markSkipped(ctx, node, action.reason);
          continue;
        }
        if (action.action !== 'SWAP_MODEL' && action.action !== 'RETRY') continue;

        if (action.action === 'RETRY' && action.delayMs > 0) await sleep(action.delayMs);

        const retryNode: DAGNode =
          action.action === 'SWAP_MODEL'
            ? { ...node, assignedProvider: action.model.provider, assignedModel: action.model.model }
            : node;

        ctx.emit({
          event: 'subtask_started',
          subtaskId: node.id,
          role: node.role,
          provider: retryNode.assignedProvider,
          model: retryNode.assignedModel,
          recovery: action.reason,
        });

        try {
          results.set(node.id, await this.executor.executeSubTask(retryNode, ctx));
          failed.delete(node.id);
        } catch (error) {
          logger.warn(
            { subtaskId: node.id, err: (error as Error).message },
            'Recovery attempt failed — subtask stays failed',
          );
        }
      }

      // Still stranded work? Re-plan the remainder, at most twice.
      if (
        failed.size > 0 &&
        replans < 2 &&
        !this.pastDeadline(ctx) &&
        this.recovery.isCriticalFailure(failed, activePlan, results)
      ) {
        ctx.emit({ event: 'replanning', failedSubtasks: [...failed], attempt: replans + 1 });
        const replanned = await this.recovery.replan(activePlan, failed, results, ctx.taskType);
        if (replanned) {
          replans += 1;
          activePlan = { ...replanned, nodes: [...replanned.nodes] };
          groups = [...replanned.parallelGroups];
          groupIndex = 0;
          // `failed` is not cleared: those subtasks really did fail, and the
          // final result must say so even if the re-plan recovers the answer.
        }
      }
    }

    return { results, failed, skipped, replans, deadlineHit };
  }

  /**
   * Upstream results enter through their own prompt block (`<agent_results>`),
   * never appended to the untrusted document slice — the safety boundary has
   * to survive dependency injection too.
   */
  private injectDependencyResults(node: DAGNode, results: Map<string, SubTaskResult>): DAGNode {
    if (node.dependencies.length === 0) return node;

    const blocks: string[] = [];
    for (const dependency of node.dependencies) {
      const result = results.get(dependency);
      if (!result) continue;
      blocks.push(
        `## ${dependency} (${result.role}, confidence ${result.confidence.toFixed(2)})\n${truncateToTokens(
          result.output,
          MAX_DEPENDENCY_TOKENS,
        )}`,
      );
    }

    return { ...node, dependencyContext: blocks.join('\n\n') };
  }

  /**
   * Ensemble: run the node on two different models and keep the more confident
   * answer. Premium-only, and only for nodes the decomposer marked critical.
   */
  private async executeEnsemble(node: DAGNode, ctx: SubtaskExecutionContext): Promise<SubTaskResult> {
    const primary = await this.executor.executeSubTask(node, ctx);

    const alternative = await this.recovery.findFallbackModel(node, [primary.model]);
    if (!alternative) return primary;

    try {
      const second = await this.executor.executeSubTask(
        { ...node, assignedProvider: alternative.provider, assignedModel: alternative.model },
        ctx,
      );
      const winner = second.confidence > primary.confidence ? second : primary;
      ctx.emit({
        event: 'subtask_done',
        subtaskId: node.id,
        role: node.role,
        ensemble: true,
        chosenModel: winner.model,
        candidates: [primary.model, second.model],
        confidence: Number(winner.confidence.toFixed(2)),
      });
      return winner;
    } catch {
      return primary;
    }
  }

  private async markSkipped(ctx: SubtaskExecutionContext, node: DAGNode, reason: string): Promise<void> {
    ctx.emit({ event: 'subtask_skipped', subtaskId: node.id, role: node.role, reason });
    await this.db
      .updateSubTask(ctx.taskId, node.id, { status: 'skipped', errorCode: reason, completedAt: new Date() })
      .catch(() => undefined);
  }

  private pastDeadline(ctx: SubtaskExecutionContext): boolean {
    return ctx.deadlineAt !== undefined && Date.now() >= ctx.deadlineAt;
  }

  private nearDeadline(ctx: SubtaskExecutionContext): boolean {
    if (ctx.deadlineAt === undefined) return false;
    const total = config.execution.taskTimeoutMs;
    return Date.now() >= ctx.deadlineAt - total * (1 - OPTIONAL_DROP_THRESHOLD);
  }
}

/** Roles whose output is a merge, not an analysis — used by the aggregator. */
export const SYNTHESIS_ROLES = new Set<AgentRole>([AgentRole.SYNTHESIZER]);
