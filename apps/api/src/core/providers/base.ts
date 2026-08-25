import type {
  ProviderCapability,
  ProviderErrorKind,
  ProviderModel,
  ProviderName,
  ProviderRequest,
  ProviderResponse,
} from '@modelmesh/types';
import { config } from '../../config';
import { countTokens } from '../../infra/text';
import { resolveModelId } from './aliases';

/** Normalized provider failure. Recovery decisions branch on `kind`. */
export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    message: string,
    readonly provider: ProviderName,
    readonly status?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export interface RawUsage {
  input?: number | null;
  output?: number | null;
}

/**
 * Every provider is reached through this interface. Nothing above the adapter
 * layer knows a vendor SDK exists (docs/07-PROVIDER-ADAPTERS.md).
 */
export abstract class BaseProvider {
  abstract readonly name: ProviderName;
  abstract readonly models: ProviderModel[];

  abstract complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse>;

  /** Cheap liveness probe — one minimal completion. */
  async isAvailable(apiKey: string): Promise<boolean> {
    const model = this.models[0];
    if (!model) return false;
    try {
      await this.complete(
        { model: model.model, prompt: 'ping', maxTokens: 8, temperature: 0, timeoutMs: 8_000 },
        apiKey,
      );
      return true;
    } catch {
      return false;
    }
  }

  supports(capabilities: ProviderCapability[]): boolean {
    return this.models.some((model) => capabilities.every((capability) => model.capabilities.includes(capability)));
  }

  getModel(modelId: string): ProviderModel | undefined {
    return this.models.find((model) => model.model === modelId);
  }

  protected resolve(model: string): string {
    return resolveModelId(this.name, model);
  }

  protected timeout(request: ProviderRequest): number {
    return request.timeoutMs ?? config.execution.providerTimeoutMs;
  }

  /**
   * Providers disagree on usage reporting; some omit it entirely. Fall back to
   * an estimate so telemetry and calibration always have numbers to work with.
   */
  protected normalizeTokenCounts(
    raw: RawUsage,
    request: ProviderRequest,
    responseText: string,
  ): { input: number; output: number } {
    const input =
      raw.input && raw.input > 0
        ? raw.input
        : countTokens(`${request.systemPrompt ?? ''}\n${request.prompt}`);
    const output = raw.output && raw.output > 0 ? raw.output : countTokens(responseText);
    return { input, output };
  }

  /** Maps transport/SDK errors onto the recovery engine's vocabulary. */
  protected classifyError(error: unknown): ProviderErrorKind {
    if (error instanceof ProviderError) return error.kind;

    const candidate = error as { status?: number; statusCode?: number; code?: string; message?: string; response?: { status?: number } };
    const status = candidate?.status ?? candidate?.statusCode ?? candidate?.response?.status;

    if (status === 429) return 'RATE_LIMIT';
    if (status === 401 || status === 403) return 'AUTH';
    if (status === 400 || status === 404 || status === 422) return 'BAD_REQUEST';
    if (typeof status === 'number' && status >= 500) return 'SERVER_ERROR';

    const code = candidate?.code;
    if (code === 'ETIMEDOUT' || code === 'ECONNABORTED' || code === 'ABORT_ERR' || code === 'UND_ERR_HEADERS_TIMEOUT') {
      return 'TIMEOUT';
    }
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'SERVER_ERROR';

    const message = String(candidate?.message ?? error ?? '').toLowerCase();
    if (message.includes('timeout') || message.includes('aborted')) return 'TIMEOUT';
    if (message.includes('rate limit') || message.includes('quota') || message.includes('429')) return 'RATE_LIMIT';
    if (message.includes('api key') || message.includes('unauthorized') || message.includes('permission')) return 'AUTH';
    if (message.includes('fetch failed') || message.includes('network')) return 'SERVER_ERROR';
    return 'UNKNOWN';
  }

  protected wrap(error: unknown): ProviderError {
    if (error instanceof ProviderError) return error;
    const kind = this.classifyError(error);
    const candidate = error as { status?: number; message?: string; headers?: Record<string, string> };
    const retryAfter = Number(candidate?.headers?.['retry-after']);
    return new ProviderError(
      kind,
      `${this.name}: ${candidate?.message ?? String(error)}`,
      this.name,
      candidate?.status,
      Number.isFinite(retryAfter) ? retryAfter : undefined,
    );
  }

  /** Shared OpenAI-compatible chat call used by Together / Mistral / OpenRouter. */
  protected async openAiCompatibleChat(
    endpoint: string,
    request: ProviderRequest,
    apiKey: string,
    extraHeaders: Record<string, string> = {},
  ): Promise<ProviderResponse> {
    const model = this.resolve(request.model);
    let response: Response;

    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          ...extraHeaders,
        },
        body: JSON.stringify({
          model,
          messages: [
            ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
            { role: 'user', content: request.prompt },
          ],
          max_tokens: request.maxTokens ?? 4096,
          temperature: request.temperature ?? 0.3,
          ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' } } : {}),
        }),
        signal: AbortSignal.timeout(this.timeout(request)),
      });
    } catch (error) {
      throw this.wrap(error);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProviderError(
        this.classifyError({ status: response.status }),
        `${this.name} HTTP ${response.status}: ${body.slice(0, 300)}`,
        this.name,
        response.status,
        Number(response.headers.get('retry-after')) || undefined,
      );
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };

    const choice = data.choices?.[0];
    const text = choice?.message?.content ?? '';
    const usage = this.normalizeTokenCounts(
      { input: data.usage?.prompt_tokens, output: data.usage?.completion_tokens },
      request,
      text,
    );

    return {
      text,
      inputTokens: usage.input,
      outputTokens: usage.output,
      model,
      finishReason: choice?.finish_reason === 'stop' ? 'stop' : choice?.finish_reason ? 'length' : 'error',
    };
  }
}
