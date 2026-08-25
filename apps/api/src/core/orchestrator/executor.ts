import { AgentRole } from '@modelmesh/types';
import type {
  DAGNode,
  ExecutionStrategy,
  ProviderCapability,
  ProviderName,
  ProviderResponse,
  SubTaskResult,
  TraceEmitter,
} from '@modelmesh/types';
import { config } from '../../config';
import { logger } from '../../infra/logger';
import type { Persistence } from '../../infra/persistence';
import { clamp, sleep, withTimeout } from '../../infra/text';
import type { KeyManager } from '../../keys/manager';
import type { KeyRotator } from '../../keys/rotator';
import { getRoleDefinition } from '../agents/roles';
import type { AgentRouter } from '../agents/router';
import type { SemanticCache } from '../cache/semantic';
import { buildSubtaskPrompt, PromptOptimizer } from '../optimizer/prompt';
import { BaseProvider, ProviderError } from '../providers/base';
import type { ProviderRegistry } from '../providers/registry';
import type { TelemetryRecorder } from '../telemetry/metrics';

export interface InvokeOptions {
  role: AgentRole;
  prompt: string;
  strategy: ExecutionStrategy;
  taskType?: string;
  images?: string[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
  extraCapabilities?: ProviderCapability[];
  preferProvider?: ProviderName;
  preferModel?: string;
  minContextTokens?: number;
  allowCache?: boolean;
  timeoutMs?: number;
  maxAttempts?: number;
  onAttempt?: (info: { provider: ProviderName; model: string; attempt: number }) => void;
  onFailure?: (info: {
    provider: ProviderName;
    model: string;
    attempt: number;
    kind: string;
    message: string;
    retrying: boolean;
  }) => void;
}

export interface InvokeResult {
  text: string;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  attempts: number;
  failovers: number;
  fromCache: boolean;
  confidence: number;
}

export interface SubtaskExecutionContext {
  taskId: string;
  taskType: string;
  strategy: ExecutionStrategy;
  /** Sanitized user intent, kept separate from untrusted content (Rule 6). */
  userIntent: string;
  emit: TraceEmitter;
  /** Absolute epoch ms after which no new provider call should start. */
  deadlineAt?: number;
}

export class NoProvidersAvailableError extends Error {
  readonly code = 'NO_PROVIDERS_AVAILABLE';
  constructor(role: AgentRole) {
    super(`No provider/key available for role ${role}`);
    this.name = 'NoProvidersAvailableError';
  }
}

const HEDGE_PATTERNS = [
  /\bmight\b/gi, /\bmay be\b/gi, /\bpossibly\b/gi, /\bperhaps\b/gi, /\bcould be\b/gi,
  /\bi think\b/gi, /\bit seems\b/gi, /\bappears to\b/gi, /\bunclear\b/gi, /\bnot sure\b/gi,
  /\bprobably\b/gi, /\bpotentially\b/gi, /\bcannot determine\b/gi, /\bwithout more (?:context|information)\b/gi,
];

const CERTAIN_PATTERNS = [
  /\bdefinitely\b/gi, /\bclearly\b/gi, /\bconfirmed\b/gi, /\bthe issue is\b/gi, /\bfound\b/gi,
  /\bwill\b/gi, /\bmust\b/gi, /\bexactly\b/gi, /\bline \d+\b/gi, /\bat line\b/gi,
];

/**
 * Executes one unit of work against the provider pool, with retry, key
 * rotation, and model failover (docs/06-ORCHESTRATION-ENGINE.md §4).
 *
 * `invoke` is the primitive — used by the intelligence layer for its own LLM
 * calls. `executeSubTask` wraps it with DAG semantics: prompt assembly under
 * the safety boundary, trace events, subtask persistence, and telemetry.
 */
export class SubTaskExecutor {
  private readonly promptOptimizer = new PromptOptimizer();

  constructor(
    private readonly router: AgentRouter,
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyManager,
    private readonly rotator: KeyRotator,
    private readonly cache: SemanticCache,
    private readonly telemetry: TelemetryRecorder,
    private readonly db: Persistence,
  ) {}

