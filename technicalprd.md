# ModelMesh — Phase 1 Technical Product Requirements

## 1. Technical goal

Build the reusable routing engine that becomes the intelligence layer of the complete ModelMesh product.

The architecture must later support vision, PDF, audio, video, research, writing, camera, voice, and on-device AI without replacing the core.

## 2. Reference architecture

```text
Mobile PWA
    ↓
Task Composer
    ↓
Task/API Service
    ↓
┌────────────┬──────────────┬─────────────┐
↓            ↓              ↓
Classifier   Profiler       Provider DB
└────────────┴──────────────┴─────────────┘
                ↓
           Router Engine
                ↓
          Key Manager
                ↓
        Execution Engine
                ↓
         Provider Adapters
                ↓
            Providers
                ↓
        Result + Telemetry
```

## 3. Technology baseline

Use existing repository choices where already established. Otherwise prefer:

Frontend: React, TypeScript, Tailwind CSS, Vite, PWA-friendly architecture.

Backend: Python, FastAPI, Pydantic, async HTTP client.

Testing: Pytest, HTTPX, Vitest, React Testing Library, Playwright.

Avoid unnecessary infrastructure.

## 4. Domain layer

Create explicit types for:

- Task
- Classification
- WorkloadProfile
- Provider
- Model
- Key
- Route
- Execution
- Usage

Avoid generic untyped payloads across the domain.

## 5. Classifier

Expose a classifier interface. Phase 1 can use deterministic rules. Future implementations may add on-device and cloud classifiers. The router must not depend on a specific classifier implementation.

## 6. Profiler

Expose a profiler interface independent of providers. Keep estimation logic modular so future TextProfiler, CodeProfiler, ImageProfiler, PdfProfiler, AudioProfiler, and VideoProfiler implementations can be added without changing router internals.

## 7. Provider registry

Provider/model metadata must be data-driven and include:

- provider
- model
- supported modalities
- context window
- quality
- cost/efficiency
- latency
- reliability
- availability/health

Do not scatter provider-specific constants through application logic.

## 8. Router

```text
classify
 ↓
load providers
 ↓
capability filter
 ↓
context filter
 ↓
key availability
 ↓
score candidates
 ↓
rank candidates
 ↓
select primary + fallbacks
```

Provide a clean `route(task, profile, strategy)` interface.

## 9. Scoring

Keep scoring separate from routing. Use configurable weights for quality, efficiency, latency, quota, and reliability. Do not bury strategy weights in UI or provider adapter code.

## 10. Key manager

Expose operations for compatible keys, key selection, rate-limit marking, exhaustion marking, and disabling. Key capability metadata must support future modalities.

## 11. Execution engine

The execution engine should:

1. receive a route,
2. acquire a compatible key,
3. invoke a provider adapter,
4. normalize the result,
5. record latency/usage,
6. classify errors,
7. retry or failover when allowed,
8. return an execution result.

The API layer must remain thin.

## 12. Provider adapters

Use a common provider contract. Build deterministic mock adapters first so routing and failover are testable without external APIs. Add real adapters after the abstraction is stable.

## 13. Error model

Normalize external failures into internal categories such as RATE_LIMITED, QUOTA_EXHAUSTED, INVALID_KEY, CONTEXT_TOO_LARGE, TIMEOUT, UNAVAILABLE, BAD_REQUEST, and UNKNOWN. The execution engine decides whether a normalized error is retryable.

## 14. Telemetry

Record per execution:

- task_id
- provider
- model
- strategy
- estimated usage
- actual usage
- latency
- status
- retry count
- failover count
- classification source

Never record raw secrets or private content unless explicitly required.

## 15. API

Required:

```text
POST /classify
POST /profile
POST /route
POST /execute
```

Optional:

```text
GET /providers
GET /health
```

Controllers should call application services rather than contain business logic.

## 16. Frontend architecture

Feature-based structure:

```text
features/
  task/
  profile/
  route/
  execution/
```

Reusable UI components should include TaskComposer, StrategySelector, ProfileSummary, ConfidenceBand, ProviderCard, RouteExplanation, ExecutionStatus, and ResultView.

## 17. State management

Use explicit lifecycle states:

```text
IDLE
INPUT_READY
CLASSIFYING
PROFILE_READY
ROUTING
READY_TO_EXECUTE
EXECUTING
RECOVERING
COMPLETED
ERROR
```

Avoid many independent booleans describing the same lifecycle.

## 18. Mobile technical requirements

Verify 360×800, 390×844, and 430×932. Critical interactions must not require hover, large screens, keyboard shortcuts, or horizontal scrolling.

## 19. Performance

Keep the initial shell light, make API work asynchronous, bound retries, cache provider metadata where appropriate, and avoid blocking the browser during profiling.

## 20. Security

Validate API input, redact secrets, avoid secret URLs, do not expose credentials unnecessarily to the browser, and prepare the architecture for secure server-side secret management in production.

## 21. Testing architecture

### Unit

Classifier, profiler, filtering, scoring, key selection, retry/failover.

### Integration

Classifier + profiler + registry + router + key manager + executor.

### E2E

Mobile UI → API → router → mock provider → result.

### Failure tests

Rate limit, quota exhaustion, timeout, invalid key, provider unavailable, and no-fallback conditions.

## 22. Phase 1 technical exit gate

```text
CORE ENGINE       ✓
ROUTER            ✓
PROFILER          ✓
PROVIDER LAYER    ✓
KEY MANAGER       ✓
FAILOVER          ✓
API               ✓
MOBILE UI         ✓
AUTOMATED TESTS   ✓
REAL DEVICE CHECK ✓
```
