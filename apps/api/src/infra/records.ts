/**
 * Persistence record shapes.
 *
 * Deliberately decoupled from the generated Prisma types so the in-process
 * store and the PostgreSQL store satisfy one contract, and so route handlers
 * never leak ORM types into the API surface.
 */
import type {
  ExecutionPlan,
  ExecutionStrategy,
  InputType,
  LocalMetadata,
  OutputFormat,
  ProviderName,
  TaskStatus,
  VerificationResult,
} from '@modelmesh/types';

export interface TaskRecord {
  id: string;
  status: TaskStatus;
  strategy: ExecutionStrategy;
  inputType: InputType;
  inputText: string | null;
  inputMeta: LocalMetadata | null;
  taskType: string | null;
  confidence: number | null;
  enhancedSpec: unknown | null;
  executionPlan: ExecutionPlan | null;
  output: string | null;
  outputFormat: OutputFormat | null;
  outputConfidence: number | null;
  verification: VerificationResult | null;
  partial: boolean;
  errorCode: string | null;
  estimatedTokens: number | null;
  actualTokens: number | null;
  savedTokens: number | null;
  estimatedLatencyMs: number | null;
  actualLatencyMs: number | null;
  failovers: number;
  cacheHits: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export type NewTask = Pick<TaskRecord, 'id' | 'strategy' | 'inputType'> &
  Partial<Pick<TaskRecord, 'inputText' | 'inputMeta' | 'status' | 'estimatedLatencyMs'>>;

export type TaskPatch = Partial<Omit<TaskRecord, 'id' | 'createdAt'>>;

export type SubTaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface SubTaskRecord {
  id: string;
  taskId: string;
  nodeId: string;
  role: string;
  status: SubTaskStatus;
  dependencies: string[];
  contextSlice: string | null;
  prompt: string | null;
  provider: string | null;
  model: string | null;
  attemptNumber: number;
  failovers: number;
  fromCache: boolean;
  output: string | null;
  confidence: number | null;
  estimatedInputTokens: number | null;
  estimatedOutputTokens: number | null;
  actualInputTokens: number | null;
  actualOutputTokens: number | null;
  latencyMs: number | null;
  errorCode: string | null;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
}

export type NewSubTask = Pick<SubTaskRecord, 'taskId' | 'nodeId' | 'role' | 'dependencies'> &
  Partial<
    Pick<
      SubTaskRecord,
      'contextSlice' | 'prompt' | 'estimatedInputTokens' | 'estimatedOutputTokens' | 'status' | 'provider' | 'model'
    >
  >;

export type SubTaskPatch = Partial<Omit<SubTaskRecord, 'id' | 'taskId' | 'nodeId' | 'createdAt'>>;

export interface TraceEventRecord {
  id: string;
  taskId: string;
  event: string;
  payload: Record<string, unknown> | null;
  msOffset: number;
}

export interface ProviderKeyRecord {
  id: string;
  provider: ProviderName;
  maskedKey: string;
  encryptedKey: string;
  keyHash: string;
  label: string | null;
  priority: number;
  healthScore: number;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  lastErrorCode: string | null;
  lastUsedAt: Date | null;
  avgLatencyMs: number;
  quotaLimit: number | null;
  quotaUsed: number;
  quotaResetAt: Date | null;
  isRateLimited: boolean;
  rateLimitUntil: Date | null;
  active: boolean;
  createdAt: Date;
}

export type NewProviderKey = Pick<ProviderKeyRecord, 'provider' | 'maskedKey' | 'encryptedKey' | 'keyHash'> &
  Partial<Pick<ProviderKeyRecord, 'label' | 'priority' | 'quotaLimit' | 'active'>>;

export type ProviderKeyPatch = Partial<Omit<ProviderKeyRecord, 'id' | 'provider' | 'createdAt' | 'keyHash'>>;

export interface TelemetryRecordInput {
  taskId: string;
  subtaskId?: string | null;
  taskType?: string | null;
  classificationConfidence?: number | null;
  estimatedInputTokens?: number | null;
  actualInputTokens?: number | null;
  estimatedOutputTokens?: number | null;
  actualOutputTokens?: number | null;
  estimatedLatencyMs?: number | null;
  actualLatencyMs?: number | null;
  provider?: string | null;
  model?: string | null;
  role?: string | null;
  strategy?: string | null;
  confidence?: number | null;
  failovers?: number | null;
  fromCache?: boolean;
  errorCode?: string | null;
  userRating?: number | null;
}

export interface TelemetryRecord extends TelemetryRecordInput {
  id: string;
  tokenPredictionError: number | null;
  latencyPredictionError: number | null;
  recordedAt: Date;
}

export interface CalibrationRecord {
  taskType: string;
  role: string;
  inputTokenMultiplier: number;
  inputTokenBias: number;
  outputTokenMultiplier: number;
  outputTokenBias: number;
  latencyMultiplier: number;
  latencyBias: number;
  sampleCount: number;
  lastUpdatedAt: Date;
}

export const NEUTRAL_CALIBRATION = (taskType: string, role: string): CalibrationRecord => ({
  taskType,
  role,
  inputTokenMultiplier: 1,
  inputTokenBias: 0,
  outputTokenMultiplier: 1,
  outputTokenBias: 0,
  latencyMultiplier: 1,
  latencyBias: 0,
  sampleCount: 0,
  lastUpdatedAt: new Date(0),
});

export interface CacheEntryRecord {
  cacheKey: string;
  prompt: string;
  response: string;
  provider: string;
  model: string;
  role: string | null;
  confidence: number | null;
  inputTokens: number;
  outputTokens: number;
  hitCount: number;
  createdAt: Date;
  expiresAt: Date;
}

export interface FeedbackRecord {
  taskId: string;
  rating: number;
  comment: string | null;
  actualQuality: number | null;
  createdAt: Date;
}