  // ─── Primitive: one logical call, many physical attempts ────────────────

  async invoke(options: InvokeOptions): Promise<InvokeResult> {
    const roleDef = getRoleDefinition(options.role);
    const maxAttempts = options.maxAttempts ?? config.execution.maxAttemptsPerSubtask;
    const triedKeys: string[] = [];
    const triedModels: string[] = [];
    const useCache = (options.allowCache ?? true) && this.cache.cacheable(options.role, Boolean(options.images?.length));

    let attempt = 0;
    let failovers = 0;
    let lastError: Error | null = null;

    while (attempt < maxAttempts) {
      attempt += 1;

      const route = await this.router.route(options.role, {
        strategy: options.strategy,
        excludeKeys: triedKeys,
        excludeModels: triedModels,
        minContextTokens: options.minContextTokens,
        extraCapabilities: options.extraCapabilities,
        preferProvider: options.preferProvider,
        preferModel: options.preferModel,
      });

      if (!route) throw lastError ?? new NoProvidersAvailableError(options.role);

      const provider = this.registry.get(route.provider);
      if (!provider) {
        triedModels.push(route.model);
        continue;
      }

      if (useCache) {
        const cached = await this.cache.get({
          role: options.role,
          provider: route.provider,
          model: route.model,
          prompt: options.prompt,
        });
        if (cached) {
          return {
            text: cached.text,
            provider: cached.provider,
            model: cached.model,
            inputTokens: cached.inputTokens,
            outputTokens: cached.outputTokens,
            latencyMs: 0,
            attempts: attempt,
            failovers,
            fromCache: true,
            confidence: cached.confidence,
          };
        }
      }

      options.onAttempt?.({ provider: route.provider, model: route.model, attempt });

      const startedAt = Date.now();
      try {
        const response = await this.callProvider(provider, route, options);
        const latencyMs = Date.now() - startedAt;

        await this.keys.recordSuccess(
          route.keyId,
          route.provider,
          response.inputTokens + response.outputTokens,
          latencyMs,
        );

        const result: InvokeResult = {
          text: response.text,
          provider: route.provider,
          model: route.model,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens,
          latencyMs,
          attempts: attempt,
          failovers,
          fromCache: false,
          confidence: this.inferConfidence(response.text, options.responseFormat ?? roleDef.responseFormat),
        };

        if (useCache && response.text.trim().length > 0) {
          await this.cache.set(
            { role: options.role, provider: route.provider, model: route.model, prompt: options.prompt },
            {
              output: result.text,
              confidence: result.confidence,
              actualInputTokens: result.inputTokens,
              actualOutputTokens: result.outputTokens,
              role: options.role,
            },
            this.cache.ttlSecondsFor(options.taskType),
          );
        }

        return result;
      } catch (error) {
        lastError = error as Error;
        const kind = error instanceof ProviderError ? error.kind : 'UNKNOWN';
        const retryAfter = error instanceof ProviderError ? error.retryAfterSeconds : undefined;
        const outcome = await this.rotator.classify(route.keyId, kind, attempt, retryAfter);
        const retrying = outcome.action !== 'GIVE_UP' && attempt < maxAttempts;

        logger.warn(
          {
            role: options.role,
            provider: route.provider,
            model: route.model,
            attempt,
            kind,
            action: outcome.action,
            err: lastError.message,
          },
          'Provider call failed',
        );

        options.onFailure?.({
          provider: route.provider,
          model: route.model,
          attempt,
          kind,
          message: lastError.message,
          retrying,
        });

        if (!retrying) break;

        switch (outcome.action) {
          case 'ROTATE_KEY':
            triedKeys.push(route.keyId);
            failovers += 1;
            break;
          case 'SWAP_PROVIDER':
            triedModels.push(route.model);
            triedKeys.push(route.keyId);
            failovers += 1;
            break;
          case 'RETRY_SAME_KEY':
          default:
            break;
        }

        if (outcome.delayMs > 0) await sleep(outcome.delayMs);
      }
    }

    throw lastError ?? new NoProvidersAvailableError(options.role);
  }

