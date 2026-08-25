import { describe, expect, it } from 'vitest';
import { AgentRole } from '@modelmesh/types';
import { TaskClassifier } from '../../src/core/intelligence/classifier';
import { TokenProfiler } from '../../src/core/intelligence/profiler';
import { CalibrationEngine } from '../../src/core/telemetry/calibration';
import { MemoryPersistence } from '../../src/infra/persistence';
import { NEUTRAL_CALIBRATION } from '../../src/infra/records';
import { makeModel, makeNode } from '../helpers/factories';

/**
 * Layer 6 — profiling, plus the honest counterfactual that `savedTokens` is
 * measured against (docs/08). The baseline must describe work that actually
 * happened: crediting savings for a subtask that never ran is a lie.
 */

const profiler = (): TokenProfiler => new TokenProfiler(new CalibrationEngine(new MemoryPersistence()));

describe('TokenProfiler.profileWith', () => {
  it('scales the input estimate with the context slice', () => {
    const subject = profiler();
    const neutral = NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.SECURITY_ANALYZER);

    const small = subject.profileWith(
      makeNode('a', { role: AgentRole.SECURITY_ANALYZER, contextSlice: 'x'.repeat(400) }),
      neutral,
    );
    const large = subject.profileWith(
      makeNode('a', { role: AgentRole.SECURITY_ANALYZER, contextSlice: 'x'.repeat(40_000) }),
      neutral,
    );

    expect(large.estimatedInputTokens).toBeGreaterThan(small.estimatedInputTokens);
    expect(small.estimatedInputTokens).toBeGreaterThan(0);
  });

  it('counts the dependency context as input', () => {
    const subject = profiler();
    const neutral = NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.SYNTHESIZER);
    const base = makeNode('synthesis', { role: AgentRole.SYNTHESIZER });

    const without = subject.profileWith(base, neutral);
    const with_ = subject.profileWith({ ...base, dependencyContext: 'y'.repeat(4_000) }, neutral);

    expect(with_.estimatedInputTokens).toBeGreaterThan(without.estimatedInputTokens);
  });

  it('caps the output estimate at the role ceiling', () => {
    const subject = profiler();
    const neutral = NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.SECURITY_ANALYZER);

    const profile = subject.profileWith(
      makeNode('a', { role: AgentRole.SECURITY_ANALYZER, contextSlice: 'x'.repeat(400_000) }),
      neutral,
    );

    expect(profile.estimatedOutputTokens).toBeLessThanOrEqual(8_192);
  });

  it('applies the calibration coefficients (Rule 4)', () => {
    const subject = profiler();
    const node = makeNode('a', { role: AgentRole.SECURITY_ANALYZER, contextSlice: 'x'.repeat(4_000) });

    const neutral = subject.profileWith(node, NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.SECURITY_ANALYZER));
    const calibrated = subject.profileWith(node, {
      ...NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.SECURITY_ANALYZER),
      inputTokenMultiplier: 2,
      inputTokenBias: 100,
      sampleCount: 20,
    });

    expect(calibrated.estimatedInputTokens).toBeGreaterThan(neutral.estimatedInputTokens * 1.9);
    expect(calibrated.confidence).toBeGreaterThan(neutral.confidence);
  });

  it('trusts a well-sampled calibration more than a fresh one', () => {
    const subject = profiler();
    const fresh = NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.CODER);

    expect(subject.profileConfidence(fresh)).toBeLessThan(
      subject.profileConfidence({ ...fresh, sampleCount: 25 }),
    );
    expect(subject.profileConfidence({ ...fresh, sampleCount: 1_000 })).toBeLessThanOrEqual(0.95);
  });

  it('latency grows with output size and with a slower model', () => {
    const subject = profiler();

    const fast = subject.estimateLatency(2_000, 500, makeModel({ avgLatencyMs: 100 }));
    const slow = subject.estimateLatency(2_000, 500, makeModel({ avgLatencyMs: 900 }));
    const chatty = subject.estimateLatency(2_000, 4_000, makeModel({ avgLatencyMs: 100 }));

    expect(slow).toBeGreaterThan(fast);
    expect(chatty).toBeGreaterThan(fast);
  });
});

