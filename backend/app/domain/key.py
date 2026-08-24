"""API key metadata — SECURITY-CRITICAL.

A :class:`ApiKey` is a *handle*, not a secret. It never stores raw key material.
The actual secret lives only in the process environment (``.env`` → ``os.environ``)
and is fetched by reference at execution time inside the adapter edge.

This makes it structurally impossible for a key to leak via logging, telemetry,
serialisation, or the API: there is simply no field that holds the secret.

Each key carries the metadata the key manager and router need:
- provider association
- modality/capability scope
- priority (lower = tried first)
- health/status + quota state
- a masked fingerprint for human identification (never the raw value)
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from datetime import datetime, timezone

from .enums import KeyStatus, Modality


def fingerprint(secret: str) -> str:
    """Return a short, non-reversible fingerprint for identifying a key.

    Uses a truncated SHA-256 hex digest. This is one-way and safe to log/show;
    it cannot be used to reconstruct the key. Empty input yields "unknown".
    """
    if not secret:
        return "unknown"
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()[:12]


def mask(secret: str) -> str:
    """Return a display mask like ``sk-…a1b2`` revealing only the last 4 chars."""
    if not secret:
        return "…"
    tail = secret[-4:]
    return f"…{tail}"


_ACTIVE_STATES = frozenset({KeyStatus.NEW, KeyStatus.VALIDATING, KeyStatus.ACTIVE, KeyStatus.DEGRADED})


@dataclass
class ApiKey:
    """Mutable metadata handle for one provider credential.

    Mutable (unlike the value objects) because the key manager updates health,
    status, and quota as executions succeed or fail. The secret itself is
    immutable and external — referenced by ``env_var``.
    """

    provider_id: str
    env_var: str  # name of the env var holding the secret, e.g. "GROQ_API_KEY"
    label: str  # human label, e.g. "groq-primary"
    fingerprint: str  # masked/one-way id; NEVER the raw key
    priority: int = 100  # lower = preferred
    modalities: frozenset[Modality] = field(default_factory=lambda: frozenset({Modality.TEXT, Modality.CODE}))
    capabilities: frozenset[str] = field(default_factory=frozenset)
    status: KeyStatus = KeyStatus.NEW

    # Quota tracking (best-effort; refined by telemetry/provider headers).
    quota_limit: int | None = None  # None = unknown / unlimited
    quota_used: int = 0

    # Health bookkeeping.
    consecutive_failures: int = 0
    last_used_at: datetime | None = None
    last_error_code: str | None = None
    # When set, the manager should not select this key until now >= cooldown_until.
    cooldown_until: datetime | None = None

    @classmethod
    def from_secret(
        cls,
        *,
        provider_id: str,
        env_var: str,
        label: str,
        secret: str,
        priority: int = 100,
        **kwargs: object,
    ) -> "ApiKey":
        """Build a key handle from a raw secret WITHOUT retaining it.

        Only the fingerprint is derived and stored; ``secret`` is not kept.
        """
        return cls(
            provider_id=provider_id,
            env_var=env_var,
            label=label,
            fingerprint=fingerprint(secret),
            priority=priority,
            **kwargs,  # type: ignore[arg-type]
        )

    @property
    def is_selectable(self) -> bool:
        """Eligible for selection ignoring cooldown (manager checks time)."""
        return self.status in _ACTIVE_STATES

    @property
    def quota_remaining(self) -> int | None:
        if self.quota_limit is None:
            return None
        return max(self.quota_limit - self.quota_used, 0)

    def is_in_cooldown(self, now: datetime | None = None) -> bool:
        if self.cooldown_until is None:
            return False
        now = now or datetime.now(timezone.utc)
        return now < self.cooldown_until

    def supports_modality(self, modality: Modality) -> bool:
        return modality in self.modalities
