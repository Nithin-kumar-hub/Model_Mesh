import type { ProviderErrorKind, ProviderName } from '@modelmesh/types';
import { logger } from '../infra/logger';
import type { KeyLease, KeyManager } from './manager';

export type RotationOutcome =
  | { action: 'RETRY_SAME_KEY'; delayMs: number; reason: string }
  | { action: 'ROTATE_KEY'; delayMs: number; reason: string }
  | { action: 'SWAP_PROVIDER'; delayMs: number; reason: string }
  | { action: 'GIVE_UP'; delayMs: 0; reason: string };

/**
 * Quota-aware rotation policy (CLAUDE.md §10).
 *
 * KeyManager owns key *state*; the rotator owns the *decision* of what to do
 * after a failure, so the executor stays free of provider-specific reasoning.
 *
 *   429  → cool the key down, move to the next one immediately
 *   5xx  → same key, backoff, health shaved (usually transient)
 *   401  → key is dead, deactivate and rotate
 *   400  → our request is wrong; retrying it changes nothing
 */
export class KeyRotator {
  constructor(private readonly keys: KeyManager) {}

  async classify(
    keyId: string,
    kind: ProviderErrorKind,
    attempt: number,
    retryAfterSeconds?: number,
  ): Promise<RotationOutcome> {
    switch (kind) {
      case 'RATE_LIMIT':
        await this.keys.markRateLimited(keyId, retryAfterSeconds ?? 60);
        return { action: 'ROTATE_KEY', delayMs: 0, reason: 'key_rate_limited' };

      case 'AUTH':
        await this.keys.recordFailure(keyId, 'AUTH');
        return { action: 'ROTATE_KEY', delayMs: 0, reason: 'key_rejected' };

      case 'SERVER_ERROR':
        await this.keys.decrementHealth(keyId, 0.1);
        return attempt < 3
          ? { action: 'RETRY_SAME_KEY', delayMs: 2 ** attempt * 1000, reason: 'server_error_backoff' }
          : { action: 'SWAP_PROVIDER', delayMs: 0, reason: 'provider_unstable' };

      case 'TIMEOUT':
        await this.keys.decrementHealth(keyId, 0.05);
        return attempt < 2
          ? { action: 'RETRY_SAME_KEY', delayMs: 500, reason: 'timeout_retry' }
          : { action: 'SWAP_PROVIDER', delayMs: 0, reason: 'provider_slow' };

      case 'BAD_REQUEST':
        // Not the key's fault — a different key would fail identically.
        await this.keys.recordFailure(keyId, 'BAD_REQUEST');
        return { action: 'SWAP_PROVIDER', delayMs: 0, reason: 'request_rejected_by_provider' };

      case 'UNKNOWN':
      default:
        await this.keys.recordFailure(keyId, String(kind));
        return attempt < 2
          ? { action: 'ROTATE_KEY', delayMs: 250, reason: 'unknown_error_rotate' }
          : { action: 'SWAP_PROVIDER', delayMs: 0, reason: 'unknown_error_exhausted' };
    }
  }

  /** Next usable key for a provider, skipping ones already tried. */
  async next(provider: ProviderName, triedKeyIds: string[]): Promise<KeyLease | null> {
    const lease = await this.keys.getBestKey(provider, triedKeyIds);
    if (!lease) {
      logger.warn({ provider, tried: triedKeyIds.length }, 'Key pool exhausted for provider');
    }
    return lease;
  }
}
