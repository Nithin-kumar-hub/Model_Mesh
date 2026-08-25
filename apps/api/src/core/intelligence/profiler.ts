import type { DAGNode, ProviderModel } from '@modelmesh/types';
import { countTokens } from '../../infra/text';
import type { CalibrationRecord } from '../../infra/records';
import { getRoleDefinition } from '../agents/roles';
import type { CalibrationEngine } from '../telemetry/calibration';

/**
 * Layer 6 — per-subtask profiling (docs/08-TOKEN-INTELLIGENCE.md).
 *
 * Produces the estimates the planner spends: input tokens, output tokens,
 * latency. Every estimate passes through the calibration coefficients for its
 * (taskType, role) pair, so the numbers converge on reality as the system runs
 * (Rule 4). A fresh install starts with neutral coefficients and honest
 * heuristics.
 */

export interface TokenProfile {
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedLatencyMs: number;
  /** How much to trust this estimate, from calibration sample count. */
  confidence: number;
}

/** Provider-independent baseline: system prompt + protocol overhead. */
const PROMPT_OVERHEAD_TOKENS = 220;
/** Rough throughput floor when no model is assigned yet. */
const DEFAULT_TOKENS_PER_SECOND = 90;
const DEFAULT_FIRST_TOKEN_MS = 450;

export class TokenProfiler {
  constructor(private readonly calibration: CalibrationEngine) {}

  async profile(node: DAGNode, taskType: string, model?: ProviderModel): Promise<TokenProfile> {
    const calibration = await this.calibration.get(taskType, node.role);
    return this.profileWith(node, calibration, model);
  }

  /** Synchronous form for hot paths that already hold the coefficients. */
  profileWith(node: DAGNode, calibration: CalibrationRecord, model?: ProviderModel): TokenProfile {
    const roleDef = getRoleDefinition(node.role);

    const contextTokens = countTokens(node.contextSlice);
    const dependencyTokens = countTokens(node.dependencyContext ?? '');
    const promptTokens = countTokens(node.instructions);

    const rawInput = contextTokens + dependencyTokens + promptTokens + PROMPT_OVERHEAD_TOKENS;

    // Output scales with input, but the role's cap is a hard ceiling.
    const rawOutput = Math.min(
      roleDef.maxOutputTokens,
      Math.max(64, Math.ceil(rawInput * roleDef.outputRatio)),
    );

    const estimatedInputTokens = Math.max(
      1,
      Math.ceil(rawInput * calibration.inputTokenMultiplier + calibration.inputTokenBias),
    );
    const estimatedOutputTokens = Math.max(
      1,
      Math.ceil(rawOutput * calibration.outputTokenMultiplier + calibration.outputTokenBias),
    );

    const rawLatency = this.estimateLatency(estimatedInputTokens, estimatedOutputTokens, model);
    const estimatedLatencyMs = Math.max(
      50,
      Math.ceil(rawLatency * calibration.latencyMultiplier + calibration.latencyBias),
    );

    return {
      estimatedInputTokens,
      estimatedOutputTokens,
      estimatedLatencyMs,
      confidence: this.profileConfidence(calibration),
    };
  }

  /** Apply a profile to a node, returning the updated node. */
  applyProfile(node: DAGNode, profile: TokenProfile): DAGNode {
    return {
      ...node,
      estimatedInputTokens: profile.estimatedInputTokens,
      estimatedOutputTokens: profile.estimatedOutputTokens,
      estimatedLatencyMs: profile.estimatedLatencyMs,
    };
  }

  estimateLatency(inputTokens: number, outputTokens: number, model?: ProviderModel): number {
    const firstToken = model?.avgLatencyMs ?? DEFAULT_FIRST_TOKEN_MS;
    // Larger prompts cost prefill time; output dominates for long answers.
    const prefillMs = (inputTokens / 1_000) * 12;
    const generationMs = (outputTokens / DEFAULT_TOKENS_PER_SECOND) * 1_000;
    return Math.round(firstToken + prefillMs + generationMs);
  }

  /** More samples → more trust, saturating around 20 observations. */
  profileConfidence(calibration: CalibrationRecord): number {
    return Number(Math.min(0.95, 0.4 + calibration.sampleCount * 0.03).toFixed(3));
  }

  /**
   * What this same plan would have cost without token intelligence: every node
   * handed the entire master context instead of its slice, with no prompt
   * compression and no cache. That is the honest counterfactual for
   * `savedTokens` — same models, same roles, one difference.
   */
  naiveBaselineTokens(masterContextTokens: number, nodes: DAGNode[]): number {
    const effective = nodes.length > 0 ? nodes : [];
    return effective.reduce((total, node) => {
      const roleDef = getRoleDefinition(node.role);
      const input = masterContextTokens + countTokens(node.instructions) + PROMPT_OVERHEAD_TOKENS;
      const output = Math.min(roleDef.maxOutputTokens, Math.ceil(input * roleDef.outputRatio));
      return total + input + output;
    }, 0);
  }
}
