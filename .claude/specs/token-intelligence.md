# 08 — Token Intelligence

Token intelligence is ModelMesh's most important cost differentiator. It operates at 4 levels.

---

## Level 1: Global Token Optimizer

Runs on the entire task BEFORE decomposition.

**What it removes:**
- Repeated boilerplate (instructions repeated multiple times)
- Duplicate context (same info described in two ways)
- Verbose phrasing ("Please make sure to" → "")
- Redundant examples (3 examples when 1 suffices)
- Empty structure ("The following is a list of..." → just the list)

```typescript
// core/optimizer/token.ts

export class GlobalTokenOptimizer {
  async optimize(enhancedTask: EnhancedTask): Promise<OptimizedTask> {
    let text = enhancedTask.fullText;
    let savings = 0;

    // Pass 1: Remove structural boilerplate
    const afterBoilerplate = this.removeBoilerplate(text);
    savings += this.countSavedTokens(text, afterBoilerplate);
    text = afterBoilerplate;

    // Pass 2: Deduplicate repeated context
    const afterDedup = await this.deduplicateContext(text);
    savings += this.countSavedTokens(text, afterDedup);
    text = afterDedup;

    // Pass 3: Compress verbose instructions
    const afterCompress = this.compressInstructions(text);
    savings += this.countSavedTokens(text, afterCompress);
    text = afterCompress;

    // Pass 4: Normalize structure (consistent formatting = fewer tokens)
    const afterNormalize = this.normalizeStructure(text);
    savings += this.countSavedTokens(text, afterNormalize);
    text = afterNormalize;

    return {
      ...enhancedTask,
      optimizedText: text,
      tokensSaved: savings,
      originalEstimatedTokens: this.countTokens(enhancedTask.fullText),
      optimizedEstimatedTokens: this.countTokens(text)
    };
  }

  private removeBoilerplate(text: string): string {
    // Remove common LLM prompt filler patterns
    const patterns = [
      /Please make sure to /gi,
      /You should (always |never )?/gi,
      /It is important (that you |to )?/gi,
      /Note that /gi,
      /Remember to /gi,
      /The following is (a|an|the) /gi,
      /As you can see,? /gi,
      /I would (like|want) you to /gi,
    ];

    let result = text;
    for (const pattern of patterns) {
      result = result.replace(pattern, '');
    }
    return result.trim();
  }

  private async deduplicateContext(text: string): Promise<string> {
    // Split into paragraphs/sections
    const sections = text.split(/\n\n+/);

    // Use embedding similarity to detect near-duplicates
    if (sections.length < 3) return text; // not worth the effort

    const embeddings = await this.embed(sections);
    const unique: string[] = [];
    const seen = new Set<number>();

    for (let i = 0; i < sections.length; i++) {
      if (seen.has(i)) continue;

      unique.push(sections[i]);

      // Find and mark near-duplicates
      for (let j = i + 1; j < sections.length; j++) {
        const similarity = this.cosineSimilarity(embeddings[i], embeddings[j]);
        if (similarity > 0.90) {
          seen.add(j); // mark as duplicate, skip
        }
      }
    }

    return unique.join('\n\n');
  }

  // Token counting (tiktoken approximation without library)
  private countTokens(text: string): number {
    // ~4 chars per token is a reasonable approximation
    return Math.ceil(text.length / 4);
  }
}
```

---

## Level 2: Context Slicer (Per-Subtask)

This is where the biggest savings happen.

**Principle:** A subtask that analyzes SQL injection vulnerabilities doesn't need the Java algorithm performance code.

