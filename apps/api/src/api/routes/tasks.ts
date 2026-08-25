import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SubmitTaskRequest, TaskResult } from '@modelmesh/types';
import { config } from '../../config';
import type { AppContext } from '../../context';
import { taskId as newTaskId } from '../../infra/ids';
import { logger } from '../../infra/logger';
import { countTokens } from '../../infra/text';
import type { TaskQueue } from '../../jobs/queues';
import { sendError } from '../errors';
import { rateLimitHook } from '../middleware/rate-limit';
import { sanitizeUserIntent } from '../middleware/safety';

/** Modalities that need a binary payload we can actually forward to a model. */
const SUPPORTED_BINARY_MIME = /^(?:image\/|application\/pdf|audio\/|text\/)/;

const localMetadataSchema = z
  .object({
    detectedText: z.string().max(200_000).optional(),
    detectedLanguage: z.string().max(16).optional(),
    barcodeData: z.string().max(8_000).optional(),
    imageWidth: z.number().int().positive().optional(),
    imageHeight: z.number().int().positive().optional(),
    audioDurationSeconds: z.number().nonnegative().optional(),
    deviceModel: z.string().max(120).optional(),
    hasNPU: z.boolean().optional(),
    hasGPU: z.boolean().optional(),
    batteryLevel: z.number().min(0).max(100).optional(),
    isOnWifi: z.boolean().optional(),
  })
  .strict();

