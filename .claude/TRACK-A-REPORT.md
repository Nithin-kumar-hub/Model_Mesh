# PHASE 3 TRACK A — DATA LAYER

**Status:** Complete. Room, on-device preprocessing, the repository, the sync worker,
the Hilt graph, the `Application`, ProGuard rules, JVM tests, all three scripts, the
README, and the implementation notes are written. Static validation passed. The
backend is still green: **192 tests, typecheck clean, build clean**. Kotlin was
**never compiled** — no Android toolchain exists in this environment (§ Compilation).

---

## Files created

### Room persistence — `apps/android/app/src/main/kotlin/com/modelmesh/data/local/`
| File | Contents |
|---|---|
| `TaskEntity.kt` | `@Entity("tasks")`, 21 columns, 4 JSON columns typed with the domain models |
| `TaskDao.kt` | `upsert`, `upsertAll`, `observeTask`, `getTask`, `observeHistory`, `getUnfinished`, `delete` |
| `ModelMeshDatabase.kt` | `@Database(version = 1, exportSchema = true)`, `@TypeConverters(Converters::class)` |
| `Converters.kt` | 8 `@TypeConverter`s + 5 `@Serializable` `Stored*` mirrors + both mapping directions |
| `TaskEntityExt.kt` | `toDomain`, `toListItem`, `TaskSnapshot.toEntity`, `TaskAccepted.toInitialEntity`, `TaskSubmission.toPendingEntity`, `TaskListItem.toEntity`, `withListItem`, `isLocalOnly`, `LOCAL_TASK_ID_PREFIX` |

### On-device preprocessing — `data/preprocess/`
| File | Contents |
|---|---|
| `DeviceCapabilities.kt` | NPU (declared-only), GPU (always `null`), battery (clamped 0–100), Wi-Fi, device model (≤120 chars) |
| `OnDevicePreprocessor.kt` | MIME dispatch: image → OCR + barcode + dimensions + base64; PDF → `PdfRenderer` + per-page OCR, no base64; audio/video → duration only; text → UTF-8; else unchanged. Hand-rolled `Task.awaitResult()` bridge. |

### Repository, worker, DI, application
| File | Contents |
|---|---|
| `data/repository/TaskRepositoryImpl.kt` | All 8 interface members, offline-first, socket + polling fallback folded through one `reduce` |
| `data/work/TaskSyncWorker.kt` | `@HiltWorker`, 15-min periodic, `NetworkType.CONNECTED`, ≤10 tasks/run, `Result.retry()` when offline |
| `di/NetworkModule.kt` | `apiKey`, `apiBaseUrl`, `wsBaseUrl`, `Json(explicitNulls = false)`, OkHttp (+redacted logging), Retrofit, `ModelMeshApi` |
| `di/DatabaseModule.kt` | `ModelMeshDatabase`, `TaskDao` |
| `di/RepositoryModule.kt` | `@Binds TaskRepository`, `@Binds AttachmentPreprocessor` |
| `di/WorkModule.kt` | `WorkManager` |
| `ModelMeshApplication.kt` | `@HiltAndroidApp`, `Configuration.Provider` with `HiltWorkerFactory`, schedules the sync worker |
| `app/proguard-rules.pro` | serialization, socket.io, Retrofit/OkHttp, Room, ML Kit, Hilt, enums, coroutines |

### JVM tests — `apps/android/app/src/test/kotlin/com/modelmesh/`
| File | Tests |
|---|---|
| `data/local/ConvertersTest.kt` | 7 — round-trips all four converters (incl. failed/skipped subtasks), null handling, malformed-row degradation |
| `data/repository/TaskRepositoryImplTest.kt` | 8 — cache-before-network, submit placeholder lifecycle, error-envelope mapping, offline, history merge, unfinished purge, socket fold, **polling fallback** |
| `domain/usecases/SubmitTaskUseCaseTest.kt` | 9 — every `InputType` derivation + Rule 6 separation + findings merge |
| `data/models/ExecutionTimelineTest.kt` | 9 — stage states, subtask fold, retrying ≠ failed, replay dedup, plan/savings/outcome |
| `util/AppResultTest.kt` | 11 — `map`/`onSuccess`/`onFailure`/`getOrNull` + `ErrorCode.fromWire` |
| `di/NetworkJsonTest.kt` | 4 — `explicitNulls = false` (the non-negotiable wire rule), unknown-key tolerance |

