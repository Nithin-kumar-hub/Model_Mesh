# ModelMesh

**An AI workload planner and orchestrator — not a model router.**

ModelMesh takes one request, understands it, breaks it into a dependency graph of
subtasks, gives each subtask only the slice of context it actually needs, routes
each one to the model best suited to it by *capability*, runs the independent ones
concurrently, recovers from provider failures without killing the plan, then merges,
verifies, and reports what it really spent.

The difference from a router is where the intelligence sits. A router picks a model
and forwards a prompt. ModelMesh decides what the work *is*: a 42 KB Java file plus
"find the bugs" becomes a classified task, an enhanced specification, a five-node
DAG, three costed candidate plans, four subtasks running in parallel on different
models with ~6.7 K tokens of relevant context each instead of ~12.8 K of everything,
a synthesis pass over their results, and a verification pass triggered by the
confidence score rather than by a checkbox.

Two deployables: a Node/TypeScript backend (`apps/api`) that owns the pipeline, and
an Android app (`apps/android`) that is the multimodal front door — camera, PDF,
audio, share-sheet — and does its OCR on device so a 4 MB scan travels as a few KB
of text.

---

## Status — what is actually built

| Part | State | Verified how |
|---|---|---|
| Backend pipeline (`apps/api`, 59 TS files) | complete | `pnpm --filter @modelmesh/api test` → **192 tests, 11 files, all passing**; `typecheck` and `build` clean |
| Shared types (`packages/types`, 8 files) | complete | consumed by the API as a composite project reference |
| Android data layer, DI, on-device preprocessing (38 Kotlin files) | complete | static validation only — see the warning below |
| Android JVM unit tests (6 files) | written | **never executed** — no Android toolchain in the authoring environment |
| Android UI (`ui/`, `res/`, `MainActivity`) | in progress on a parallel track | — |
| `scripts/` | complete | `bash -n`, standalone `tsc --noEmit` |

> **The Android app has never been compiled.** The environment that wrote it has no
> Android SDK, no Gradle, and no JDK 17. Nothing here claims otherwise. Anything
> beyond "the sources are internally consistent" needs a real build on a machine
> with the toolchain.

---

## Architecture

### Backend pipeline

```
request
  ├─ safety            sanitize the directive channel, neutralize untrusted content
  ├─ classify          rule table first; an LLM only when rules are unsure
  ├─ enhance           split intent from material, restate goal/constraints/edge cases
  ├─ optimize (global) compress the master context, code blocks preserved verbatim
  ├─ decompose         → DAG of subtasks with explicit dependencies
  ├─ profile           per-node token + latency estimates, corrected by calibration
  ├─ slice             per-node context: only the sections that node needs
  ├─ plan              three candidate plans (draft / balanced / premium), costed
  ├─ schedule          Kahn parallel groups; concurrent within a group
  ├─ route             capability match → ranked models → first with an available key
  ├─ execute           provider call, cache check, confidence inference
  ├─ recover           retry / rotate key / swap model / skip / re-plan
  ├─ aggregate         collect, dedupe findings, detect contradictions, synthesize
  ├─ verify            critic + structural consistency, gated on confidence
  └─ telemetry         actuals vs estimates → calibration multipliers
```

Every stage emits a trace event, so the Android execution screen can render the
pipeline as it happens rather than showing a spinner.

### Android app

```
ui/            Compose screens: multimodal input → execution trace → result
domain/        eight use cases + two ports (TaskRepository, AttachmentPreprocessor)
data/
  api/         Retrofit + Socket.io client + DTO mappers
  local/       Room: one `tasks` table, JSON columns for plan/subtasks/telemetry
  preprocess/  ML Kit OCR, barcode, language id; PdfRenderer; device capabilities
  repository/  offline-first TaskRepositoryImpl
  work/        WorkManager sync for tasks the app never saw finish
di/            Hilt modules (network, database, repository, work)
```

