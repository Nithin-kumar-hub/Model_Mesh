import cors from '@fastify/cors';
import Fastify, { type FastifyBaseLogger, type FastifyInstance } from 'fastify';
import type { TaskResult } from '@modelmesh/types';
import { registerProviderRoutes } from './api/routes/providers';
import { registerStream, type StreamHandle } from './api/routes/stream';
import { registerTaskRoutes } from './api/routes/tasks';
import { registerTelemetryRoutes } from './api/routes/telemetry';
import { authPlugin } from './api/middleware/auth';
import { config } from './config';
import { createAppContext, type AppContext } from './context';
import { logger } from './infra/logger';
import { TaskQueue, type TaskJobData } from './jobs/queues';
import { DASHBOARD_HTML } from './dashboard';

/** base64 payloads inflate ~33%; leave headroom above MAX_FILE_BYTES. */
const BODY_LIMIT_BYTES = Math.max(32 * 1024 * 1024, config.limits.maxFileBytes * 2);
const API_PREFIX = '/api/v1';
/** Completed results held briefly for reads that race the DB write. */
const RESULT_CACHE_LIMIT = 100;

export interface BuiltServer {
  app: FastifyInstance;
  ctx: AppContext;
  queue: TaskQueue;
  stream: StreamHandle | null;
  close(): Promise<void>;
}

export interface BuildOptions {
  /** Disabled in unit tests that don't need a socket server. */
  enableStream?: boolean;
}

export const buildServer = async (options: BuildOptions = {}): Promise<BuiltServer> => {
  const ctx = await createAppContext();

  const app = Fastify({
    // Cast keeps the instance on Fastify's default logger generic while still
    // sharing the one configured pino instance with non-request code paths.
    logger: logger as FastifyBaseLogger,
    bodyLimit: BODY_LIMIT_BYTES,
    trustProxy: true,
    disableRequestLogging: config.isTest,
  });

  const resultCache = new Map<string, TaskResult>();

  // The queue runner is the single entrypoint into the pipeline, shared by the
  // in-process worker and the standalone one.
  const runTask = async (data: TaskJobData): Promise<void> => {
    const emit = ctx.trace.createEmitter(data.taskId);
    try {
      const result = await ctx.pipeline.run({
        taskId: data.taskId,
        request: data.request,
        emit,
        ...(data.sessionId ? { sessionId: data.sessionId } : {}),
      });

      resultCache.set(data.taskId, result);
      if (resultCache.size > RESULT_CACHE_LIMIT) {
        const oldest = resultCache.keys().next().value;
        if (oldest !== undefined) resultCache.delete(oldest);
      }
    } catch (error) {
      // The pipeline has already persisted the failure and emitted `failed`.
      logger.error({ taskId: data.taskId, err: (error as Error).message }, 'Task run ended in failure');
    }
  };

  const queue = await TaskQueue.create(ctx.redis, runTask);

  const stream = options.enableStream === false ? null : registerStream(app, app.server, ctx);
  if (stream) ctx.trace.setBroadcaster(stream.broadcast);

  await app.register(cors, { origin: '*', exposedHeaders: ['X-RateLimit-Remaining', 'X-RateLimit-Reset'] });
  await app.register(authPlugin);

  // ── Dashboard & Health ──────────────────────────────────────────────────
  app.get('/', async (_request, reply) => {
    return reply.type('text/html').send(DASHBOARD_HTML);
  });
  app.get('/dashboard', async (_request, reply) => {
    return reply.type('text/html').send(DASHBOARD_HTML);
  });
  app.get('/health', async () => ({ status: 'ok', service: 'modelmesh-api', version: '0.1.0' }));

  app.get('/ready', async (_request, reply) => {
    const [dbOk, providers] = await Promise.all([
      ctx.db.ping().catch(() => false),
      ctx.keys.getAvailableProviders(),
    ]);

    const ready = dbOk && providers.length > 0;
    return reply.status(ready ? 200 : 503).send({
      status: ready ? 'ready' : 'degraded',
      persistence: { backend: ctx.db.kind, ok: dbOk },
      cache: { backend: ctx.store.kind },
      execution: { mode: queue.mode },
      providers: { available: providers, mockEnabled: config.mockProviderEnabled },
    });
  });

  // ── API ─────────────────────────────────────────────────────────────────
  await app.register(
    async (instance) => {
      registerTaskRoutes(instance, { ctx, queue, resultCache });
      registerProviderRoutes(instance, ctx);
      registerTelemetryRoutes(instance, ctx, queue);
      instance.get('/health', async () => ({ status: 'ok' }));
    },
    { prefix: API_PREFIX },
  );

  // Stream routes sit under the same prefix but need the raw reply object.
  app.setNotFoundHandler(async (request, reply) => {
    await reply.status(404).send({
      error: { code: 'TASK_NOT_FOUND', message: `No route for ${request.method} ${request.url}` },
    });
  });

  app.setErrorHandler(async (error, request, reply) => {
    const status = error.statusCode ?? 500;
    if (status >= 500) {
      logger.error({ err: error.message, url: request.url, stack: error.stack }, 'Unhandled route error');
    }

    await reply.status(status).send({
      error: {
        code: status === 400 ? 'INVALID_INPUT' : status >= 500 ? 'INTERNAL' : 'INVALID_INPUT',
        message: status >= 500 ? 'Internal server error' : error.message,
      },
    });
  });

  return {
    app,
    ctx,
    queue,
    stream,
    async close(): Promise<void> {
      await stream?.close().catch(() => undefined);
      await queue.close();
      await app.close();
      await ctx.close();
    },
  };
};

const start = async (): Promise<void> => {
  const server = await buildServer();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Shutting down');
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason: String(reason) }, 'Unhandled rejection');
  });

  await server.app.listen({ port: config.server.port, host: config.server.host });

  logger.info(
    {
      url: `http://${config.server.host}:${config.server.port}${API_PREFIX}`,
      websocket: `ws://${config.server.host}:${config.server.port}/ws`,
      persistence: server.ctx.db.kind,
      cache: server.ctx.store.kind,
      execution: server.queue.mode,
      strategy: config.execution.defaultStrategy,
    },
    'Neural Forge API listening',
  );
};

// Only auto-start when executed directly, so tests can import buildServer.
if (require.main === module) {
  void start().catch((error: Error) => {
    logger.error({ err: error.message, stack: error.stack }, 'Server failed to start');
    process.exit(1);
  });
}
