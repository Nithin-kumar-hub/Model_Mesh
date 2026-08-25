# ModelMesh — Implementation Notes

Every place the built system differs from the specification, and why. Written so a
reviewer can tell a deliberate decision from an accident.

Last updated: 2026-08-25 (Track A — data layer, DI, scripts, docs).

---

## 1. Specification gaps that had to be bridged

`CLAUDE.md` §11 references fifteen design documents. The `.claude/` tree contains
architecture, tech-stack, API, data-models (partial), orchestration, providers,
token-intelligence, and agent-roles. **Missing: 03-SYSTEM-DESIGN, the rest of
05-DATA-MODELS, 10-MOBILE-ANDROID, 11-TELEMETRY, 12-TESTING, 13-DEPLOYMENT,
14-PHASE-PLAN, 15-DEMO-GUIDE.**

Consequence: the entire Android design — screens, Room schema, DI graph, socket
handling, on-device preprocessing — was derived from `02-TECH-STACK`, `04-API-SPEC`,
`CLAUDE.md` §3/§4/§6, and **the actual backend source**, not from a mobile spec. Where
this file cites the backend (`apps/api/src/...`) as the reason for a decision, that is
because the source was the only available authority.

---

## 2. Backend deviations (pre-existing, recorded for completeness)

| Deviation | Reason |
|---|---|
| `MemoryStore` / `MemoryPersistence` / `MockProvider` are first-class, not test doubles | The spec implies Postgres + Redis + real keys. Requiring any of them would make the pipeline undemoable offline. `PERSISTENCE=auto` and `CACHE_BACKEND=auto` try the real backend and fall back; `mockProviderEnabled` auto-enables when no real key exists. |
| `apps/api/vitest.config.ts` raises `RATE_LIMIT_TASKS_PER_MIN` to 1000 and `RATE_LIMIT_READS_PER_MIN` to 100000 | The integration suite submits far more tasks per minute than a phone would; the production defaults (10 / 60) would fail tests for the wrong reason. Left in place deliberately. |
| `Task.savedTokens` counts only nodes that produced a result (`buildTelemetry` in `core/pipeline.ts`) | The original code took the baseline over `plan.nodes`, so a run where 3 of 5 subtasks failed reported **79.64% savings for work it never did**. Now it filters to `collected.all` subtask ids. A run with `MOCK_FAILURE_RATE=0.35` reports 49.29% for 2 executed nodes, `partial: true`, `replans: 1`. Covered by `tests/integration/telemetry-honesty.test.ts`. |
| `SubTask.nodeId` + `@@unique([taskId, nodeId])`, `CalibrationModel @@unique([taskType, role])` in `schema.prisma` | The data-model doc keyed subtasks by a generated id, which makes semantic DAG ids (`bug_analysis`) unaddressable per task. |
| `DAG.validate(nodes, knownIds)` | Re-planning never took effect: validation reported `MISSING_DEPENDENCY` for a pending synthesis node whose dependencies had already completed, so every re-plan was discarded. Completed ids are now passed as satisfied. |
| `failed` is not cleared after a successful re-plan (`orchestrator/scheduler.ts`) | Those subtasks really did fail, and the final result must say so even when a re-plan recovers the answer. |
| Semantic cache has a `LENGTH_RATIO_FLOOR = 0.9` guard | A draft run's 55%-truncated prompt scored ≥0.95 cosine against the full balanced prompt, because repetitive code shares vocabulary — a false cache hit that returned the wrong-strategy answer. |

### `AndroidManifest.xml` — cleartext HTTP (fixed during handoff, manifest now frozen)

`android:networkSecurityConfig="@xml/network_security_config"` was added. Without it,
every debug request to `10.0.2.2` dies with `CLEARTEXT communication not permitted`.
The referenced XML is the UI track's file to create; permitting cleartext for dev
hosts only (not `base-config`) is the requirement.

---

## 3. Track A deviations from `tracks/track-a-data-layer.md`

All of these are additive; none changes a frozen contract.

### 3.1 `Converters.kt` uses `@Serializable` mirror classes — as instructed

The four JSON columns hold `TelemetryView`, `PlanSummary`, `List<SubtaskView>`, and
`VerificationView`. Those types live in the frozen `data/models/TaskSnapshot.kt` and
carry no `@Serializable`, so `Stored*` mirrors exist inside `Converters.kt` with enums
flattened to their `wire` strings. Nothing in the compiler checks that a mirror still
matches its domain type, so `ConvertersTest` round-trips a fully-populated instance of
each — **that test is the drift detector**.

