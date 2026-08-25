import type { Server as HttpServer } from 'node:http';
import type { FastifyInstance } from 'fastify';
import { Server as SocketServer, type Socket } from 'socket.io';
import type { TraceEvent } from '@modelmesh/types';
import { config } from '../../config';
import type { AppContext } from '../../context';
import { logger } from '../../infra/logger';
import { sendError } from '../errors';

/**
 * Real-time execution trace (Layer: everything, observed).
 *
 * Socket.io on path `/ws`, one room per task. Two details make this usable on a
 * phone rather than just demo-able:
 *
 *  - Late subscribers get the persisted trace replayed on join, so a client that
 *    connects after `plan_selected` still renders the full timeline.
 *  - An SSE endpoint mirrors the same stream for curl and for clients where a
 *    socket is overkill.
 */

const MAX_CONNECTIONS_PER_KEY = 5;

export interface StreamHandle {
  io: SocketServer;
  broadcast: (taskId: string, event: TraceEvent) => void;
  close: () => Promise<void>;
}

export const registerStream = (
  app: FastifyInstance,
  server: HttpServer,
  ctx: AppContext,
): StreamHandle => {
  const io = new SocketServer(server, {
    path: '/ws',
    cors: { origin: '*' },
    // A phone on mobile data reconnects often; keep the window generous.
    pingTimeout: 30_000,
    connectionStateRecovery: { maxDisconnectionDuration: 60_000 },
  });

  const connectionsByKey = new Map<string, number>();
  /** Per-task buffer so an SSE client that arrives mid-run stays in sync. */
  const sseClients = new Map<string, Set<(event: TraceEvent) => void>>();

  io.use((socket, next) => {
    const provided = socket.handshake.auth?.apiKey ?? socket.handshake.headers['x-api-key'];
    const key = Array.isArray(provided) ? provided[0] : provided;

    if (key !== config.server.apiSecret) {
      next(new Error('UNAUTHORIZED'));
      return;
    }

    const identity = String(key);
    const current = connectionsByKey.get(identity) ?? 0;
    if (current >= MAX_CONNECTIONS_PER_KEY) {
      next(new Error('TOO_MANY_CONNECTIONS'));
      return;
    }

    connectionsByKey.set(identity, current + 1);
    socket.data.identity = identity;
    next();
  });

  io.on('connection', (socket: Socket) => {
    const requested = socket.handshake.query.taskId;
    const initialTaskId = Array.isArray(requested) ? requested[0] : requested;

    const subscribe = async (taskId: string): Promise<void> => {
      if (!taskId) return;
      await socket.join(taskId);

      // Replay what already happened, then live events continue in order.
      const history = await ctx.db.listTrace(taskId);
      socket.emit('trace_history', {
        taskId,
        events: history.map((entry) => ({ event: entry.event, ts: entry.msOffset, ...entry.payload })),
      });
      logger.debug({ taskId, socketId: socket.id }, 'Socket subscribed');
    };

    if (initialTaskId) void subscribe(initialTaskId);

    socket.on('subscribe', (payload: { taskId?: string } | string) => {
      const taskId = typeof payload === 'string' ? payload : payload?.taskId;
      if (taskId) void subscribe(taskId);
    });

    socket.on('unsubscribe', (payload: { taskId?: string } | string) => {
      const taskId = typeof payload === 'string' ? payload : payload?.taskId;
      if (taskId) void socket.leave(taskId);
    });

    socket.on('disconnect', () => {
      const identity = String(socket.data.identity ?? '');
      const current = connectionsByKey.get(identity) ?? 1;
      if (current <= 1) connectionsByKey.delete(identity);
      else connectionsByKey.set(identity, current - 1);
    });
  });

  const broadcast = (taskId: string, event: TraceEvent): void => {
    io.to(taskId).emit('trace', event);
    for (const listener of sseClients.get(taskId) ?? []) listener(event);
  };

  // ── GET /tasks/:taskId/events (SSE mirror) ──────────────────────────────
  app.get<{ Params: { taskId: string } }>('/tasks/:taskId/events', async (request, reply) => {
    const { taskId } = request.params;
    const task = await ctx.db.getTask(taskId);
    if (!task) return sendError(reply, 'TASK_NOT_FOUND', `No task with id ${taskId}`);

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const write = (event: TraceEvent): void => {
      reply.raw.write(`event: ${event.event}\ndata: ${JSON.stringify(event)}\n\n`);
    };

    for (const entry of await ctx.db.listTrace(taskId)) {
      write({ event: entry.event as TraceEvent['event'], taskId, ts: entry.msOffset, ...entry.payload });
    }

    const listeners = sseClients.get(taskId) ?? new Set();
    listeners.add(write);
    sseClients.set(taskId, listeners);

    const heartbeat = setInterval(() => reply.raw.write(': ping\n\n'), 15_000);

    request.raw.on('close', () => {
      clearInterval(heartbeat);
      listeners.delete(write);
      if (listeners.size === 0) sseClients.delete(taskId);
    });

    return reply;
  });

  return {
    io,
    broadcast,
    close: async () => {
      await io.close();
    },
  };
};
