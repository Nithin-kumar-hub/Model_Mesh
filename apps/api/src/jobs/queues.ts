import { Queue, Worker, type Job } from 'bullmq';
import type Redis from 'ioredis';
import type { SubmitTaskRequest } from '@modelmesh/types';
import { config } from '../config';
import { logger } from '../infra/logger';

/**
 * Job orchestration.
 *
 * Work is queued at the *task* level, and the DAG fans out inside the worker
 * (see subtask.worker.ts). Dependency state belongs to a plan, so splitting one
 * plan across workers would mean shipping that state through Redis for no gain
 * at hackathon scale. What BullMQ buys us — and why it is here — is durability
 * across restarts, priority by strategy, and a hard concurrency ceiling per
 * process so a burst cannot exhaust every provider key at once.
 *
 * With no Redis available the same runner executes inline. The pipeline behaves
 * identically; only durability is lost.
 */

export const TASK_QUEUE_NAME = 'modelmesh.tasks';

export interface TaskJobData {
  taskId: string;
  request: SubmitTaskRequest;
  sessionId?: string;
}

export type TaskRunner = (data: TaskJobData) => Promise<void>;

const PRIORITY: Record<string, number> = { premium: 1, balanced: 5, draft: 10 };

export interface EnqueueResult {
  mode: 'queue' | 'inline';
  jobId?: string;
}

export class TaskQueue {
  private queue: Queue<TaskJobData> | null = null;
  private worker: Worker<TaskJobData> | null = null;

  private constructor(
    private readonly runner: TaskRunner,
    private readonly connection: Redis | null,
  ) {}

  static async create(connection: Redis | null, runner: TaskRunner): Promise<TaskQueue> {
    const instance = new TaskQueue(runner, connection);

    if (!connection || !config.features.queue) {
      logger.warn(
        { reason: connection ? 'ENABLE_QUEUE=false' : 'no redis' },
        'Task queue disabled — executing tasks inline',
      );
      return instance;
    }

    instance.queue = new Queue<TaskJobData>(TASK_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        // One attempt only: a retry would re-bill every provider call that
        // already succeeded. In-flight failures are handled by the executor's
        // own retry/failover, which is cache-aware.
        attempts: 1,
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });

    instance.worker = instance.startWorker(connection);
    logger.info({ queue: TASK_QUEUE_NAME }, 'Task queue ready (BullMQ)');
    return instance;
  }

  /** In-process worker so `pnpm dev` is a complete system. */
  private startWorker(connection: Redis): Worker<TaskJobData> {
    const worker = new Worker<TaskJobData>(
      TASK_QUEUE_NAME,
      async (job: Job<TaskJobData>) => {
        await this.runner(job.data);
      },
      {
        connection,
        concurrency: config.execution.maxParallelSubtasks,
        lockDuration: config.execution.taskTimeoutMs + 30_000,
      },
    );

    worker.on('failed', (job, error) => {
      logger.error({ taskId: job?.data.taskId, err: error.message }, 'Task job failed');
    });

    return worker;
  }

  async enqueue(data: TaskJobData): Promise<EnqueueResult> {
    if (!this.queue) {
      // Detached execution: the caller has already returned 202 to the client.
      void this.runner(data).catch((error: Error) => {
        logger.error({ taskId: data.taskId, err: error.message }, 'Inline task execution failed');
      });
      return { mode: 'inline' };
    }

    const job = await this.queue.add(TASK_QUEUE_NAME, data, {
      priority: PRIORITY[data.request.strategy ?? config.execution.defaultStrategy] ?? 5,
      jobId: data.taskId,
    });

    return { mode: 'queue', jobId: job.id };
  }

  async depth(): Promise<{ waiting: number; active: number } | null> {
    if (!this.queue) return null;
    const [waiting, active] = await Promise.all([this.queue.getWaitingCount(), this.queue.getActiveCount()]);
    return { waiting, active };
  }

  async close(): Promise<void> {
    await this.worker?.close().catch(() => undefined);
    await this.queue?.close().catch(() => undefined);
  }

  get mode(): 'queue' | 'inline' {
    return this.queue ? 'queue' : 'inline';
  }

  get hasConnection(): boolean {
    return this.connection !== null;
  }
}
