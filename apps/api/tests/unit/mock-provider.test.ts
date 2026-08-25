import { afterEach, describe, expect, it } from 'vitest';
import { AgentRole } from '@modelmesh/types';
import type { ProviderRequest } from '@modelmesh/types';
import { ProviderError } from '../../src/core/providers/base';
import { MockProvider } from '../../src/core/providers/mock';
import { ProviderRegistry } from '../../src/core/providers/registry';
import { SubTaskExecutor } from '../../src/core/orchestrator/executor';

/**
 * The mock provider is what makes the whole 15-layer pipeline runnable with no
 * API keys, no Postgres, and no Redis. It has to be deterministic, role-shaped,
 * and able to inject failures on demand so recovery is demoable offline.
 */

const request = (overrides: Partial<ProviderRequest> = {}): ProviderRequest => ({
  model: 'mock-balanced',
  prompt: 'Analyze the payment service for defects.',
  ...overrides,
});

afterEach(() => {
  delete process.env.MOCK_FAILURE_RATE;
});

describe('MockProvider — determinism', () => {
  it('returns the same answer for the same prompt', async () => {
    const provider = new MockProvider();

    const first = await provider.complete(request(), 'mock');
    const second = await provider.complete(request(), 'mock');

    expect(first.text).toBe(second.text);
    expect(first.inputTokens).toBe(second.inputTokens);
    expect(first.model).toBe('mock-balanced');
    expect(first.finishReason).toBe('stop');
  });

  it('returns a different answer for a different role', async () => {
    const provider = new MockProvider();

    const security = await provider.complete(request({ roleHint: AgentRole.SECURITY_ANALYZER }), 'mock');
    const performance = await provider.complete(request({ roleHint: AgentRole.PERFORMANCE_ANALYZER }), 'mock');

    expect(security.text).not.toBe(performance.text);
    expect(security.text).toContain('Security Findings');
    expect(performance.text).toContain('Performance Analysis');
  });

  it('reports token counts derived from the actual payload', async () => {
    const provider = new MockProvider();

    const short = await provider.complete(request({ prompt: 'Hi' }), 'mock');
    const long = await provider.complete(request({ prompt: 'Hi '.repeat(4_000) }), 'mock');

    expect(long.inputTokens).toBeGreaterThan(short.inputTokens);
    expect(short.outputTokens).toBeGreaterThan(0);
  });

  it('is always available and advertises three tiers', () => {
    const provider = new MockProvider();

    expect(provider.models).toHaveLength(3);
    expect(provider.models.map((model) => model.model)).toEqual([
      'mock-instant',
      'mock-balanced',
      'mock-vision-pro',
    ]);
    expect(provider.getModel('mock-vision-pro')?.capabilities).toContain('vision');
    expect(provider.getModel('mock-instant')?.capabilities).not.toContain('reasoning');
  });
});

describe('MockProvider — structured roles', () => {
  it('returns parseable JSON for every json-shaped role', async () => {
    const provider = new MockProvider();

    for (const role of [
      AgentRole.CLASSIFIER,
      AgentRole.ENHANCER,
      AgentRole.DECOMPOSER,
      AgentRole.VERIFIER,
    ]) {
      const response = await provider.complete(
        request({ roleHint: role, responseFormat: 'json', prompt: '<input>\nfix this bug\n</input>' }),
        'mock',
      );
      expect(() => JSON.parse(response.text) as unknown).not.toThrow();
    }
  });

  it('classifies the input block, not the surrounding meta-prompt', async () => {
    const provider = new MockProvider();

    // The bug this pins: the word "summarize" in the list of allowed values
    // used to make every task look like a SUMMARIZATION.
    const prompt = [
      'Classify this task. Respond with JSON only.',
      'Allowed taskType values: CODE_ANALYSIS, SUMMARIZATION, RESEARCH, SIMPLE_QA',
      '<input>',
      'What is the capital of France?',
      '</input>',
    ].join('\n');

    const response = await provider.complete(
      request({ roleHint: AgentRole.CLASSIFIER, responseFormat: 'json', prompt }),
      'mock',
    );

    expect((JSON.parse(response.text) as { taskType: string }).taskType).toBe('SIMPLE_QA');
  });

  it('reads the enhancer intent out of its own block', async () => {
    const provider = new MockProvider();
    const prompt = '<user_intent>\nAudit the invoice importer\n</user_intent>\n<document_content>noise</document_content>';

    const response = await provider.complete(
      request({ roleHint: AgentRole.ENHANCER, responseFormat: 'json', prompt }),
      'mock',
    );

    expect((JSON.parse(response.text) as { goal: string }).goal).toContain('Audit the invoice importer');
  });

  it('produces a valid DAG shape for the decomposer', async () => {
    const provider = new MockProvider();

    const response = await provider.complete(
      request({ roleHint: AgentRole.DECOMPOSER, responseFormat: 'json' }),
      'mock',
    );
    const parsed = JSON.parse(response.text) as {
      subtasks: Array<{ id: string; dependencies: string[] }>;
    };

    const ids = new Set(parsed.subtasks.map((subtask) => subtask.id));
    for (const subtask of parsed.subtasks) {
      for (const dependency of subtask.dependencies) expect(ids.has(dependency)).toBe(true);
    }
    expect(parsed.subtasks.some((subtask) => subtask.dependencies.length > 0)).toBe(true);
  });
});