  private async callProvider(
    provider: BaseProvider,
    route: { model: string; apiKey: string; systemPrompt: string; maxOutputTokens: number; temperature: number; responseFormat?: 'text' | 'json' },
    options: InvokeOptions,
  ): Promise<ProviderResponse> {
    const timeoutMs = options.timeoutMs ?? config.execution.providerTimeoutMs;

    return withTimeout(
      provider.complete(
        {
          model: route.model,
          prompt: options.prompt,
          systemPrompt: route.systemPrompt,
          images: options.images,
          maxTokens: options.maxTokens ?? route.maxOutputTokens,
          temperature: options.temperature ?? route.temperature,
          responseFormat: options.responseFormat ?? route.responseFormat,
          timeoutMs,
          roleHint: options.role,
        },
        route.apiKey,
      ),
      timeoutMs + 2_000,
      `${provider.name}:${route.model}`,
    );
  }

  // ─── DAG node execution ────────────────────────────────────────────────

  async executeSubTask(node: DAGNode, ctx: SubtaskExecutionContext): Promise<SubTaskResult> {
    const roleDef = getRoleDefinition(node.role);

    const assembled = buildSubtaskPrompt({
      role: node.role,
      instructions: node.instructions,
      userIntent: ctx.userIntent,
      documentContent: node.contextSlice,
      dependencyContext: node.dependencyContext,
      outputFormat: roleDef.outputFormat,
    });

    const optimized = this.promptOptimizer.optimize(assembled, node.role, ctx.strategy);

    await this.db
      .updateSubTask(ctx.taskId, node.id, {
        status: 'running',
        startedAt: new Date(),
        prompt: optimized.text,
        contextSlice: node.contextSlice,
      })
      .catch(() => undefined);

    const remainingMs = ctx.deadlineAt ? ctx.deadlineAt - Date.now() : undefined;
    if (remainingMs !== undefined && remainingMs <= 0) {
      throw Object.assign(new Error(`Deadline exceeded before ${node.id} started`), { code: 'TIMEOUT' });
    }

    try {
      const result = await this.invoke({
        role: node.role,
        prompt: optimized.text,
        strategy: ctx.strategy,
        taskType: ctx.taskType,
        images: node.images,
        maxTokens: roleDef.maxOutputTokens,
        temperature: roleDef.temperature,
        responseFormat: roleDef.responseFormat,
        minContextTokens: node.estimatedInputTokens,
        preferProvider: node.assignedProvider,
        preferModel: node.assignedModel,
        timeoutMs: remainingMs !== undefined ? Math.max(3_000, Math.min(config.execution.providerTimeoutMs, remainingMs)) : undefined,
        onAttempt: ({ provider, model, attempt }) => {
          ctx.emit({
            event: 'subtask_started',
            subtaskId: node.id,
            role: node.role,
            provider,
            model,
            attempt,
            estimatedTokens: node.estimatedInputTokens + node.estimatedOutputTokens,
          });
        },
        onFailure: ({ provider, model, attempt, kind, message, retrying }) => {
          ctx.emit({
            event: 'subtask_failed',
            subtaskId: node.id,
            role: node.role,
            provider,
            model,
            error: kind,
            message: message.slice(0, 200),
            attemptNumber: attempt,
            retrying,
          });
        },
      });

      const subtaskResult: SubTaskResult = {
        subtaskId: node.id,
        role: node.role,
        provider: result.provider,
        model: result.model,
        output: result.text,
        confidence: result.confidence,
        actualInputTokens: result.inputTokens,
        actualOutputTokens: result.outputTokens,
        actualLatencyMs: result.latencyMs,
        failovers: result.failovers,
        fromCache: result.fromCache,
      };

      await this.db
        .updateSubTask(ctx.taskId, node.id, {
          status: 'completed',
          completedAt: new Date(),
          provider: result.provider,
          model: result.model,
          output: result.text,
          confidence: result.confidence,
          actualInputTokens: result.inputTokens,
          actualOutputTokens: result.outputTokens,
          latencyMs: result.latencyMs,
          attemptNumber: result.attempts,
          failovers: result.failovers,
          fromCache: result.fromCache,
        })
        .catch(() => undefined);

      await this.telemetry.recordSubtask({
        taskId: ctx.taskId,
        subtaskId: node.id,
        role: node.role,
        taskType: ctx.taskType,
        strategy: ctx.strategy,
        provider: result.provider,
        model: result.model,
        estimatedInputTokens: node.estimatedInputTokens,
        actualInputTokens: result.inputTokens,
        estimatedOutputTokens: node.estimatedOutputTokens,
        actualOutputTokens: result.outputTokens,
        estimatedLatencyMs: node.estimatedLatencyMs,
        actualLatencyMs: result.latencyMs,
        confidence: result.confidence,
        failovers: result.failovers,
        fromCache: result.fromCache,
      });

      if (result.fromCache) ctx.emit({ event: 'cache_hit', subtaskId: node.id, role: node.role });

      ctx.emit({
        event: 'subtask_done',
        subtaskId: node.id,
        role: node.role,
        provider: result.provider,
        model: result.model,
        tokens: result.inputTokens + result.outputTokens,
        ms: result.latencyMs,
        confidence: Number(result.confidence.toFixed(2)),
        failovers: result.failovers,
        fromCache: result.fromCache,
      });

      return subtaskResult;
    } catch (error) {
      const message = (error as Error).message;
      const errorCode =
        error instanceof ProviderError
          ? error.kind
          : ((error as { code?: string }).code ?? 'ALL_PROVIDERS_FAILED');

      await this.db
        .updateSubTask(ctx.taskId, node.id, {
          status: 'failed',
          completedAt: new Date(),
          errorCode: String(errorCode),
        })
        .catch(() => undefined);

      await this.telemetry.recordSubtask({
        taskId: ctx.taskId,
        subtaskId: node.id,
        role: node.role,
        taskType: ctx.taskType,
        strategy: ctx.strategy,
        estimatedInputTokens: node.estimatedInputTokens,
        estimatedOutputTokens: node.estimatedOutputTokens,
        estimatedLatencyMs: node.estimatedLatencyMs,
        errorCode: String(errorCode),
        fromCache: false,
      });

      logger.error({ taskId: ctx.taskId, subtaskId: node.id, err: message }, 'Subtask failed permanently');
      throw error;
    }
  }

