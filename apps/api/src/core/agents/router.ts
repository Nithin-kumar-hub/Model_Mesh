import type { AgentRole, ExecutionStrategy, ProviderCapability, ProviderName, RouteDecision } from '@modelmesh/types';
import { logger } from '../../infra/logger';
import type { KeyManager } from '../../keys/manager';
import type { ProviderRegistry } from '../providers/registry';
import { getRoleDefinition } from './roles';

export interface RouteOptions {
  strategy: ExecutionStrategy;
  /** Model ids already tried for this subtask. */
  excludeModels?: string[];
  /** Key ids already tried. */
  excludeKeys?: string[];
  /** The subtask's context must fit. */
  minContextTokens?: number;
  /** Extra capabilities the specific subtask needs on top of the role's. */
  extraCapabilities?: ProviderCapability[];
  /** Planner's suggestion — honoured when still routable. */
  preferProvider?: ProviderName;
  preferModel?: string;
}

/**
 * Role + capabilities → a concrete (provider, model, key) triple.
 *
 * This is the only place that turns "SECURITY_ANALYZER needs code+reasoning"
 * into "gemini-1.5-pro with key_01H…". Callers never name a model.
 */
export class AgentRouter {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly keys: KeyManager,
  ) {}

  async route(role: AgentRole, options: RouteOptions): Promise<RouteDecision | null> {
    const roleDef = getRoleDefinition(role);
    const availableProviders = await this.keys.getAvailableProviders();

    if (availableProviders.length === 0) {
      logger.error({ role }, 'No provider has an available key');
      return null;
    }

    const requiredCapabilities = [
      ...new Set([...roleDef.requiredCapabilities, ...(options.extraCapabilities ?? [])]),
    ];

    // The planner's hint gets first refusal, then the open field.
    const orderedProviders =
      options.preferProvider && availableProviders.includes(options.preferProvider)
        ? [options.preferProvider, ...availableProviders.filter((name) => name !== options.preferProvider)]
        : availableProviders;

    const ranked = this.registry.rank({
      requiredCapabilities,
      strategy: options.strategy,
      availableProviders: orderedProviders,
      preferredModels: [
        ...(options.preferModel ? [options.preferModel] : []),
        ...roleDef.preferredModels,
      ],
      minContextTokens: options.minContextTokens,
      exclude: options.excludeModels,
    });

    if (ranked.length === 0) {
      // Capability set is unsatisfiable right now — relax the optional half.
      const relaxed = this.registry.rank({
        requiredCapabilities: roleDef.requiredCapabilities.slice(0, 1),
        strategy: options.strategy,
        availableProviders: orderedProviders,
        exclude: options.excludeModels,
      });
      if (relaxed.length === 0) {
        logger.warn({ role, requiredCapabilities }, 'No model satisfies the required capabilities');
        return null;
      }
      logger.warn({ role, fallbackModel: relaxed[0]?.model }, 'Routing with relaxed capabilities');
      ranked.push(...relaxed);
    }

    for (const model of ranked) {
      const lease = await this.keys.getBestKey(model.provider, options.excludeKeys ?? []);
      if (!lease) continue;

      return {
        provider: model.provider,
        model: model.model,
        keyId: lease.keyId,
        apiKey: lease.apiKey,
        systemPrompt: roleDef.systemPrompt,
        maxOutputTokens: roleDef.maxOutputTokens,
        temperature: roleDef.temperature,
        responseFormat: roleDef.responseFormat,
      };
    }

    return null;
  }
}