describe('MockProvider — failure injection', () => {
  it('injects nothing by default', async () => {
    const provider = new MockProvider();
    await expect(provider.complete(request(), 'mock')).resolves.toBeDefined();
  });

  it('raises a retryable 429 when the failure rate is saturated', async () => {
    process.env.MOCK_FAILURE_RATE = '1';
    const provider = new MockProvider();

    await expect(provider.complete(request(), 'mock')).rejects.toBeInstanceOf(ProviderError);

    const error = await provider.complete(request(), 'mock').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderError);
    expect((error as ProviderError).kind).toBe('RATE_LIMIT');
    expect((error as ProviderError).status).toBe(429);
    expect((error as ProviderError).provider).toBe('mock');
  });

  it('injects deterministically for the same prompt', async () => {
    process.env.MOCK_FAILURE_RATE = '0.5';
    const provider = new MockProvider();

    const attempt = async (): Promise<boolean> =>
      provider
        .complete(request({ prompt: 'a stable prompt for the determinism check' }), 'mock')
        .then(() => true)
        .catch(() => false);

    expect(await attempt()).toBe(await attempt());
  });

  it('clamps a nonsense failure rate instead of throwing', async () => {
    process.env.MOCK_FAILURE_RATE = 'not-a-number';
    const provider = new MockProvider();
    await expect(provider.complete(request(), 'mock')).resolves.toBeDefined();

    process.env.MOCK_FAILURE_RATE = '-5';
    await expect(provider.complete(request(), 'mock')).resolves.toBeDefined();
  });
});

describe('ProviderRegistry with the mock provider', () => {
  const registry = new ProviderRegistry(
    new Map([['mock', new MockProvider()]]),
  );

  it('only offers models that satisfy every required capability (Rule 3)', () => {
    const ranked = registry.rank({
      requiredCapabilities: ['vision'],
      strategy: 'balanced',
      availableProviders: ['mock'],
    });

    expect(ranked).toHaveLength(1);
    expect(ranked[0]?.model).toBe('mock-vision-pro');
  });

  it('excludes a model that already failed', () => {
    const ranked = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'balanced',
      availableProviders: ['mock'],
      exclude: ['mock-balanced'],
    });

    expect(ranked.map((model) => model.model)).not.toContain('mock-balanced');
  });

  it('drops models that cannot hold the input', () => {
    const ranked = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'balanced',
      availableProviders: ['mock'],
      minContextTokens: 500_000,
    });

    expect(ranked.map((model) => model.model)).toEqual(['mock-vision-pro']);
  });

  it('ranks cheap-and-fast first on draft and quality first on premium', () => {
    const draft = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'draft',
      availableProviders: ['mock'],
    });
    const premium = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'premium',
      availableProviders: ['mock'],
    });

    expect(draft[0]?.model).toBe('mock-instant');
    expect(premium[0]?.model).toBe('mock-vision-pro');
  });

  it('uses the role preference only as a tie-breaker', () => {
    const withoutPreference = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'premium',
      availableProviders: ['mock'],
    });
    const withPreference = registry.rank({
      requiredCapabilities: ['text'],
      strategy: 'premium',
      availableProviders: ['mock'],
      preferredModels: ['mock-instant'],
    });

    // A +0.08 nudge must not overturn a large quality gap.
    expect(withPreference[0]?.model).toBe(withoutPreference[0]?.model);
  });

  it('returns nothing when no capability match exists', () => {
    expect(
      registry.rank({
        requiredCapabilities: ['audio', 'cheap'],
        strategy: 'balanced',
        availableProviders: ['mock'],
      }),
    ).toEqual([]);
    expect(
      registry.getBestModel({
        requiredCapabilities: ['audio', 'cheap'],
        strategy: 'balanced',
        availableProviders: ['mock'],
      }),
    ).toBeNull();
  });

  it('costs nothing to run the mock', () => {
    const model = registry.findModel('mock', 'mock-vision-pro');
    expect(model).toBeDefined();
    expect(registry.estimateCost(model!, 100_000, 20_000)).toBe(0);
  });
});

describe('confidence inference', () => {
  const executor = Object.create(SubTaskExecutor.prototype) as SubTaskExecutor;

  it('scores hedging below assertion', () => {
    const hedged = executor.inferConfidence(
      'It might possibly be an issue, though I think it is unclear without more context. It could be fine. Perhaps review it again later when you have time to look at the whole module carefully.',
    );
    const assertive = executor.inferConfidence(
      '## Findings\n\nThe issue is confirmed at line 42: user input is concatenated into the query. Clearly exploitable. The fix must bind parameters. Found in three places, all at line 42 of the same file, and each one will fail the same way.',
    );

    expect(assertive).toBeGreaterThan(hedged);
  });

  it('treats a parseable JSON answer as high confidence', () => {
    expect(executor.inferConfidence('{"verified": true}', 'json')).toBe(0.9);
    expect(executor.inferConfidence('{"verified": tru', 'json')).toBe(0.5);
    expect(executor.inferConfidence('sorry, no JSON here', 'json')).toBe(0.3);
  });

  it('penalizes an empty or evasive answer', () => {
    expect(executor.inferConfidence('')).toBe(0.1);
    expect(
      executor.inferConfidence('I cannot determine the answer from the supplied material.'),
    ).toBeLessThan(0.5);
  });

  it('stays inside 0.1 and 0.98', () => {
    const extreme = executor.inferConfidence(
      `## Report\n\n- Confirmed. Definitely. Clearly. Found at line 1. ${'The issue is exact and must be fixed at line 2. '.repeat(80)}`,
    );

    expect(extreme).toBeLessThanOrEqual(0.98);
    expect(extreme).toBeGreaterThanOrEqual(0.1);
  });
});
