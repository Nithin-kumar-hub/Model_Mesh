export type Modality = 'text' | 'code';
export type TaskType =
  | 'code_generation'
  | 'debugging'
  | 'refactoring'
  | 'code_explanation'
  | 'text_generation'
  | 'summarization'
  | 'explanation'
  | 'translation'
  | 'question_answering'
  | 'other';

export type Complexity = 'simple' | 'medium' | 'complex';
export type Strategy = 'draft' | 'balanced' | 'premium';

export type LifecycleState =
  | 'IDLE'
  | 'INPUT_READY'
  | 'CLASSIFYING'
  | 'PROFILE_READY'
  | 'ROUTING'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'RECOVERING'
  | 'COMPLETED'
  | 'ERROR';

export interface Classification {
  modality: Modality;
  task_type: TaskType;
  complexity: Complexity;
  confidence: number;
  source: string;
  signals: string[];
}

export interface TokenRange {
  best: number;
  expected: number;
  worst: number;
}

export interface WorkloadProfile {
  estimated_input_tokens: number;
  estimated_output_tokens: TokenRange;
  estimated_total_tokens: TokenRange;
  required_context_tokens: number;
  confidence: number;
  reasons: string[];
  is_estimate: boolean;
}

export interface RouteCandidate {
  provider_id: string;
  model_id: string;
  model_ref: string;
  score: number;
  rank: number;
  score_breakdown: Record<string, number>;
  reasons: string[];
  estimated_cost_usd: number | null;
  estimated_latency_ms: number | null;
  is_mock: boolean;
}

export interface RejectedCandidate {
  model_ref: string;
  reason_code: string;
  detail: string;
}

export interface RoutePlan {
  strategy: Strategy;
  selected: RouteCandidate;
  candidates: RouteCandidate[];
  rejected: RejectedCandidate[];
  classification: Classification;
  profile: WorkloadProfile;
}

export interface Attempt {
  provider_id: string;
  model_id: string;
  model_ref: string;
  status: 'success' | 'failed';
  latency_ms: number;
  error_code?: string;
  detail?: string;
}

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  is_estimate: boolean;
}

export interface ExecutionResult {
  task_id: string;
  status: 'success' | 'failed';
  provider_id: string | null;
  model_id: string | null;
  model_ref: string | null;
  output_text: string | null;
  usage: Usage;
  latency_ms: number;
  attempts: Attempt[];
  retries: number;
  failovers: number;
  is_mock: boolean;
  failover_occurred: boolean;
  route_reasons: string[];
  classification: Classification;
  profile: WorkloadProfile;
  error_code?: string;
  error_message?: string;
}

export interface ProviderModel {
  id: string;
  provider_id: string;
  display_name: string;
  modalities: string[];
  context_window: number;
  max_output_tokens: number;
  quality_prior: number;
  reliability_prior: number;
  is_mock: boolean;
}

export interface Provider {
  id: string;
  display_name: string;
  is_mock: boolean;
  models: ProviderModel[];
}

export interface TelemetryStats {
  total_executions: number;
  success_rate: number;
  total_tokens: number;
  avg_latency_ms: number;
  failover_count: number;
  provider_distribution: Record<string, number>;
}

export interface ApiKeyItem {
  provider_id: string;
  label: string;
  fingerprint: string;
  mask: string;
  status: string;
  priority: number;
  quota_used: number;
  quota_limit: number | null;
  last_error_code?: string;
  is_in_cooldown: boolean;
}

export interface CompareStrategiesResult {
  classification: Classification;
  profile: WorkloadProfile;
  draft: RoutePlan;
  balanced: RoutePlan;
  premium: RoutePlan;
}
