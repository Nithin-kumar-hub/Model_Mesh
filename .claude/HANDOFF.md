# ModelMesh — Parallel Build Handoff

> **Purpose of this file.** The project is finished except for the Android app's
> upper layers and the repo-level scripts/docs. That remainder has been split into
> **two file-disjoint tracks** so two Claude Opus sessions can run at the same time
> and merge without conflicts.
>
> **Read this file first, then read only your track's file.**
> - Track A → [`TRACK-A-DATA-LAYER.md`](./TRACK-A-DATA-LAYER.md)
> - Track B → [`TRACK-B-UI-LAYER.md`](./TRACK-B-UI-LAYER.md)
>
> `CLAUDE.md` in this directory remains the authoritative project specification.
> This file does not replace it; it records what is already built, what is frozen,
> and who owns what.

Last updated: 2026-08-25.

---

## 1. What ModelMesh is

An AI **workload planner and orchestrator** — not a model router. A request is
classified, enhanced, token-optimized, decomposed into a DAG of subtasks, each
subtask routed by capability to a different model and given only the context slice
it needs, executed in parallel where the DAG allows, recovered/re-planned on
failure, then aggregated and verified. Estimates are calibrated against actuals
over time. See `CLAUDE.md` §1 and `01-ARCHITECTURE.md`.

Android app (`apps/android`) + Node/TypeScript backend (`apps/api`), pnpm +
Turborepo monorepo.

---

## 2. Current state — verified, not assumed

### Backend (`apps/api`) — COMPLETE
- 62 TypeScript source files across the full 15-stage pipeline.
- **192 tests pass** across 12 files (`tests/unit/*` ×10, `tests/integration/*` ×2).
- `pnpm run typecheck` clean; `pnpm run build` clean.
- The compiled `dist/server.js` was launched and served `/health`, `/ready`
  (memory/memory/inline/mock) and a 202 on `POST /tasks`.
- Runs fully offline: `MemoryStore` + `MemoryPersistence` + `MockProvider`, with
  deterministic failure injection via `MOCK_FAILURE_RATE`.
- Telemetry honesty was the last bug fixed and is covered by a regression test:
  `buildTelemetry()` in `src/core/pipeline.ts` counts **only nodes that produced a
  result** toward the naive baseline. Verified end-to-end — a run with
  `MOCK_FAILURE_RATE=0.35` reported `replans: 1`, three failed subtasks,
  `partial: true`, and 49.29% savings for 2 executed nodes instead of the 79.64%
  the old code would have claimed.
- Mutation testing confirmed three regression tests actually bite: reintroducing
  `failed.clear()`, dropping `knownIds` from `DAG.validate`, and reverting
  `executedNodes` → `plan.nodes` each failed exactly the intended assertion.

**Do not rewrite backend source or tests.** Only Track A touches `apps/api`, and
only to add `scripts/` entry points that call into it.

### Android (`apps/android`) — PARTIAL
Complete and **frozen**: Gradle config, version catalog, manifest, error type, all
data models, all DTOs + mappers, Retrofit interface, API-key interceptor, trace
event mapper, Socket.io client, the repository interface, the preprocessing port,
and all eight use cases (§5).

Missing — the two tracks: Room, on-device preprocessing, repository
implementation, Hilt modules, `Application`, `MainActivity`, theme, navigation,
components, the three screens, and `res/`.

### Repo level — NOT STARTED
`scripts/setup.sh`, `scripts/seed-keys.ts`, `scripts/test-providers.ts`,
`README.md`, `.claude/IMPLEMENTATION-NOTES.md`. All Track A.

---

## 3. Environment reality — read before you claim anything

The session that produced this repo had:

| Tool | Status |
|---|---|
| Node 24, pnpm 11.23.0 | present — backend fully buildable and testable |
| `ANDROID_HOME` / Android SDK | **absent** |
| `gradle` / `gradlew` | **absent** (no wrapper JAR in the repo) |
| `kotlinc`, `ktlint` | **absent** |
| JDK | 21 and 11 only; the project requires **17** |