const fileSchema = z
  .object({
    id: z.string().min(1).max(120),
    mimeType: z.string().min(3).max(120),
    base64: z.string().optional(),
    url: z.string().url().optional(),
    metadata: z
      .object({
        pageCount: z.number().int().nonnegative().optional(),
        sizeBytes: z.number().int().nonnegative().optional(),
        imageWidth: z.number().int().positive().optional(),
        imageHeight: z.number().int().positive().optional(),
        audioDurationSeconds: z.number().nonnegative().optional(),
        preprocessedAt: z.string().optional(),
        detectedText: z.string().max(500_000).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const submitTaskSchema = z
  .object({
    input: z
      .object({
        type: z.enum(['text', 'code', 'image', 'pdf', 'audio', 'video', 'qr', 'multipart']),
        text: z.string().max(500_000).optional(),
        files: z.array(fileSchema).max(10).optional(),
        localMetadata: localMetadataSchema.optional(),
      })
      .strict()
      .refine(
        (input) => Boolean(input.text?.trim()) || (input.files?.length ?? 0) > 0 || Boolean(input.localMetadata?.detectedText),
        { message: 'Provide text, at least one file, or on-device extracted text' },
      ),
    strategy: z.enum(['draft', 'balanced', 'premium']).optional(),
    budget: z
      .object({
        maxTokens: z.number().int().positive().max(2_000_000).optional(),
        maxLatencyMs: z.number().int().positive().max(600_000).optional(),
        minQuality: z.number().min(0).max(1).optional(),
      })
      .strict()
      .optional(),
    preferences: z
      .object({
        preferLocalModels: z.boolean().optional(),
        explainPlan: z.boolean().optional(),
        streamTrace: z.boolean().optional(),
      })
      .strict()
      .optional(),
    sessionId: z.string().min(4).max(120).optional(),
  })
  .strict();

const feedbackSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(2_000).optional(),
    actualQuality: z.number().min(0).max(1).optional(),
  })
  .strict();

export interface TaskRouteDeps {
  ctx: AppContext;
  queue: TaskQueue;
  /** Completed results, kept briefly so a fast client can read before the DB write settles. */
  resultCache: Map<string, TaskResult>;
}

export const registerTaskRoutes = (app: FastifyInstance, deps: TaskRouteDeps): void => {
  const { ctx } = deps;

  const submitLimit = rateLimitHook(ctx.store, {
    bucket: 'tasks:submit',
    limit: config.limits.tasksPerMinute,
    windowSeconds: 60,
  });
  const readLimit = rateLimitHook(ctx.store, {
    bucket: 'tasks:read',
    limit: config.limits.readsPerMinute,
    windowSeconds: 60,
  });

  // ── POST /tasks ─────────────────────────────────────────────────────────
  app.post('/tasks', { preHandler: submitLimit }, async (request, reply) => {
    const parsed = submitTaskSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 'INVALID_INPUT', 'Malformed request body', parsed.error.flatten());
    }

    const body = parsed.data;

    // Payload limits before anything expensive happens.
    for (const file of body.input.files ?? []) {
      const bytes = file.base64 ? Math.ceil((file.base64.length * 3) / 4) : (file.metadata?.sizeBytes ?? 0);
      if (bytes > config.limits.maxFileBytes) {
        return sendError(
          reply,
          'FILE_TOO_LARGE',
          `File ${file.id} is ${bytes} bytes; limit is ${config.limits.maxFileBytes}`,
        );
      }
      const usable =
        SUPPORTED_BINARY_MIME.test(file.mimeType) || Boolean(file.metadata?.detectedText) || Boolean(file.url);
      if (!usable) {
        return sendError(
          reply,
          'UNSUPPORTED_MODALITY',
          `No adapter can consume ${file.mimeType}. Send on-device extracted text in metadata.detectedText instead.`,
        );
      }
    }

    // Rule 6: the directive channel is scanned; content is neutralized later.
    const { userIntent, verdict } = sanitizeUserIntent(body.input.text);
    if (!verdict.safe) {
      return sendError(reply, 'PROMPT_INJECTION', 'Input attempts to override system instructions', {
        signals: verdict.matches,
      });
    }

    const strategy = body.strategy ?? config.execution.defaultStrategy;
    const id = newTaskId();

    const submitRequest: SubmitTaskRequest = {
      input: { ...body.input, text: userIntent },
      strategy,
      ...(body.budget ? { budget: body.budget } : {}),
      ...(body.preferences ? { preferences: body.preferences } : {}),
    };

    const estimatedMs = estimateDuration(ctx, submitRequest, strategy);

    await ctx.db.createTask({
      id,
      strategy,
      inputType: body.input.type,
      inputText: userIntent || null,
      inputMeta: body.input.localMetadata ?? null,
      status: 'received',
      estimatedLatencyMs: estimatedMs,
    });

    const enqueued = await deps.queue.enqueue({
      taskId: id,
      request: submitRequest,
      ...(body.sessionId ? { sessionId: body.sessionId } : {}),
    });

    logger.info({ taskId: id, strategy, mode: enqueued.mode }, 'Task accepted');

    return reply.status(202).send({
      taskId: id,
      status: 'received',
      websocketRoom: id,
      estimatedMs,
      executionMode: enqueued.mode,
      createdAt: new Date().toISOString(),
    });
  });

  // ── GET /tasks/:taskId ──────────────────────────────────────────────────
  app.get<{ Params: { taskId: string } }>(
    '/tasks/:taskId',
    { preHandler: readLimit },
    async (request, reply) => {
      const task = await ctx.db.getTask(request.params.taskId);
      if (!task) return sendError(reply, 'TASK_NOT_FOUND', `No task with id ${request.params.taskId}`);

      const subtasks = await ctx.db.listSubTasks(task.id);
      const cached = deps.resultCache.get(task.id);
      const plan = task.executionPlan;

      return reply.send({
        taskId: task.id,
        status: task.status,
        strategy: task.strategy,
        taskType: task.taskType,
        createdAt: task.createdAt.toISOString(),
        completedAt: task.completedAt?.toISOString() ?? null,
        ...(task.errorCode ? { error: { code: task.errorCode } } : {}),
        result:
          task.output !== null
            ? {
                output: task.output,
                format: task.outputFormat ?? 'markdown',
                confidence: task.outputConfidence ?? cached?.confidence ?? null,
                partial: task.partial,
              }
            : null,
        plan: plan
          ? {
              id: plan.id,
              strategy: plan.strategy,
              subtaskCount: plan.nodes.length,
              parallelGroups: plan.parallelGroups,
              estimatedTokens: plan.estimatedTotalTokens,
              estimatedLatencyMs: plan.estimatedTotalLatencyMs,
              estimatedCost: plan.estimatedTotalCost,
              reliabilityScore: plan.reliabilityScore,
              reasoning: plan.reasoning,
            }
          : null,
        subtasks: subtasks.map((subtask) => ({
          id: subtask.nodeId,
          role: subtask.role,
          status: subtask.status,
          provider: subtask.provider,
          model: subtask.model,
          dependencies: subtask.dependencies,
          confidence: subtask.confidence,
          tokens: (subtask.actualInputTokens ?? 0) + (subtask.actualOutputTokens ?? 0),
          latencyMs: subtask.latencyMs,
          failovers: subtask.failovers,
          fromCache: subtask.fromCache,
          errorCode: subtask.errorCode,
        })),
        verification: task.verification,
        telemetry: {
          totalMs: task.actualLatencyMs,
          estimatedTokens: task.estimatedTokens,
          actualTokens: task.actualTokens,
          savedTokens: task.savedTokens,
          savingsPercent:
            task.savedTokens && task.actualTokens
              ? Number(((task.savedTokens / (task.savedTokens + task.actualTokens)) * 100).toFixed(2))
              : 0,
          failovers: task.failovers,
          cacheHits: task.cacheHits,
          providerBreakdown: cached?.telemetry.providerBreakdown ?? buildBreakdown(subtasks),
        },
      });
    },
  );

  // ── GET /tasks/:taskId/trace ────────────────────────────────────────────
  app.get<{ Params: { taskId: string } }>(
    '/tasks/:taskId/trace',
    { preHandler: readLimit },
    async (request, reply) => {
      const task = await ctx.db.getTask(request.params.taskId);
      if (!task) return sendError(reply, 'TASK_NOT_FOUND', `No task with id ${request.params.taskId}`);

      const events = await ctx.db.listTrace(task.id);
      return reply.send({
        taskId: task.id,
        status: task.status,
        events: events.map((entry) => ({ event: entry.event, ts: entry.msOffset, ...entry.payload })),
      });
    },
  );

  // ── GET /tasks ──────────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string } }>('/tasks', { preHandler: readLimit }, async (request, reply) => {
    const limit = Math.min(100, Math.max(1, Number(request.query.limit ?? 20) || 20));
    const tasks = await ctx.db.listTasks({ limit });

    return reply.send({
      tasks: tasks.map((task) => ({
        taskId: task.id,
        status: task.status,
        strategy: task.strategy,
        taskType: task.taskType,
        inputPreview: task.inputText?.slice(0, 120) ?? null,
        confidence: task.outputConfidence,
        actualTokens: task.actualTokens,
        savedTokens: task.savedTokens,
        totalMs: task.actualLatencyMs,
        createdAt: task.createdAt.toISOString(),
      })),
    });
  });

  // ── POST /tasks/:taskId/feedback ────────────────────────────────────────
  app.post<{ Params: { taskId: string } }>('/tasks/:taskId/feedback', async (request, reply) => {
    const parsed = feedbackSchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 'INVALID_INPUT', 'Malformed feedback body', parsed.error.flatten());
    }

    const task = await ctx.db.getTask(request.params.taskId);
    if (!task) return sendError(reply, 'TASK_NOT_FOUND', `No task with id ${request.params.taskId}`);

    await ctx.db.saveFeedback({
      taskId: task.id,
      rating: parsed.data.rating,
      comment: parsed.data.comment ?? null,
      actualQuality: parsed.data.actualQuality ?? null,
      createdAt: new Date(),
    });

    // User rating is a quality signal for future calibration work.
    await ctx.telemetry.recordTask({
      taskId: task.id,
      taskType: task.taskType,
      strategy: task.strategy,
      userRating: parsed.data.rating,
      confidence: parsed.data.actualQuality ?? null,
    });

    return reply.status(201).send({ taskId: task.id, recorded: true });
  });
};

