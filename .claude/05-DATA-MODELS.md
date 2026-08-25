# 05 — Data Models

## Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ═══════════════════════════════════════════════
// TASKS
// ═══════════════════════════════════════════════

model Task {
  id          String     @id @default(cuid())
  status      TaskStatus @default(RECEIVED)
  strategy    Strategy   @default(BALANCED)

  // Input
  inputType   InputType
  inputText   String?
  inputMeta   Json?      // localMetadata from phone

  // Classification result
  taskType    String?
  confidence  Float?

  // Enhancement
  enhancedSpec Json?    // structured goal + constraints

  // Plan
  executionPlan Json?   // chosen ExecutionPlan

  // Result
  output      String?
  outputFormat String?  @default("markdown")
  outputConfidence Float?

  // Telemetry
  estimatedTokens   Int?
  actualTokens      Int?
  estimatedLatencyMs Int?
  actualLatencyMs   Int?
  failovers         Int    @default(0)
  cacheHits         Int    @default(0)

  // Relations
  subtasks    SubTask[]
  traceEvents TraceEvent[]
  feedback    TaskFeedback?

  // Timestamps
  createdAt   DateTime @default(now())
  startedAt   DateTime?
  completedAt DateTime?
  updatedAt   DateTime @updatedAt

  @@index([status])
  @@index([createdAt])
  @@index([taskType])
}

model SubTask {
  id           String        @id @default(cuid())
  taskId       String
  task         Task          @relation(fields: [taskId], references: [id])

  role         String        // AgentRole enum value
  status       SubTaskStatus @default(PENDING)
  dependencies String[]      // IDs of subtasks this depends on

  // Context slice sent to this subtask
  contextSlice String?
  prompt       String?

  // Execution
  provider     String?
  model        String?
  attemptNumber Int     @default(1)
  failovers    Int      @default(0)

  // Result
  output       String?
  confidence   Float?
  estimatedInputTokens  Int?
  estimatedOutputTokens Int?
  actualInputTokens     Int?
  actualOutputTokens    Int?
  latencyMs    Int?
  errorCode    String?

  // Timestamps
  createdAt    DateTime @default(now())
  startedAt    DateTime?
  completedAt  DateTime?

  @@index([taskId])
  @@index([status])
}

// ═══════════════════════════════════════════════
// PROVIDERS & KEYS
// ═══════════════════════════════════════════════

model ProviderKey {
  id          String   @id @default(cuid())
  provider    String   // "gemini" | "groq" | "together" | "mistral"
  maskedKey   String   // for display: "gsk_****xyz"
  encryptedKey String  // AES-256 encrypted in DB
  label       String?
  priority    Int      @default(1)

  // Health tracking
  healthScore     Float   @default(1.0)  // 0-1, rolling success rate
  totalCalls      Int     @default(0)
  successfulCalls Int     @default(0)
  failedCalls     Int     @default(0)
  lastErrorCode   String?
  lastUsedAt      DateTime?

  // Quota tracking
  quotaLimit     Int?
  quotaUsed      Int     @default(0)
  quotaResetAt   DateTime?
  isRateLimited  Boolean @default(false)
  rateLimitUntil DateTime?

  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt

  @@index([provider, active])
  @@index([provider, healthScore])
}

// ═══════════════════════════════════════════════
// TELEMETRY
// ═══════════════════════════════════════════════

model TelemetryRecord {
  id          String   @id @default(cuid())
  taskId      String
  subtaskId   String?

  // Classification accuracy
  taskType    String?
  classificationConfidence Float?

  // Token accuracy
  estimatedInputTokens  Int?
  actualInputTokens     Int?
  estimatedOutputTokens Int?
  actualOutputTokens    Int?
  tokenPredictionError  Float?  // (actual - estimated) / estimated

  // Latency accuracy
  estimatedLatencyMs Int?
  actualLatencyMs    Int?
  latencyPredictionError Float?

  // Execution quality
  provider    String?
  model       String?
  role        String?
  strategy    String?
  confidence  Float?
  failovers   Int?

  // User signal
  userRating  Int?

  recordedAt  DateTime @default(now())

  @@index([taskType])
  @@index([provider])
  @@index([recordedAt])
}

// For the calibration model — aggregated by task type
model CalibrationModel {
  id             String   @id @default(cuid())
  taskType       String   @unique
  role           String

  // Current calibration coefficients
  // actual = estimated * multiplier + bias
  inputTokenMultiplier   Float @default(1.0)
  inputTokenBias         Float @default(0.0)
  outputTokenMultiplier  Float @default(1.0)
  outputTokenBias        Float @default(0.0)
  latencyMultiplier      Float @default(1.0)
  latencyBias            Float @default(0.0)

  // Calibration metadata
  sampleCount    Int      @default(0)
  lastUpdatedAt  DateTime @default(now())

  @@index([taskType])
}

