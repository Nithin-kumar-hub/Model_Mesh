# 07 — Provider Adapters

All providers implement the same `BaseProvider` interface. The rest of ModelMesh never calls providers directly — it goes through the adapter layer.

---

## Base Interface

```typescript
// core/providers/base.ts

export interface ProviderRequest {
  model: string;
  prompt: string;
  systemPrompt?: string;
  images?: string[];      // base64 for vision models
  maxTokens?: number;
  temperature?: number;
  responseFormat?: 'text' | 'json';
}

export interface ProviderResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  finishReason: 'stop' | 'length' | 'error';
}

export abstract class BaseProvider {
  abstract readonly name: ProviderName;
  abstract readonly models: ProviderModel[];

  abstract complete(
    request: ProviderRequest,
    apiKey: string
  ): Promise<ProviderResponse>;

  abstract isAvailable(apiKey: string): Promise<boolean>;

  // Normalize token counts (some providers report differently)
  protected normalizeTokenCounts(raw: RawProviderResponse): { input: number; output: number } {
    return { input: raw.usage?.input_tokens ?? 0, output: raw.usage?.output_tokens ?? 0 };
  }

  // Standard error classification
  protected classifyError(err: unknown): 'RATE_LIMIT' | 'AUTH' | 'SERVER_ERROR' | 'TIMEOUT' | 'UNKNOWN' {
    const status = (err as any)?.status ?? (err as any)?.response?.status;
    if (status === 429) return 'RATE_LIMIT';
    if (status === 401 || status === 403) return 'AUTH';
    if (status >= 500) return 'SERVER_ERROR';
    if ((err as any)?.code === 'ECONNABORTED') return 'TIMEOUT';
    return 'UNKNOWN';
  }
}
```

---

## Gemini Adapter

```typescript
// core/providers/gemini.ts
import { GoogleGenerativeAI } from '@google/generative-ai';

export class GeminiProvider extends BaseProvider {
  readonly name: ProviderName = 'gemini';

  readonly models: ProviderModel[] = [
    {
      provider: 'gemini',
      model: 'gemini-1.5-flash',
      capabilities: ['text', 'code', 'vision', 'fast', 'cheap'],
      maxContextTokens: 1_000_000,
      avgLatencyMs: 1200,
      costPerInputMToken: 0.075,
      costPerOutputMToken: 0.30,
      reliability: 0.97
    },
    {
      provider: 'gemini',
      model: 'gemini-1.5-pro',
      capabilities: ['text', 'code', 'reasoning', 'vision', 'long_context'],
      maxContextTokens: 2_000_000,
      avgLatencyMs: 3500,
      costPerInputMToken: 1.25,
      costPerOutputMToken: 5.00,
      reliability: 0.96
    }
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: request.model });

    const parts: any[] = [];

    // Add images for vision tasks
    if (request.images?.length) {
      for (const imageBase64 of request.images) {
        parts.push({
          inlineData: {
            mimeType: 'image/jpeg',
            data: imageBase64
          }
        });
      }
    }

    parts.push({ text: request.prompt });

    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      systemInstruction: request.systemPrompt,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.3,
        responseMimeType: request.responseFormat === 'json' ? 'application/json' : 'text/plain'
      }
    });

    const response = result.response;
    const text = response.text();
    const usage = response.usageMetadata;

    return {
      text,
      inputTokens: usage?.promptTokenCount ?? 0,
      outputTokens: usage?.candidatesTokenCount ?? 0,
      model: request.model,
      finishReason: response.candidates?.[0]?.finishReason === 'STOP' ? 'stop' : 'length'
    };
  }
}
```

---

## Groq Adapter

```typescript
// core/providers/groq.ts
import Groq from 'groq-sdk';

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
      reliability: 0.94
    },
    {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      capabilities: ['text', 'fast', 'cheap'],
      maxContextTokens: 128_000,
      avgLatencyMs: 150,
      costPerInputMToken: 0.05,
      costPerOutputMToken: 0.08,
      reliability: 0.96
    },
    {
      provider: 'groq',
      model: 'llama-3.3-70b-specdec',
      capabilities: ['text', 'code', 'reasoning', 'fast'],
      maxContextTokens: 8192,
      avgLatencyMs: 300,
      costPerInputMToken: 0.59,
      costPerOutputMToken: 0.99,
      reliability: 0.93
    }
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const client = new Groq({ apiKey });

    const messages: Groq.Chat.ChatCompletionMessageParam[] = [];
    if (request.systemPrompt) {
      messages.push({ role: 'system', content: request.systemPrompt });
    }
    messages.push({ role: 'user', content: request.prompt });

    const completion = await client.chat.completions.create({
      model: request.model,
      messages,
      max_tokens: request.maxTokens ?? 4096,
      temperature: request.temperature ?? 0.3,
      response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined
    });

    const choice = completion.choices[0];
    return {
      text: choice.message.content ?? '',
      inputTokens: completion.usage?.prompt_tokens ?? 0,
      outputTokens: completion.usage?.completion_tokens ?? 0,
      model: request.model,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length'
    };
  }
}
```

---

## Together AI Adapter

