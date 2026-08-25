import type { ExecutionStrategy } from '@modelmesh/types';
import { logger } from '../../infra/logger';
import type { Persistence } from '../../infra/persistence';
import type { TelemetryRecordInput } from '../../infra/records';
import type { CalibrationEngine } from './calibration';

export interface SubtaskTelemetry extends TelemetryRecordInput {
  taskId: string;
  subtaskId: string;
  role: string;
  taskType: string;
}

export interface StatsPayload {
  period: string;
  tasks: {
    total: number;
    completed: number;
    failed: number;
    byStrategy: Record<string, number>;
    byType: Record<string, number>;
  };
  tokens: {
    totalEstimated: number;
    totalActual: number;
    totalSaved: number;
    avgSavingsPercent: number;
    calibrationError: number;
  };
  latency: { p50Ms: number; p95Ms: number; p99Ms: number };
  reliability: {
    taskSuccessRate: number;
    subtaskFailoverRate: number;
    cacheHitRate: number;
  };
  providerBreakdown: Array<{
    provider: string;
    callCount: number;
    avgLatencyMs: number;
    errorRate: number;
    tokens: number;
  }>;
  calibration: Awaited<ReturnType<CalibrationEngine['summary']>>;
}

const percentile = (sorted: number[], fraction: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index] ?? 0;
};

const mean = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;

/**
 * Rule 4's recording half: every subtask writes estimate-vs-actual, and every
 * write feeds the calibration engine. Nothing else in the system is allowed to
 * write telemetry directly, so "did we measure it?" has one answer.
 */
export class TelemetryRecorder {
  constructor(
    private readonly db: Persistence,
    private readonly calibration: CalibrationEngine,
  ) {}

  async recordSubtask(input: SubtaskTelemetry): Promise<void> {
    try {
      await this.db.recordTelemetry(input);

      // A cache hit says nothing about how big a real call would have been.
      if (!input.fromCache) {
        await this.calibration.ingest({
          taskType: input.taskType,
          role: input.role,
          estimatedInputTokens: input.estimatedInputTokens ?? 0,
          actualInputTokens: input.actualInputTokens ?? 0,
          estimatedOutputTokens: input.estimatedOutputTokens ?? 0,
          actualOutputTokens: input.actualOutputTokens ?? 0,
          estimatedLatencyMs: input.estimatedLatencyMs ?? 0,
          actualLatencyMs: input.actualLatencyMs ?? 0,
        });
      }
    } catch (error) {
      // Telemetry must never break execution.
      logger.warn({ err: (error as Error).message, taskId: input.taskId }, 'Telemetry write failed');
    }
  }

  async recordTask(input: TelemetryRecordInput): Promise<void> {
    try {
      await this.db.recordTelemetry(input);
    } catch (error) {
      logger.warn({ err: (error as Error).message, taskId: input.taskId }, 'Task telemetry write failed');
    }
  }

  async stats(days = 7): Promise<StatsPayload> {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const [records, tasks] = await Promise.all([
      this.db.listTelemetry({ since, limit: 20_000 }),
      this.db.listTasks({ limit: 2_000 }),
    ]);

    const windowTasks = tasks.filter((task) => task.createdAt >= since);
    const byStrategy: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let completed = 0;
    let failed = 0;
    let totalEstimated = 0;
    let totalActual = 0;
    let totalSaved = 0;

    for (const task of windowTasks) {
      byStrategy[task.strategy] = (byStrategy[task.strategy] ?? 0) + 1;
      const type = task.taskType ?? 'UNKNOWN';
      byType[type] = (byType[type] ?? 0) + 1;
      if (task.status === 'completed') completed += 1;
      if (task.status === 'failed') failed += 1;
      totalEstimated += task.estimatedTokens ?? 0;
      totalActual += task.actualTokens ?? 0;
      totalSaved += task.savedTokens ?? 0;
    }

    const subtaskRecords = records.filter((record) => record.subtaskId);
    const latencies = subtaskRecords
      .map((record) => record.actualLatencyMs ?? 0)
      .filter((value) => value > 0)
      .sort((a, b) => a - b);

    const failovers = subtaskRecords.reduce((sum, record) => sum + (record.failovers ?? 0), 0);
    const cacheHits = subtaskRecords.filter((record) => record.fromCache).length;

    const providerMap = new Map<string, { calls: number; latency: number[]; errors: number; tokens: number }>();
    for (const record of subtaskRecords) {
      const provider = record.provider ?? 'unknown';
      const bucket = providerMap.get(provider) ?? { calls: 0, latency: [], errors: 0, tokens: 0 };
      bucket.calls += 1;
      if (record.actualLatencyMs) bucket.latency.push(record.actualLatencyMs);
      if (record.errorCode) bucket.errors += 1;
      bucket.tokens += (record.actualInputTokens ?? 0) + (record.actualOutputTokens ?? 0);
      providerMap.set(provider, bucket);
    }

    const calibrationError = mean(
      subtaskRecords
        .map((record) => record.tokenPredictionError)
        .filter((value): value is number => value !== null && Number.isFinite(value))
        .map(Math.abs),
    );

    return {
      period: `last_${days}_days`,
      tasks: {
        total: windowTasks.length,
        completed,
        failed,
        byStrategy: byStrategy as Record<ExecutionStrategy, number>,
        byType,
      },
      tokens: {
        totalEstimated,
        totalActual,
        totalSaved,
        avgSavingsPercent:
          totalActual + totalSaved > 0
            ? Number(((totalSaved / (totalActual + totalSaved)) * 100).toFixed(2))
            : 0,
        calibrationError: Number(calibrationError.toFixed(4)),
      },
      latency: {
        p50Ms: Math.round(percentile(latencies, 0.5)),
        p95Ms: Math.round(percentile(latencies, 0.95)),
        p99Ms: Math.round(percentile(latencies, 0.99)),
      },
      reliability: {
        taskSuccessRate:
          windowTasks.length > 0 ? Number((completed / windowTasks.length).toFixed(4)) : 0,
        subtaskFailoverRate:
          subtaskRecords.length > 0 ? Number((failovers / subtaskRecords.length).toFixed(4)) : 0,
        cacheHitRate:
          subtaskRecords.length > 0 ? Number((cacheHits / subtaskRecords.length).toFixed(4)) : 0,
      },
      providerBreakdown: [...providerMap.entries()].map(([provider, bucket]) => ({
        provider,
        callCount: bucket.calls,
        avgLatencyMs: Math.round(mean(bucket.latency)),
        errorRate: Number((bucket.errors / Math.max(1, bucket.calls)).toFixed(4)),
        tokens: bucket.tokens,
      })),
      calibration: await this.calibration.summary(),
    };
  }
}