  /**
   * Confidence is inferred from output shape, not self-reported (CLAUDE.md §10).
   * A model that says "confidence: 0.95" is not evidence; hedging density,
   * specificity, and structure are.
   */
  inferConfidence(output: string, responseFormat?: 'text' | 'json'): number {
    const text = output.trim();
    if (text.length === 0) return 0.1;

    // Structured output either parses or it doesn't — that is the signal.
    if (responseFormat === 'json') {
      try {
        JSON.parse(text);
        return 0.9;
      } catch {
        return /[{[]/.test(text) ? 0.5 : 0.3;
      }
    }

    const count = (patterns: RegExp[]): number =>
      patterns.reduce((sum, pattern) => sum + (text.match(pattern)?.length ?? 0), 0);

    const hedges = count(HEDGE_PATTERNS);
    const certainties = count(CERTAIN_PATTERNS);
    const words = text.split(/\s+/).length;

    let confidence = 0.75;
    confidence += (certainties - hedges * 0.5) * 0.02;

    // Structure and evidence.
    if (/^#{1,6}\s/m.test(text)) confidence += 0.04;
    if (/^\s*(?:[-*]|\d+\.)\s/m.test(text)) confidence += 0.03;
    if (/```/.test(text)) confidence += 0.03;
    if (/\bline \d+|:\d+\b/.test(text)) confidence += 0.04;

    // A three-line answer to a large question is a tell.
    if (words < 40) confidence -= 0.12;
    if (words < 15) confidence -= 0.15;

    // Offering many alternatives instead of an answer.
    const alternatives = (text.match(/\b(?:alternatively|another option|or you could)\b/gi) ?? []).length;
    confidence -= alternatives * 0.04;

    if (/\bi (?:cannot|can't|am unable to)\b/i.test(text)) confidence -= 0.25;

    return Number(clamp(confidence, 0.1, 0.98).toFixed(3));
  }
}