### Repo level
`scripts/setup.sh`, `scripts/seed-keys.ts`, `scripts/test-providers.ts` (all `chmod +x`),
`README.md`, `.claude/IMPLEMENTATION-NOTES.md`, `.claude/TRACK-A-REPORT.md`.

**27 files created** (15 Kotlin sources + 6 JVM test files + 3 scripts + 3 docs).
**0 files modified.**

---

## Architecture implemented

- **Offline-first as the read path.** `observeTask` and `observeHistory` are Room flows
  wrapped in a private `withRefresh { }` that launches the network read in the
  *collector's* scope. The refresh writes to Room; Room re-emits. One path into the UI.
- **Trace transport honesty.** Socket signals and polled replays are merged into one
  private `TraceSignal` stream and folded by a single `reduce`, so a polled timeline is
  byte-identical to a live one. Polling starts after 3 consecutive socket errors (or
  immediately if the socket throws), runs at 3 s (20 reads/min against a 60/min limit),
  stops at a terminal status or `TASK_NOT_FOUND`, and reports `TraceConnection.POLLING`
  instead of claiming to be live. A live event or reconnect cancels it and returns to
  `LIVE`.
- **Rule 6 in storage and on the wire.** `inputPreview` is built only from
  `userIntent`; extracted text stays in `attachment.detectedText`. The preprocessor
  never writes OCR output into the intent channel, and the repository only ever adds
  hardware hints to `localMetadata`.
- **Rule 1 respected by the client.** Findings are not duplicated between
  `attachment.detectedText` and `localMetadata.detectedText`; a PDF ships as text, not
  bytes.
- **Truthful telemetry preserved.** The entity stores `savedTokens`/`actualTokens`/
  `partial` exactly as returned; nothing is recomputed or rounded client-side.
- **Recovery.** `unfinishedTasks()` returns server-known non-terminal tasks and purges
  unreconcilable local placeholders; `TaskSyncWorker` refreshes up to 10 of them every
  15 minutes.

---

## Static validation performed

### 1. Package declaration matches directory (all 44 Kotlin files)
```
$ find apps/android -name '*.kt' | while read -r f; do
    pkg=$(grep -m1 '^package' "$f" | awk '{print $2}')
    exp=$(echo "$f" | sed 's|.*/kotlin/||; s|/[^/]*\.kt$||; s|/|.|g')
    [ "$pkg" != "$exp" ] && echo "MISMATCH $f: $pkg != $exp"
  done; echo "package check done"
package check done
```
No mismatches.

### 2. Every `com.modelmesh.*` import resolves to a declaration
```
$ grep -rho '^import com\.modelmesh\.[A-Za-z0-9_.]*' apps/android --include='*.kt' \
    | sed 's/^import //' | sort -u | wc -l
70
$ # …each checked against declarations in its package directory
UNRESOLVED: com.modelmesh.BuildConfig
UNRESOLVED: com.modelmesh.util.map
import check done
```
Both are false positives, verified by hand:
- `BuildConfig` is generated by AGP (`buildConfig = true`, namespace `com.modelmesh`).
- `util.map` exists — the checker's regex could not match a generic receiver:
```
$ grep -n 'fun .*\.map' apps/android/app/src/main/kotlin/com/modelmesh/util/AppResult.kt
49:inline fun <T, R> AppResult<T>.map(transform: (T) -> R): AppResult<R> = when (this) {
```

### 3. No hard-coded secret or endpoint in Kotlin
```
$ grep -rnE 'AIzaSy|sk-[A-Za-z0-9]|gsk_|http://|https://' apps/android --include='*.kt'
…/test/…/SubmitTaskUseCaseTest.kt:88:  barcodeData = "https://example.test/x"
…/main/…/data/work/TaskSyncWorker.kt:54: const val UNIQUE_WORK_NAME = "task-sync"
```
Two matches, neither a secret: a barcode payload in a test fixture, and `task-sync`
matching the `sk-` pattern. Every URL and key comes from `BuildConfig`.

### 4. Rule 6 audit
```
$ grep -rn 'userIntent' apps/android/app/src/main/kotlin --include='*.kt' \
    | grep -i 'detected\|attachment\.\|ocr'
clean: no production line mixes userIntent with extracted text
```
The blunt pattern from the track doc (`userIntent.*detectedText`) matches two lines in
`SubmitTaskUseCaseTest.kt` — both are *separate named arguments on one call*
(`useCase(userIntent = "", attachments = listOf(prepared(…, detectedText = …)))`), which
is the test asserting the separation, not breaking it.

