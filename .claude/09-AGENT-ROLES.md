# 09 — Agent Roles & Capability-Based Routing

ModelMesh never says "use Gemini" or "use Groq" for a task. It says "this task needs a SECURITY_ANALYZER with reasoning + code capabilities" and then finds the best available model that satisfies those requirements.

---

## Why Capability-Based, Not Model-Based

```
Model-based (fragile):
  "Security analysis → always use Gemini 1.5 Pro"
  Problem: if Gemini is rate-limited, what do you do?

Capability-based (robust):
  "Security analysis → needs: code, reasoning, confidence ≥ 0.8"
  System: "Gemini is rate-limited, Mistral Large satisfies code + reasoning → route there"
```

---

## Complete Role Definitions

```typescript
// core/agents/roles.ts

export const ROLE_DEFINITIONS: Record<AgentRole, RoleDefinition> = {

  [AgentRole.CLASSIFIER]: {
    role: AgentRole.CLASSIFIER,
    description: 'Identifies task type, complexity, required modalities',
    requiredCapabilities: ['text', 'fast'],
    optionalCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-8b-instant'],
    systemPrompt: `You are a task classification system. Analyze the user's input and return a JSON classification with: taskType, modalities, complexity, requiresVision, requiresCode, requiresReasoning, estimatedSubtasks, confidence.`,
    maxOutputTokens: 256,
    temperature: 0.0,   // deterministic for classification
    responseFormat: 'json'
  },

  [AgentRole.ENHANCER]: {
    role: AgentRole.ENHANCER,
    description: 'Transforms vague user input into structured task specification',
    requiredCapabilities: ['text', 'reasoning'],
    optionalCapabilities: ['fast'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a task enhancement engine. Take the user's raw input and produce a structured specification with: goal, constraints, expected_output_format, helpful_context, edge_cases_to_consider. Return as JSON.`,
    maxOutputTokens: 1024,
    temperature: 0.1,
    responseFormat: 'json'
  },

  [AgentRole.DECOMPOSER]: {
    role: AgentRole.DECOMPOSER,
    description: 'Breaks complex tasks into a DAG of specialized subtasks',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a task decomposition engine. Break this complex task into specialized subtasks. Return a JSON array where each subtask has: id, role, description, dependencies (array of ids), contextNeeds (keywords of what context it needs).`,
    maxOutputTokens: 1024,
    temperature: 0.1,
    responseFormat: 'json'
  },

  [AgentRole.RESEARCHER]: {
    role: AgentRole.RESEARCHER,
    description: 'Analyzes documents, synthesizes information, answers questions',
    requiredCapabilities: ['text', 'reasoning'],
    optionalCapabilities: ['long_context'],
    preferredModels: ['gemini-1.5-pro', 'Qwen2.5-72B-Instruct-Turbo', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a precise research analyst. Extract and synthesize information accurately. Always cite specific evidence. Flag uncertainty explicitly.`,
    maxOutputTokens: 4096,
    temperature: 0.2
  },

  [AgentRole.CODER]: {
    role: AgentRole.CODER,
    description: 'Analyzes code, finds bugs, implements fixes',
    requiredCapabilities: ['code'],
    optionalCapabilities: ['reasoning', 'fast'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile', 'gemini-1.5-flash'],
    systemPrompt: `You are an expert software engineer. Analyze code for bugs, errors, and issues. For each finding: identify the exact location, explain root cause, provide corrected code, identify edge cases.`,
    maxOutputTokens: 4096,
    temperature: 0.1
  },

  [AgentRole.CODE_REVIEWER]: {
    role: AgentRole.CODE_REVIEWER,
    description: 'Reviews code quality, style, best practices',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a senior code reviewer. Evaluate: readability, maintainability, test coverage, best practices, design patterns, error handling. Provide actionable suggestions with priority (critical/major/minor).`,
    maxOutputTokens: 3072,
    temperature: 0.2
  },

  [AgentRole.SECURITY_ANALYZER]: {
    role: AgentRole.SECURITY_ANALYZER,
    description: 'Identifies security vulnerabilities, OWASP issues, attack vectors',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-2', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a cybersecurity expert specializing in code security analysis. Check for: SQL injection, XSS, CSRF, authentication flaws, authorization issues, sensitive data exposure, insecure dependencies, command injection, path traversal. For each vulnerability: severity (critical/high/medium/low), CVSS score estimate, exact location, exploitation scenario, remediation code.`,
    maxOutputTokens: 4096,
    temperature: 0.1
  },

  [AgentRole.PERFORMANCE_ANALYZER]: {
    role: AgentRole.PERFORMANCE_ANALYZER,
    description: 'Finds N+1 queries, algorithmic complexity issues, memory leaks',
    requiredCapabilities: ['code', 'reasoning'],
    preferredModels: ['deepseek-ai/DeepSeek-V3', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a performance engineering expert. Analyze for: algorithmic complexity (Big O), N+1 database queries, missing indexes, inefficient data structures, memory leaks, thread contention, unnecessary network calls. Estimate performance impact (ms saved, memory reduced) for each recommendation.`,
    maxOutputTokens: 3072,
    temperature: 0.1
  },

  [AgentRole.ARCHITECT]: {
    role: AgentRole.ARCHITECT,
    description: 'Reviews system design, coupling, patterns, scalability',
    requiredCapabilities: ['reasoning', 'code'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-2', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a senior software architect. Evaluate: separation of concerns, SOLID principles, design patterns used, coupling and cohesion, scalability considerations, dependency management, testability. Provide architectural recommendations with trade-offs.`,
    maxOutputTokens: 3072,
    temperature: 0.2
  },

  [AgentRole.SUMMARIZER]: {
    role: AgentRole.SUMMARIZER,
    description: 'Creates concise, accurate summaries of long content',
    requiredCapabilities: ['text'],
    optionalCapabilities: ['long_context'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are an expert summarizer. Create structured summaries that preserve all important information while eliminating redundancy. Include: key points, important details, conclusions, action items if applicable.`,
    maxOutputTokens: 2048,
    temperature: 0.2
  },

  [AgentRole.VISION_ANALYZER]: {
    role: AgentRole.VISION_ANALYZER,
    description: 'Analyzes images, extracts text, identifies objects',
    requiredCapabilities: ['vision'],
    preferredModels: ['gemini-1.5-pro', 'gemini-1.5-flash'],
    systemPrompt: `You are a vision analysis system. Analyze the provided image(s) and extract: text content (OCR), described objects, layout/structure, key information, any data or charts. Provide structured output.`,
    maxOutputTokens: 2048,
    temperature: 0.1
  },

  [AgentRole.SYNTHESIZER]: {
    role: AgentRole.SYNTHESIZER,
    description: 'Merges multiple subtask results into a coherent final answer',
    requiredCapabilities: ['text', 'reasoning'],
    preferredModels: ['gemini-1.5-flash', 'llama-3.1-70b-versatile'],
    systemPrompt: `You are a synthesis engine. You will receive multiple analysis results from different specialized agents. Your job: merge them into a single coherent, well-structured report. Remove duplicates, resolve contradictions (flag them if unresolvable), organize by importance, preserve all specific evidence and code examples.`,
    maxOutputTokens: 6144,
    temperature: 0.1
  },

  [AgentRole.VERIFIER]: {
    role: AgentRole.VERIFIER,
    description: 'Checks consistency and accuracy of results',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-2'],
    systemPrompt: `You are a verification engine. Review the provided analysis for: internal consistency, factual accuracy, contradictions, missing considerations, logical errors. Return: verified (boolean), issues found (list), corrections needed (list), final confidence (0-1).`,
    maxOutputTokens: 1024,
    temperature: 0.0,  // deterministic
    responseFormat: 'json'
  },

  [AgentRole.CRITIC]: {
    role: AgentRole.CRITIC,
    description: 'Provides adversarial review to improve quality',
    requiredCapabilities: ['reasoning'],
    preferredModels: ['gemini-1.5-pro', 'mistral-large-2'],
    systemPrompt: `You are a critical reviewer. Your job is to find flaws, gaps, and incorrect assumptions in the provided analysis. Be specific and constructive. Return: critical issues (list), missing analysis (list), confidence assessment.`,
    maxOutputTokens: 1024,
    temperature: 0.3
  }
};
```

---

## Agent Router

```typescript
// core/agents/router.ts

export class AgentRouter {
  constructor(
    private registry: ProviderRegistry,
    private keyManager: KeyManager
  ) {}

  async route(
    role: AgentRole,
    strategy: ExecutionStrategy,
    forceProvider?: ProviderName
  ): Promise<RouteDecision | null> {
    const roleDef = ROLE_DEFINITIONS[role];

    // Get providers that have available keys
    const availableProviders = await this.getAvailableProviders();

    // If a specific provider is forced (e.g., vision always needs Gemini)
    const candidateProviders = forceProvider
      ? [forceProvider].filter(p => availableProviders.includes(p))
      : availableProviders;

    // Find best model
    const model = this.registry.getBestModel(
      roleDef.requiredCapabilities,
      strategy,
      candidateProviders
    );

    if (!model) return null;

    // Get the best key for this provider
    const keyResult = await this.keyManager.getBestKey(model.provider);
    if (!keyResult) return null;

    return {
      provider: model.provider,
      model: model.model,
      keyId: keyResult.keyId,
      apiKey: keyResult.key,
      systemPrompt: roleDef.systemPrompt,
      maxOutputTokens: roleDef.maxOutputTokens,
      temperature: roleDef.temperature ?? 0.2,
      responseFormat: roleDef.responseFormat
    };
  }

  private async getAvailableProviders(): Promise<ProviderName[]> {
    // Providers with at least one non-rate-limited key
    const providers: ProviderName[] = ['gemini', 'groq', 'together', 'mistral', 'openrouter'];
    const available: ProviderName[] = [];

    for (const provider of providers) {
      const key = await this.keyManager.getBestKey(provider);
      if (key) available.push(provider);
    }

    return available;
  }
}
```

---

## Capability → Best Provider Matrix

At runtime, this mapping changes based on health/quota. This is the default priority:

| Required Capability | First Choice | Second | Third |
|--------------------|-------------|--------|-------|
| vision | gemini-1.5-pro | gemini-1.5-flash | openrouter (gpt-4o) |
| code (deep) | deepseek-v3 | llama-3.1-70b | gemini-1.5-flash |
| reasoning | gemini-1.5-pro | mistral-large-2 | llama-3.1-70b |
| fast | llama-3.1-8b | gemini-flash | groq-specdec |
| cheap | llama-3.1-8b | gemini-flash | together-qwen |
| long_context | gemini-1.5-pro | gemini-1.5-flash | - |
| multilingual | gemini-1.5-flash | qwen-2.5 | mistral-large |

---

## Task Type → Recommended Role Pipeline

```
CODE_ANALYSIS
  parallel: [SECURITY_ANALYZER, CODER, PERFORMANCE_ANALYZER, ARCHITECT]
  then: [SYNTHESIZER]
  if_premium: [VERIFIER]

CODE_REVIEW
  parallel: [CODER, CODE_REVIEWER, SECURITY_ANALYZER]
  then: [SYNTHESIZER]

DOCUMENT_ANALYSIS
  if_pdf: [SUMMARIZER for each section] → then [RESEARCHER + QA] → [SYNTHESIZER]
  if_image: [VISION_ANALYZER] → [RESEARCHER]

RESEARCH
  parallel: [RESEARCHER × N_QUESTIONS]
  then: [SYNTHESIZER]
  if_premium: [VERIFIER, CRITIC]

IMAGE_ANALYSIS
  first: [VISION_ANALYZER]  # must be vision-capable model
  then: [RESEARCHER] if analysis needed

SIMPLE_QA
  single: [RESEARCHER]  # no decomposition
```
