"""Key manager — manages API key lifecycle, selection, and health tracking.

The key manager holds all registered keys and provides:
- Selection of the best healthy, compatible key for a provider + modality
- Health/failure tracking (cooldown, rate-limit, quota exhaustion)
- Success/failure marking that updates key state
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Sequence

from app.domain import ApiKey, ErrorCode, KeyStatus, Modality, NoHealthyKeyError


class KeyManager:
    """In-memory key registry and selector."""

    def __init__(self) -> None:
        self._keys: list[ApiKey] = []

    # -- Registration -----------------------------------------------------

    def register_key(self, key: ApiKey) -> None:
        """Register a key. Activates NEW keys automatically."""
        if key.status == KeyStatus.NEW:
            key.status = KeyStatus.ACTIVE
        self._keys.append(key)

    def register_keys(self, keys: Sequence[ApiKey]) -> None:
        for k in keys:
            self.register_key(k)

    # -- Queries ----------------------------------------------------------

    def all_keys(self) -> list[ApiKey]:
        return list(self._keys)

    def keys_for_provider(self, provider_id: str) -> list[ApiKey]:
        return [k for k in self._keys if k.provider_id == provider_id]

    def compatible_keys(
        self, provider_id: str, modality: Modality
    ) -> list[ApiKey]:
        """Return keys that are selectable, support the modality, and not in cooldown."""
        now = datetime.now(timezone.utc)
        return [
            k for k in self._keys
            if k.provider_id == provider_id
            and k.is_selectable
            and k.supports_modality(modality)
            and not k.is_in_cooldown(now)
        ]

    # -- Selection --------------------------------------------------------

    def select_key(
        self, provider_id: str, modality: Modality
    ) -> ApiKey:
        """Select the best key for a provider + modality.

        Selection order: lowest priority number → highest quota remaining → first.
        Raises ``NoHealthyKeyError`` if no compatible key is available.
        """
        candidates = self.compatible_keys(provider_id, modality)
        if not candidates:
            raise NoHealthyKeyError(
                f"No healthy key for provider '{provider_id}' with modality '{modality.value}'"
            )

        # Sort by priority (asc), then by quota remaining (desc, None=high)
        def _sort_key(k: ApiKey) -> tuple[int, int]:
            remaining = k.quota_remaining if k.quota_remaining is not None else 10**9
            return (k.priority, -remaining)

        candidates.sort(key=_sort_key)
        return candidates[0]

    # -- Health tracking --------------------------------------------------

    def mark_success(self, key: ApiKey) -> None:
        """Record a successful execution for a key."""
        key.consecutive_failures = 0
        key.last_used_at = datetime.now(timezone.utc)
        key.last_error_code = None
        if key.status in (KeyStatus.DEGRADED, KeyStatus.NEW, KeyStatus.VALIDATING):
            key.status = KeyStatus.ACTIVE

    def mark_failure(
        self,
        key: ApiKey,
        error_code: ErrorCode,
        *,
        cooldown_seconds: float = 30.0,
    ) -> None:
        """Record a failed execution for a key."""
        key.consecutive_failures += 1
        key.last_used_at = datetime.now(timezone.utc)
        key.last_error_code = error_code.value

        if error_code == ErrorCode.RATE_LIMITED:
            self.mark_rate_limited(key, cooldown_seconds=cooldown_seconds)
        elif error_code == ErrorCode.QUOTA_EXHAUSTED:
            self.mark_exhausted(key)
        elif error_code == ErrorCode.INVALID_KEY:
            key.status = KeyStatus.INVALID
        elif key.consecutive_failures >= 3:
            key.status = KeyStatus.DEGRADED

    def mark_rate_limited(
        self, key: ApiKey, *, cooldown_seconds: float = 60.0
    ) -> None:
        """Put a key on cooldown for rate limiting."""
        key.status = KeyStatus.RATE_LIMITED
        key.cooldown_until = datetime.now(timezone.utc) + timedelta(seconds=cooldown_seconds)

    def mark_exhausted(self, key: ApiKey) -> None:
        """Mark a key as quota-exhausted."""
        key.status = KeyStatus.QUOTA_EXHAUSTED
        key.quota_used = key.quota_limit or 0

    def record_usage(self, key: ApiKey, tokens: int) -> None:
        """Record token usage against a key's quota."""
        key.quota_used += tokens
        if key.quota_limit is not None and key.quota_used >= key.quota_limit:
            key.status = KeyStatus.QUOTA_EXHAUSTED
