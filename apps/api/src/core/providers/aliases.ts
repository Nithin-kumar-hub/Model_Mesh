import type { ProviderName } from '@modelmesh/types';

/**
 * Providers rename and retire model ids faster than a spec document changes.
 * The registry keeps the model catalogue from docs/07-PROVIDER-ADAPTERS.md as
 * the planning surface (its cost/latency numbers are what the planner reasons
 * about); this map rewrites an id to its current vendor equivalent at call
 * time so a retired id doesn't take down a live demo.
 *
 * Set PROVIDER_MODEL_ALIASES=false to send the catalogue ids verbatim.
 */
export const MODEL_ALIASES: Partial<Record<ProviderName, Record<string, string>>> = {
  groq: {
    'llama-3.1-70b-versatile': 'llama-3.3-70b-versatile',
    'llama-3.3-70b-specdec': 'llama-3.3-70b-versatile',
  },
  gemini: {
    'gemini-1.5-flash': 'gemini-2.0-flash',
    'gemini-1.5-pro': 'gemini-2.5-pro',
  },
};

let aliasesEnabled = process.env.PROVIDER_MODEL_ALIASES !== 'false';

export const setModelAliasesEnabled = (enabled: boolean): void => {
  aliasesEnabled = enabled;
};

export const resolveModelId = (provider: ProviderName, model: string): string => {
  if (!aliasesEnabled) return model;
  return MODEL_ALIASES[provider]?.[model] ?? model;
};