Storage decision: the entity properties are declared with the *domain* type
(`telemetryJson: TelemetryView?`) rather than `String?`, so Room applies the converter
itself and a future write cannot forget to serialize. The `Json` suffix names the
column's storage form; the type names the value.

Decode failures degrade to `null` instead of throwing. This is a cache: losing a row is
acceptable, crashing a screen is not.

### 3.2 `TaskAccepted.toInitialEntity` takes the strategy

Spec signature: `fun TaskAccepted.toInitialEntity(inputPreview: String? = null)`.
Actual: `(strategy: ExecutionStrategy, inputPreview: String? = null)`.

`POST /tasks` returns `{taskId, status, websocketRoom, estimatedMs, executionMode,
createdAt}` — it does **not** echo the strategy, and `TaskAccepted` therefore has no
strategy field. Without the parameter every freshly-submitted row would claim
`balanced`, and the history list would show the wrong strategy chip for a draft or
premium run. The repository passes the strategy it submitted.

### 3.3 Pending-submission rows carry a `local-` id and are purged

The spec's `submit()` step 1 is "write an initial `RECEIVED` entity immediately so the
task is in Room before anything touches the network". There is no task id at that
point, so `TaskSubmission.toPendingEntity(localTaskId)` writes a row keyed
`local-<uuid>` (`LOCAL_TASK_ID_PREFIX`).

Such a row cannot be reconciled with the backend, so:

- on success the placeholder is deleted and the real row is written;
- on failure the placeholder is deleted and the failure is returned — the caller is
  suspended on `submit()` and will surface it, so a permanently un-openable history row
  would be worse than none;
- `unfinishedTasks()` purges any `local-` row it finds and never offers it as
  recoverable, which covers a process death mid-submit.

Trade-off, stated plainly: a submission killed between the Room write and the HTTP
response is lost rather than resumed. Resuming it would need a client-generated task id
the backend accepts, which the frozen API does not provide.

### 3.4 Extra mapping helpers in `TaskEntityExt.kt`

Beyond the four functions the spec lists: `TaskListItem.toEntity()`,
`TaskEntity.withListItem(item)`, `TaskSubmission.toPendingEntity(id)`, and
`TaskEntity.isLocalOnly`.

`GET /tasks` carries no output, plan, subtasks, or telemetry breakdown. `@Upsert`
replaces the whole row, so syncing the history list with a blind upsert would **erase a
full snapshot this device had already fetched**. `withListItem` folds the list fields
into the cached row instead.

### 3.5 `localCreatedAt` is derived from the server timestamp when there is one

The spec describes it as `System.currentTimeMillis()`. If every refresh restamped it,
the history list would reshuffle on each sync, and a task synced from another device
would sort as the newest. It is now `Instant.parse(createdAt)` when parseable
(`minSdk 26`, so `java.time` needs no desugaring) and wall-clock only as the fallback
for a row the backend has not acknowledged.

### 3.6 `TaskRepositoryImpl` takes a fifth dependency: `Json`

Needed to parse the backend's `{"error": {code, message, details}}` envelope out of a
non-2xx `Response`. It is the same singleton Retrofit uses, so an error body parses
exactly as a success body would. This adds no burden to the UI track — the graph
provides it.

### 3.7 Background refresh uses `channelFlow`, not `.also { refreshTask(...) }`

The spec sketches `dao.observeTask(id).map { … }.also { refreshTask(id) }`, which cannot
compile: `refreshTask` is a `suspend` function and `also` provides no coroutine scope.
Implemented as a private `Flow<T>.withRefresh { … }` helper that launches the refresh in
the **collector's** scope, so it is cancelled with the screen instead of outliving it.

### 3.8 Trace fallback: threshold, single fold point, and a subscription that stays open

- Socket.io retries internally, so "all retries exhausted" is not a signal it emits.
  Polling starts after `MAX_SOCKET_ERRORS = 3` consecutive `Signal.Error`s with no
  intervening `Connected`, or immediately if the socket flow itself throws.
- Socket signals and polled replays are merged into one private `TraceSignal` stream and
  folded by a single `reduce`, so a timeline assembled from `GET /tasks/:id/trace` is
  identical to one streamed live. No shared mutable timeline, no lock.
- While polling, further socket errors and disconnects **do not** flip the state back to
  `RECONNECTING`; a live event or a reconnect does flip it to `LIVE` and cancels polling.
