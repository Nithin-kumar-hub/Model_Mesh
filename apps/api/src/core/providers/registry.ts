import type {
  ExecutionStrategy,
  ProviderCapability,
  ProviderModel,
  ProviderName,
} from '@modelmesh/types';
import { config } from '../../config';
import type { BaseProvider } from './base';
import { GeminiProvider } from './gemini';
import { GroqProvider } from './groq';
import { MistralProvider } from './mistral';
import { MockProvider } from './mock';
import { OpenRouterProvider } from './openrouter';
import { TogetherProvider } from './together';

export interface ModelSelection {
  requiredCapabilities: ProviderCapability[];
  strategy: ExecutionStrategy;
  availableProviders: ProviderName[];
  /** Role-preferred model ids — a tie-breaker, never a hard constraint (Rule 3). */
  preferredModels?: string[];
  /** Model must fit this much input. */
  minContextTokens?: number;
  /** Model ids already tried and failed. */
  exclude?: string[];
}

/**
 * Capability → model resolution.
 *
 * The registry never looks at the task; it answers "which available model best
 * satisfies these capabilities under this strategy?".
 */
export class ProviderRegistry {
  private readonly providers: Map<ProviderName, BaseProvider>;

  constructor(providers?: Map<ProviderName, BaseProvider>) {
    this.providers =
      providers ??
      new Map<ProviderName, BaseProvider>([
        ['gemini', new GeminiProvider()],
        ['groq', new GroqProvider()],
        ['together', new TogetherProvider()],
        ['mistral', new MistralProvider()],
        ['openrouter', new OpenRouterProvider()],
        ...(config.mockProviderEnabled ? ([['mock', new MockProvider()]] as const) : []),
      ]);
  }

  get(name: ProviderName): BaseProvider | undefined {
    return this.providers.get(name);
  }

  names(): ProviderName[] {
    return [...this.providers.keys()];
  }

  all(): BaseProvider[] {
    return [...this.providers.values()];
  }

  allModels(): ProviderModel[] {
    return this.all().flatMap((provider) => provider.models);
  }

  findModel(provider: ProviderName, model: string): ProviderModel | undefined {
    return this.providers.get(provider)?.getModel(model);
  }

  /**
   * Ranked candidates, best first. The recovery engine walks this list when a
   * model fails, which is what makes failover capability-preserving.
   */
  rank(selection: ModelSelection): ProviderModel[] {
    const real = selection.availableProviders.filter((name) => name !== 'mock');
    // The mock provider is a floor, not a competitor: only reachable alone.
    const providers = real.length > 0 ? real : selection.availableProviders;

    const candidates = providers
      .flatMap((name) => this.providers.get(name)?.models ?? [])
      .filter((model) => selection.requiredCapabilities.every((cap) => model.capabilities.includes(cap)))
      .filter((model) => !selection.exclude?.includes(model.model))
      .filter((model) => !selection.minContextTokens || model.maxContextTokens >= selection.minContextTokens);

    return candidates
      .map((model) => ({
        model,
        score:
          this.scoreModel(model, selection.strategy) +
          (selection.preferredModels?.includes(model.model) ? 0.08 : 0),
      }))
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.model);
  }

  getBestModel(selection: ModelSelection): ProviderModel | null {
    return this.rank(selection)[0] ?? null;
  }

  getBalancedModel(
    requiredCapabilities: ProviderCapability[],
    availableProviders: ProviderName[],
  ): ProviderModel | null {
    return this.getBestModel({ requiredCapabilities, strategy: 'balanced', availableProviders });
  }

  /**
   * Strategy defines what "best" means. Weights come from
   * docs/07-PROVIDER-ADAPTERS.md; every term is normalized to 0-1 first.
   */
  scoreModel(model: ProviderModel, strategy: ExecutionStrategy): number {
    const speed = 1 - Math.min(model.avgLatencyMs / 5000, 1);
    const cost = 1 - Math.min(model.costPerInputMToken / 5, 1);
    const reliability = model.reliability;
    const quality = model.quality;

    switch (strategy) {
      case 'draft':
        return cost * 0.5 + speed * 0.3 + reliability * 0.2;
      case 'balanced':
        return quality * 0.35 + cost * 0.25 + speed * 0.25 + reliability * 0.15;
      case 'premium':
        return quality * 0.6 + reliability * 0.25 + speed * 0.15;
    }
  }

  /** Per-million-token cost of a projected call. */
  estimateCost(model: ProviderModel, inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * model.costPerInputMToken +
      (outputTokens / 1_000_000) * model.costPerOutputMToken
    );
  }
}
