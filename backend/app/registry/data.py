"""Static provider/model catalog.

All provider and model metadata lives here as plain Python data, not YAML/JSON,
to avoid external-dependency requirements. This is the SINGLE SOURCE of
routing metadata — the router, filter, and scorer operate only on these
normalised types.

NO FABRICATION:
- ``quality_prior`` and ``reliability_prior`` are CONFIGURED routing priors in
  [0, 1], NOT measured benchmarks. They are tunable heuristics.
- Cost fields are published list prices where known (source noted), and
  ``None`` for mocks.
- ``est_latency_ms_per_1k_tokens`` is a rough prior; ``None`` = unknown.
- Mock providers set ``is_mock=True``; their numbers are illustrative.
"""

from __future__ import annotations

from app.domain import HealthStatus, Modality, ModelSpec, Provider

_TEXT_CODE = frozenset({Modality.TEXT, Modality.CODE})

# ====================================================================
# MOCK PROVIDERS — deterministic test providers
# ====================================================================

MOCK_FAST = Provider(
    id="mock_fast",
    display_name="Mock Fast",
    is_mock=True,
    models=(
        ModelSpec(
            id="fast-v1",
            provider_id="mock_fast",
            display_name="Mock Fast v1",
            modalities=_TEXT_CODE,
            context_window=8192,
            max_output_tokens=2048,
            quality_prior=0.4,
            reliability_prior=0.95,
            cost_per_1k_input_usd=None,
            cost_per_1k_output_usd=None,
            est_latency_ms_per_1k_tokens=50.0,
            capabilities=frozenset({"text", "code"}),
            is_mock=True,
        ),
    ),
)

MOCK_QUALITY = Provider(
    id="mock_quality",
    display_name="Mock Quality",
    is_mock=True,
    models=(
        ModelSpec(
            id="quality-v1",
            provider_id="mock_quality",
            display_name="Mock Quality v1",
            modalities=_TEXT_CODE,
            context_window=128_000,
            max_output_tokens=8192,
            quality_prior=0.95,
            reliability_prior=0.9,
            cost_per_1k_input_usd=None,
            cost_per_1k_output_usd=None,
            est_latency_ms_per_1k_tokens=200.0,
            capabilities=frozenset({"text", "code", "reasoning"}),
            is_mock=True,
        ),
    ),
)

MOCK_CODE = Provider(
    id="mock_code",
    display_name="Mock Code Specialist",
    is_mock=True,
    models=(
        ModelSpec(
            id="code-v1",
            provider_id="mock_code",
            display_name="Mock Code v1",
            modalities=frozenset({Modality.CODE}),
            context_window=32_768,
            max_output_tokens=4096,
            quality_prior=0.8,
            reliability_prior=0.9,
            cost_per_1k_input_usd=None,
            cost_per_1k_output_usd=None,
            est_latency_ms_per_1k_tokens=80.0,
            capabilities=frozenset({"code", "debugging"}),
            is_mock=True,
        ),
    ),
)

MOCK_RATE_LIMITED = Provider(
    id="mock_rate_limited",
    display_name="Mock Rate-Limited",
    is_mock=True,
    models=(
        ModelSpec(
            id="limited-v1",
            provider_id="mock_rate_limited",
            display_name="Mock Limited v1",
            modalities=_TEXT_CODE,
            context_window=8192,
            max_output_tokens=2048,
            quality_prior=0.6,
            reliability_prior=0.3,
            is_mock=True,
        ),
    ),
)

MOCK_EXHAUSTED = Provider(
    id="mock_exhausted",
    display_name="Mock Exhausted",
    is_mock=True,
    models=(
        ModelSpec(
            id="exhausted-v1",
            provider_id="mock_exhausted",
            display_name="Mock Exhausted v1",
            modalities=_TEXT_CODE,
            context_window=8192,
            max_output_tokens=2048,
            quality_prior=0.5,
            reliability_prior=0.2,
            is_mock=True,
        ),
    ),
)

MOCK_TIMEOUT = Provider(
    id="mock_timeout",
    display_name="Mock Timeout",
    is_mock=True,
    models=(
        ModelSpec(
            id="timeout-v1",
            provider_id="mock_timeout",
            display_name="Mock Timeout v1",
            modalities=_TEXT_CODE,
            context_window=8192,
            max_output_tokens=2048,
            quality_prior=0.5,
            reliability_prior=0.1,
            is_mock=True,
        ),
    ),
)

