import type { TraceEmitter, TraceEvent } from '@modelmesh/types';
import { logger } from '../infra/logger';
import type { Persistence } from '../infra/persistence';

/**
 * The execution trace.
 *
 * One event stream feeds three consumers: the WebSocket (live view on the
 * phone), the TraceEvent table (history and post-mortem), and the log. Stage
 * code calls `emit` and knows nothing about any of them.
 *
 * Emission is fire-and-forget by design: a slow socket or a failing insert must
 * never add latency to, or fail, the task it is describing.
 */
export type TraceBroadcaster = (taskId: string, event: TraceEvent) => void;

export class TraceBus {
  private broadcaster: TraceBroadcaster | null = null;

  constructor(private readonly db: Persistence) {}

  setBroadcaster(broadcaster: TraceBroadcaster | null): void {
    this.broadcaster = broadcaster;
  }

  createEmitter(taskId: string, startedAtMs = Date.now()): TraceEmitter {
    return (partial) => {
      const event: TraceEvent = {
        ...partial,
        event: partial.event,
        taskId,
        ts: Date.now() - startedAtMs,
      };

      try {
        this.broadcaster?.(taskId, event);
      } catch (error) {
        logger.debug({ err: (error as Error).message }, 'Trace broadcast failed');
      }

      const { event: name, taskId: _taskId, ts, ...payload } = event;
      void this.db
        .appendTrace(taskId, name, payload as Record<string, unknown>, ts)
        .catch((error: Error) => logger.debug({ err: error.message }, 'Trace persist failed'));

      logger.debug({ taskId, event: name, ts }, 'trace');
    };
  }
}
