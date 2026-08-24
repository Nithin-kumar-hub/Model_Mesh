# ModelMesh — Phase 1 Working Instructions

You are the principal engineer building Phase 1 of ModelMesh.

Your mission is to build the CORE PROJECT that will become the foundation for the onsite iQOO hackathon implementation.

## 1. Working mode

Act as a senior software architect, full-stack engineer, QA engineer, security reviewer, and mobile UX engineer.

Understand the repository before changing it. Inspect existing documentation, source, tests, configuration, and current behavior. Reuse working code where appropriate. Do not recreate the project blindly.

## 2. Phase 1 scope

Build:

- text/code task input
- task classification
- workload profiling
- provider/model registry
- capability/context filtering
- Draft/Balanced/Premium routing
- provider adapters
- key management
- bounded retry/failover
- execution
- usage telemetry
- minimal mobile-first UI
- automated tests

Do not spend Phase 1 on full camera, QR, PDF, image, audio/video, NPU, Office Kit, advanced dashboard, CLI, SDK, browser extension, billing, or accounts. Create extension points for Phase 2.

## 3. Core pipeline

```text
TASK → CLASSIFY → PROFILE → FILTER → SCORE → ROUTE → EXECUTE → FAILOVER → RESULT → TELEMETRY
```

Do not bypass the architecture for convenience.

## 4. Mobile-first

Design first for 360px, 390px, and 430px widths. The critical Task → Profile → Route → Result flow must work from a phone. Do not build desktop-first.

## 5. Routing

Routing has two stages:

1. Hard filtering for modality/capability, context, key availability, and health.
2. Scoring based on quality, efficiency, latency, quota, and reliability.

Weights must be configurable. Every route must include human-readable reasons.

## 6. Profiling

Keep profiling independent from providers. Use configurable heuristics and return best, expected, worst, context, and confidence. Never represent heuristics as exact billing.

## 7. Provider abstraction

Provider-specific HTTP/auth/request/response behavior belongs inside adapters. The router must operate on normalized provider/model metadata.

## 8. Key security

Never log, commit, print, or expose raw keys. Keys must carry provider, priority, health, quota, and capability metadata.

## 9. Failover

Classify provider failures. Retry only transient/recoverable errors. Rotate keys, then provider fallbacks where appropriate. Bound retries. Never loop indefinitely.

## 10. Testing

Build tests alongside the implementation.

Required unit coverage:
- classifier
- profiler
- filtering
- scoring
- key selection
- retry/failover

Required integration/E2E coverage:
- classify → profile → route → execute → result
- provider failure → fallback → success

Use deterministic mock providers for routing/failover tests so the core does not depend on external API availability.

## 11. Self-review loop

After every major feature:

```text
IMPLEMENT → TEST → INSPECT → FIND PROBLEMS → FIX → TEST AGAIN
```

Do not consider a feature complete merely because the application compiles or loads.

## 12. No fabrication

Never fabricate provider capabilities, quotas, token usage, benchmarks, device capabilities, or execution results. Clearly distinguish real, estimated, and mocked values.

## 13. Scope discipline

If a future feature is not required for Phase 1, create the correct abstraction/extension point but do not build the full feature.

## 14. Definition of done

Phase 1 is done only when classification, profiling, registry, filtering, routing strategies, adapters, execution, key management, failover, telemetry, mobile UI, tests, and E2E behavior all work together.