MOCK_UNAVAILABLE = Provider(
    id="mock_unavailable",
    display_name="Mock Unavailable",
    is_mock=True,
    default_health=HealthStatus.UNAVAILABLE,
    models=(
        ModelSpec(
            id="unavail-v1",
            provider_id="mock_unavailable",
            display_name="Mock Unavailable v1",
            modalities=_TEXT_CODE,
            context_window=8192,
            max_output_tokens=2048,
            quality_prior=0.5,
            reliability_prior=0.0,
            is_mock=True,
        ),
    ),
)

# ====================================================================
# REAL PROVIDERS
# ====================================================================

# Groq — published pricing as of 2025-06 (source: groq.com/pricing)
GROQ = Provider(
    id="groq",
    display_name="Groq",
    is_mock=False,
    env_key_name="GROQ_API_KEY",
    models=(
        ModelSpec(
            id="llama-3.3-70b-versatile",
            provider_id="groq",
            display_name="Llama 3.3 70B Versatile",
            modalities=_TEXT_CODE,
            context_window=128_000,
            max_output_tokens=32_768,
            quality_prior=0.82,
            reliability_prior=0.85,
            cost_per_1k_input_usd=0.00059,
            cost_per_1k_output_usd=0.00079,
            est_latency_ms_per_1k_tokens=30.0,
            capabilities=frozenset({"text", "code", "reasoning"}),
            litellm_id="groq/llama-3.3-70b-versatile",
            is_mock=False,
        ),
        ModelSpec(
            id="llama-3.1-8b-instant",
            provider_id="groq",
            display_name="Llama 3.1 8B Instant",
            modalities=_TEXT_CODE,
            context_window=128_000,
            max_output_tokens=8192,
            quality_prior=0.55,
            reliability_prior=0.9,
            cost_per_1k_input_usd=0.00005,
            cost_per_1k_output_usd=0.00008,
            est_latency_ms_per_1k_tokens=15.0,
            capabilities=frozenset({"text", "code"}),
            litellm_id="groq/llama-3.1-8b-instant",
            is_mock=False,
        ),
        ModelSpec(
            id="mixtral-8x7b-32768",
            provider_id="groq",
            display_name="Mixtral 8x7B",
            modalities=_TEXT_CODE,
            context_window=32_768,
            max_output_tokens=4096,
            quality_prior=0.65,
            reliability_prior=0.85,
            cost_per_1k_input_usd=0.00024,
            cost_per_1k_output_usd=0.00024,
            est_latency_ms_per_1k_tokens=25.0,
            capabilities=frozenset({"text", "code"}),
            litellm_id="groq/mixtral-8x7b-32768",
            is_mock=False,
        ),
    ),
)

# OpenRouter — published pricing varies by model (source: openrouter.ai/models)
OPENROUTER = Provider(
    id="openrouter",
    display_name="OpenRouter",
    is_mock=False,
    env_key_name="OPENROUTER_API_KEY",
    models=(
        ModelSpec(
            id="meta-llama/llama-3.1-70b-instruct",
            provider_id="openrouter",
            display_name="Llama 3.1 70B (OpenRouter)",
            modalities=_TEXT_CODE,
            context_window=128_000,
            max_output_tokens=16_384,
            quality_prior=0.80,
            reliability_prior=0.80,
            cost_per_1k_input_usd=0.00052,
            cost_per_1k_output_usd=0.00075,
            est_latency_ms_per_1k_tokens=60.0,
            capabilities=frozenset({"text", "code", "reasoning"}),
            litellm_id="openrouter/meta-llama/llama-3.1-70b-instruct",
            is_mock=False,
        ),
        ModelSpec(
            id="mistralai/mistral-7b-instruct",
            provider_id="openrouter",
            display_name="Mistral 7B (OpenRouter)",
            modalities=_TEXT_CODE,
            context_window=32_768,
            max_output_tokens=4096,
            quality_prior=0.55,
            reliability_prior=0.80,
            cost_per_1k_input_usd=0.00006,
            cost_per_1k_output_usd=0.00006,
            est_latency_ms_per_1k_tokens=40.0,
            capabilities=frozenset({"text", "code"}),
            litellm_id="openrouter/mistralai/mistral-7b-instruct",
            is_mock=False,
        ),
    ),
)


# ====================================================================
# Complete catalog
# ====================================================================

ALL_PROVIDERS: tuple[Provider, ...] = (
    MOCK_FAST,
    MOCK_QUALITY,
    MOCK_CODE,
    MOCK_RATE_LIMITED,
    MOCK_EXHAUSTED,
    MOCK_TIMEOUT,
    MOCK_UNAVAILABLE,
    GROQ,
    OPENROUTER,
)

MOCK_PROVIDERS: tuple[Provider, ...] = tuple(p for p in ALL_PROVIDERS if p.is_mock)
REAL_PROVIDERS: tuple[Provider, ...] = tuple(p for p in ALL_PROVIDERS if not p.is_mock)
