# ModelMesh — Complete Project Roadmap

**Project:** ModelMesh  
**Hackathon:** iQOO City Battle 2026 — Bengaluru  
**Development Strategy:** Phase 1 — Core Project → Phase 2 — Onsite Execution  
**Primary Platform:** Mobile-first Android PWA  

## 1. Vision

ModelMesh is a phone-first AI workload routing system. The core flow is:

```text
Task Input
  ↓
Task Classification
  ↓
Workload Profiling
  ↓
Provider Capability Filtering
  ↓
Route Scoring
  ↓
Best Route Selection
  ↓
Provider Execution
  ↓
Failure Recovery / Failover
  ↓
Result + Usage Telemetry
```

The project is intentionally split into two phases:

```text
PHASE 1 — CORE PROJECT
    ↓
Working architecture + routing engine + profiler + mobile MVP + tests
    ↓
Submission / selection
    ↓
PHASE 2 — ONSITE EXECUTION
    ↓
Multimodal expansion + iQOO device features + on-device AI + Office Kit + polish
    ↓
FINAL HACKATHON PRODUCT
```

## 2. Why Two Phases?

The first-round submission asks teams to show a progression from **Idea → Thought Process → Architecture → MVP → Why Your Team → What You’ll Build in 30 Hours**. ModelMesh should therefore arrive at the hackathon with its core intelligence already working. The onsite 30 hours should be used to extend and harden that foundation instead of inventing the architecture under time pressure.

## 3. Phase 1 — Core Project

### Objective

Prove the central ModelMesh thesis:

> ModelMesh understands an AI workload, estimates its requirements, compares compatible execution routes, chooses the best route for the user's strategy, executes it, and can recover from provider/key failures.

### Phase 1 scope

- Text tasks
- Code tasks
- Task classification
- Workload profiling
- Provider/model registry
- Capability and context filtering
- Draft / Balanced / Premium routing
- Provider adapters
- Key management
- Retry and failover
- Usage/telemetry
- Minimal mobile-first UI
- Automated tests

### Phase 1 non-goals

- Full camera UX
- QR scanning
- Full PDF/image/audio/video pipelines
- Complete NPU integration
- Office Kit integration
- Advanced dashboard
- CLI / SDK / browser extension
- Billing / subscriptions / accounts

Phase 1 should create clean extension points for those features.

## 4. Phase 1 Architecture

```text
Mobile PWA
   ↓
Task Composer
   ↓
Task Classifier
   ↓
Workload Profiler
   ↓
Provider Registry
   ↓
Capability Filter
   ↓
Routing Engine
   ↓
Key Manager
   ↓
Execution Engine
   ↓
Provider Adapters
   ↓
AI Providers
   ↓
Result + Telemetry
```

## 5. Phase 1 Milestones

### M1 — Repository foundation

Set up project structure, tooling, environment configuration, linting, formatting, typing, testing, and documentation.

### M2 — Domain models

Implement Task, Classification, WorkloadProfile, Provider, Model, Key, Route, Execution, and Usage entities.

### M3 — Task classifier

Implement deterministic modality/task-type/complexity detection with confidence.

### M4 — Workload profiler

Implement configurable input/output estimation, best/expected/worst range, context requirement, and confidence.

### M5 — Provider registry

Externalize provider/model capabilities, context, quality, cost, latency, and health metadata.

### M6 — Router

Implement capability filtering followed by strategy scoring for Draft, Balanced, and Premium.

### M7 — Execution engine

Implement normalized provider adapters, execution lifecycle, timeouts, and error normalization.

### M8 — Key manager and failover

Implement priority, status, quota state, retry, rotation, and provider fallback.

### M9 — Mobile MVP

Implement Task → Profile → Recommendation → Result.

### M10 — Validation

Run unit, integration, E2E, failure, mobile viewport, and real-device sanity tests.

## 6. Phase 1 Submission Evidence

Prepare:

- Working mobile MVP
- Clean GitHub repository
- README and setup instructions
- Architecture diagram
- Routing/profiler demonstration
- Failover demonstration
- Screenshots
- Short demo video
- Test evidence

## 7. Phase 1 Exit Gate

```text
[ ] Classification works
[ ] Profiling works
[ ] Provider registry works
[ ] Filtering works
[ ] Draft/Balanced/Premium work
[ ] Provider adapters work
[ ] Execution works
[ ] Key management works
[ ] Failover works
[ ] Telemetry works
[ ] Mobile UI works
[ ] Tests pass
[ ] End-to-end flow passes
[ ] Real phone sanity test completed
[ ] Submission evidence prepared
```

## 8. Phase 2 — Onsite Execution

### Objective

Turn the Phase 1 core into the complete iQOO hackathon product during the 30-hour onsite build.

Do not redesign the core. Extend it.

### Phase 2 expansion

#### Multimodal routing

- PDF/document
- Image/photo
- Audio
- Video
- Research
- Writing/content

#### Phone-native input

- Camera capture
- Microphone/voice input
- QR key scanning
- Direct file workflows

#### Local processing

- Image dimensions and preprocessing
- PDF page analysis
- Audio duration
- Local file analysis

#### On-device AI

Use a capability-detected hierarchy:

```text
Local rules
  ↓
On-device model (when actually available)
  ↓
Cloud fallback
```

Never claim on-device execution unless it is verified on the target device.

#### Key Vault UX

- QR scanning
- Capability tags
- Health status
- Automatic rotation visualization

#### Dashboard

- Usage
- Quota
- Burn rate
- Routing distribution
- Savings
- Failovers
- On-device routing metrics

#### Office Kit

Use it as meaningful infrastructure and workflow integration, not as decoration.

## 9. Suggested 30-Hour Phase 2 Plan

### Hour 0–2

Stabilize Phase 1. Verify the core on the target iQOO device.

### Hour 2–5

Camera, microphone, file picker, QR workflows.

### Hour 5–9

PDF/image/audio/video metadata profiling.

### Hour 9–13

Multimodal routing expansion.

### Hour 13–17

Key vault UX and automatic rotation.

### Hour 17–21

On-device/local processing path and device verification.

### Hour 21–24

Dashboard and telemetry.

### Hour 24–27

Full E2E tests on the iQOO phone.

### Hour 27–29

Demo hardening and feature cuts.

### Hour 29–30

Pitch, recording, GitHub, architecture, and final dry run.

## 10. Phase 2 Exit Gate

```text
[ ] Phase 1 core stable
[ ] Multimodal tasks work
[ ] Camera works
[ ] Voice works
[ ] File workflows work
[ ] QR key workflow works
[ ] Multimodal routing works
[ ] Automatic failover works
[ ] Local processing works
[ ] Verified on-device path works where supported
[ ] Dashboard works
[ ] Office Kit meaningfully integrated
[ ] Full demo works
[ ] Demo fallback exists
```

## 11. Golden Rule

If a Phase 2 feature threatens Phase 1 stability:

```text
CUT FEATURE
   ↓
KEEP CORE STABLE
   ↓
POLISH WORKING FEATURES
```

The final product should feel like one coherent routing system, not a collection of unrelated demonstrations.