**Offline-first is the read path, not a feature.** Every `observe*` flow is a Room
flow; the network read is a side effect that writes to Room, and Room re-emits. A
screen renders with the radio off and updates when the backend answers.

### The six rules

1. **Never send the full context to every model.** Per-subtask slicing. Measured and
   surfaced (`contextReductionPercent`), never estimated optimistically.
2. **A DAG, not a list.** Decomposition produces explicit dependencies and parallel
   batches; the app draws the batches.
3. **Capability-based routing.** The app never names a model. It may express a budget
   and a "prefer on-device" hint; the backend chooses.
4. **Every estimate gets calibrated.** Actuals feed EWMA multipliers per task type
   and role; user ratings feed the same loop.
5. **Confidence drives compute.** Confidence is inferred from output patterns, not
   self-reported, and it decides whether verification runs.
6. **User intent stays separate from untrusted content.** The typed instruction is the
   only thing in the directive channel; OCR text, PDF text, and file contents travel
   as material and are delimiter-escaped server-side. Enforced on both sides —
   `SubmitTaskUseCase` is the only place a submission is assembled, and the prompt
   builder keeps the two in separate blocks.

**Truthful telemetry** is treated as part of the architecture: savings are computed
only over subtasks that actually produced a result, `partial` is never hidden, and a
failed or skipped subtask is always reported.

---

## Layout

```
Model_Mesh/
├── apps/
│   ├── api/                       Node 20 + Fastify + Socket.io backend
│   │   ├── src/
│   │   │   ├── core/              pipeline, intelligence, orchestrator, optimizer,
│   │   │   │                      providers, aggregator, verifier, cache, telemetry
│   │   │   ├── keys/              multi-key manager + quota-aware rotator
│   │   │   ├── api/               routes + auth/rate-limit/safety middleware
│   │   │   ├── infra/             store, persistence, crypto, text, logger
│   │   │   └── jobs/              BullMQ queue + worker (in-process fallback)
│   │   ├── prisma/schema.prisma
│   │   └── tests/                 11 files, 192 tests
│   └── android/                   Kotlin + Compose app (JVM 17, minSdk 26)
├── packages/types/                shared TypeScript contract
├── scripts/                       setup.sh, seed-keys.ts, test-providers.ts
├── docker-compose.yml             Postgres 15 + Redis 7 (both optional)
└── .claude/                       specs, state, per-track plans and reports
```

---

## Prerequisites

| For | Need |
|---|---|
| Backend | Node ≥ 20, pnpm ≥ 11 (`corepack prepare pnpm@11.23.0 --activate`) |
| Backend, full stack | Postgres 15 and Redis 7 — **optional**, `docker compose up -d` |
| Android | JDK 17, Android SDK 35, Android Studio Ladybug or newer (AGP 8.7.3, Gradle 8.11.1) |
| AI providers | nothing — the mock provider runs the whole pipeline offline |

Postgres, Redis, and API keys are all genuinely optional: `PERSISTENCE=auto` and
`CACHE_BACKEND=auto` fall back to in-process implementations, and with no keys the
backend enables a deterministic mock provider. The full 15-stage pipeline is
demoable on a laptop with nothing installed but Node.

---

## Quick start

```bash
./scripts/setup.sh                        # checks tools, installs, generates Prisma, runs the backend tests
pnpm --filter @modelmesh/api dev          # http://localhost:3000 — API under /api/v1
./scripts/test-providers.ts               # end-to-end smoke test, prints the plan and the real token accounting
```

Optional:

```bash
docker compose up -d                      # Postgres + Redis, if you want the real datastores
pnpm run seed                             # register provider keys from .env (idempotent; no keys needed)
```

Android:

```bash
cd apps/android
gradle wrapper --gradle-version 8.11.1    # gradlew and gradle-wrapper.jar are binaries and are not committed
./gradlew :app:assembleDebug
```

