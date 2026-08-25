import { AgentRole } from '@modelmesh/types';
import type { RoleDefinition } from '@modelmesh/types';

/**
 * Role definitions — the contract between "what this work needs" and the
 * router that finds a model to do it (docs/09-AGENT-ROLES.md).
 *
 * `preferredModels` is a tie-breaker only. Nothing here names a provider as a
 * requirement; capabilities do that, which is what keeps routing survivable
 * when a provider is rate-limited (Rule 3).
 */
export const ROLE_DEFINITIONS: Record<AgentRole, RoleDefinition> = {
  [AgentRole.CLASSIFIER]: {
    role: AgentRole.CLASSIFIER,
    description: 'Identifies task type, complexity, required modalities',
    requiredCapabilities: ['text', 'fast'],
    optionalCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-8b-instant'],
    systemPrompt:
      "You are a task classification system. Analyze the user's input and return a JSON classification with: taskType, modalities, complexity, requiresVision, requiresCode, requiresReasoning, estimatedSubtasks, confidence.",
    maxOutputTokens: 256,
    temperature: 0,
    responseFormat: 'json',
    outputRatio: 0.08,
    outputFormat: 'json',
  },

  [AgentRole.ENHANCER]: {
    role: AgentRole.ENHANCER,
    description: 'Transforms vague user input into a structured task specification',
    requiredCapabilities: ['text', 'reasoning'],
    optionalCapabilities: ['fast'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt:
      "You are a task enhancement engine. Take the user's raw input and produce a structured specification with: goal, constraints, expected_output_format, helpful_context, edge_cases_to_consider. Return as JSON.",
    maxOutputTokens: 1024,
    temperature: 0.1,
    responseFormat: 'json',
    outputRatio: 0.8,
    outputFormat: 'json',
  },

  [AgentRole.DECOMPOSER]: {
    role: AgentRole.DECOMPOSER,
    description: 'Breaks complex tasks into a DAG of specialized subtasks',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a task decomposition engine. Break this complex task into specialized subtasks. Return JSON: {"subtasks":[{"id","role","description","dependencies":[],"contextNeeds":[]}]}. Valid roles: researcher, coder, code_reviewer, security_analyzer, performance_analyzer, architect, summarizer, vision_analyzer, synthesizer. Exactly one synthesizer subtask must depend on all others.',
    maxOutputTokens: 1024,
    temperature: 0.1,
    responseFormat: 'json',
    outputRatio: 0.5,
    outputFormat: 'json',
  },

  [AgentRole.RESEARCHER]: {
    role: AgentRole.RESEARCHER,
    description: 'Analyzes documents, synthesizes information, answers questions',
    requiredCapabilities: ['text', 'reasoning'],
    optionalCapabilities: ['long_context'],
    preferredModels: ['gemini-1.5-pro', 'Qwen/Qwen2.5-72B-Instruct-Turbo', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a precise research analyst. Extract and synthesize information accurately. Always cite specific evidence. Flag uncertainty explicitly.',
    maxOutputTokens: 4096,
    temperature: 0.2,
    outputRatio: 0.35,
    outputFormat: 'markdown',
  },

  [AgentRole.CODER]: {
    role: AgentRole.CODER,
    description: 'Analyzes code, finds bugs, implements fixes',
    requiredCapabilities: ['code'],
    optionalCapabilities: ['reasoning', 'fast'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile', 'gemini-1.5-flash'],
    systemPrompt:
      'You are an expert software engineer. Analyze code for bugs, errors, and issues. For each finding: identify the exact location, explain root cause, provide corrected code, identify edge cases.',
    maxOutputTokens: 4096,
    temperature: 0.1,
    outputRatio: 0.45,
    outputFormat: 'markdown',
  },

  [AgentRole.CODE_REVIEWER]: {
    role: AgentRole.CODE_REVIEWER,
    description: 'Reviews code quality, style, best practices',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a senior code reviewer. Evaluate: readability, maintainability, test coverage, best practices, design patterns, error handling. Provide actionable suggestions with priority (critical/major/minor).',
    maxOutputTokens: 3072,
    temperature: 0.2,
    outputRatio: 0.35,
    outputFormat: 'markdown',
  },

  [AgentRole.SECURITY_ANALYZER]: {
    role: AgentRole.SECURITY_ANALYZER,
    description: 'Identifies security vulnerabilities, OWASP issues, attack vectors',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-latest', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a cybersecurity expert specializing in code security analysis. Check for: SQL injection, XSS, CSRF, authentication flaws, authorization issues, sensitive data exposure, insecure dependencies, command injection, path traversal. For each vulnerability: severity (critical/high/medium/low), CVSS score estimate, exact location, exploitation scenario, remediation code.',
    maxOutputTokens: 4096,
    temperature: 0.1,
    outputRatio: 0.35,
    outputFormat: 'markdown',
  },

  [AgentRole.PERFORMANCE_ANALYZER]: {
    role: AgentRole.PERFORMANCE_ANALYZER,
    description: 'Finds N+1 queries, algorithmic complexity issues, memory leaks',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a performance engineering expert. Analyze for: algorithmic complexity (Big O), N+1 database queries, missing indexes, inefficient data structures, memory leaks, thread contention, unnecessary network calls. Estimate performance impact (ms saved, memory reduced) for each recommendation.',
    maxOutputTokens: 3072,
    temperature: 0.1,
    outputRatio: 0.3,
    outputFormat: 'markdown',
  },

  [AgentRole.ARCHITECT]: {
    role: AgentRole.ARCHITECT,
    description: 'Reviews system design, coupling, patterns, scalability',
    requiredCapabilities: ['reasoning', 'code'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-latest', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a senior software architect. Evaluate: separation of concerns, SOLID principles, design patterns used, coupling and cohesion, scalability considerations, dependency management, testability. Provide architectural recommendations with trade-offs.',
    maxOutputTokens: 3072,
    temperature: 0.2,
    outputRatio: 0.3,
    outputFormat: 'markdown',
  },

  [AgentRole.SUMMARIZER]: {
    role: AgentRole.SUMMARIZER,
    description: 'Creates concise, accurate summaries of long content',
    requiredCapabilities: ['text'],
    optionalCapabilities: ['long_context'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are an expert summarizer. Create structured summaries that preserve all important information while eliminating redundancy. Include: key points, important details, conclusions, action items if applicable.',
    maxOutputTokens: 2048,
    temperature: 0.2,
    outputRatio: 0.15,
    outputFormat: 'markdown',
  },

  [AgentRole.VISION_ANALYZER]: {
    role: AgentRole.VISION_ANALYZER,
    description: 'Analyzes images, extracts text, identifies objects',
    requiredCapabilities: ['vision'],
    preferredModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    systemPrompt:
      'You are a vision analysis system. Analyze the provided image(s) and extract: text content (OCR), described objects, layout/structure, key information, any data or charts. Provide structured output.',
    maxOutputTokens: 2048,
    temperature: 0.1,
    outputRatio: 0.25,
    outputFormat: 'markdown',
  },

  [AgentRole.AUDIO_TRANSCRIBER]: {
    role: AgentRole.AUDIO_TRANSCRIBER,
    description: 'Transcribes and structures spoken audio',
    requiredCapabilities: ['audio'],
    optionalCapabilities: ['multilingual'],
    preferredModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    systemPrompt:
      'You are a transcription system. Produce a verbatim transcript with speaker turns where distinguishable, then a short list of key points. Mark inaudible segments explicitly rather than guessing.',
    maxOutputTokens: 4096,
    temperature: 0,
    outputRatio: 0.5,
    outputFormat: 'markdown',
  },

  [AgentRole.SYNTHESIZER]: {
    role: AgentRole.SYNTHESIZER,
    description: 'Merges multiple subtask results into a coherent final answer',
    requiredCapabilities: ['text', 'reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt:
      'You are a synthesis engine. You will receive multiple analysis results from different specialized agents. Your job: merge them into a single coherent, well-structured report. Remove duplicates, resolve contradictions (flag them if unresolvable), organize by importance, preserve all specific evidence and code examples.',
    maxOutputTokens: 6144,
    temperature: 0.1,
    outputRatio: 0.25,
    outputFormat: 'markdown',
  },

  [AgentRole.VERIFIER]: {
    role: AgentRole.VERIFIER,
    description: 'Checks consistency and accuracy of results',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-latest'],
    systemPrompt:
      'You are a verification engine. Review the provided analysis for: internal consistency, factual accuracy, contradictions, missing considerations, logical errors. Return JSON: {"verified":boolean,"issues":[],"corrections":[],"final_confidence":number}.',
    maxOutputTokens: 1024,
    temperature: 0,
    responseFormat: 'json',
    outputRatio: 0.2,
    outputFormat: 'json',
  },

  [AgentRole.CRITIC]: {
    role: AgentRole.CRITIC,
    description: 'Provides adversarial review to improve quality',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-latest'],
    systemPrompt:
      'You are a critical reviewer. Your job is to find flaws, gaps, and incorrect assumptions in the provided analysis. Be specific and constructive. Return: critical issues (list), missing analysis (list), confidence assessment.',
    maxOutputTokens: 1024,
    temperature: 0.3,
    outputRatio: 0.2,
    outputFormat: 'markdown',
  },
};

export const getRoleDefinition = (role: AgentRole): RoleDefinition =>
  ROLE_DEFINITIONS[role] ?? ROLE_DEFINITIONS[AgentRole.RESEARCHER];

const ROLE_VALUES = new Set<string>(Object.values(AgentRole));

export const parseRole = (value: unknown, fallback: AgentRole = AgentRole.RESEARCHER): AgentRole => {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return ROLE_VALUES.has(normalized) ? (normalized as AgentRole) : fallback;
};

/**
 * Task type → role pipeline (docs/09-AGENT-ROLES.md). The decomposer uses this
 * as its default shape and only calls an LLM when a task type isn't covered.
 */
export const ROLE_PIPELINES: Partial<Record<string, { parallel: AgentRole[]; then: AgentRole[] }>> = {
  CODE_ANALYSIS: {
    parallel: [AgentRole.SECURITY_ANALYZER, AgentRole.CODER, AgentRole.PERFORMANCE_ANALYZER, AgentRole.ARCHITECT],
    then: [AgentRole.SYNTHESIZER],
  },
  CODE_REVIEW: {
    parallel: [AgentRole.CODER, AgentRole.CODE_REVIEWER, AgentRole.SECURITY_ANALYZER],
    then: [AgentRole.SYNTHESIZER],
  },
  BUG_FIX: {
    parallel: [AgentRole.CODER, AgentRole.CODE_REVIEWER],
    then: [AgentRole.SYNTHESIZER],
  },
  CODE_GENERATION: {
    parallel: [AgentRole.ARCHITECT, AgentRole.CODER],
    then: [AgentRole.SYNTHESIZER],
  },
  DOCUMENT_ANALYSIS: {
    parallel: [AgentRole.SUMMARIZER, AgentRole.RESEARCHER],
    then: [AgentRole.SYNTHESIZER],
  },
  DOCUMENT_QA: {
    parallel: [AgentRole.RESEARCHER],
    then: [],
  },
  IMAGE_ANALYSIS: {
    parallel: [AgentRole.VISION_ANALYZER],
    then: [AgentRole.RESEARCHER],
  },
  VISUAL_QA: {
    parallel: [AgentRole.VISION_ANALYZER],
    then: [],
  },
  OCR: {
    parallel: [AgentRole.VISION_ANALYZER],
    then: [],
  },
  AUDIO_TRANSCRIPTION: {
    parallel: [AgentRole.AUDIO_TRANSCRIBER],
    then: [],
  },
  AUDIO_ANALYSIS: {
    parallel: [AgentRole.AUDIO_TRANSCRIBER],
    then: [AgentRole.RESEARCHER],
  },
  RESEARCH: {
    parallel: [AgentRole.RESEARCHER, AgentRole.RESEARCHER, AgentRole.RESEARCHER],
    then: [AgentRole.SYNTHESIZER],
  },
  SUMMARIZATION: {
    parallel: [AgentRole.SUMMARIZER],
    then: [],
  },
  DATA_ANALYSIS: {
    parallel: [AgentRole.RESEARCHER, AgentRole.PERFORMANCE_ANALYZER],
    then: [AgentRole.SYNTHESIZER],
  },
  COMPLEX_REASONING: {
    parallel: [AgentRole.RESEARCHER, AgentRole.ARCHITECT],
    then: [AgentRole.SYNTHESIZER],
  },
  SIMPLE_QA: {
    parallel: [AgentRole.RESEARCHER],
    then: [],
  },
};
