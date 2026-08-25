import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { BaseProvider } from './base';

/**
 * OpenRouter — last-resort aggregator. Reached only when every first-party
 * provider is rate-limited or unhealthy, so its cost numbers are pessimistic
 * on purpose: the planner should never prefer it.
 */
export class OpenRouterProvider extends BaseProvider {
  readonly name: ProviderName = 'openrouter';

  readonly models: ProviderModel[] = [
    {
      provider: 'openrouter',
      model: 'google/gemini-flash-1.5',
      capabilities: ['text', 'code', 'vision', 'fast', 'cheap', 'long_context'],
      maxContextTokens: 1_000_000,
      avgLatencyMs: 1800,
      costPerInputMToken: 0.075,
      costPerOutputMToken: 0.3,
      reliability: 0.9,
      quality: 0.73,
    },
    {
      provider: 'openrouter',
      model: 'meta-llama/llama-3.1-70b-instruct',
      capabilities: ['text', 'code', 'reasoning'],
      maxContextTokens: 128_000,
      avgLatencyMs: 2600,
      costPerInputMToken: 0.35,
      costPerOutputMToken: 0.4,
      reliability: 0.88,
      quality: 0.79,
    },
    {
      provider: 'openrouter',
      model: 'openai/gpt-4o-mini',
      capabilities: ['text', 'code', 'reasoning', 'vision'],
      maxContextTokens: 128_000,
      avgLatencyMs: 2200,
      costPerInputMToken: 0.15,
      costPerOutputMToken: 0.6,
      reliability: 0.92,
      quality: 0.83,
    },
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    return this.openAiCompatibleChat('https://openrouter.ai/api/v1/chat/completions', request, apiKey, {
      'HTTP-Referer': 'https://modelmesh.app',
      'X-Title': 'ModelMesh',
    });
  }
}