### 5. Repository implements the frozen interface exactly
```
$ grep -c 'suspend fun \|    fun ' …/domain/repository/TaskRepository.kt   → 8 members
$ grep -c 'override' …/data/repository/TaskRepositoryImpl.kt               → 8 overrides
submit / observeTask / refreshTask / observeTimeline / observeHistory /
unfinishedTasks / submitFeedback / providerHealth
```

### 6. Hilt graph is closed
Every `@Inject`/`@AssistedInject` dependency in `apps/android/.../main` and its provider:

| Requested | Satisfied by |
|---|---|
| `@Named("apiKey") String` ×2 (`ApiKeyInterceptor`, `TraceSocketClient`) | `NetworkModule.apiKey()` |
| `@Named("wsBaseUrl") String` (`TraceSocketClient`) | `NetworkModule.wsBaseUrl()` |
| `@Named("apiBaseUrl") String` (Retrofit) | `NetworkModule.apiBaseUrl()` |
| `OkHttpClient`, `Json`, `Retrofit`, `ModelMeshApi` | `NetworkModule` |
| `ModelMeshDatabase`, `TaskDao` | `DatabaseModule` |
| `TaskRepository` (7 use cases + worker) | `@Binds TaskRepositoryImpl` |
| `AttachmentPreprocessor` (use case + repository) | `@Binds OnDevicePreprocessor` |
| `Context` (`DeviceCapabilities`, `OnDevicePreprocessor`, modules) | `@ApplicationContext` |
| `DeviceCapabilities` | `@Inject constructor` |
| `WorkManager` | `WorkModule` |
| `HiltWorkerFactory` (`ModelMeshApplication`) | `androidx.hilt:hilt-work` generated module |
| `@Assisted Context/WorkerParameters` (`TaskSyncWorker`) | WorkManager + `@HiltWorker` |
No cycles: `di → data → domain → util`, and `TaskRepositoryImpl` depends on the
`AttachmentPreprocessor` *port*, not on `OnDevicePreprocessor`.

### 7. Room entity ↔ converters ↔ database
```
@Entity(tableName = "tasks") / @PrimaryKey val taskId: String
telemetryJson: TelemetryView?     ↔ fromTelemetry(TelemetryView?)/toTelemetry(String?)
planJson: PlanSummary?            ↔ fromPlan/toPlan
subtasksJson: List<SubtaskView>?  ↔ fromSubtasks/toSubtasks
verificationJson: VerificationView? ↔ fromVerification/toVerification
@Database(entities = [TaskEntity::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)   → registered for every non-primitive column
```
All other columns are `String?`/`Int?`/`Long?`/`Double?`/`Boolean`. The DAO's
`getUnfinished()` filters on `status NOT IN ('completed','failed')`, which matches
`TaskStatus.COMPLETED.wire` / `FAILED.wire` exactly.

### 8. Retrofit paths vs the backend (`apps/api/src/api/routes/*`, prefix `/api/v1`)
```
@POST("tasks")                    @GET("tasks/{taskId}")
@GET("tasks/{taskId}/trace")      @GET("tasks")
@POST("tasks/{taskId}/feedback")  @GET("providers/status")
@POST("providers/keys")           @GET("telemetry/stats")
@GET("telemetry/calibration")
```
All nine match. (Frozen file — verified, not changed.)

### 9. Socket event names vs `apps/api/src/api/routes/stream.ts`
```
client: SOCKET_PATH "/ws"  EVENT_TRACE "trace"  EVENT_TRACE_HISTORY "trace_history"
        EVENT_SUBSCRIBE "subscribe"  EVENT_UNSUBSCRIBE "unsubscribe"
server: stream.ts:36  path: '/ws'
        stream.ts:78  socket.emit('trace_history', {…})
        stream.ts:87  socket.on('subscribe', …)
        stream.ts:92  socket.on('unsubscribe', …)
        stream.ts:106 io.to(taskId).emit('trace', event)
```
Exact match.

### 10. Serialization configuration
`NetworkModule.json()` sets `explicitNulls = false` (a strict Zod schema rejects
`{"budget": null}`), `ignoreUnknownKeys = true`, `isLenient = true`. Pinned by
`NetworkJsonTest`, which asserts the encoded body contains no `null` and no absent
optional block, and that an unknown response field decodes without throwing.