/**
 * Pre-execution duration estimate for the 202 response. Rules only — spending
 * an LLM call to predict how long an LLM call takes would be self-defeating.
 */
const estimateDuration = (
  ctx: AppContext,
  request: SubmitTaskRequest,
  strategy: string,
): number => {
  const classification = ctx.classifier.classifyByRules(request.input);
  const contextTokens = countTokens(request.input.text ?? '') + 500;
  const perSubtaskMs = 700 + (contextTokens / 1_000) * 120;
  const batches = strategy === 'draft' ? classification.estimatedSubtasks : Math.ceil(classification.estimatedSubtasks / 3);
  const overheadMs = classification.complexity === 'simple' ? 150 : 900;

  return Math.round(overheadMs + batches * perSubtaskMs);
};

const buildBreakdown = (
  subtasks: Awaited<ReturnType<AppContext['db']['listSubTasks']>>,
): Array<Record<string, unknown>> =>
  subtasks
    .filter((subtask) => subtask.provider !== null)
    .map((subtask) => ({
      provider: subtask.provider,
      model: subtask.model,
      subtask: subtask.nodeId,
      inputTokens: subtask.actualInputTokens ?? 0,
      outputTokens: subtask.actualOutputTokens ?? 0,
      latencyMs: subtask.latencyMs ?? 0,
    }));
