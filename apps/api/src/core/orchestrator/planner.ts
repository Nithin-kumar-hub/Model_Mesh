import type {
  DAGNode,
  ExecutionPlan,
  ExecutionStrategy,
  ProviderModel,
  TaskBudget,
} from '@modelmesh/types';
import { config } from '../../config';
import { planId } from '../../infra/ids';
import { logger } from '../../infra/logger';
import { countTokens, truncateToTokens } from '../../infra/text';
import type { KeyManager } from '../../keys/manager';
import { getRoleDefinition } from '../agents/roles';
import type { TokenProfiler } from '../intelligence/profiler';
import type { ProviderRegistry } from '../providers/registry';
import { DAG } from './dag';

/**
 * Layer 8 — execution plan optimizer.
 *
 * Three real candidate plans are built and costed, then one is selected. They
 * differ in more than a label: context budget, parallelism, model tier, and
 * whether verification runs.
 *
 *   draft    — cheapest models, sequential, context compressed hardest
 *   balanced — best cost/latency/quality trade, quota-bounded parallelism
 *   premium  — strongest models, maximum parallelism, full context
 */

export interface PlanSelection {
  plans: ExecutionPlan[];
  selected: ExecutionPlan;
  /** Set when the requested strategy blew the budget and we stepped down. */
  downgradedFrom?: ExecutionStrategy;
  budgetViolations: string[];
}

/** Fraction of each node's sliced context each strategy keeps. */
const CONTEXT_BUDGET: Record<ExecutionStrategy, number> = {
  draft: 0.55,
  balanced: 1,
  premium: 1,
};