```typescript
// core/optimizer/context.ts

export class ContextSlicer {
  async buildContextSlice(
    masterContext: string,
    subtask: DAGNode
  ): Promise<string> {
    // For simple tasks: return relevant portions only
    const role = subtask.role;

    // Role-to-section mapping
    const relevancyRules = this.getRelevancyRules(role);

    // Strategy 1: keyword-based extraction
    const keywordSlice = this.extractByKeywords(masterContext, relevancyRules.keywords);

    // Strategy 2: structural section extraction
    // (if context has markdown headers, extract relevant sections)
    const structureSlice = this.extractBySections(masterContext, relevancyRules.sections);

    // Strategy 3: for large contexts (>10K tokens), use LLM to extract
    if (this.countTokens(masterContext) > 10_000) {
      return await this.llmExtract(masterContext, subtask.role, subtask.instructions);
    }

    // Merge best extraction
    return this.mergeSlices([keywordSlice, structureSlice]);
  }

  private getRelevancyRules(role: AgentRole): RelevancyRule {
    const rules: Record<AgentRole, RelevancyRule> = {
      [AgentRole.SECURITY_ANALYZER]: {
        keywords: ['password', 'auth', 'sql', 'inject', 'xss', 'csrf', 'input', 'sanitize', 'encrypt', 'token', 'session'],
        sections: ['security', 'auth', 'input handling', 'database', 'api'],
        maxTokens: 8000
      },
      [AgentRole.PERFORMANCE_ANALYZER]: {
        keywords: ['loop', 'query', 'cache', 'index', 'n+1', 'algorithm', 'complexity', 'memory', 'async', 'thread'],
        sections: ['performance', 'database', 'algorithm', 'caching'],
        maxTokens: 7000
      },
      [AgentRole.CODER]: {
        keywords: ['function', 'class', 'method', 'exception', 'error', 'null', 'undefined', 'bug', 'throw'],
        sections: ['implementation', 'logic', 'error handling'],
        maxTokens: 9000
      },
      [AgentRole.ARCHITECT]: {
        keywords: ['service', 'module', 'layer', 'dependency', 'interface', 'pattern', 'design', 'coupling', 'cohesion'],
        sections: ['architecture', 'structure', 'design', 'overview'],
        maxTokens: 6000
      },
      // ... other roles
    };

    return rules[role] ?? { keywords: [], sections: [], maxTokens: 8000 };
  }

  private async llmExtract(
    context: string,
    role: AgentRole,
    instructions: string
  ): Promise<string> {
    // Use Groq Llama 8B (fastest, cheapest) for extraction
    // This meta-call costs ~200 tokens but saves thousands
    const response = await this.groqFast.complete({
      model: 'llama-3.1-8b-instant',
      prompt: `Extract ONLY the portions of this text relevant to: ${role} performing "${instructions}".
Return only the relevant extracted text, no commentary.

TEXT:
${context.slice(0, 30_000)}` // limit to 30K for extraction model
    });

    return response.text;
  }
}
```

---

## Level 3: Prompt Optimizer (Per-Subtask)

```typescript
// core/optimizer/prompt.ts

export class PromptOptimizer {
  async optimize(
    prompt: string,
    role: AgentRole,
    strategy: ExecutionStrategy
  ): Promise<OptimizedPrompt> {
    // Generate candidate prompts
    const candidates = [
      { label: 'original', text: prompt },
      { label: 'compressed', text: this.compress(prompt) },
      { label: 'role_optimized', text: this.optimizeForRole(prompt, role) },
      { label: 'strategy_optimized', text: this.optimizeForStrategy(prompt, role, strategy) }
    ];

    // For draft strategy: just return compressed
    if (strategy === 'draft') {
      return candidates.find(c => c.label === 'compressed')!;
    }

    // For premium: score candidates and pick best
    const scored = candidates.map(c => ({
      ...c,
      estimatedTokens: this.countTokens(c.text),
      qualityScore: this.estimateQuality(c.text, role)
    }));

    // Best quality-per-token candidate
    const best = scored.sort((a, b) =>
      (b.qualityScore / b.estimatedTokens) - (a.qualityScore / a.estimatedTokens)
    )[0];

    return best;
  }

  private optimizeForRole(prompt: string, role: AgentRole): string {
    const roleInstructions: Record<AgentRole, string> = {
      [AgentRole.SECURITY_ANALYZER]: 'Check for: OWASP Top 10, injection, auth flaws, sensitive data exposure. Be specific and cite line numbers.',
      [AgentRole.CODER]: 'Find bugs, logic errors, null pointer risks, exception handling gaps. Show exact fix for each.',
      [AgentRole.PERFORMANCE_ANALYZER]: 'Find: N+1 queries, O(n²) loops, missing indexes, memory leaks. Estimate impact.',
      [AgentRole.SYNTHESIZER]: 'Merge these results into a structured report with sections: Summary, Critical Issues, Recommendations.',
      // ... other roles
    };

    const rolePrefix = roleInstructions[role] ?? '';
    return rolePrefix ? `${rolePrefix}\n\n${prompt}` : prompt;
  }
}
```

