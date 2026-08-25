/** Provider-facing contracts. All adapters normalize to these shapes. */

export type ProviderName = 'gemini' | 'groq' | 'together' | 'mistral' | 'openrouter' | 'mock';

export type ProviderCapability =
  | 'text'
  | 'code'
  | 'reasoning'
  | 'vision'
  | 'audio'
  | 'long_context'
  | 'fast'
  | 'cheap'
  | 'multilingual';

export interface ProviderModel {
  provider: ProviderName;
  model: string;
  capabilities: ProviderCapability[];
  maxContextTokens: number;
  avgLatencyMs: number;
  costPerInputMToken: number;
  costPerOutputMToken: number;
  reliability: number;
  /** 0-1 relative quality, used by the strategy scorer. */
  quality: number;
}

export interface ProviderRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  /** base64-encoded images for vision models. */
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  timeoutMs?: number;
  /**
   * The AgentRole this call serves. Advisory: used for logging and by the
   * deterministic mock provider to shape offline output.
   */
  roleHint?: string;
}

export interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

export type ProviderErrorKind =
  | 'RATE_LIMIT'
  | 'AUTH'
  | 'SERVER_ERROR'
  | 'TIMEOUT'
  | 'BAD_REQUEST'
  | 'UNKNOWN';

export interface RouteDecision {
  provider: ProviderName;
  model: string;
  keyId: string;
  apiKey: string;
  systemPrompt: string;
  maxOutputTokens: number;
  temperature: number;
  responseFormat?: 'text' | 'json';
}

export type ProviderHealthStatus = 'healthy' | 'degraded' | 'unavailable';

export interface ProviderStatus {
  provider: ProviderName;
  status: ProviderHealthStatus;
  activeKeys: number;
  rateLimitedKeys: number;
  avgLatencyMs: number;
  healthScore: number;
  quotaConsumedToday: number;
  models: string[];
}