### 11. Script validation
```
$ bash -n scripts/setup.sh
setup.sh: syntax OK
$ shellcheck scripts/setup.sh
shellcheck: not installed
$ cd apps/api && pnpm exec tsc --noEmit --strict --target ES2022 --module CommonJS \
    --moduleResolution Node --lib ES2023 --types node \
    ../../scripts/seed-keys.ts ../../scripts/test-providers.ts
tsc exit: 0
$ ls -l scripts/
-rwxrwxr-x seed-keys.ts   -rwxrwxr-x setup.sh   -rwxrwxr-x test-providers.ts
```
`apps/api/package.json` already declares `"seed": "tsx ../../scripts/seed-keys.ts"` and
`"test-providers": "tsx ../../scripts/test-providers.ts"`, and the root delegates to
both — no script was duplicated or renamed.

### 12. Ownership boundary
```
$ git status --short
?? apps/android/app/proguard-rules.pro
?? apps/android/app/src/main/kotlin/com/modelmesh/ModelMeshApplication.kt
?? apps/android/app/src/main/kotlin/com/modelmesh/data/local/
?? apps/android/app/src/main/kotlin/com/modelmesh/data/preprocess/
?? apps/android/app/src/main/kotlin/com/modelmesh/data/repository/
?? apps/android/app/src/main/kotlin/com/modelmesh/data/work/
?? apps/android/app/src/main/kotlin/com/modelmesh/di/
?? apps/android/app/src/test/
?? scripts/
```
Every entry is an addition inside a Track A path. **No modified files at all** — no
frozen contract touched, no Track B file created or edited, `apps/api/**` untouched.
(`README.md` and `.claude/*.md` were written after this snapshot; both are Track A's.)

### 13. Backend still green
```
$ pnpm --filter @modelmesh/api test
 ✓ tests/unit/safety.test.ts (14 tests)          ✓ tests/unit/dag.test.ts (18 tests)
 ✓ tests/unit/calibration.test.ts (12 tests)     ✓ tests/unit/optimizer.test.ts (21 tests)
 ✓ tests/unit/classifier.test.ts (16 tests)      ✓ tests/unit/scheduler.test.ts (16 tests)
 ✓ tests/unit/profiler.test.ts (13 tests)        ✓ tests/unit/keys.test.ts (24 tests)
 ✓ tests/integration/telemetry-honesty.test.ts (4 tests)
 ✓ tests/unit/mock-provider.test.ts (23 tests)
 ✓ tests/integration/tasks.test.ts (31 tests)

 Test Files  11 passed (11)
      Tests  192 passed (192)
   Duration  6.07s
[exited with code 0]

$ pnpm --filter @modelmesh/api typecheck
$ tsc -p tsconfig.json --noEmit
--- typecheck exit: 0 ---

$ pnpm --filter @modelmesh/api build
$ tsc -p tsconfig.build.json
--- build exit: 0 ---
```

---

## Compilation

**NOT PERFORMED — Android toolchain unavailable.** Measured, not assumed:

```
$ echo "ANDROID_HOME=[${ANDROID_HOME:-unset}]"     → ANDROID_HOME=[unset]
$ command -v gradle                                 → gradle: not found
$ command -v kotlinc                                → kotlinc: not found
$ ls apps/android/gradlew                           → absent
$ java -version                                     → openjdk 21.0.11
$ ls /usr/lib/jvm                                    → java-11-openjdk, java-21-openjdk
$ ls apps/android/app/schemas/                       → absent (KSP writes it on first build)
```
The project needs JDK 17 (`app/build.gradle.kts`: `JavaVersion.VERSION_17`,
`jvmTarget JVM_17`). No Kotlin file in this repository has ever been compiled, and the
6 JVM test files have never been executed. Everything above is static validation.

The backend, by contrast, was really run: 192 tests, typecheck, and build all pass in
this environment.

---

## Problems found

1. **`.also { refreshTask(taskId) }` cannot compile** — the track doc's sketch for
   `observeTask` calls a `suspend` function from `also`, which provides no scope.
2. **`TaskAccepted` has no `strategy`** — the spec's `toInitialEntity(inputPreview)`
   would have stamped every new row `balanced`.
3. **"Write an initial `RECEIVED` entity" has no id to key on** — the task id only
   exists after the 202 response.
4. **A blind `@Upsert` from `GET /tasks` erases cached snapshots** — the list endpoint
   carries no output/plan/subtasks/telemetry.
5. **`localCreatedAt = now()` on every refresh reorders history** and makes a task
   synced from another device sort as the newest.
6. **A `channelFlow` whose body returns cancels its children** — the polling fallback
   would have been killed the moment the socket flow completed.
7. **The manifest removes `WorkManagerInitializer`**, so without
   `Configuration.Provider` the Hilt worker factory is never installed and
   `TaskSyncWorker`'s injected repository fails at runtime. The spec did not mention it.
8. **Injecting `WorkManager` into the `Application` is a startup hazard** — provisioning
   it during member injection calls `workManagerConfiguration`, which reads a
   `lateinit workerFactory` that may not be assigned yet.
9. **The backend has no audio transcription adapter.** The track doc says "the backend's
   adapter transcribes"; `core/pipeline.ts` `collectImages()` forwards inline bytes for
   `image/*` only. Uploading audio base64 would be pure waste.
10. **`runCatching` around suspend work swallows `CancellationException`**, breaking
    structured concurrency for a cancelled screen.
11. **`PdfRenderer` composites onto transparency** — OCR finds nothing on a transparent
    bitmap.
12. **`HANDOFF.md` §2 says "192 tests across 12 files"** — it is 11 files.
13. **`core/providers/gemini.ts` labels every inline image `image/jpeg`** — a PNG from
    the phone is sent under the wrong MIME type.

## Problems fixed

1–2, 4–5: `withRefresh { }` helper; `toInitialEntity(strategy, inputPreview)`;
`withListItem()` folding; `localCreatedAt` derived from the server `createdAt` via
`Instant.parse` with wall-clock as fallback.
3: `LOCAL_TASK_ID_PREFIX` placeholder rows, deleted on both outcomes and purged by
`unfinishedTasks()`.
6: socket collection moved into a child coroutine, flow body ends in
`awaitCancellation()`.
7–8: `ModelMeshApplication` implements `Configuration.Provider` with an injected
`HiltWorkerFactory`, and calls `WorkManager.getInstance(this)` after `super.onCreate()`.
9: audio/video send duration only, no base64 — which also matches the frozen
`Attachment` KDoc.
10: `CancellationException` is rethrown in `prepare()`, `safely()`, and `apiCall()`.
11: white `Canvas` fill before `page.render`, 2× render scale, per-page `recycle()`.
12–13: reported, not changed (see below).

All of these, plus every intentional divergence, are written up in
`.claude/IMPLEMENTATION-NOTES.md` §3.

## Remaining problems

1. **Nothing Kotlin has been compiled or run.** The highest-value next action is a real
   build on a JDK 17 machine. Expect the usual first-build friction: KSP/Room codegen,
   Hilt aggregation, and unused-import warnings.
2. **`apps/android/app/schemas/` does not exist** — `exportSchema = true` writes it on
   the first successful build; it should then be committed.
3. **`gradlew` / `gradle-wrapper.jar` are absent** (binaries, cannot be authored as
   text). `gradle wrapper --gradle-version 8.11.1`, or open the project in Android
   Studio.
4. **`fallbackToDestructiveMigration()`** is acceptable for a v1 cache and must be
   replaced with a real migration before anything locally authored is stored.
5. **No local trace persistence** — with no network *and* a killed process, the
   execution screen can show the cached snapshot but not the trace.
6. **`gemini.ts` inline-image MIME type** (problem 13) is a genuine backend bug. One
   line, but `apps/api/**` is outside Track A's write scope beyond `scripts/`. Filed
   here and in `IMPLEMENTATION-NOTES.md` §6.1.
7. **`GET /tasks` has no cursor**, so history is capped at the requested `limit` (≤100).
8. **Audio is metadata-only end to end** until a backend transcription adapter exists.

---

## Exact next task

**Track B merges after Track A** (it owns the DI graph Track B's ViewModels resolve
through). Then, on a machine with JDK 17 + Android SDK 35:

```bash
cd apps/android
gradle wrapper --gradle-version 8.11.1
./gradlew :app:testDebugUnitTest      # runs the 6 JVM test files for the first time
./gradlew :app:assembleDebug          # needs Track B's res/ and MainActivity.kt
git add app/schemas/                  # commit the exported Room schema
```

Fix whatever the first compile reports, then run the live smoke path: start the backend
(`pnpm --filter @modelmesh/api dev`), run `./scripts/test-providers.ts`, install the
APK, and confirm the trace screen shows `LIVE` rather than `POLLING` against
`10.0.2.2:3000`.