`assembleDebug` needs the UI track's `res/` and `MainActivity.kt` — the frozen
manifest already references `@string/app_name`, `@style/Theme.ModelMesh`,
`@xml/network_security_config`, and `.MainActivity`, so the build fails until those
land. `./gradlew :app:testDebugUnitTest` needs them too, because it runs resource
processing first. The JVM tests themselves need no device or emulator — the one
Android framework call they reach (`android.util.Log` inside the repository) is
covered by `testOptions { unitTests.isReturnDefaultValues = true }`.

Point the app at a backend via `apps/android/local.properties` (never committed):

```properties
MODELMESH_API_BASE_URL=http://10.0.2.2:3000/api/v1/
MODELMESH_WS_BASE_URL=http://10.0.2.2:3000
MODELMESH_API_KEY=dev-secret-change-me
```

`10.0.2.2` is the emulator's alias for the host. A physical device needs your LAN IP
in both URLs **and** in `res/xml/network_security_config.xml`, which is what permits
cleartext for dev hosts only.

---

## Tests

```bash
pnpm --filter @modelmesh/api test         # 192 tests, 11 files
pnpm --filter @modelmesh/api typecheck
pnpm --filter @modelmesh/api build
```

What the backend suite covers:

| File | Covers |
|---|---|
| `unit/dag.test.ts` | cycle detection, parallel groups, dependency validation with known ids |
| `unit/scheduler.test.ts` | group execution, degraded dependencies, re-planning, failure records surviving a re-plan |
| `unit/optimizer.test.ts` | token passes, fenced-code preservation, context slicing |
| `unit/profiler.test.ts` | estimates and the naive baseline |
| `unit/calibration.test.ts` | EWMA multipliers and clamping |
| `unit/keys.test.ts` | health scoring, 429 rotation, quota exhaustion, masked display |
| `unit/classifier.test.ts` | rule table, modality evidence, complexity |
| `unit/safety.test.ts` | injection scoring of the directive channel, neutralizing untrusted content |
| `unit/mock-provider.test.ts` | determinism, role-shaped JSON, failure injection |
| `integration/tasks.test.ts` | `POST /tasks` end to end, strategy differences, a hostile document being analyzed rather than obeyed |
| `integration/telemetry-honesty.test.ts` | savings counted only for subtasks that ran |

Android JVM tests live in `apps/android/app/src/test/kotlin/` (Room converter
round-trips, the Rule 6 separation in `SubmitTaskUseCase`, `AppResult`, the trace
timeline fold, repository offline-first/polling-fallback behaviour, and the
`explicitNulls = false` wire contract). They run with
`./gradlew :app:testDebugUnitTest` once a toolchain exists — **they have not been
run yet**.

---

## Environment

