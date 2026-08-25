import { GoogleGenerativeAI } from '@google/generative-ai';
import type { ProviderModel, ProviderName, ProviderRequest, ProviderResponse } from '@modelmesh/types';
import { BaseProvider } from './base';

/** Google AI Studio — the only true multimodal provider in the pool. */
export class GeminiProvider extends BaseProvider {
  readonly name: ProviderName = 'gemini';

  readonly models: ProviderModel[] = [
    {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      capabilities: ['text', 'code', 'vision', 'fast', 'cheap', 'long_context', 'multilingual'],
      maxContextTokens: 1_000_000,
      avgLatencyMs: 1200,
      costPerInputMToken: 0.075,
      costPerOutputMToken: 0.3,
      reliability: 0.97,
      quality: 0.74,
    },
    {
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      capabilities: ['text', 'code', 'reasoning', 'vision', 'long_context', 'multilingual'],
      maxContextTokens: 2_000_000,
      avgLatencyMs: 3500,
      costPerInputMToken: 1.25,
      costPerOutputMToken: 5.0,
      reliability: 0.96,
      quality: 0.92,
    },
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const modelId = this.resolve(request.model);

    try {
      const client = new GoogleGenerativeAI(apiKey);
      const model = client.getGenerativeModel({
        model: modelId,
        ...(request.systemPrompt ? { systemInstruction: request.systemPrompt } : {}),
      });

      const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
      for (const image of request.images ?? []) {
        parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } });
      }
      parts.push({ text: request.prompt });

      const result = await model.generateContent(
        {
          contents: [{ role: 'user', parts }],
          generationConfig: {
            maxOutputTokens: request.maxTokens ?? 4096,
            temperature: request.temperature ?? 0.3,
            ...(request.responseFormat === 'json' ? { responseMimeType: 'application/json' } : {}),
          },
        },
        { timeout: this.timeout(request) },
      );

      const response = result.response;
      const text = response.text();
      const usage = this.normalizeTokenCounts(
        {
          input: response.usageMetadata?.promptTokenCount,
          output: response.usageMetadata?.candidatesTokenCount,
        },
        request,
        text,
      );

      return {
        text,
        inputTokens: usage.input,
        outputTokens: usage.output,
        model: modelId,
        finishReason: response.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : 'length',
      };
    } catch (error) {
      throw this.wrap(error);
    }
  }
}
