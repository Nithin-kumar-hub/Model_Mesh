import type {
  DAGNode,
  ExecutionPlan,
  ProviderModel,
  SubTaskResult,
} from '@modelmesh/types';
import { AgentRole } from '@modelmesh/types';
import { logger } from '../../infra/logger';
import { exponentialBackoff } from '../../infra/text';
import type { KeyManager } from '../../keys/manager';
import { ProviderError } from '../providers/base';
import type { ProviderRegistry } from '../providers/registry';
import { DAG } from './dag';
import type { ExecutionPlanner } from './planner';

/**
 * Layer 12 — failure recovery.
 *
 * The point of a DAG is that one dead subtask is not a dead task. This module
 * decides, per failure, whether to retry, swap model, drop an optional node,
 * or re-plan the remainder — and whether a partial answer is still worth
 * returning.
 */

export type RecoveryAction =
  | { action: 'RETRY'; delayMs: number; reason: string }
  | { action: 'SWAP_MODEL'; model: ProviderModel; reason: string }
  | { action: 'SKIP'; reason: string }
  | { action: 'FAIL'; reason: string };

export class FailureRecovery {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyManager,
    private readonly planner: ExecutionPlanner,
  ) {}

  async handleSubTaskFailure(node: DAGNode, error: Error, attempt: number): Promise<RecoveryAction> {
    const kind = error instanceof ProviderError ? error.kind : 'UNKNOWN';

    if (kind === 'RATE_LIMIT') {
      // The executor already cooled the key down; a different key may be free.
      const fallback = await this.findFallbackModel(node, [node.assignedModel ?? '']);
      return fallback
        ? { action: 'SWAP_MODEL', model: fallback, reason: 'rate_limited_swap_model' }
        : { action: 'RETRY', delayMs: 1_000, reason: 'rate_limited_wait_for_cooldown' };
    }

    if (kind === 'SERVER_ERROR' && attempt < 3) {
      return { action: 'RETRY', delayMs: exponentialBackoff(attempt, 1_000), reason: 'server_error_backoff' };
    }

    const fallback = await this.findFallbackModel(node, [node.assignedModel ?? '']);
    if (fallback) return { action: 'SWAP_MODEL', model: fallback, reason: 'model_fallback' };

    if (node.optional) return { action: 'SKIP', reason: 'optional_subtask_dropped' };

    return { action: 'FAIL', reason: 'no_fallback_available' };
  }

  /** Another model with the same capabilities and an available key. */
  async findFallbackModel(node: DAGNode, exclude: string[]): Promise<ProviderModel | null> {
    const availableProviders = await this.keys.getAvailableProviders();
    const ranked = this.registry.rank({
      requiredCapabilities: node.capabilities,
      strategy: 'balanced',
      availableProviders,
      exclude: exclude.filter(Boolean),
      minContextTokens: node.estimatedInputTokens,
    });
    return ranked[0] ?? null;
  }

  /**
   * A failure is critical when it strands work that cannot be reconstructed:
   * it has downstream nodes, or nothing usable completed at all.
   */
  isCriticalFailure(failed: Set<string>, plan: ExecutionPlan, results: Map<string, SubTaskResult>): boolean {
    if (failed.size === 0) return false;

    const dag = new DAG(plan.nodes);
    for (const id of failed) {
      const node = dag.nodes.get(id);
      if (!node || node.optional) continue;

      const stranded = [...dag.descendants(id)].filter((descendant) => !results.has(descendant));
      if (stranded.length > 0) return true;
    }

    // Every analysis died — there is nothing to synthesize.
    const analysisResults = [...results.values()].filter((result) => result.role !== AgentRole.SYNTHESIZER);
    return analysisResults.length === 0;
  }

  /**
   * Re-plan the unfinished remainder. Dependencies on *failed* nodes are
   * dropped so a synthesis can still run on the analyses that did land —
   * degraded, and labelled as such. Dependencies on *completed* nodes are
   * kept: the scheduler needs them to inject those results as context.
   */
  async replan(
    plan: ExecutionPlan,
    failed: Set<string>,
    results: Map<string, SubTaskResult>,
    taskType: string,
  ): Promise<ExecutionPlan | null> {
    const remaining = plan.nodes
      .filter((node) => !results.has(node.id) && !failed.has(node.id))
      .map((node) => ({
        ...node,
        dependencies: node.dependencies.filter((dependency) => !failed.has(dependency)),
      }));

    if (remaining.length === 0) return null;

    // Completed nodes are outside `remaining` but are legitimately satisfied.
    const errors = DAG.validate(remaining, new Set(results.keys()));
    if (errors.length > 0) {
      logger.warn({ errors }, 'Re-plan produced an invalid DAG — abandoning re-plan');
      return null;
    }

    const plans = await this.planner.generatePlans(remaining, taskType, {});
    const selection = this.planner.select(plans, plan.strategy, {});

    logger.info(
      { original: plan.nodes.length, remaining: remaining.length, failed: failed.size },
      'Re-planned remaining subtasks',
    );

    return {
      ...selection.selected,
      reasoning: `Re-plan after ${failed.size} failure(s): ${selection.selected.reasoning}`,
    };
  }

  /** Enough survived to answer, even if not everything ran. */
  canProceedWithPartial(results: Map<string, SubTaskResult>): boolean {
    return [...results.values()].some((result) => result.output.trim().length > 0);
  }
}