All of these have working defaults; `.env.example` is the reference and
`apps/api/src/config.ts` is the only thing that reads `process.env`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT`, `HOST` | `3000`, `0.0.0.0` | HTTP listener |
| `NODE_ENV`, `LOG_LEVEL` | `development`, `info` | |
| `API_SECRET` | `dev-secret-change-me` | `X-API-Key` for every REST call and the socket handshake |
| `KEY_ENCRYPTION_SECRET` | dev value | AES-256-GCM key-at-rest encryption |
| `DATABASE_URL` | — | Postgres; empty is fine |
| `REDIS_URL` | — | Redis; empty is fine |
| `PERSISTENCE` | `auto` | `auto` \| `prisma` \| `memory` |
| `CACHE_BACKEND` | `auto` | `auto` \| `redis` \| `memory` |
| `GEMINI_API_KEYS` … `OPENROUTER_API_KEYS` | empty | comma-separated, multiple keys per provider |
| `ENABLE_MOCK_PROVIDER` | `true` | auto-enables anyway when no real key exists |
| `ENABLE_SEMANTIC_CACHE`, `ENABLE_PARALLEL_EXECUTION`, `ENABLE_VERIFICATION`, `ENABLE_QUEUE` | `true` | feature flags |
| `MAX_PARALLEL_SUBTASKS` | `4` | width of a parallel batch |
| `DEFAULT_STRATEGY` | `balanced` | `draft` \| `balanced` \| `premium` |
| `TASK_TIMEOUT_MS`, `PROVIDER_TIMEOUT_MS` | `60000`, `45000` | |
| `MAX_FILE_BYTES`, `MAX_ATTEMPTS_PER_SUBTASK` | `20971520`, `3` | |
| `CACHE_TTL_DEFAULT_SECONDS`, `CACHE_TTL_DOCUMENT_SECONDS` | `3600`, `86400` | |
| `RATE_LIMIT_TASKS_PER_MIN`, `RATE_LIMIT_READS_PER_MIN` | `10`, `60` | per API key |

---

## API

Base path `/api/v1`, `X-API-Key` on every call.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/tasks` | → `202 {taskId, status, websocketRoom, estimatedMs, executionMode, createdAt}` |
| `GET` | `/tasks/:taskId` | full snapshot: result, plan, subtasks, verification, telemetry |
| `GET` | `/tasks/:taskId/trace` | `{taskId, status, events[]}` — the polling fallback source |
| `GET` | `/tasks/:taskId/events` | SSE mirror of the socket |
| `GET` | `/tasks?limit=` | 1–100, default 20 |
| `POST` | `/tasks/:taskId/feedback` | `{rating: 1..5, comment?, actualQuality?}` → calibration |
| `GET` | `/providers/status`, `/providers/models`, `/providers/keys` | |
| `POST` | `/providers/keys` | register a key; de-duplicated by hash |
| `GET` | `/telemetry/stats?days=`, `/telemetry/calibration` | |
| `GET` | `/health`, `/ready` | unauthenticated |

The `POST /tasks` body is validated by a Zod schema that is `.strict()` at every
level: unknown fields are rejected, and an explicit `null` for an optional field is
rejected too — which is why the Android `Json` instance is configured
`explicitNulls = false`. Max 10 files, 20 MB each. A MIME type outside `image/*`,
`application/pdf`, `audio/*`, `text/*` is rejected unless the file carries
`metadata.detectedText`, which is exactly why on-device OCR exists.

### Socket.io

Path `/ws`, handshake `auth.apiKey`, optional `taskId` query to auto-join. The client
emits `subscribe`/`unsubscribe`; the server replays `trace_history` on join and then
streams `trace`. Max 5 concurrent connections per key. When the socket cannot be
established, the app polls `/tasks/:id/trace` and says **"Polling (no live socket)"**
rather than claiming to be live.

---

## Android app

The data layer described below is implemented. The three screens — **multimodal
input**, **execution trace**, and **result** — are the UI track's work and are *not*
in this branch yet; the use cases, DTOs, socket client, Room cache, and Hilt graph
they consume are.

On-device work before anything is uploaded:

| Input | On device | On the wire |
|---|---|---|
| Image | ML Kit OCR + barcode + dimensions | base64 (a vision model reads pixels) plus the extracted text |
| PDF | `PdfRenderer` → bitmap → OCR per page, capped at 20 pages with an explicit truncation marker | **text only** — the whole point |
| Text file | read as UTF-8 | text only |
| Audio / video | duration via `MediaMetadataRetriever` | metadata only; this backend has no transcription adapter |

Device hints (model name, battery, Wi-Fi, declared NPU) are attached as *hints*. An
unknown capability is reported as `null`, never as `false` — a fabricated `true`
would corrupt a routing decision, while a `null` costs nothing.

---

## Contributing

`.claude/CLAUDE.md` is the controller for automated work: smallest correct change,
narrowest meaningful validation, no unrelated refactors, frozen contracts stay
frozen. `.claude/state/FILE-OWNERSHIP.md` records the boundary between the two
parallel Android tracks, and `.claude/IMPLEMENTATION-NOTES.md` records every
deviation from the specification along with why.

## License

Not yet chosen. Built for the iQOO AI Hackathon.