describe('TokenProfiler.naiveBaselineTokens — honest savings accounting', () => {
  const MASTER = 12_000;
  const nodes = [
    makeNode('security_analyzer', { role: AgentRole.SECURITY_ANALYZER }),
    makeNode('coder', { role: AgentRole.CODER }),
    makeNode('performance_analyzer', { role: AgentRole.PERFORMANCE_ANALYZER }),
    makeNode('architect', { role: AgentRole.ARCHITECT }),
    makeNode('synthesis', { role: AgentRole.SYNTHESIZER }),
  ];

  it('charges every counted node the whole master context', () => {
    const subject = profiler();
    const one = subject.naiveBaselineTokens(MASTER, [nodes[0] as (typeof nodes)[number]]);

    expect(one).toBeGreaterThan(MASTER);
    expect(subject.naiveBaselineTokens(MASTER, nodes)).toBeGreaterThan(MASTER * nodes.length);
  });

  it('is additive, so a subset costs exactly its members', () => {
    const subject = profiler();
    const subset = nodes.slice(0, 2);

    const sumOfParts = subset.reduce(
      (total, node) => total + subject.naiveBaselineTokens(MASTER, [node]),
      0,
    );

    expect(subject.naiveBaselineTokens(MASTER, subset)).toBe(sumOfParts);
  });

  it('never credits savings for a subtask that did not run', () => {
    const subject = profiler();
    // The failure-injection scenario: only two of five nodes produced a result.
    const executed = [nodes[1] as (typeof nodes)[number], nodes[3] as (typeof nodes)[number]];

    const executedBaseline = subject.naiveBaselineTokens(MASTER, executed);
    const allNodesBaseline = subject.naiveBaselineTokens(MASTER, nodes);

    expect(executedBaseline).toBeLessThan(allNodesBaseline);
    // Two nodes' worth of context, not five.
    expect(executedBaseline).toBeGreaterThan(MASTER * executed.length);
    expect(executedBaseline).toBeLessThan(MASTER * (executed.length + 1));
  });

  it('is zero when nothing ran', () => {
    expect(profiler().naiveBaselineTokens(MASTER, [])).toBe(0);
  });
});

describe('TokenProfiler.profile — end-to-end with calibration storage', () => {
  it('reads the stored coefficients for the (taskType, role) pair', async () => {
    const db = new MemoryPersistence();
    const calibration = new CalibrationEngine(db);
    const subject = new TokenProfiler(calibration);
    const node = makeNode('a', { role: AgentRole.CODER, contextSlice: 'x'.repeat(4_000) });

    const before = await subject.profile(node, 'CODE_ANALYSIS');

    await db.upsertCalibration({
      ...NEUTRAL_CALIBRATION('CODE_ANALYSIS', AgentRole.CODER),
      inputTokenMultiplier: 2,
      sampleCount: 10,
    });

    const after = await subject.profile(node, 'CODE_ANALYSIS');

    expect(after.estimatedInputTokens).toBeGreaterThan(before.estimatedInputTokens * 1.9);
  });

  it('applyProfile writes the estimates onto the node', () => {
    const subject = profiler();
    const node = makeNode('a', { estimatedInputTokens: 0, estimatedOutputTokens: 0, estimatedLatencyMs: 0 });

    const updated = subject.applyProfile(node, {
      estimatedInputTokens: 1_234,
      estimatedOutputTokens: 567,
      estimatedLatencyMs: 890,
      confidence: 0.7,
    });

    expect(updated).toMatchObject({
      id: 'a',
      estimatedInputTokens: 1_234,
      estimatedOutputTokens: 567,
      estimatedLatencyMs: 890,
    });
  });
});

describe('estimated subtask counts feed the planner', () => {
  it('a simple question stays a single subtask', () => {
    const classification = new TaskClassifier().classifyByRules({
      type: 'text',
      text: 'What is the capital of France?',
    });

    expect(classification.estimatedSubtasks).toBe(1);
  });
});
