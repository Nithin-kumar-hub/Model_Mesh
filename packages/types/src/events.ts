/**
 * Real-time execution trace. Every pipeline stage emits one of these over
 * WebSocket (docs/04-API-SPEC.md) and persists it as a TraceEvent row.
 */

export type TraceEventName =
  | 'task_received'
  | 'classifying'
  | 'classified'
  | 'enhancing'
  | 'enhanced'
  | 'optimizing'
  | 'optimized'
  | 'decomposing'
  | 'decomposed'
  | 'planning'
  | 'plan_selected'
  | 'subtask_started'
  | 'subtask_progress'
  | 'subtask_failed'
  | 'subtask_done'
  | 'subtask_skipped'
  | 'replanning'
  | 'aggregating'
  | 'verifying'
  | 'verified'
  | 'cache_hit'
  | 'completed'
  | 'failed';

export interface TraceEvent {
  event: TraceEventName;
  taskId: string;
  /** Milliseconds since the task was received. */
  ts: number;
  [key: string]: unknown;
}

/** Client → server messages on the task socket. */
export type TraceClientMessage =
  | { type: 'subscribe'; taskId: string }
  | { type: 'unsubscribe'; taskId?: string };

/** What a stage passes to `emit`; taskId and ts are filled in by the bus. */
export interface TraceEventInput {
  event: TraceEventName;
  [key: string]: unknown;
}

export type TraceEmitter = (event: TraceEventInput) => void;
