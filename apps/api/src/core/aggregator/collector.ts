import { AgentRole } from '@modelmesh/types';
import type { ExecutionPlan, ProviderUsage, SubTaskResult } from '@modelmesh/types';

/**
 * Layer 13a — collection.
 *
 * Turns the scheduler's result map into the shapes the rest of the pipeline
 * needs: which outputs are analyses versus the merge, what the usage totals
 * are, and how confident the run is as a whole.
 */

export interface CollectedResults {
  analyses: SubTaskResult[];
  synthesis: SubTaskResult | null;
  critique: SubTaskResult | null;
  all: SubTaskResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalFailovers: number;
  cacheHits: number;
  providerBreakdown: ProviderUsage[];
  /** Confidence weighted by output volume — a one-line answer counts less. */
  overallConfidence: number;
}

export class ResultCollector {
  collect(results: Map<string, SubTaskResult>, plan: ExecutionPlan): CollectedResults {
    const ordered = plan.nodes
      .map((node) => results.get(node.id))
      .filter((result): result is SubTaskResult => result !== undefined);

    // Any result not present in the plan (e.g. from a re-plan) still counts.
    for (const result of results.values()) {
      if (!ordered.includes(result)) ordered.push(result);
    }

    const synthesis = ordered.find((result) => result.role === AgentRole.SYNTHESIZER) ?? null;
    const critique = ordered.find((result) => result.role === AgentRole.CRITIC) ?? null;
    const analyses = ordered.filter(
      (result) => result.role !== AgentRole.SYNTHESIZER && result.role !== AgentRole.CRITIC,
    );

    const providerBreakdown: ProviderUsage[] = ordered.map((result) => ({
      provider: result.provider,
      model: result.model,
      subtask: result.subtaskId,
      inputTokens: result.actualInputTokens,
      outputTokens: result.actualOutputTokens,
      latencyMs: result.actualLatencyMs,
    }));

    return {
      analyses,
      synthesis,
      critique,
      all: ordered,
      totalInputTokens: ordered.reduce((sum, result) => sum + result.actualInputTokens, 0),
      totalOutputTokens: ordered.reduce((sum, result) => sum + result.actualOutputTokens, 0),
      totalFailovers: ordered.reduce((sum, result) => sum + result.failovers, 0),
      cacheHits: ordered.filter((result) => result.fromCache).length,
      providerBreakdown,
      overallConfidence: this.calculateOverallConfidence(ordered),
    };
  }

  calculateOverallConfidence(results: SubTaskResult[]): number {
    if (results.length === 0) return 0;

    // Weight by output size: a substantive answer should dominate a stub.
    let weightedSum = 0;
    let weightTotal = 0;
    for (const result of results) {
      const weight = Math.max(1, Math.min(result.actualOutputTokens, 4_000));
      weightedSum += result.confidence * weight;
      weightTotal += weight;
    }

    const weighted = weightedSum / weightTotal;
    // The weakest link matters: a low-confidence input drags the merge down.
    const lowest = Math.min(...results.map((result) => result.confidence));
    return Number((weighted * 0.75 + lowest * 0.25).toFixed(3));
  }
}