---

## Level 4: Output Optimizer

Runs on the final merged result before sending to the user.

```typescript
// core/optimizer/output.ts

export class OutputOptimizer {
  async optimize(rawOutput: string, outputFormat: OutputFormat): Promise<string> {
    let text = rawOutput;

    // Remove duplicate conclusions (common in merged multi-model output)
    text = this.removeDuplicateConclusions(text);

    // Ensure consistent section structure
    text = this.normalizeHeaders(text);

    // Remove meta-commentary ("In conclusion, as I've shown above...")
    text = this.removeMetaCommentary(text);

    // Ensure evidence is preserved (don't over-compress)
    text = this.preserveEvidence(text);

    return text;
  }

  private removeDuplicateConclusions(text: string): string {
    // Split by headers, detect near-duplicate sections
    const sections = this.parseSections(text);
    const seen: string[] = [];
    const unique: typeof sections = [];

    for (const section of sections) {
      const isDuplicate = seen.some(s => this.similarity(s, section.content) > 0.85);
      if (!isDuplicate) {
        unique.push(section);
        seen.push(section.content);
      }
    }

    return unique.map(s => `${s.header}\n${s.content}`).join('\n\n');
  }
}
```

---

## Token Profiler (Estimation)

Before execution, ModelMesh estimates token costs. These estimates improve over time via calibration.

```typescript
// core/intelligence/profiler.ts

export class TokenProfiler {
  async profile(subtask: DAGNode, calibration: CalibrationModel): Promise<TokenProfile> {
    // Base estimates from task type and context length
    const contextTokens = this.countTokens(subtask.contextSlice);
    const promptTokens = this.countTokens(subtask.instructions);

    // Output estimate based on role (from historical data)
    const outputMultipliers: Record<AgentRole, number> = {
      [AgentRole.SECURITY_ANALYZER]: 0.35,  // output ~35% of input
      [AgentRole.CODER]: 0.45,
      [AgentRole.SUMMARIZER]: 0.15,
      [AgentRole.SYNTHESIZER]: 0.25,
      [AgentRole.VERIFIER]: 0.20,
      // ...
    };

    const outputMultiplier = outputMultipliers[subtask.role] ?? 0.30;

    let estimatedInput = contextTokens + promptTokens;
    let estimatedOutput = Math.ceil(estimatedInput * outputMultiplier);

    // Apply calibration correction
    estimatedInput = Math.ceil(
      estimatedInput * calibration.inputTokenMultiplier + calibration.inputTokenBias
    );
    estimatedOutput = Math.ceil(
      estimatedOutput * calibration.outputTokenMultiplier + calibration.outputTokenBias
    );

    return {
      estimatedInputTokens: estimatedInput,
      estimatedOutputTokens: estimatedOutput,
      estimatedLatencyMs: this.estimateLatency(estimatedInput + estimatedOutput, subtask.role),
      confidence: this.profileConfidence(calibration)
    };
  }
}
```

---

## Expected Savings

Based on the architecture design, typical savings per task type:

| Task Type | Without Optimization | With ModelMesh | Savings |
|-----------|---------------------|----------------|---------|
| Code analysis (30K codebase) | 120K tokens | ~40-50K tokens | 58-67% |
| PDF analysis (50-page doc) | 80K tokens | ~25-35K tokens | 56-69% |
| Research (4 questions) | 40K tokens | ~20-25K tokens | 37-50% |
| Image analysis | 5K tokens | 5K tokens | ~0% (already small) |
| Simple QA | 2K tokens | 2K tokens | ~0% (no optimization needed) |

**Total system-level savings typically: 20-40% for complex tasks, 0% for simple tasks (correctly identified and skipped).**
