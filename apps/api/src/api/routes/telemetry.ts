import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../../context';
import type { TaskQueue } from '../../jobs/queues';

export const registerTelemetryRoutes = (
  app: FastifyInstance,
  ctx: AppContext,
  queue: TaskQueue,
): void => {
  // ── GET /telemetry/stats ────────────────────────────────────────────────
  app.get<{ Querystring: { days?: string } }>('/telemetry/stats', async (request, reply) => {
    const days = Math.min(90, Math.max(1, Number(request.query.days ?? 7) || 7));
    const stats = await ctx.telemetry.stats(days);

    return reply.send({
      ...stats,
      infrastructure: {
        persistence: ctx.db.kind,
        cache: ctx.store.kind,
        executionMode: queue.mode,
        queueDepth: await queue.depth(),
      },
    });
  });

  // ── GET /telemetry/calibration ──────────────────────────────────────────
  // The learning loop, made inspectable: what the system now believes about
  // its own estimates for each (taskType, role) pair.
  app.get('/telemetry/calibration', async (_request, reply) => {
    const models = await ctx.db.listCalibrations();

    return reply.send({
      summary: await ctx.calibration.summary(),
      models: models
        .sort((a, b) => b.sampleCount - a.sampleCount)
        .map((model) => ({
          taskType: model.taskType,
          role: model.role,
          samples: model.sampleCount,
          inputTokens: {
            multiplier: Number(model.inputTokenMultiplier.toFixed(4)),
            bias: Number(model.inputTokenBias.toFixed(2)),
          },
          outputTokens: {
            multiplier: Number(model.outputTokenMultiplier.toFixed(4)),
            bias: Number(model.outputTokenBias.toFixed(2)),
          },
          latency: {
            multiplier: Number(model.latencyMultiplier.toFixed(4)),
            bias: Number(model.latencyBias.toFixed(2)),
          },
          lastUpdatedAt: model.lastUpdatedAt,
        })),
    });
  });
};
