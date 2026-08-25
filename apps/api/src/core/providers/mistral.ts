import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { BaseProvider } from './base';

/** Mistral — European hosting, strong reasoning; useful failover for Gemini Pro. */
export class MistralProvider extends BaseProvider {
  readonly name: ProviderName = 'mistral';

  readonly models: ProviderModel[] = [
    {
      provider: 'mistral',
      model: 'mistral-large-latest',
      capabilities: ['text', 'code', 'reasoning', 'multilingual'],
      maxContextTokens: 128_000,
      avgLatencyMs: 2600,
      costPerInputMToken: 2.0,
      costPerOutputMToken: 6.0,
      reliability: 0.93,
      quality: 0.88,
    },
    {
      provider: 'mistral',
      model: 'mistral-small-latest',
      capabilities: ['text', 'code', 'fast', 'cheap', 'multilingual'],
      maxContextTokens: 128_000,
      avgLatencyMs: 900,
      costPerInputMToken: 0.2,
      costPerOutputMToken: 0.6,
      reliability: 0.94,
      quality: 0.68,
    },
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    return this.openAiCompatibleChat('https://api.mistral.ai/v1/chat/completions', request, apiKey);
  }
}