export class ExecutionPlanner {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyManager,
    private readonly profiler: TokenProfiler,
  ) {}

  async generatePlans(nodes: DAGNode[], taskType: string, budget: TaskBudget = {}): Promise<ExecutionPlan[]> {
    const availableProviders = await this.keys.getAvailableProviders();
    const strategies: ExecutionStrategy[] = ['draft', 'balanced', 'premium'];

    const plans: ExecutionPlan[] = [];
    for (const strategy of strategies) {
      plans.push(await this.buildPlan(nodes, taskType, strategy, availableProviders, budget));
    }
    return plans;
  }

  /**
   * Feasibility first, preference second: a plan that violates the caller's
   * budget is not "the chosen plan with a warning", it is not eligible.
   */
  select(plans: ExecutionPlan[], strategy: ExecutionStrategy, budget: TaskBudget = {}): PlanSelection {
    const violations: string[] = [];

    const feasible = plans.filter((plan) => {
      const overTokens = budget.maxTokens !== undefined && plan.estimatedTotalTokens > budget.maxTokens;
      const overLatency =
        budget.maxLatencyMs !== undefined && plan.estimatedTotalLatencyMs > budget.maxLatencyMs;

      if (overTokens) {
        violations.push(
          `${plan.strategy}: ${plan.estimatedTotalTokens} tokens exceeds budget ${budget.maxTokens}`,
        );
      }
      if (overLatency) {
        violations.push(
          `${plan.strategy}: ${plan.estimatedTotalLatencyMs}ms exceeds budget ${budget.maxLatencyMs}ms`,
        );
      }
      return !overTokens && !overLatency;
    });

    const requested = feasible.find((plan) => plan.strategy === strategy);
    if (requested) return { plans, selected: requested, budgetViolations: violations };

    // Step down through cheaper strategies before giving up on the budget.
    const fallbackOrder: ExecutionStrategy[] =
      strategy === 'premium' ? ['balanced', 'draft'] : strategy === 'balanced' ? ['draft'] : [];

    for (const candidate of fallbackOrder) {
      const plan = feasible.find((entry) => entry.strategy === candidate);
      if (plan) {
        logger.info(
          { requested: strategy, selected: candidate },
          'Requested strategy violated the budget — stepping down',
        );
        return { plans, selected: plan, downgradedFrom: strategy, budgetViolations: violations };
      }
    }

    // Nothing fits: run the cheapest plan and report the violation honestly.
    const cheapest = [...plans].sort((a, b) => a.estimatedTotalTokens - b.estimatedTotalTokens)[0];
    const chosen = cheapest ?? plans[0];
    if (!chosen) throw new Error('Planner produced no candidate plans');

    return {
      plans,
      selected: chosen,
      downgradedFrom: chosen.strategy === strategy ? undefined : strategy,
      budgetViolations: violations,
    };
  }

  // ─── Plan construction ──────────────────────────────────────────────────

  private async buildPlan(
    nodes: DAGNode[],
    taskType: string,
    strategy: ExecutionStrategy,
    availableProviders: Parameters<ProviderRegistry['rank']>[0]['availableProviders'],
    budget: TaskBudget,
  ): Promise<ExecutionPlan> {
    const contextFactor = CONTEXT_BUDGET[strategy];

    const routed: DAGNode[] = [];
    for (const node of nodes) {
      const model = this.registry.getBestModel({
        requiredCapabilities: node.capabilities,
        strategy,
        availableProviders,
        preferredModels: getRoleDefinition(node.role).preferredModels,
        minContextTokens: node.estimatedInputTokens,
      });

      const contextSlice =
        contextFactor < 1
          ? truncateToTokens(node.contextSlice, Math.ceil(countTokens(node.contextSlice) * contextFactor))
          : node.contextSlice;

      const withContext: DAGNode = {
        ...node,
        contextSlice,
        ...(model ? { assignedProvider: model.provider, assignedModel: model.model } : {}),
        // Ensembles are a premium-only expense.
        requiresEnsemble: strategy === 'premium' && node.requiresEnsemble,
      };

      const profile = await this.profiler.profile(withContext, taskType, model ?? undefined);
      routed.push(this.profiler.applyProfile(withContext, profile));
    }

    const dag = new DAG(routed);
    const maxGroupSize = this.maxGroupSize(strategy);
    const parallelGroups = dag.parallelGroups(maxGroupSize);

    const estimatedTotalTokens = routed.reduce(
      (sum, node) => sum + node.estimatedInputTokens + node.estimatedOutputTokens,
      0,
    );
    const estimatedTotalLatencyMs = this.calculateDAGLatency(parallelGroups, routed);
    const sequentialMs = dag.sequentialMs();

    return {
      id: planId(),
      strategy,
      nodes: routed,
      parallelGroups,
      estimatedTotalTokens,
      estimatedTotalLatencyMs,
      estimatedTotalCost: this.estimateCost(routed),
      reliabilityScore: this.calculateReliability(routed),
      reasoning: this.explain(strategy, routed, parallelGroups, estimatedTotalLatencyMs, sequentialMs, budget),
    };
  }

  private maxGroupSize(strategy: ExecutionStrategy): number {
    if (!config.features.parallelExecution) return 1;
    switch (strategy) {
      case 'draft':
        return 1;
      case 'balanced':
        return config.execution.maxParallelSubtasks;
      case 'premium':
        return Math.max(config.execution.maxParallelSubtasks, 6);
    }
  }

  /** A group costs its slowest member; the plan costs the sum of its groups. */
  calculateDAGLatency(groups: string[][], nodes: DAGNode[]): number {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return groups.reduce(
      (total, group) =>
        total + group.reduce((slowest, id) => Math.max(slowest, byId.get(id)?.estimatedLatencyMs ?? 0), 0),
      0,
    );
  }

  estimateCost(nodes: DAGNode[]): number {
    let cost = 0;
    for (const node of nodes) {
      const model = this.resolveModel(node);
      if (!model) continue;
      cost += this.registry.estimateCost(model, node.estimatedInputTokens, node.estimatedOutputTokens);
    }
    return Number(cost.toFixed(6));
  }

  /** Every node must succeed, so reliability multiplies. */
  calculateReliability(nodes: DAGNode[]): number {
    if (nodes.length === 0) return 0;
    const product = nodes.reduce((total, node) => total * (this.resolveModel(node)?.reliability ?? 0.9), 1);
    return Number(product.toFixed(4));
  }

  private resolveModel(node: DAGNode): ProviderModel | undefined {
    if (!node.assignedProvider || !node.assignedModel) return undefined;
    return this.registry.findModel(node.assignedProvider, node.assignedModel);
  }

  private explain(
    strategy: ExecutionStrategy,
    nodes: DAGNode[],
    groups: string[][],
    parallelMs: number,
    sequentialMs: number,
    budget: TaskBudget,
  ): string {
    const savingPercent = sequentialMs > 0 ? Math.round((1 - parallelMs / sequentialMs) * 100) : 0;
    const widest = groups.reduce((max, group) => Math.max(max, group.length), 0);
    const models = [...new Set(nodes.map((node) => node.assignedModel).filter(Boolean))];

    const parts = [
      `${nodes.length} subtask${nodes.length === 1 ? '' : 's'} in ${groups.length} batch${groups.length === 1 ? '' : 'es'}`,
    ];

    if (widest > 1) {
      parts.push(`up to ${widest} running concurrently, cutting wall-clock ~${savingPercent}% versus sequential`);
    } else {
      parts.push('sequential execution to minimize concurrent quota pressure');
    }

    parts.push(`routed across ${models.length} model${models.length === 1 ? '' : 's'}: ${models.join(', ') || 'none available'}`);

    switch (strategy) {
      case 'draft':
        parts.push('context compressed to ~55% and cheapest capable models selected');
        break;
      case 'balanced':
        parts.push('mid-tier models chosen on quality-per-token; verification only when confidence is low');
        break;
      case 'premium':
        parts.push('highest-quality capable models, full context, verification always on');
        break;
    }

    if (budget.maxTokens) parts.push(`token budget ${budget.maxTokens}`);
    return `${parts.join('; ')}.`;
  }
}
