import type { ProviderCapability, ProviderName } from './provider';
import type { AgentRole } from './roles';
import type { ExecutionStrategy } from './task';

/**
 * A node in the subtask DAG (Rule 2 — DAG, not list).
 * `contextSlice` holds ONLY what this subtask needs (Rule 1).
 */
export interface DAGNode {
  id: string;
  role: AgentRole;
  /** IDs of nodes that must complete before this one runs. */
  dependencies: string[];
  contextSlice: string;
  instructions: string;
  /** Outputs of upstream nodes, injected by the scheduler at dispatch time. */
  dependencyContext?: string;
  capabilities: ProviderCapability[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedLatencyMs: number;
  /** Higher runs first when several nodes are ready together. */
  priority: number;
  requiresEnsemble: boolean;
  /** base64 images routed to vision-capable models. */
  images?: string[];
  /** Set by the planner; the executor treats it as a hint, not a mandate. */
  assignedProvider?: ProviderName;
  assignedModel?: string;
  /** A node the plan can drop when the deadline is at risk. */
  optional?: boolean;
}

export interface ExecutionPlan {
  id: string;
  strategy: ExecutionStrategy;
  nodes: DAGNode[];
  /** Batches that can run concurrently, in execution order. */
  parallelGroups: string[][];
  estimatedTotalTokens: number;
  estimatedTotalLatencyMs: number;
  estimatedTotalCost: number;
  /** 0-1; product of per-node model reliability. Lower = riskier. */
  reliabilityScore: number;
  reasoning: string;
}

export interface DAGValidationError {
  code: 'CYCLE' | 'MISSING_DEPENDENCY' | 'DUPLICATE_ID' | 'EMPTY';
  message: string;
  nodeIds: string[];
}
