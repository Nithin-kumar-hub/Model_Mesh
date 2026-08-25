import type { FastifyReply } from 'fastify';
import { ERROR_HTTP_STATUS, type ErrorCode } from '@modelmesh/types';

/** Uniform error envelope for every route (docs/04-API-SPEC.md). */
export const sendError = async (
  reply: FastifyReply,
  code: ErrorCode,
  message: string,
  details?: unknown,
): Promise<void> => {
  await reply.status(ERROR_HTTP_STATUS[code] ?? 500).send({
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });
};
