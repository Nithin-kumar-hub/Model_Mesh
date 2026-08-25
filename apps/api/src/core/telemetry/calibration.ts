import type { Persistence } from '../../infra/persistence';
import type { CalibrationRecord } from '../../infra/records';
import { clamp } from '../../infra/text';

export interface CalibrationSample {
  taskType: string;
  role: string;
  estimatedInputTokens: number;
  actualInputTokens: number;
  estimatedOutputTokens: number;
  actualOutputTokens: number;
  estimatedLatencyMs: number;
  actualLatencyMs: number;
}

const MULTIPLIER_BOUNDS: [number, number] = [0.25, 4];
const BIAS_BOUNDS: [number, number] = [-2_000, 2_000];

/**
 * Rule 4 — every estimate gets calibrated.
 *
 * The profiler predicts `estimated`; execution reveals `actual`. Each sample
 * nudges the (taskType, role) coefficients toward the observed ratio with a
 * decaying learning rate, so early samples move fast and a mature model
 * resists a single outlier.
 *
 *     actual ≈ estimated_raw * multiplier + bias
 */
export class CalibrationEngine {
  constructor(private readonly db: Persistence) {}

  async get(taskType: string, role: string): Promise<CalibrationRecord> {
    return this.db.getCalibration(taskType, role);
  }

  async ingest(sample: CalibrationSample): Promise<void> {
    const current = await this.db.getCalibration(sample.taskType, sample.role);
    const alpha = clamp(1 / (current.sampleCount + 1), 0.05, 0.5);

    const next: CalibrationRecord = {
      ...current,
      inputTokenMultiplier: this.adjustMultiplier(
        current.inputTokenMultiplier,
        sample.estimatedInputTokens,
        sample.actualInputTokens,
        alpha,
      ),
      outputTokenMultiplier: this.adjustMultiplier(
        current.outputTokenMultiplier,
        sample.estimatedOutputTokens,
        sample.actualOutputTokens,
        alpha,
      ),
      latencyMultiplier: this.adjustMultiplier(
        current.latencyMultiplier,
        sample.estimatedLatencyMs,
        sample.actualLatencyMs,
        alpha,
      ),
      inputTokenBias: this.adjustBias(
        current.inputTokenBias,
        sample.estimatedInputTokens,
        sample.actualInputTokens,
        alpha,
      ),
      outputTokenBias: this.adjustBias(
        current.outputTokenBias,
        sample.estimatedOutputTokens,
        sample.actualOutputTokens,
        alpha,
      ),
      latencyBias: this.adjustBias(current.latencyBias, sample.estimatedLatencyMs, sample.actualLatencyMs, alpha),
      sampleCount: current.sampleCount + 1,
      lastUpdatedAt: new Date(),
    };

    await this.db.upsertCalibration(next);
  }

  /**
   * The prediction already had the old multiplier baked in, so the correction
   * is multiplicative: a 20% under-prediction scales the multiplier up by 20%,
   * damped by alpha.
   */
  private adjustMultiplier(current: number, estimated: number, actual: number, alpha: number): number {
    if (estimated <= 0 || actual <= 0) return current;
    const ratio = actual / estimated;
    const target = current * ratio;
    return clamp(current * (1 - alpha) + target * alpha, ...MULTIPLIER_BOUNDS);
  }

  /** Bias absorbs the fixed overhead a ratio can't explain (system prompts, wrappers). */
  private adjustBias(current: number, estimated: number, actual: number, alpha: number): number {
    if (estimated <= 0) return current;
    const residual = actual - estimated;
    // Only small, persistent residuals belong in the bias term.
    if (Math.abs(residual) > estimated) return current;
    return clamp(current * (1 - alpha) + residual * alpha, ...BIAS_BOUNDS);
  }

  /** Mean absolute prediction error across all calibrated (taskType, role) pairs. */
  async summary(): Promise<{
    models: number;
    samples: number;
    meanInputMultiplier: number;
    meanOutputMultiplier: number;
    meanLatencyMultiplier: number;
  }> {
    const models = await this.db.listCalibrations();
    if (models.length === 0) {
      return {
        models: 0,
        samples: 0,
        meanInputMultiplier: 1,
        meanOutputMultiplier: 1,
        meanLatencyMultiplier: 1,
      };
    }

    const mean = (pick: (model: CalibrationRecord) => number): number =>
      Number((models.reduce((sum, model) => sum + pick(model), 0) / models.length).toFixed(4));

    return {
      models: models.length,
      samples: models.reduce((sum, model) => sum + model.sampleCount, 0),
      meanInputMultiplier: mean((model) => model.inputTokenMultiplier),
      meanOutputMultiplier: mean((model) => model.outputTokenMultiplier),
      meanLatencyMultiplier: mean((model) => model.latencyMultiplier),
    };
  }
}
