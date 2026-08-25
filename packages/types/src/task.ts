/**
 * Task lifecycle, input, and classification contracts.
 * Mirrors docs/05-DATA-MODELS.md.
 */

export type TaskStatus =
  | 'received'
  | 'classifying'
  | 'enhancing'
  | 'decomposing'
  | 'planning'
  | 'executing'
  | 'aggregating'
  | 'verifying'
  | 'completed'
  | 'failed';

export type ExecutionStrategy = 'draft' | 'balanced' | 'premium';

export type InputType = 'text' | 'code' | 'image' | 'pdf' | 'audio' | 'video' | 'qr' | 'multipart';

export type OutputFormat = 'markdown' | 'json' | 'text' | 'code';

// ─── Task input ────────────────────────────────────────────

export interface InputFile {
  id: string;
  mimeType: string;
  base64?: string;
  /** For large files stored in object storage. */
  url?: string;
  metadata?: {
    pageCount?: number;
    sizeBytes?: number;
    imageWidth?: number;
    imageHeight?: number;
    audioDurationSeconds?: number;
    preprocessedAt?: string;
    /** OCR already performed on device — saves a vision call. */
    detectedText?: string;
  };
}

/** Everything the phone knows before the first network call. */
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

export interface TaskInput {
  type: InputType;
  text?: string;
  files?: InputFile[];
  localMetadata?: LocalMetadata;
}

export interface TaskBudget {
  maxTokens?: number;
  maxLatencyMs?: number;
  minQuality?: number;
}

export interface TaskPreferences {
  preferLocalModels?: boolean;
  explainPlan?: boolean;
  streamTrace?: boolean;
}

export interface SubmitTaskRequest {
  input: TaskInput;
  strategy?: ExecutionStrategy;
  budget?: TaskBudget;
  preferences?: TaskPreferences;
}

export interface SubmitTaskResponse {
  taskId: string;
  status: TaskStatus;
  websocketRoom: string;
  estimatedMs: number;
  createdAt: string;
}

// ─── Classification ────────────────────────────────────────

export type TaskType =
  | 'CODE_ANALYSIS'
  | 'CODE_REVIEW'
  | 'CODE_GENERATION'
  | 'BUG_FIX'
  | 'DOCUMENT_ANALYSIS'
  | 'PDF_EXTRACTION'
  | 'DOCUMENT_QA'
  | 'IMAGE_ANALYSIS'
  | 'OCR'
  | 'VISUAL_QA'
  | 'AUDIO_TRANSCRIPTION'
  | 'AUDIO_ANALYSIS'
  | 'RESEARCH'
  | 'SUMMARIZATION'
  | 'TRANSLATION'
  | 'CREATIVE_WRITING'
  | 'DATA_ANALYSIS'
  | 'SIMPLE_QA'
  | 'COMPLEX_REASONING';

export type Complexity = 'simple' | 'medium' | 'complex' | 'very_complex';

export interface TaskClassification {
  taskType: TaskType;
  modalities: InputType[];
  complexity: Complexity;
  requiresVision: boolean;
  requiresCode: boolean;
  requiresReasoning: boolean;
  estimatedSubtasks: number;
  confidence: number;
  classifiedBy: 'rule' | 'on_device' | 'cloud';
}

// ─── Enhancement ───────────────────────────────────────────

/** The structured specification produced from vague user input. */
export interface EnhancedTask {
  goal: string;
  constraints: string[];
  expectedOutputFormat: OutputFormat;
  helpfulContext: string;
  edgeCases: string[];
  /** Untrusted document/OCR content, kept separate from user intent (Rule 6). */
  documentContent: string;
  /** Sanitized user intent — never mixed with documentContent. */
  userIntent: string;
  /** Assembled text used for decomposition and context slicing. */
  fullText: string;
  enhancedBy: 'rule' | 'llm';
}

export interface OptimizedTask extends EnhancedTask {
  optimizedText: string;
  tokensSaved: number;
  originalEstimatedTokens: number;
  optimizedEstimatedTokens: number;
}
