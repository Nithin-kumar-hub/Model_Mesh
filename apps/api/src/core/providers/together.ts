import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { BaseProvider } from './base';

/** Together AI — open-source model access, strongest code specialist in the pool. */
export class TogetherProvider extends BaseProvider {
  readonly name: ProviderName = 'together';

  readonly models: ProviderModel[] = [
    {
      provider: 'together',
      model: 'deepseek-ai/DeepSeek-V3',
      capabilities: ['text', 'code', 'reasoning'],
      maxContextTokens: 128_000,
      avgLatencyMs: 2000,
      costPerInputMToken: 0.27,
      costPerOutputMToken: 1.1,
      reliability: 0.91,
      quality: 0.9,
    },
    {
      provider: 'together',
      model: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
      capabilities: ['text', 'reasoning', 'multilingual'],
      maxContextTokens: 32_000,
      avgLatencyMs: 1800,
      costPerInputMToken: 1.2,
      costPerOutputMToken: 1.2,
      reliability: 0.9,
      quality: 0.84,
    },
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    return this.openAiCompatibleChat('https://api.together.xyz/v1/chat/completions', request, apiKey);
  }
}
