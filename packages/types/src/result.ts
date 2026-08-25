import type { ExecutionPlan } from './dag';
import type { ProviderName } from './provider';
import type { AgentRole } from './roles';
import type { OutputFormat, TaskStatus } from './task';

export interface SubTaskResult {
  subtaskId: string;
  role: AgentRole;
  provider: ProviderName;
  model: string;
  output: string;
  /** Inferred from output patterns, not self-reported (see CLAUDE.md §10). */
  confidence: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualLatencyMs: number;
  failovers: number;
  fromCache: boolean;
}

export interface ProviderUsage {
  provider: ProviderName;
  model: string;
  subtask: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

export interface ExecutionTelemetry {
  totalMs: number;
  estimatedTokens: number;
  actualTokens: number;
  /** Tokens avoided by optimization + caching vs. the naive single-call baseline. */
  savedTokens: number;
  savingsPercent: number;
  cacheHits: number;
  failovers: number;
  providerBreakdown: ProviderUsage[];
}

export interface Conflict {
  id: string;
  claimA: string;
  claimB: string;
  sourceA: string;
  sourceB: string;
  severity: 'low' | 'medium' | 'high';
  resolution?: string;
}

export interface AggregatedResult {
  output: string;
  outputFormat: OutputFormat;
  conflictsFound: number;
  conflictsResolved: number;
  confidence: number;
  duplicatesRemoved: number;
}

export interface VerificationResult {
  verified: boolean;
  issues: string[];
  corrections: string[];
  confidence: number;
  verifiedBy: 'critic' | 'consistency' | 'skipped';
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output: string;
  outputFormat: OutputFormat;
  confidence: number;
  plan: ExecutionPlan;
  telemetry: ExecutionTelemetry;
  verification?: VerificationResult;
  /** Present when some subtasks failed but a partial answer was produced. */
  partial?: boolean;
  failedSubtasks?: string[];
}
