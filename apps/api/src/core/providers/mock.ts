import { AgentRole } from '@modelmesh/types';
import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { countTokens, sleep } from '../../infra/text';
import { BaseProvider, ProviderError } from './base';

/**
 * Deterministic offline provider.
 *
 * Its purpose is not to fake intelligence — it is to let the other fourteen
 * layers (decomposition, scheduling, failover, aggregation, verification,
 * calibration) be exercised, demoed, and tested with no API keys and no
 * network. Output is a function of the prompt hash, so runs are reproducible.
 *
 * MOCK_FAILURE_RATE (0-1) injects deterministic failures, which is how the
 * recovery path is demonstrated without waiting for a real 429.
 */

const fnv1a = (text: string): number => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
};

const pick = <T>(options: readonly T[], seed: number): T => {
  const value = options[seed % options.length];
  // options is always non-empty at every call site.
  return value as T;
};

/** First plausible identifier in the context, so output looks grounded. */
const findSymbol = (text: string): string => {
  const match =
    /(?:class|interface|function|def|fun|public\s+\w+)\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(text) ??
    /([A-Za-z_][A-Za-z0-9_]{4,})\s*\(/.exec(text);
  return match?.[1] ?? 'the primary handler';
};

const failureRate = (): number => {
  const parsed = Number(process.env.MOCK_FAILURE_RATE ?? '0');
  return Number.isFinite(parsed) ? Math.max(0, Math.min(1, parsed)) : 0;
};

export class MockProvider extends BaseProvider {
  readonly name: ProviderName = 'mock';

  readonly models: ProviderModel[] = [
    {
      provider: 'mock',
      model: 'mock-instant',
      capabilities: ['text', 'fast', 'cheap'],
      maxContextTokens: 128_000,
      avgLatencyMs: 60,
      costPerInputMToken: 0,
      costPerOutputMToken: 0,
      reliability: 0.99,
      quality: 0.5,
    },
    {
      provider: 'mock',
      model: 'mock-balanced',
      capabilities: ['text', 'code', 'reasoning', 'fast', 'cheap', 'multilingual'],
      maxContextTokens: 128_000,
      avgLatencyMs: 140,
      costPerInputMToken: 0,
      costPerOutputMToken: 0,
      reliability: 0.98,
      quality: 0.72,
    },
    {
      provider: 'mock',
      model: 'mock-vision-pro',
      capabilities: ['text', 'code', 'reasoning', 'vision', 'audio', 'long_context', 'multilingual'],
      maxContextTokens: 1_000_000,
      avgLatencyMs: 260,
      costPerInputMToken: 0,
      costPerOutputMToken: 0,
      reliability: 0.97,
      quality: 0.86,
    },
  ];

  async complete(request: ProviderRequest, _apiKey: string): Promise<ProviderResponse> {
    const modelId = request.model;
    const seed = fnv1a(`${request.roleHint ?? ''}|${request.prompt}`);

    // Deterministic failure injection for demoing recovery.
    const rate = failureRate();
    if (rate > 0 && (seed % 1000) / 1000 < rate) {
      const model = this.getModel(modelId);
      await sleep(Math.min(120, model?.avgLatencyMs ?? 60));
      throw new ProviderError('RATE_LIMIT', 'mock: injected 429 (MOCK_FAILURE_RATE)', this.name, 429, 1);
    }

    const model = this.getModel(modelId) ?? this.models[1];
    await sleep(Math.round(((model?.avgLatencyMs ?? 100) * (60 + (seed % 80))) / 100));

    const text =
      request.responseFormat === 'json'
        ? this.jsonResponse(request, seed)
        : this.markdownResponse(request, seed);

    return {
      text,
      inputTokens: countTokens(`${request.systemPrompt ?? ''}\n${request.prompt}`),
      outputTokens: countTokens(text),
      model: modelId,
      finishReason: 'stop',
    };
  }

  override async isAvailable(): Promise<boolean> {
    return true;
  }

  // ─── JSON-shaped roles ──────────────────────────────────────────────────

  private jsonResponse(request: ProviderRequest, seed: number): string {
    const role = request.roleHint ?? '';
    const system = (request.systemPrompt ?? '').toLowerCase();
    const prompt = request.prompt;

    if (role === AgentRole.CLASSIFIER || system.includes('classification')) {
      // Classify the input, not the instruction preamble that surrounds it.
      const target = /<input>\s*([\s\S]*?)\s*<\/input>/.exec(prompt)?.[1] ?? prompt;
      return JSON.stringify(this.classification(target));
    }
    if (role === AgentRole.ENHANCER || system.includes('enhancement')) {
      // Read the caller's actual intent out of its block rather than echoing
      // the meta-prompt back — keeps the offline demo coherent.
      const intent = /<user_intent>\s*([\s\S]*?)\s*<\/user_intent>/.exec(prompt)?.[1] ?? prompt;
      return JSON.stringify({
        goal: `Produce a complete, evidence-backed answer for: ${intent.slice(0, 140).replace(/\s+/g, ' ').trim()}`,
        constraints: ['Cite specific evidence from the supplied material', 'Prefer precision over breadth'],
        expected_output_format: 'markdown',
        helpful_context: 'Offline planning run — no external calls were made.',
        edge_cases_to_consider: ['Input may be truncated', 'Terminology may be domain-specific'],
      });
    }
    if (role === AgentRole.DECOMPOSER || system.includes('decomposition')) {
      return JSON.stringify({
        subtasks: [
          { id: 'analysis_a', role: AgentRole.RESEARCHER, description: 'Analyze the primary dimension of the request', dependencies: [], contextNeeds: ['overview', 'requirements'] },
          { id: 'analysis_b', role: AgentRole.RESEARCHER, description: 'Analyze the secondary dimension of the request', dependencies: [], contextNeeds: ['details', 'constraints'] },
          { id: 'synthesis', role: AgentRole.SYNTHESIZER, description: 'Merge both analyses into the final answer', dependencies: ['analysis_a', 'analysis_b'], contextNeeds: [] },
        ],
      });
    }
    if (role === AgentRole.VERIFIER || system.includes('verification')) {
      const confident = seed % 5 !== 0;
      return JSON.stringify({
        verified: confident,
        issues: confident ? [] : ['One claim lacks supporting evidence in the provided material'],
        corrections: confident ? [] : ['Attach the specific location that supports the claim'],
        final_confidence: confident ? 0.88 : 0.61,
      });
    }
    if (system.includes('contradict') || prompt.toLowerCase().includes('contradictory claims')) {
      return JSON.stringify({ conflicts: [] });
    }
    return JSON.stringify({ ok: true, note: 'mock provider default JSON response' });
  }

  private classification(prompt: string): Record<string, unknown> {
    const lower = prompt.toLowerCase();
    const looksLikeCode = /[{};]\s*$|function |class |def |public |import /m.test(prompt);
    const taskType = /secur|vulnerab|owasp|inject/.test(lower)
      ? 'CODE_ANALYSIS'
      : looksLikeCode
        ? 'CODE_REVIEW'
        : /summar/.test(lower)
          ? 'SUMMARIZATION'
          : /research|compare|investigate/.test(lower)
            ? 'RESEARCH'
            : prompt.length < 160
              ? 'SIMPLE_QA'
              : 'COMPLEX_REASONING';

    return {
      taskType,
      modalities: ['text'],
      complexity: prompt.length > 1500 ? 'complex' : prompt.length > 300 ? 'medium' : 'simple',
      requiresVision: false,
      requiresCode: looksLikeCode,
      requiresReasoning: taskType !== 'SIMPLE_QA',
      estimatedSubtasks: taskType === 'SIMPLE_QA' ? 1 : 4,
      confidence: 0.82,
    };
  }

  // ─── Prose roles ────────────────────────────────────────────────────────

  private markdownResponse(request: ProviderRequest, seed: number): string {
    const role = (request.roleHint ?? AgentRole.RESEARCHER) as AgentRole;
    const symbol = findSymbol(request.prompt);
    const severity = pick(['high', 'medium', 'low'] as const, seed);

    switch (role) {
      case AgentRole.SECURITY_ANALYZER:
        return [
          '## Security Findings',
          '',
          `### 1. Unvalidated input reaches \`${symbol}\` (severity: ${severity})`,
          '- **Vector:** user-controlled value is concatenated into a downstream call.',
          '- **Exploitation:** a crafted payload alters the statement/command that executes.',
          '- **Remediation:** bind parameters and validate against an allow-list before use.',
          '',
          '### 2. Errors surface internal detail',
          '- Stack traces returned to the caller confirm framework and schema details.',
          '- Return an opaque error id; log the detail server-side.',
          '',
          '**Confirmed:** the two findings above are reproducible from the supplied material.',
        ].join('\n');

      case AgentRole.PERFORMANCE_ANALYZER:
        return [
          '## Performance Analysis',
          '',
          `- **N+1 access pattern** around \`${symbol}\`: one query per item in the result set.`,
          '  Batch into a single lookup — clearly the dominant cost at list sizes above ~50.',
          '- **O(n²) comparison loop**: nested iteration over the same collection.',
          '  A hash index reduces this to O(n).',
          '- **Missing index** on the column used for the hot filter.',
          '',
          'Estimated impact: 120-400ms saved per request at current data volumes.',
        ].join('\n');

      case AgentRole.CODER:
        return [
          '## Bugs and Logic Defects',
          '',
          `1. **Null dereference in \`${symbol}\`** — the optional result is used without a guard.`,
          '   ```',
          '   if (result == null) return fallback;',
          '   ```',
          '2. **Unclosed resource** on the error path — wrap acquisition in try-with-resources/finally.',
          '3. **Off-by-one** in the boundary check; the last element is skipped.',
          '',
          'Each fix is local and independently testable.',
        ].join('\n');

      case AgentRole.CODE_REVIEWER:
        return [
          '## Review Notes',
          '',
          '**Critical**',
          `- \`${symbol}\` mixes transport, validation, and persistence concerns.`,
          '',
          '**Major**',
          '- No test covers the failure branch.',
          '- Error handling swallows the cause.',
          '',
          '**Minor**',
          '- Naming drifts from the surrounding module conventions.',
        ].join('\n');

      case AgentRole.ARCHITECT:
        return [
          '## Architecture Assessment',
          '',
          `- **Coupling:** \`${symbol}\` depends on a concrete implementation where an interface would do.`,
          '- **Cohesion:** the module has two reasons to change; splitting it isolates the volatile half.',
          '- **Scalability:** state held in the request path prevents horizontal scaling.',
          '',
          'Trade-off: the split adds one indirection layer in exchange for independent deployability.',
        ].join('\n');

      case AgentRole.VISION_ANALYZER:
        return [
          '## Image Analysis',
          '',
          '- **Extracted text:** (on-device OCR already supplied the authoritative transcription)',
          '- **Layout:** header block, two-column body, footer with contact details.',
          '- **Objects:** document page, printed table, handwritten annotation.',
          '- **Data:** the table contains 4 columns × 12 rows of numeric values.',
        ].join('\n');

      case AgentRole.SUMMARIZER:
        return [
          '## Summary',
          '',
          '- The material centres on one primary claim with three supporting details.',
          '- Two constraints limit how the claim generalizes.',
          '- No internal contradictions were found.',
        ].join('\n');

      case AgentRole.SYNTHESIZER:
        return [
          '# Combined Report',
          '',
          '## Summary',
          'Findings from all specialist agents are merged below, de-duplicated, and ordered by severity.',
          '',
          '## Critical Issues',
          `1. Unvalidated input reaching \`${symbol}\` (security).`,
          '2. N+1 access pattern in the hot path (performance).',
          '3. Null dereference on the optional result (correctness).',
          '',
          '## Recommendations',
          '- Parameterize and validate all external input.',
          '- Batch the per-item lookup and add the missing index.',
          '- Add regression tests for the failure branches.',
          '',
          '## Evidence',
          'Each item above traces to a specific location identified by the specialist agents.',
        ].join('\n');

      case AgentRole.CRITIC:
        return [
          '## Critique',
          '',
          '- **Gap:** no analysis of the concurrency behaviour under load.',
          '- **Assumption:** the input is treated as trusted in one branch without justification.',
          '- **Confidence:** the security and correctness findings are well supported; the performance estimate is directional.',
        ].join('\n');

      default:
        return [
          '## Analysis',
          '',
          `The request concerns ${symbol}. Based on the supplied material:`,
          '',
          '1. The primary question has a definite answer, stated below.',
          '2. Two supporting details corroborate it.',
          '3. One boundary condition deserves attention before acting on it.',
          '',
          '**Answer:** the requested outcome is achievable as described, with the caveat noted in (3).',
        ].join('\n');
    }
  }
}