**Therefore: never claim the Android app compiles.** Say exactly what was run.
If your environment *does* have the Android SDK, Gradle, and JDK 17, then run
`./gradlew :app:assembleDebug` and report the real result — that is strictly
better, and it is the main reason to hand a track to a machine that has them.

`apps/android/gradle/wrapper/gradle-wrapper.properties` is committed (Gradle
8.11.1, which AGP 8.7.3 requires). `gradle-wrapper.jar` and `gradlew` are **not** —
they are binaries that cannot be authored as text. Generate them once with
`gradle wrapper --gradle-version 8.11.1` in `apps/android`, or just open the
project in Android Studio, which writes them for you.

---

## 4. The split — file ownership is absolute

Each track creates only files under the paths it owns. **Never create, edit, or
delete a file owned by the other track**, even if it looks broken or missing.
That is the whole reason the merge is clean.

### Track A — data, domain implementation, DI, scripts, docs
```
apps/android/app/src/main/kotlin/com/modelmesh/ModelMeshApplication.kt
apps/android/app/src/main/kotlin/com/modelmesh/data/local/**
apps/android/app/src/main/kotlin/com/modelmesh/data/preprocess/**
apps/android/app/src/main/kotlin/com/modelmesh/data/repository/**
apps/android/app/src/main/kotlin/com/modelmesh/data/work/**
apps/android/app/src/main/kotlin/com/modelmesh/di/**
apps/android/app/proguard-rules.pro
apps/android/app/src/test/kotlin/**
scripts/**
README.md
.claude/IMPLEMENTATION-NOTES.md
.claude/TRACK-A-REPORT.md
```

### Track B — UI
```
apps/android/app/src/main/kotlin/com/modelmesh/MainActivity.kt
apps/android/app/src/main/kotlin/com/modelmesh/ui/**
apps/android/app/src/main/res/**
apps/android/app/src/androidTest/kotlin/**
.claude/TRACK-B-REPORT.md
.claude/TRACK-B-CONTRACT-REQUESTS.md
```

### Frozen — neither track modifies
```
apps/api/**                       (except: Track A adds scripts that import from it)
apps/android/build.gradle.kts
apps/android/settings.gradle.kts
apps/android/gradle.properties
apps/android/gradle/**
apps/android/app/build.gradle.kts
apps/android/app/src/main/AndroidManifest.xml
apps/android/app/src/main/kotlin/com/modelmesh/util/**
apps/android/app/src/main/kotlin/com/modelmesh/data/models/**
apps/android/app/src/main/kotlin/com/modelmesh/data/api/**
apps/android/app/src/main/kotlin/com/modelmesh/domain/repository/**
apps/android/app/src/main/kotlin/com/modelmesh/domain/preprocess/**
apps/android/app/src/main/kotlin/com/modelmesh/domain/usecases/**
.claude/*.md                      (except each track's own report file)
```

**If you believe a frozen file is genuinely wrong**, do not edit it.
- Track A may amend a frozen Android file if there is no alternative, and must
  record the change and its reason in `.claude/IMPLEMENTATION-NOTES.md`.
- Track B must instead append the request to
  `.claude/TRACK-B-CONTRACT-REQUESTS.md` and code around it. Track A is the
  tiebreaker on the shared contract, because every frozen type is a data-layer
  type.