// ═══════════════════════════════════════════════
// TRACE EVENTS
// ═══════════════════════════════════════════════

model TraceEvent {
  id      String   @id @default(cuid())
  taskId  String
  task    Task     @relation(fields: [taskId], references: [id])

  event   String   // matches WebSocket event names
  payload Json?
  msOffset Int     // milliseconds from task creation

  @@index([taskId])
}

// ═══════════════════════════════════════════════
// SEMANTIC CACHE
// ═══════════════════════════════════════════════

model SemanticCache {
  id          String   @id @default(cuid())
  cacheKey    String   @unique  // sha256(provider+model+normalizedPrompt)
  prompt      String
  response    String
  provider    String
  model       String
  inputTokens Int
  outputTokens Int
  hitCount    Int      @default(0)
  createdAt   DateTime @default(now())
  expiresAt   DateTime

  @@index([cacheKey])
  @@index([expiresAt])
}

// ═══════════════════════════════════════════════
// FEEDBACK
// ═══════════════════════════════════════════════

model TaskFeedback {
  id         String   @id @default(cuid())
  taskId     String   @unique
  task       Task     @relation(fields: [taskId], references: [id])
  rating     Int      // 1-5
  comment    String?
  createdAt  DateTime @default(now())
}

// ═══════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════

enum TaskStatus {
  RECEIVED
  CLASSIFYING
  ENHANCING
  DECOMPOSING
  PLANNING
  EXECUTING
  AGGREGATING
  VERIFYING
  COMPLETED
  FAILED
}

enum SubTaskStatus {
  PENDING
  RUNNING
  COMPLETED
  FAILED
  SKIPPED
}

enum Strategy {
  DRAFT
  BALANCED
  PREMIUM
}

enum InputType {
  TEXT
  CODE
  IMAGE
  PDF
  AUDIO
  VIDEO
  QR
  MULTIPART
}
```

---

## TypeScript Types

```typescript
// packages/types/src/index.ts

export type TaskStatus =
  | 'received' | 'classifying' | 'enhancing' | 'decomposing'
  | 'planning' | 'executing' | 'aggregating' | 'verifying'
  | 'completed' | 'failed';

export type ExecutionStrategy = 'draft' | 'balanced' | 'premium';
export type InputType = 'text' | 'code' | 'image' | 'pdf' | 'audio' | 'video' | 'qr' | 'multipart';

export enum AgentRole {
  CLASSIFIER           = 'classifier',
  ENHANCER             = 'enhancer',
  DECOMPOSER           = 'decomposer',
  RESEARCHER           = 'researcher',
  CODER                = 'coder',
  CODE_REVIEWER        = 'code_reviewer',
  SECURITY_ANALYZER    = 'security_analyzer',
  PERFORMANCE_ANALYZER = 'performance_analyzer',
  ARCHITECT            = 'architect',
  SUMMARIZER           = 'summarizer',
  VISION_ANALYZER      = 'vision_analyzer',
  AUDIO_TRANSCRIBER    = 'audio_transcriber',
  SYNTHESIZER          = 'synthesizer',
  VERIFIER             = 'verifier',
  CRITIC               = 'critic',
}

// ─── Task input ────────────────────────────────────────────

export interface TaskInput {
  type: InputType;
  text?: string;
  files?: InputFile[];
  localMetadata?: LocalMetadata;
}

export interface InputFile {
  id: string;
  mimeType: string;
  base64?: string;
  url?: string;          // for large files stored in object storage
  metadata?: {
    pageCount?: number;
    sizeBytes?: number;
    imageWidth?: number;
    imageHeight?: number;
    audioDurationSeconds?: number;
    preprocessedAt?: string;
    detectedText?: string;  // OCR already done on device
  };
}

export interface LocalMetadata {
  detectedText?: string;
  detectedLanguage?: string;
  barcodeData?: string;
  imageWidth?: number;
  imageHeight?: number;
  audioDurationSeconds?: number;
  deviceModel?: string;
  hasNPU?: boolean;
  hasGPU?: boolean;
  batteryLevel?: number;
  isOnWifi?: boolean;
}

// ─── Classification ────────────────────────────────────────

