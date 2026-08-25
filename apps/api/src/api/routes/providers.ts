import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProviderName } from '@modelmesh/types';
import { config } from '../../config';
import type { AppContext } from '../../context';
import { maskKey } from '../../infra/crypto';
import { logger } from '../../infra/logger';
import { sendError } from '../errors';

const addKeySchema = z
  .object({
    provider: z.enum(['gemini', 'groq', 'together', 'mistral', 'openrouter']),
    key: z.string().min(8).max(400),
    priority: z.number().int().min(1).max(100).optional(),
    label: z.string().max(80).optional(),
    quotaLimit: z.number().int().positive().optional(),
  })
  .strict();

export const registerProviderRoutes = (app: FastifyInstance, ctx: AppContext): void => {
  // ── GET /providers/status ───────────────────────────────────────────────
  app.get('/providers/status', async (_request, reply) => {
    const providers = await ctx.keys.statusReport(ctx.modelsByProvider);
    const available = await ctx.keys.getAvailableProviders();

    return reply.send({
      providers,
      availableProviders: available,
      mockProviderEnabled: config.mockProviderEnabled,
      timestamp: new Date().toISOString(),
    });
  });

  // ── GET /providers/models ──────────────────────────────────────────────
  // The capability catalogue the router actually reasons over.
  app.get('/providers/models', async (_request, reply) => {
    return reply.send({
      models: ctx.registry.allModels().map((model) => ({
        provider: model.provider,
        model: model.model,
        capabilities: model.capabilities,
        maxContextTokens: model.maxContextTokens,
        avgLatencyMs: model.avgLatencyMs,
        costPerInputMToken: model.costPerInputMToken,
        costPerOutputMToken: model.costPerOutputMToken,
        reliability: model.reliability,
        quality: model.quality,
        scores: {
          draft: Number(ctx.registry.scoreModel(model, 'draft').toFixed(4)),
          balanced: Number(ctx.registry.scoreModel(model, 'balanced').toFixed(4)),
          premium: Number(ctx.registry.scoreModel(model, 'premium').toFixed(4)),
        },
      })),
    });
  });

  // ── POST /providers/keys ───────────────────────────────────────────────
  app.post('/providers/keys', async (request, reply) => {
    const parsed = addKeySchema.safeParse(request.body);
    if (!parsed.success) {
      return sendError(reply, 'INVALID_INPUT', 'Malformed key payload', parsed.error.flatten());
    }

    const record = await ctx.keys.addKey({
      provider: parsed.data.provider as ProviderName,
      key: parsed.data.key,
      ...(parsed.data.priority === undefined ? {} : { priority: parsed.data.priority }),
      ...(parsed.data.label === undefined ? {} : { label: parsed.data.label }),
      ...(parsed.data.quotaLimit === undefined ? {} : { quotaLimit: parsed.data.quotaLimit }),
    });

    logger.info({ provider: record.provider, keyId: record.id }, 'Provider key registered');

    return reply.status(201).send({
      keyId: record.id,
      provider: record.provider,
      maskedKey: record.maskedKey || maskKey(parsed.data.key),
      status: record.active ? 'active' : 'inactive',
    });
  });

  // ── GET /providers/keys ────────────────────────────────────────────────
  // Never returns key material — masked display values only.
  app.get('/providers/keys', async (_request, reply) => {
    const keys = await ctx.keys.listKeysForDisplay();
    return reply.send({ keys });
  });
};
