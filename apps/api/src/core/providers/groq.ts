import Groq from 'groq-sdk';
import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { BaseProvider } from './base';

/** Groq — LPU inference; the latency floor of the pool. */
export class GroqProvider extends BaseProvider {
  readonly name: ProviderName = 'groq';

  readonly models: ProviderModel[] = [
    {
      provider: 'groq',
      model: 'llama-3.1-70b-versatile',
      capabilities: ['text', 'code', 'reasoning', 'fast'],
      maxContextTokens: 128_000,
      avgLatencyMs: 400,
      costPerInputMToken: 0.59,
      costPerOutputMToken: 0.79,
      reliability: 0.94,
      quality: 0.8,
    },
    {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      capabilities: ['text', 'fast', 'cheap'],
      maxContextTokens: 128_000,
      avgLatencyMs: 150,
      costPerInputMToken: 0.05,
      costPerOutputMToken: 0.08,
      reliability: 0.96,
      quality: 0.55,
    },
    {
      provider: 'groq',
      model: 'llama-3.3-70b-specdec',
      capabilities: ['text', 'code', 'reasoning', 'fast'],
      maxContextTokens: 8_192,
      avgLatencyMs: 300,
      costPerInputMToken: 0.59,
      costPerOutputMToken: 0.99,
      reliability: 0.93,
      quality: 0.81,
    },
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const modelId = this.resolve(request.model);

    try {
      const client = new Groq({ apiKey, timeout: this.timeout(request), maxRetries: 0 });

      const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
      if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
      messages.push({ role: 'user', content: request.prompt });

      const completion = await client.chat.completions.create({
        model: modelId,
        messages,
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.3,
        ...(request.responseFormat === 'json' ? { response_format: { type: 'json_object' as const } } : {}),
      });

      const choice = completion.choices[0];
      const text = choice?.message?.content ?? '';
      const usage = this.normalizeTokenCounts(
        { input: completion.usage?.prompt_tokens, output: completion.usage?.completion_tokens },
        request,
        text,
      );

      return {
        text,
        inputTokens: usage.input,
        outputTokens: usage.output,
        model: modelId,
        finishReason: choice?.finish_reason === 'stop' ? 'stop' : 'length',
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }
}
