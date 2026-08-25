import { beforeEach, describe, expect, it } from 'vitest';
import { CalibrationEngine } from '../../src/core/telemetry/calibration';
import type { CalibrationSample } from '../../src/core/telemetry/calibration';
import { MemoryPersistence } from '../../src/infra/persistence';

/**
 * Rule 4 — every estimate gets calibrated.
 *
 *     actual ≈ estimated_raw * multiplier + bias
 *
 * EWMA with a decaying learning rate: early samples move fast, a mature model
 * resists a single outlier, and the coefficients stay inside sane bounds.
 */

const sample = (overrides: Partial<CalibrationSample> = {}): CalibrationSample => ({
  taskType: 'CODE_ANALYSIS',
  role: 'security_analyzer',
  estimatedInputTokens: 1_000,
  actualInputTokens: 1_000,
  estimatedOutputTokens: 400,
  actualOutputTokens: 400,
  estimatedLatencyMs: 800,
  actualLatencyMs: 800,
  ...overrides,
});

let db: MemoryPersistence;
let calibration: CalibrationEngine;

beforeEach(() => {
  db = new MemoryPersistence();
  calibration = new CalibrationEngine(db);
});

describe('CalibrationEngine', () => {
  it('starts neutral', async () => {
    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');

    expect(record.inputTokenMultiplier).toBe(1);
    expect(record.outputTokenMultiplier).toBe(1);
    expect(record.latencyMultiplier).toBe(1);
    expect(record.inputTokenBias).toBe(0);
    expect(record.sampleCount).toBe(0);
  });

  it('raises the multiplier when reality exceeds the estimate', async () => {
    await calibration.ingest(sample({ actualInputTokens: 2_000 }));

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.inputTokenMultiplier).toBeGreaterThan(1);
    expect(record.sampleCount).toBe(1);
  });

  it('lowers the multiplier when the estimate overshoots', async () => {
    await calibration.ingest(sample({ actualOutputTokens: 100 }));

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.outputTokenMultiplier).toBeLessThan(1);
  });

  it('converges so the calibrated prediction lands on reality', async () => {
    // Closed loop: the profiler feeds back its *calibrated* estimate every
    // round, which is what the engine sees in production. The fixed point of
    // `current ← current(1-α) + (actual/estimated)·current·α` is actual/raw.
    const RAW_ESTIMATE = 1_000;
    const TRUE_ACTUAL = 1_500;

    for (let i = 0; i < 40; i++) {
      const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
      const estimated = Math.max(
        1,
        Math.ceil(RAW_ESTIMATE * record.inputTokenMultiplier + record.inputTokenBias),
      );
      await calibration.ingest(
        sample({ estimatedInputTokens: estimated, actualInputTokens: TRUE_ACTUAL }),
      );
    }

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    const prediction = RAW_ESTIMATE * record.inputTokenMultiplier + record.inputTokenBias;

    expect(prediction).toBeGreaterThan(TRUE_ACTUAL * 0.9);
    expect(prediction).toBeLessThan(TRUE_ACTUAL * 1.1);
    expect(record.sampleCount).toBe(40);
  });

  it('runs the multiplier to its bound when the estimate is fed back uncorrected', async () => {
    // An open loop (a constant ratio that ignores the correction already
    // applied) must not be able to produce an unbounded coefficient.
    for (let i = 0; i < 40; i++) {
      await calibration.ingest(sample({ estimatedInputTokens: 1_000, actualInputTokens: 1_500 }));
    }

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.inputTokenMultiplier).toBeLessThanOrEqual(4);
  });

  it('lets early samples move further than late ones', async () => {
    await calibration.ingest(sample({ actualInputTokens: 2_000 }));
    const afterFirst = (await calibration.get('CODE_ANALYSIS', 'security_analyzer')).inputTokenMultiplier;

    // Bring the model to maturity on neutral samples so alpha decays.
    for (let i = 0; i < 30; i++) await calibration.ingest(sample());
    const beforeOutlier = (await calibration.get('CODE_ANALYSIS', 'security_analyzer')).inputTokenMultiplier;

    await calibration.ingest(sample({ actualInputTokens: 2_000 }));
    const afterOutlier = (await calibration.get('CODE_ANALYSIS', 'security_analyzer')).inputTokenMultiplier;

    const firstMove = Math.abs(afterFirst - 1);
    const lateMove = Math.abs(afterOutlier - beforeOutlier);
    expect(lateMove).toBeLessThan(firstMove);
  });

  it('clamps the multiplier no matter how extreme the observation', async () => {
    for (let i = 0; i < 200; i++) {
      await calibration.ingest(sample({ estimatedInputTokens: 10, actualInputTokens: 100_000 }));
    }
    const high = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(high.inputTokenMultiplier).toBeLessThanOrEqual(4);

    for (let i = 0; i < 200; i++) {
      await calibration.ingest(sample({ estimatedOutputTokens: 100_000, actualOutputTokens: 1 }));
    }
    const low = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(low.outputTokenMultiplier).toBeGreaterThanOrEqual(0.25);
  });

  it('absorbs a small persistent residual into the bias', async () => {
    for (let i = 0; i < 10; i++) {
      await calibration.ingest(sample({ estimatedInputTokens: 1_000, actualInputTokens: 1_120 }));
    }

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.inputTokenBias).toBeGreaterThan(0);
    expect(record.inputTokenBias).toBeLessThanOrEqual(2_000);
  });

  it('refuses to put a huge residual in the bias term', async () => {
    // A 50x miss is a modelling error, not a fixed overhead.
    await calibration.ingest(sample({ estimatedInputTokens: 100, actualInputTokens: 5_000 }));

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.inputTokenBias).toBe(0);
    expect(record.inputTokenMultiplier).toBeGreaterThan(1);
  });

  it('ignores a sample with no usable numbers', async () => {
    await calibration.ingest(sample({ estimatedInputTokens: 0, actualInputTokens: 0 }));

    const record = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    expect(record.inputTokenMultiplier).toBe(1);
    expect(record.inputTokenBias).toBe(0);
    // The sample still counts — it decays alpha for the coefficients that moved.
    expect(record.sampleCount).toBe(1);
  });

  it('keeps (taskType, role) pairs independent', async () => {
    await calibration.ingest(sample({ role: 'security_analyzer', actualInputTokens: 2_000 }));
    await calibration.ingest(sample({ role: 'coder' }));

    const security = await calibration.get('CODE_ANALYSIS', 'security_analyzer');
    const coder = await calibration.get('CODE_ANALYSIS', 'coder');

    expect(security.inputTokenMultiplier).toBeGreaterThan(1);
    expect(coder.inputTokenMultiplier).toBe(1);
  });

  it('summarizes the fleet of calibration models', async () => {
    expect(await calibration.summary()).toMatchObject({ models: 0, samples: 0, meanInputMultiplier: 1 });

    await calibration.ingest(sample({ role: 'security_analyzer', actualInputTokens: 2_000 }));
    await calibration.ingest(sample({ role: 'coder', actualInputTokens: 2_000 }));

    const summary = await calibration.summary();
    expect(summary.models).toBe(2);
    expect(summary.samples).toBe(2);
    expect(summary.meanInputMultiplier).toBeGreaterThan(1);
  });
});
