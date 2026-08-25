import { Worker, type Job } from 'bullmq';
import { createAppContext } from '../context';
import { logger } from '../infra/logger';
import { TASK_QUEUE_NAME, type TaskJobData } from './queues';

/**
 * Standalone worker process.
 *
 * `pnpm dev` already runs an in-process worker, so this entrypoint is for
 * scaling execution out of the API process (`pnpm --filter @modelmesh/api worker`).
 * A task job runs the whole 15-layer pipeline; the subtask fan-out happens
 * inside the DAG scheduler, where the dependency state lives.
 *
 * Trace events still reach the phone: they are persisted to the TraceEvent
 * table, and the API broadcasts from there when a client subscribes.
 */
const main = async (): Promise<void> => {
  const context = await createAppContext();

  if (!context.redis) {
    logger.error('Standalone worker requires REDIS_URL — exiting');
    await context.close();
    process.exit(1);
  }

  const worker = new Worker<TaskJobData>(
    TASK_QUEUE_NAME,
    async (job: Job<TaskJobData>) => {
      const { taskId, request, sessionId } = job.data;
      const emit = context.trace.createEmitter(taskId);

      logger.info({ taskId, jobId: job.id }, 'Worker picked up task');
      await context.pipeline.run({ taskId, request, emit, ...(sessionId ? { sessionId } : {}) });
    },
    {
      connection: context.redis,
      concurrency: Number(process.env.WORKER_CONCURRENCY ?? 4),
    },
  );

  worker.on('completed', (job) => logger.info({ taskId: job.data.taskId }, 'Task completed'));
  worker.on('failed', (job, error) =>
    logger.error({ taskId: job?.data.taskId, err: error.message }, 'Task failed'),
  );

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'Worker shutting down');
    await worker.close();
    await context.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.info({ queue: TASK_QUEUE_NAME }, 'Subtask worker online');
};

void main().catch((error: Error) => {
  logger.error({ err: error.message }, 'Worker bootstrap failed');
  process.exit(1);
});