- The socket collection runs in a child coroutine and the flow body ends in
  `awaitCancellation()`. Without that, a socket flow that completes would close the
  channel and kill the polling fallback it had just started. Consequence: the trace flow
  never completes on its own — it ends when the consumer stops collecting, which is what
  `TraceSocketClient`'s `awaitClose` already assumes and what frees the connection slot
  against the backend's 5-per-key cap.
- Polling stops on a terminal status or `TASK_NOT_FOUND`, and runs at 3 s — 20 reads a
  minute against a 60-a-minute limit.

### 3.9 Audio and video: no base64 is uploaded

The track document says "the backend's adapter transcribes". **It does not.**
`apps/api/src/core/pipeline.ts` `collectImages()` forwards inline bytes for
`image/*` only, and there is no transcription adapter anywhere in `core/providers/`.
Uploading a voice note would spend the user's data on bytes nothing reads.

So `audio/*` and `video/*` produce an attachment with `audioDurationSeconds` from
`MediaMetadataRetriever`, no `detectedText`, and no base64 — which is also exactly what
the frozen `Attachment` KDoc says ("`base64` is only populated for modalities a cloud
model consumes directly (images)"). `video/*` additionally fails the backend's MIME
check unless it carries `detectedText`, so it is honestly rejected rather than silently
half-supported. **Real audio support needs a backend transcription adapter first.**

### 3.10 Preprocessing: caps, early rejection, visible truncation

- An image whose bytes exceed 20 MB (`MAX_FILE_BYTES`) returns
  `AppResult.Failure(FILE_TOO_LARGE)` before base64 encoding, rather than being uploaded
  and 400'd. Cheaper for the user and a better message.
- PDFs render at most 20 pages, at 2× scale onto a white canvas (`PdfRenderer`
  composites onto transparency, and OCR finds nothing on a transparent bitmap). Each
  page bitmap is recycled immediately, so peak memory is one page rather than the
  document. When pages are dropped, a marker line is appended **inside the extracted
  text** — a truncated read must be visible, or a model answers confidently about pages
  it never saw.
- Extracted text is capped at 500 000 chars (the backend's own limit) with a visible
  truncation marker; barcode payloads at 8 000; `deviceModel` at 120.
- OCR, barcode, and language-id failures are swallowed per step and logged: a file whose
  on-device pass found nothing is still attachable, because the backend can often still
  handle it. Only a file that cannot be read at all returns a `Failure`.
- Findings are not duplicated: OCR text lives on `attachment.detectedText`, and only
  `barcodeData` / `detectedLanguage` / duration go into `localMetadata`. Sending the same
  text twice would inflate the very token count Rule 1 exists to reduce.
- ML Kit's `Task` is bridged with a hand-written `suspendCancellableCoroutine` because
  `kotlinx-coroutines-play-services` is not a dependency and `app/build.gradle.kts` is
  frozen.
- `play-services-mlkit-document-scanner` is a declared dependency but its API is
  activity-result driven, so it cannot be called from the data layer. Unused here; a
  UI-initiated scan flow could use it. The `PdfRenderer` path needs no Play services at
  all, which is why the document path works fully offline.

### 3.11 `DeviceCapabilities` reports `null`, never a guess

- **NPU**: `hasSystemFeature("android.hardware.neuralnetworks")` — only `true` is
  reported. A `false` means "not declared", which is not "not present", so it maps to
  `null`.
- **GPU**: always `null`. Every Android device has a GPU, so `true` is vacuous, and
  whether GPU-accelerated *inference* is available cannot be read from the SDK.
- **Battery**: sticky `ACTION_BATTERY_CHANGED`, clamped 0–100 (outside that the
  backend's Zod schema rejects the whole submission).
- **Wi-Fi**: `null` when there is no active network at all — different from "on
  cellular".

### 3.12 `ModelMeshApplication` implements `Configuration.Provider`

The spec's sketch injects `WorkManager` as a field and does not mention
`Configuration.Provider`. Both needed changing:

1. The frozen manifest removes `WorkManagerInitializer` via `tools:node="remove"`, so
   WorkManager must be configured on demand — otherwise the Hilt worker factory is never
   installed and `TaskSyncWorker`'s injected repository fails at runtime.
2. `WorkManager` is obtained with `WorkManager.getInstance(this)` after
   `super.onCreate()` instead of by field injection. Provisioning it *during* member
   injection would call `workManagerConfiguration`, which reads `workerFactory` — a field
   that may not have been assigned yet. `WorkModule` still provides `WorkManager` for any
   later injection site.

### 3.13 Room uses `fallbackToDestructiveMigration()`

Acceptable only because the table is a cache of server state at schema version 1: the
worst case is one refetch. **A real migration is required before anything locally
authored is stored here.** Noted in the code as well.

### 3.14 No local persistence of trace events

Only task snapshots are cached. `trace_history` replay on socket join, plus
`GET /tasks/:id/trace` as the fallback, reconstruct the full timeline, so a local trace
table would duplicate server state for no gain. **Limitation:** with no network *and* a
killed process, the execution screen can show the cached snapshot but not the trace.

### 3.15 `Instant.parse` / `java.time` used directly

`minSdk = 26`, so `java.time` is available without desugaring. No `ThreeTenABP`.

---

## 4. Scripts

- `scripts/seed-keys.ts` and `scripts/test-providers.ts` import **nothing but Node
  builtins**. `apps/api/package.json` runs them as `tsx ../../scripts/*.ts`, so module
  resolution starts from `/scripts`, where the API's `node_modules` are not reachable —
  `import 'dotenv/config'` would fail. Each script therefore carries a ~20-line `.env`
  parser with the same precedence as `config.ts` (repo `.env`, then `apps/api/.env`, and
  an exported shell variable always wins).
- Neither script requires a real provider key. `seed-keys` exits 0 with an explanation
  when none is configured; `test-providers` reports that it is running on the mock
  provider.
- `test-providers` polls every 2 s because `RATE_LIMIT_READS_PER_MIN` defaults to 60.
- Keys are never printed. The seeder masks locally and prefers the `maskedKey` the
  backend returns.
- `setup.sh` treats a missing Postgres or Redis as a **warning**, not a failure, because
  `auto` mode falls back in-process. It hard-codes no URL: hosts and ports are parsed out
  of `DATABASE_URL` / `REDIS_URL`. It runs `prisma migrate dev` only when Postgres is
  actually reachable, and notes that the command can prompt on schema drift.
- The scripts are typechecked standalone (`tsc --noEmit --strict`) but are **not** part
  of `pnpm --filter @modelmesh/api typecheck`: that project's `include` is
  `src/**`, `tests/**`, `vitest.config.ts`. Left as is rather than widening a frozen
  tsconfig.

---

## 5. Environment limitations — what was never verified

| Claim | Status |
|---|---|
| Backend tests | **Run.** 192 tests, 11 files, all passing. |
| Backend typecheck / build | **Run.** Both clean. |
| Script syntax | **Checked.** `bash -n` on `setup.sh`; `tsc --noEmit --strict` on both TS scripts. |
| Kotlin compilation | **Never attempted.** No `ANDROID_HOME`, no Gradle, no `kotlinc`; JDK 11 and 21 present, the project needs 17. |
| Android JVM unit tests | **Written, never executed.** They need a toolchain. |
| Room schema export (`app/schemas/`) | **Absent.** KSP writes it during the first build, which has not happened. |
| `gradlew` / `gradle-wrapper.jar` | **Absent.** Binaries cannot be authored as text; generate with `gradle wrapper --gradle-version 8.11.1` or open the project in Android Studio. |

Everything Android was therefore validated by static inspection: package↔directory
match, import resolution against the actual file/symbol set, interface-implementation
coverage, Hilt graph completeness, Room entity↔converter↔database consistency, Retrofit
paths and socket event names against the backend source, a secret scan, and a Rule 6
audit. The commands and their real output are in `.claude/TRACK-A-REPORT.md`.

---

## 6. Observations left alone (frozen code, reported not fixed)

1. **`core/providers/gemini.ts` labels every inline image `image/jpeg`.**
   `parts.push({ inlineData: { mimeType: 'image/jpeg', data: image } })` — a PNG or WebP
   from the phone is sent under the wrong MIME type. The Android side deliberately keeps
   the true MIME on the attachment, so the fix is one line in the adapter (use the
   file's `mimeType`), but `apps/api/**` is frozen for Track A beyond adding scripts.
2. **`HANDOFF.md` §2 says "192 tests across 12 files".** The suite is 192 tests across
   **11** files. The test count is right; the file count was not.
3. **`GET /tasks` has no cursor.** History is a `limit`-capped list (1–100), so the app's
   history is capped at the same 50 rows it requests. Fine for the demo; a real backlog
   would need pagination on both sides.