```typescript
// core/providers/together.ts

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
      costPerOutputMToken: 1.10,
      reliability: 0.91
    },
    {
      provider: 'together',
      model: 'Qwen/Qwen2.5-72B-Instruct-Turbo',
      capabilities: ['text', 'reasoning', 'multilingual'],
      maxContextTokens: 32_000,
      avgLatencyMs: 1800,
      costPerInputMToken: 1.20,
      costPerOutputMToken: 1.20,
      reliability: 0.90
    }
  ];

  async complete(request: ProviderRequest, apiKey: string): Promise<ProviderResponse> {
    const response = await fetch('https://api.together.xyz/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: request.model,
        messages: [
          ...(request.systemPrompt ? [{ role: 'system', content: request.systemPrompt }] : []),
          { role: 'user', content: request.prompt }
        ],
        max_tokens: request.maxTokens ?? 4096,
        temperature: request.temperature ?? 0.3,
        response_format: request.responseFormat === 'json' ? { type: 'json_object' } : undefined
      })
    });

    if (!response.ok) {
      const err = await response.json();
      throw Object.assign(new Error(err.error?.message), { status: response.status });
    }

    const data = await response.json();
    const choice = data.choices[0];

    return {
      text: choice.message.content,
      inputTokens: data.usage?.prompt_tokens ?? 0,
      outputTokens: data.usage?.completion_tokens ?? 0,
      model: request.model,
      finishReason: choice.finish_reason === 'stop' ? 'stop' : 'length'
    };
  }
}
```

---

## Provider Registry

```typescript
// core/providers/registry.ts

export class ProviderRegistry {
  private providers = new Map<ProviderName, BaseProvider>([
    ['gemini', new GeminiProvider()],
    ['groq', new GroqProvider()],
    ['together', new TogetherProvider()],
    ['mistral', new MistralProvider()],
    ['openrouter', new OpenRouterProvider()]
  ]);

  // Find best model for given capabilities
  getBestModel(
    requiredCapabilities: ProviderCapability[],
    strategy: ExecutionStrategy,
    availableProviders: ProviderName[]
  ): ProviderModel | null {
    const allModels = availableProviders
      .flatMap(p => this.providers.get(p)?.models ?? [])
      .filter(m => requiredCapabilities.every(cap => m.capabilities.includes(cap)));

    if (allModels.length === 0) return null;

    // Score based on strategy
    return allModels.sort((a, b) => this.scoreModel(b, strategy) - this.scoreModel(a, strategy))[0];
  }

  private scoreModel(model: ProviderModel, strategy: ExecutionStrategy): number {
    const speedScore = 1 - Math.min(model.avgLatencyMs / 5000, 1);
    const costScore = 1 - Math.min(model.costPerInputMToken / 5, 1);
    const reliabilityScore = model.reliability;

    // Hypothetical quality score based on model size / known benchmarks
    const qualityScore = this.getQualityScore(model.model);

    switch (strategy) {
      case 'draft':
        return costScore * 0.5 + speedScore * 0.3 + reliabilityScore * 0.2;
      case 'balanced':
        return qualityScore * 0.35 + costScore * 0.25 + speedScore * 0.25 + reliabilityScore * 0.15;
      case 'premium':
        return qualityScore * 0.6 + reliabilityScore * 0.25 + speedScore * 0.15;
    }
  }
}
```

---

## Key Manager

```typescript
// keys/manager.ts

export class KeyManager {
  constructor(private redis: Redis, private db: PrismaClient) {}

  async getBestKey(provider: ProviderName): Promise<{ keyId: string; key: string } | null> {
    // Get keys sorted by health (highest first) that aren't rate limited
    const keyIds = await this.redis.zrevrange(`key:manager:${provider}`, 0, -1);

    for (const keyId of keyIds) {
      const isRateLimited = await this.redis.exists(`key:ratelimit:${keyId}`);
      if (!isRateLimited) {
        const keyRecord = await this.db.providerKey.findUnique({ where: { id: keyId } });
        if (keyRecord?.active) {
          return { keyId, key: decrypt(keyRecord.encryptedKey) };
        }
      }
    }

    return null; // all keys rate limited or unavailable
  }

  async markRateLimited(keyId: string, retryAfterSeconds = 60): Promise<void> {
    await this.redis.setex(`key:ratelimit:${keyId}`, retryAfterSeconds, '1');
    await this.db.providerKey.update({
      where: { id: keyId },
      data: { isRateLimited: true, rateLimitUntil: new Date(Date.now() + retryAfterSeconds * 1000) }
    });
  }

  async recordSuccess(keyId: string, tokensUsed: number): Promise<void> {
    await this.db.providerKey.update({
      where: { id: keyId },
      data: {
        totalCalls: { increment: 1 },
        successfulCalls: { increment: 1 },
        quotaUsed: { increment: tokensUsed },
        lastUsedAt: new Date()
      }
    });
    // Update health score in Redis sorted set
    await this.updateHealthScore(keyId);
  }

  async recordFailure(keyId: string, errorCode: string): Promise<void> {
    await this.db.providerKey.update({
      where: { id: keyId },
      data: {
        totalCalls: { increment: 1 },
        failedCalls: { increment: 1 },
        lastErrorCode: errorCode
      }
    });
    await this.updateHealthScore(keyId);
  }

  private async updateHealthScore(keyId: string): Promise<void> {
    const key = await this.db.providerKey.findUnique({ where: { id: keyId } });
    if (!key) return;

    const healthScore = key.totalCalls > 0
      ? key.successfulCalls / key.totalCalls
      : 1.0;

    await this.db.providerKey.update({
      where: { id: keyId },
      data: { healthScore }
    });

    // Update sorted set in Redis
    const [provider] = await this.getProviderForKey(keyId);
    await this.redis.zadd(`key:manager:${provider}`, healthScore, keyId);
  }
}
```