### Git protocol
```
Track A → branch  track/a-data-layer
Track B → branch  track/b-ui-layer
```
Both branch from the same commit. Because the file sets are disjoint, `git merge`
should report no conflicts. Merge Track A first (it owns the DI graph that
Track B's ViewModels resolve through), then Track B. If a conflict does appear,
someone wrote outside their lane — resolve by reverting the out-of-lane edit, not
by hand-merging.

### Which track to take
Track A is heavier on cross-cutting correctness (Room schema, DI graph, ML Kit,
plus the TypeScript scripts). Track B is heavier on file count (theme, nav, six
components, three screens + ViewModels, all of `res/`). Either can go first; they
do not block each other, because §5 is already frozen in code.

---

## 5. The frozen contract — already written, code against it

These files exist in the repo **now**. Both tracks compile against them. Read them
before writing anything; the signatures below are for orientation, the files are
the truth.

### `util/AppResult.kt`
`AppResult.Success<T>(data)` | `AppResult.Failure(code: ErrorCode, message, cause)`,
plus `map / onSuccess / onFailure / getOrNull`.
`ErrorCode`: `INVALID_INPUT, UNSUPPORTED_MODALITY, FILE_TOO_LARGE, PROMPT_INJECTION,
TASK_NOT_FOUND, UNAUTHORIZED, RATE_LIMITED, NO_PROVIDERS_AVAILABLE, TIMEOUT,
OFFLINE, INTERNAL` with `ErrorCode.fromWire(String?)`.

### `data/models/` (all frozen)
| File | Types |
|---|---|
| `Enums.kt` | `ExecutionStrategy`, `TaskStatus`, `InputType`, `AgentRole`, `SubtaskStatus` — each with `wire` + `fromWire()` |
| `TaskSubmission.kt` | `TaskSubmission`, `Attachment`, `LocalMetadata`, `TaskBudget`, `TaskPreferences`, `TaskAccepted` |
| `TaskSnapshot.kt` | `TaskSnapshot` (+`unfinished`), `TaskOutput`, `PlanSummary` (+`widestBatch`), `SubtaskView`, `VerificationView`, `TelemetryView` (+`modelsUsed`, `hasTokenData`, `EMPTY`), `ProviderUsageView`, `TaskListItem`, `ProviderHealth` |
| `TraceEvent.kt` | `TraceEventName` (24 values, wire-exact with the backend), `TraceEvent` with loose `payload` accessors and a per-event `summary` |
| `ExecutionTimeline.kt` | `ExecutionTimeline` (folds events → `stages`, `subtasks`, `plan`, `contextSavings`, `outcome`), `PipelineStage`, `StageProgress`, `StageState`, `SubtaskProgress`, `PlanPreview`, `ContextSavings`, `RunOutcome` |
| `TraceStream.kt` | `TimelineUpdate(timeline, connection)`, `TraceConnection { CONNECTING, LIVE, RECONNECTING, POLLING, CLOSED }` |

### `data/api/` (all frozen)
`ModelMeshApi` (Retrofit, every method returns `Response<T>`), `ApiKeyInterceptor`
(needs `@Named("apiKey") String`), `TraceEventMapper` (REST `JsonObject` **and**
socket `org.json.JSONObject` → the same `TraceEvent`), `TraceSocketClient` (needs
`@Named("wsBaseUrl")` and `@Named("apiKey")`), and `dto/{Requests,Responses,Mappers}.kt`.

### `domain/repository/TaskRepository.kt`
```kotlin
suspend fun submit(submission: TaskSubmission): AppResult<TaskAccepted>
fun observeTask(taskId: String): Flow<TaskSnapshot?>
suspend fun refreshTask(taskId: String): AppResult<TaskSnapshot>
fun observeTimeline(taskId: String): Flow<TimelineUpdate>
fun observeHistory(limit: Int = DEFAULT_HISTORY_LIMIT): Flow<List<TaskListItem>>
suspend fun unfinishedTasks(): List<TaskListItem>
suspend fun submitFeedback(taskId: String, rating: Int, comment: String? = null): AppResult<Unit>
suspend fun providerHealth(): AppResult<List<ProviderHealth>>
// companion: const val DEFAULT_HISTORY_LIMIT = 50
```
Every `observe*` flow is **offline-first**: emit what Room holds, then emit again
after the network read.

### `domain/preprocess/AttachmentPreprocessor.kt`
```kotlin
interface AttachmentPreprocessor {
    suspend fun prepare(source: AttachmentSource): AppResult<PreparedAttachment>
    suspend fun deviceHints(): LocalMetadata
}
data class AttachmentSource(val uri: String, val mimeType: String, val displayName: String)
data class PreparedAttachment(val attachment: Attachment, val findings: LocalMetadata = LocalMetadata(), val sourceUri: String? = null)
fun LocalMetadata.mergedWith(other: LocalMetadata): LocalMetadata   // left wins
```
`uri` is a `String`, not `android.net.Uri`, so the domain layer stays platform-free.

### `domain/usecases/` — eight classes, all `@Inject constructor`
| Use case | Signature |
|---|---|
| `SubmitTaskUseCase` | `suspend (userIntent, attachments: List<PreparedAttachment> = [], strategy = BALANCED, budget: TaskBudget? = null, preferences = TaskPreferences(), sessionId: String? = null) → AppResult<TaskAccepted>` |
| `ObserveTaskUseCase` | `(taskId) → Flow<TaskSnapshot?>` |
| `GetTaskUseCase` | `suspend (taskId) → AppResult<TaskSnapshot>` (forced refresh) |
| `ObserveTraceUseCase` | `(taskId) → Flow<TimelineUpdate>` |
| `GetTaskHistoryUseCase` | `(limit = 50) → Flow<List<TaskListItem>>` |
| `RecoverUnfinishedTasksUseCase` | `suspend () → List<TaskListItem>` |
| `PreprocessAttachmentUseCase` | `suspend (uri, mimeType, displayName) → AppResult<PreparedAttachment>` |
| `SubmitFeedbackUseCase` | `suspend (taskId, rating, comment = null) → AppResult<Unit>` |

`SubmitTaskUseCase` derives `InputType` itself and merges per-file findings into
`localMetadata`. **A screen never builds a `TaskSubmission` by hand** — that is
where Rule 6 would get broken, so the assembly lives in one auditable place.

### Hilt bindings the graph requires
Track A must satisfy exactly these, and no ViewModel needs anything else:

| Requested by | Binding needed |
|---|---|
| `ApiKeyInterceptor`, `TraceSocketClient` | `@Named("apiKey") String` |
| `TraceSocketClient` | `@Named("wsBaseUrl") String` |
| Retrofit | `@Named("apiBaseUrl") String` (or inline `BuildConfig.API_BASE_URL`) |
| use cases | `TaskRepository` → `@Binds TaskRepositoryImpl` |
| `PreprocessAttachmentUseCase` | `AttachmentPreprocessor` → `@Binds OnDevicePreprocessor` |
| `TaskRepositoryImpl` | `ModelMeshApi`, `TraceSocketClient`, `TaskDao`, `AttachmentPreprocessor` |

`BuildConfig.API_BASE_URL` = `http://10.0.2.2:3000/api/v1/` (trailing slash
required by Retrofit), `BuildConfig.WS_BASE_URL` = `http://10.0.2.2:3000`,
`BuildConfig.API_KEY` = `dev-secret-change-me`. All three come from gradle
properties, overridable in `local.properties` — **never hard-code a key in
Kotlin.**

---

## 6. Verified backend contract — do not invent endpoints

Read from `apps/api/src` on 2026-08-25. Base path `/api/v1`.

| Method | Path | Notes |
|---|---|---|
| POST | `/tasks` | → **202** `{taskId, status, websocketRoom, estimatedMs, executionMode, createdAt}` |
| GET | `/tasks/:taskId` | full snapshot: `result`, `plan`, `subtasks[]`, `verification`, `telemetry` |
| GET | `/tasks/:taskId/trace` | `{taskId, status, events[]}`; each event is `{event, ts, ...payload}` |
| GET | `/tasks/:taskId/events` | SSE mirror of the socket |
| GET | `/tasks?limit=` | 1–100, default 20 |
| POST | `/tasks/:taskId/feedback` | `{rating: 1..5, comment?, actualQuality?}` |
| GET | `/providers/status`, `/providers/models`, `/providers/keys` | |
| POST | `/providers/keys` | |
| GET | `/telemetry/stats?days=`, `/telemetry/calibration` | |
| GET | `/health` (no prefix), `/ready` (no prefix), `/api/v1/health` | |

Auth: `X-API-Key` header on every REST call.

### Socket.io
Path `/ws`. Handshake `auth.apiKey` (the `x-api-key` header also works). Optional
query `taskId` auto-joins the room. Client emits `subscribe` / `unsubscribe` with
`{taskId}`. Server emits `trace_history` (`{taskId, events[]}`, replayed on join)
then `trace` (one event). **Max 5 concurrent connections per API key** — a screen
leaving composition must close its flow, which `TraceSocketClient` already handles
in `awaitClose`.

### `POST /tasks` request rules — these will 400 you if ignored
The Zod schema is `.strict()` at every level:
1. **Unknown fields are rejected.** Send only what `dto/Requests.kt` declares.
2. **Explicit `null` is rejected** where a field is `.optional()`. The Json
   instance therefore *must* be configured `explicitNulls = false`. This is not a
   style preference — `{"budget": null}` fails validation.
3. `input` must satisfy at least one of: non-blank `text`, ≥1 file, or
   `localMetadata.detectedText`.
4. `input.type` ∈ `text|code|image|pdf|audio|video|qr|multipart`. The backend
   derives real modalities from each file's MIME type and deliberately ignores
   `multipart` when doing so, so labelling a mixed submission `multipart` loses
   nothing.
5. Max **10 files**. Max **20 MB** per file (`MAX_FILE_BYTES`), measured from
   decoded base64 length or `metadata.sizeBytes`.
6. A MIME type outside `image/*`, `application/pdf`, `audio/*`, `text/*` is
   rejected as `UNSUPPORTED_MODALITY` **unless** the file carries
   `metadata.detectedText` — which is exactly why on-device OCR exists.
7. `text` ≤ 500 000 chars; `metadata.detectedText` ≤ 500 000;
   `localMetadata.detectedText` ≤ 200 000; `barcodeData` ≤ 8 000;
   `deviceModel` ≤ 120; `batteryLevel` 0–100.
8. `sessionId`, if sent, must be 4–120 chars.
9. The directive channel is injection-scanned server-side; a hostile *instruction*
   returns 400 `PROMPT_INJECTION` with `details.signals`. Hostile *document
   content* is accepted and neutralized instead — that asymmetry is Rule 6 and the
   UI must not "fix" it by refusing documents.

### Error envelope
`{"error": {"code", "message", "details"?}}` — map `code` through
`ErrorCode.fromWire`.

---

## 7. Architectural rules — non-negotiable

From `CLAUDE.md` §4. The backend enforces 1–5; the app must not undermine them,
and **Rule 6 is enforced on both sides**.

1. **Never send full context to every model.** Per-subtask context slicing. The app
   *displays* the saving (`ContextSavings`) and must never present the naive number
   as the real one.
2. **DAG, not list.** The app renders parallel groups and dependencies as a DAG,
   not a checklist.
3. **Capability-based routing.** The app never names a model. It may express
   `preferences.preferLocalModels` and a `budget`; the backend chooses.
4. **Every estimate gets calibrated.** Feedback and actuals feed the loop.
5. **Confidence drives compute.** The app surfaces confidence; it does not decide.
6. **User intent stays separate from untrusted content.** The typed instruction
   goes in `userIntent`. Extracted document/OCR text goes in
   `attachment.detectedText` / `localMetadata.detectedText`. **Never concatenate
   them, never paste extracted text into the intent field, not even as a
   convenience or a placeholder.** `SubmitTaskUseCase` is the only place a
   submission is assembled precisely so this stays auditable.

Also preserve: parallel execution, token/prompt optimization, failure recovery,
model failover, replanning, **truthful telemetry** (never show savings for work
that did not run; never hide `partial` or failed subtasks), offline-first
behaviour, and injection protection.

---

## 8. Engineering workflow

For every meaningful change: inspect → smallest correct change → check imports and
references → narrow static validation → broader validation → review the diff.

For a bug: reproduce → root cause → smallest fix → targeted test → regression test
→ diff review.

- Do not stop because a compiler passed — and on Android, do not pretend one ran.
- Never fabricate test output. Paste what actually ran.
- No real API keys anywhere; the mock provider and memory backend are sufficient.
- Match the surrounding code's style: comments explain *why*, KDoc on public
  types, trailing commas, `data class` for state, no `!!`, no `lateinit` where a
  constructor parameter works.

### Static validation both tracks must run (no compiler available)
1. Every file's `package` matches its directory.
2. Every imported `com.modelmesh.*` symbol exists at that exact path.
3. Every enum/sealed value referenced exists.
4. Every DTO field referenced by a mapper exists in the DTO.
5. Retrofit paths match §6 exactly.
6. Socket event names match §6 exactly.
7. Every `@Inject` dependency has a provider or binding (Track A owns the graph).
8. No dependency cycle.
9. Room entity ↔ DAO ↔ database are internally consistent; `@TypeConverters`
   registered for every non-primitive column.
10. Every navigation route referenced is registered, and its arguments match what
    the ViewModel reads from `SavedStateHandle`.
11. Every `R.*` / `@string` / `@style` / `@xml` / `@mipmap` reference resolves to a
    file that exists.
12. No hard-coded secret.
13. Rule 6 holds in every path that builds a request.
14. The UI never assumes success: partial results, failed subtasks, and skipped
    subtasks all render.

A grep-based reference audit is the practical tool here, e.g.
`grep -rho 'com\.modelmesh\.[A-Za-z0-9_.]*' --include='*.kt' | sort -u` compared
against the actual file/symbol list.

---

## 9. Definition of done

**Track A** — Room persistence, on-device preprocessing, `TaskRepositoryImpl`
satisfying the full interface offline-first, the sync worker, a complete Hilt
graph, `ModelMeshApplication`, proguard rules, JVM unit tests for what is testable
without a device, all three `scripts/`, `README.md`, and
`.claude/IMPLEMENTATION-NOTES.md`. Backend `pnpm test` / `typecheck` / `build`
still green. Report to `.claude/TRACK-A-REPORT.md`.

**Track B** — Material 3 theme, nav host with the three destinations,
`MainActivity` (including the SEND intent path), shared components, the three
screens with ViewModels, and every `res/` file the frozen manifest references.
Report to `.claude/TRACK-B-REPORT.md`.

Both report in this shape:
```
Status:
Files created:
Files modified:
Architecture implemented:
Static validation performed:      (exact commands + real output)
Compilation:                      (what ran, or the exact reason nothing could)
Problems found:
Problems fixed:
Remaining problems:
Exact next task:
```

---

## 10. Known open items at handoff

1. `gradle-wrapper.jar` / `gradlew` absent — binaries, must be generated (§3).
2. `docs/03, 05(partial), 10-MOBILE-ANDROID, 11, 12, 13, 14, 15` referenced by
   `CLAUDE.md` §11 do not exist in `.claude/`. The Android design was therefore
   derived from `02-TECH-STACK.md`, `04-API-SPEC.md`, `CLAUDE.md` §3/§4, and the
   actual backend source. Record any consequent deviation in
   `.claude/IMPLEMENTATION-NOTES.md`.
3. `apps/api/vitest.config.ts` sets `RATE_LIMIT_TASKS_PER_MIN: '1000'` and
   `RATE_LIMIT_READS_PER_MIN: '100000'` because the integration suite submits more
   tasks per minute than a phone would. Leave them.
4. Cleartext HTTP: the manifest now points at `@xml/network_security_config`
   (fixed during handoff — without it, every debug request to `10.0.2.2` would die
   with `CLEARTEXT communication not permitted`). **Track B must create that file**
   (spec in `TRACK-B-UI-LAYER.md` §7).
5. `com.google.android.material:material` is **not** a dependency, so
   `res/values/themes.xml` cannot use a `Theme.Material3.*` parent. Use an
   `android:Theme.Material.*.NoActionBar` parent; Material 3 lives in Compose.
6. No `FileProvider` is declared and the manifest is frozen — camera output must go
   to app-internal storage (`context.cacheDir`) and be read in-process.
