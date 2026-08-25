import type { ProviderCapability } from './provider';
import type { OutputFormat } from './task';

/**
 * Agent roles are capabilities, not models (Rule 3).
 * A role says what the work needs; the router picks who does it.
 */
export enum AgentRole {
  CLASSIFIER = 'classifier',
  ENHANCER = 'enhancer',
  DECOMPOSER = 'decomposer',
  RESEARCHER = 'researcher',
  CODER = 'coder',
  CODE_REVIEWER = 'code_reviewer',
  SECURITY_ANALYZER = 'security_analyzer',
  PERFORMANCE_ANALYZER = 'performance_analyzer',
  ARCHITECT = 'architect',
  SUMMARIZER = 'summarizer',
  VISION_ANALYZER = 'vision_analyzer',
  AUDIO_TRANSCRIBER = 'audio_transcriber',
  SYNTHESIZER = 'synthesizer',
  VERIFIER = 'verifier',
  CRITIC = 'critic',
}

export interface RoleDefinition {
  role: AgentRole;
  description: string;
  requiredCapabilities: ProviderCapability[];
  optionalCapabilities?: ProviderCapability[];
  /** Advisory only — routing is capability-first, these break ties. */
  preferredModels: string[];
  systemPrompt: string;
  maxOutputTokens: number;
  temperature: number;
  responseFormat?: 'text' | 'json';
  /** Expected output tokens as a fraction of input, used by the profiler. */
  outputRatio: number;
  /** Preferred format of the role's answer, used by the output optimizer. */
  outputFormat?: OutputFormat;
}