export type TaskType =
  | 'CODE_ANALYSIS' | 'CODE_REVIEW' | 'CODE_GENERATION' | 'BUG_FIX'
  | 'DOCUMENT_ANALYSIS' | 'PDF_EXTRACTION' | 'DOCUMENT_QA'
  | 'IMAGE_ANALYSIS' | 'OCR' | 'VISUAL_QA'
  | 'AUDIO_TRANSCRIPTION' | 'AUDIO_ANALYSIS'
  | 'RESEARCH' | 'SUMMARIZATION' | 'TRANSLATION'
  | 'CREATIVE_WRITING' | 'DATA_ANALYSIS'
  | 'SIMPLE_QA' | 'COMPLEX_REASONING';

export interface TaskClassification {
  taskType: TaskType;
  modalities: InputType[];
  complexity: 'simple' | 'medium' | 'complex' | 'very_complex';
  requiresVision: boolean;
  requiresCode: boolean;
  requiresReasoning: boolean;
  estimatedSubtasks: number;
  confidence: number;
  classifiedBy: 'rule' | 'on_device' | 'cloud';
}

// ─── DAG ──────────────────────────────────────────────────

export interface DAGNode {
  id: string;
  role: AgentRole;
  dependencies: string[];     // IDs of nodes that must complete first
  contextSlice: string;       // The reduced context for this subtask
  instructions: string;       // Task-specific instructions
  capabilities: ProviderCapability[];  // Required capabilities
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedLatencyMs: number;
  priority: number;           // higher = run first when possible
  requiresEnsemble: boolean;  // run on multiple models + vote?
}

// ─── Execution Plan ───────────────────────────────────────

export interface ExecutionPlan {
  id: string;
  strategy: ExecutionStrategy;
  nodes: DAGNode[];
  parallelGroups: string[][];  // batches that can run concurrently
  estimatedTotalTokens: number;
  estimatedTotalLatencyMs: number;
  estimatedTotalCost: number;
  reliabilityScore: number;    // 0-1, lower = riskier
  reasoning: string;           // human-readable why this plan
}

// ─── Provider ────────────────────────────────────────────

export type ProviderName = 'gemini' | 'groq' | 'together' | 'mistral' | 'openrouter';

export type ProviderCapability =
  | 'text' | 'code' | 'reasoning' | 'vision' | 'audio'
  | 'long_context' | 'fast' | 'cheap' | 'multilingual';

export interface ProviderModel {
  provider: ProviderName;
  model: string;
  capabilities: ProviderCapability[];
  maxContextTokens: number;
  avgLatencyMs: number;
  costPerInputMToken: number;
  costPerOutputMToken: number;
  reliability: number;
}

// ─── Results ──────────────────────────────────────────────

export interface SubTaskResult {
  subtaskId: string;
  role: AgentRole;
  provider: ProviderName;
  model: string;
  output: string;
  confidence: number;
  actualInputTokens: number;
  actualOutputTokens: number;
  actualLatencyMs: number;
  failovers: number;
  fromCache: boolean;
}

export interface TaskResult {
  taskId: string;
  status: TaskStatus;
  output: string;
  outputFormat: 'markdown' | 'json' | 'text' | 'code';
  confidence: number;
  plan: ExecutionPlan;
  telemetry: ExecutionTelemetry;
}

export interface ExecutionTelemetry {
  totalMs: number;
  estimatedTokens: number;
  actualTokens: number;
  savedTokens: number;
  savingsPercent: number;
  cacheHits: number;
  failovers: number;
  providerBreakdown: ProviderUsage[];
}

export interface ProviderUsage {
  provider: ProviderName;
  model: string;
  subtask: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}

// ─── Errors ──────────────────────────────────────────────

export type ErrorCode =
  | 'INVALID_INPUT'
  | 'CLASSIFICATION_FAILED'
  | 'DECOMPOSITION_FAILED'
  | 'PLANNING_FAILED'
  | 'ALL_PROVIDERS_FAILED'
  | 'RATE_LIMIT_GLOBAL'
  | 'TIMEOUT'
  | 'PROMPT_INJECTION'
  | 'VERIFICATION_FAILED';

export type Result<T, E = Error> =
  | { success: true; data: T }
  | { success: false; error: E; code: ErrorCode };
```

---

## Key Storage Strategy

```
PostgreSQL: persistent records (tasks, subtasks, telemetry, keys)
Redis keys:
  key:manager:{provider}          → sorted set of key IDs by health
  key:ratelimit:{keyId}           → TTL = rate limit window end
  task:state:{taskId}             → JSON state of running task (TTL=5min)
  cache:{cacheKey}                → semantic cache response (TTL=1h-24h)
  provider:quota:{provider}       → today's token usage count
  subtask:lock:{subtaskId}        → prevent double execution
```
