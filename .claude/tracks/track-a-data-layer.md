# ModelMesh — Track A: Data Layer, DI, Scripts, Documentation

> **Read [`HANDOFF.md`](./HANDOFF.md) first.** This file is the task list for one
> of two parallel implementation tracks. It references frozen contracts from
> `HANDOFF.md` §5 extensively — do not repeat them here.
>
> **Track A owns:** Room persistence, on-device preprocessing, `TaskRepositoryImpl`,
> sync worker, Hilt modules, `ModelMeshApplication`, proguard rules, JVM unit
> tests, `scripts/`, `README.md`, `.claude/IMPLEMENTATION-NOTES.md`.
>
> **Track A does NOT touch:** anything under `apps/android/...kotlin.../ui/`,
> `apps/android/app/src/main/res/`, `MainActivity.kt`, the frozen files listed in
> `HANDOFF.md` §4, or `apps/api/`.

---

## Startup sequence

Before writing a single line:

1. Read `HANDOFF.md` in full — especially §3 (environment), §4 (file ownership),
   §5 (frozen contract), §6 (backend contract), §7 (rules).
2. `find apps/android -name '*.kt' | sort` — confirm the 20 frozen Kotlin files
   exist and nothing Track A needs to write already exists.
3. `find scripts -maxdepth 1 2>/dev/null || echo missing` — confirm `scripts/`
   does not exist yet.
4. `cat apps/api/package.json | python3 -m json.tool | grep '"seed\|test-prov'`
   — read the exact script names the root `package.json` expects to delegate to.
5. Read `apps/api/src/infra/persistence.ts`, `store.ts`, `keys/manager.ts` —
   the TypeScript backing for the seeder and test-providers scripts.

Only then write code.

---

## A1 — Room persistence layer

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/data/local/`

### A1.1 `TaskEntity.kt`

One Row per task, sufficient to rebuild `TaskListItem` offline, recover
`unfinishedTasks()`, and re-enter the trace screen after a killed process.

Required columns (nullable where the backend omits them):

| Column | Type | Notes |
|---|---|---|
| `taskId` | `String` PK | UUID |
| `status` | `String` | `TaskStatus.wire` |
| `strategy` | `String` | `ExecutionStrategy.wire` |
| `taskType` | `String?` | |
| `inputPreview` | `String?` | first 120 chars of `userIntent` |
| `createdAt` | `String?` | ISO-8601 from server |
| `completedAt` | `String?` | |
| `errorCode` | `String?` | |
| `outputText` | `String?` | `TaskOutput.text`, may be long |
| `outputFormat` | `String` | default `"markdown"` |
| `outputConfidence` | `Double?` | |
| `outputPartial` | `Boolean` | default `false` |
| `telemetryJson` | `String?` | `TelemetryView` serialized via `Converters` |
| `planJson` | `String?` | `PlanSummary` serialized via `Converters` |
| `subtasksJson` | `String?` | `List<SubtaskView>` serialized via `Converters` |
| `verificationJson` | `String?` | `VerificationView` serialized via `Converters` |
| `savedTokens` | `Int?` | denormalized for list-view display |
| `actualTokens` | `Int?` | denormalized for list-view display |
| `totalMs` | `Long?` | |
| `confidence` | `Double?` | output confidence for list-view display |
| `localCreatedAt` | `Long` | `System.currentTimeMillis()` — for list sort before server echo |

Mark `@Entity(tableName = "tasks")`, `@PrimaryKey val taskId: String`.

**Converters** live in `Converters.kt` (§A1.4). Every `*Json` column uses one.

### A1.2 `TaskDao.kt`

```kotlin
@Dao
interface TaskDao {
    @Upsert
    suspend fun upsert(entity: TaskEntity)

    @Upsert
    suspend fun upsertAll(entities: List<TaskEntity>)

    @Query("SELECT * FROM tasks WHERE taskId = :taskId")
    fun observeTask(taskId: String): Flow<TaskEntity?>

    @Query("SELECT * FROM tasks WHERE taskId = :taskId")
    suspend fun getTask(taskId: String): TaskEntity?

    @Query("SELECT * FROM tasks ORDER BY localCreatedAt DESC LIMIT :limit")
    fun observeHistory(limit: Int): Flow<List<TaskEntity>>

    @Query("""
        SELECT * FROM tasks
        WHERE status NOT IN ('completed','failed')
        ORDER BY localCreatedAt DESC
    """)
    suspend fun getUnfinished(): List<TaskEntity>

    @Query("DELETE FROM tasks WHERE taskId = :taskId")
    suspend fun delete(taskId: String)
}
```

### A1.3 `ModelMeshDatabase.kt`

```kotlin
@Database(entities = [TaskEntity::class], version = 1, exportSchema = true)
@TypeConverters(Converters::class)
abstract class ModelMeshDatabase : RoomDatabase() {
    abstract fun taskDao(): TaskDao

    companion object {
        const val DATABASE_NAME = "modelmesh.db"
    }
}
```

### A1.4 `Converters.kt`

The four JSON columns hold `TelemetryView`, `PlanSummary`, `List<SubtaskView>`, and
`VerificationView` — all declared in the frozen `data/models/TaskSnapshot.kt`.

Those models are plain `data class`es and carry **no** `@Serializable` annotation,
and `TaskSnapshot.kt` is frozen, so you cannot add one. Define `@Serializable`
mirror classes inside `Converters.kt` (prefix them `Stored`), map
domain → stored → JSON string and back, and expose the mapping as
`@TypeConverter` methods using `kotlinx.serialization.json.Json` (already a
dependency).

Required converter pairs, each `String?` ↔ model:
`TelemetryView?`, `PlanSummary?`, `List<SubtaskView>?`, `VerificationView?`.

Keep the `Stored*` mirrors field-for-field identical to the domain types. A
round-trip test (§A8.1) is what protects against drift, since the compiler cannot
see the correspondence.

### A1.5 Extension: `TaskEntity` ↔ domain

In the same `data/local/` package, create `TaskEntityExt.kt`:

```kotlin
fun TaskEntity.toDomain(): TaskSnapshot
fun TaskEntity.toListItem(): TaskListItem
fun TaskSnapshot.toEntity(inputPreview: String? = null): TaskEntity
fun TaskAccepted.toInitialEntity(inputPreview: String? = null): TaskEntity
```

These are the only place that knows about both the entity layout and the domain
model — keep the mapping here, not scattered through the repository.

---

## A2 — On-device preprocessing

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/data/preprocess/`

### A2.1 `DeviceCapabilities.kt`

```kotlin
/** Detects ONLY what the platform can report reliably. Never guesses. */
@Singleton
class DeviceCapabilities @Inject constructor(
    @ApplicationContext private val context: Context,
) {
    fun snapshot(): LocalMetadata  // reads BatteryManager, ConnectivityManager,
                                   // Build.MODEL, NeuralNetworks API presence
}
```

**Honesty rule for this class: report `null`, not `false`, for anything the
platform cannot actually tell you.** `LocalMetadata`'s hardware fields are all
nullable precisely so an unknown can be expressed. The backend treats these as
hints and never trusts them for correctness, so a `null` costs nothing while a
fabricated `true` corrupts a routing decision.

- **NPU** — query `packageManager.hasSystemFeature("android.hardware.neuralnetworks")`.
  Treat only `true` as informative; a `false` means "not declared", which is not
  the same as "not present", so map it to `null`.
- **GPU** — `null`. Every Android device has a GPU, so `true` is vacuous, and
  whether *GPU-accelerated inference* is available cannot be determined from the
  SDK.
- **Battery** — `registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))`,
  then `level * 100 / scale`. Clamp to 0–100 (the backend's Zod schema rejects
  anything outside it).
- **Wi-Fi** — `ConnectivityManager.activeNetwork` →
  `getNetworkCapabilities(...)?.hasTransport(TRANSPORT_WIFI)`. `null` when there is
  no active network at all, which is different from "on cellular".
- **Device model** — `"${Build.MANUFACTURER} ${Build.MODEL}"`, truncated to 120
  chars (schema limit).

### A2.2 `OnDevicePreprocessor.kt`

Implements `domain/preprocess/AttachmentPreprocessor`.

```kotlin
@Singleton
class OnDevicePreprocessor @Inject constructor(
    @ApplicationContext private val context: Context,
    private val deviceCapabilities: DeviceCapabilities,
) : AttachmentPreprocessor {
    override suspend fun prepare(source: AttachmentSource): AppResult<PreparedAttachment>
    override suspend fun deviceHints(): LocalMetadata
}
```

`prepare()` dispatches on `source.mimeType`:

| MIME pattern | On-device pipeline |
|---|---|
| `image/*` | `TextRecognition` (Latin model), then `BarcodeScanning`. OCR text → `attachment.detectedText`. Barcode payload → `findings.barcodeData`. Dimensions from `BitmapFactory.Options(inJustDecodeBounds = true)`. Base64-encode the image for the wire — a vision model consumes it directly. |
| `application/pdf` | `PdfRenderer` (API 21+, fully offline, no Play services) → render each page to a bitmap → `TextRecognition` per page → concatenate with page markers. Set `pageCount`. **Send no base64 for a PDF** — only `detectedText`. That is the whole point: a 4 MB scan becomes a few KB. Cap the pages you render (e.g. 20) and record the cap in the extracted text so a truncated read is visible rather than silent. |
| `audio/*`, `video/*` | No offline ML Kit transcription exists. Return the attachment unchanged with `detectedText = null` and `audioDurationSeconds` from `MediaMetadataRetriever` (`METADATA_KEY_DURATION`, ms → seconds). The backend's adapter transcribes. |
| `text/*` | Read as UTF-8 into `detectedText`. No base64. |
| anything else | Return unchanged. The backend rejects it as `UNSUPPORTED_MODALITY` unless `detectedText` is present — which is the documented contract, not a bug to work around. |

Language identification: after OCR, run `LanguageIdentification.getClient()` on
`detectedText.take(200)`; set `findings.detectedLanguage` only when the result is
not `"und"`, otherwise leave it null.

**Coroutine bridging.** `kotlinx-coroutines-play-services` (which supplies
`Task.await()`) is **not** a dependency, and `app/build.gradle.kts` is frozen. Wrap
each ML Kit `Task` yourself:

```kotlin
private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { cont ->
    addOnSuccessListener { cont.resume(it) }
    addOnFailureListener { cont.resumeWithException(it) }
    addOnCanceledListener { cont.cancel() }
}
```

Run the whole of `prepare()` inside `withContext(Dispatchers.IO)`.

The `play-services-mlkit-document-scanner` dependency is present but its API is
activity-result driven, so it cannot be called from this layer. Leave it for a
UI-initiated scan flow; the `PdfRenderer` path above is what `prepare()` uses.

Failures: wrap every exception in `AppResult.Failure(ErrorCode.INTERNAL, message)`.
**Never throw out of `prepare()`** — a file that fails OCR should still be
attachable, because the backend can often still handle it.

---

## A3 — Repository implementation

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/data/repository/`

### `TaskRepositoryImpl.kt`

Implements `domain/repository/TaskRepository`.

```kotlin
@Singleton
class TaskRepositoryImpl @Inject constructor(
    private val api: ModelMeshApi,
    private val socketClient: TraceSocketClient,
    private val dao: TaskDao,
    private val preprocessor: AttachmentPreprocessor,
) : TaskRepository
```

#### `submit()`

1. Write an initial `RECEIVED` entity immediately so the task is in Room before
   anything touches the network.
2. Call `api.submitTask(submission.toDto())`.
3. On success: `dao.upsert(accepted.toInitialEntity(...))`, return
   `AppResult.Success(accepted.toDomain())`.
4. On HTTP error: parse body as `ErrorEnvelopeDto`, return
   `AppResult.Failure(ErrorCode.fromWire(code), message)`.
5. On IOException: return `AppResult.Failure(ErrorCode.OFFLINE, ...)`.

#### `observeTask()`

```
dao.observeTask(taskId)            // Room emits null or cached entity immediately
    .map { it?.toDomain() }
    .also { refreshTask(taskId) }  // fire-and-forget background refresh
```

The background refresh updates Room, which re-emits from the DAO flow.

#### `refreshTask()`

1. `api.getTask(taskId)` — map through `Mappers.kt`.
2. `dao.upsert(snapshot.toEntity())`.
3. Return `AppResult.Success(snapshot)` or the appropriate `AppResult.Failure`.

#### `observeTimeline()`

Use the socket client's `observe(taskId)` flow:

```kotlin
socketClient.observe(taskId)
    .scan(TimelineUpdate(ExecutionTimeline(taskId), TraceConnection.CONNECTING)) { acc, signal ->
        when (signal) {
            is Signal.Connected -> acc.copy(connection = TraceConnection.LIVE)
            is Signal.History   -> acc.copy(timeline = acc.timeline.withEvents(signal.events), connection = TraceConnection.LIVE)
            is Signal.Live      -> acc.copy(timeline = acc.timeline.withEvent(signal.event))
            is Signal.Disconnected -> acc.copy(connection = TraceConnection.RECONNECTING)
            is Signal.Error     -> acc.copy(connection = TraceConnection.RECONNECTING)
        }
    }
```

On socket failure (all retries exhausted), fall back to polling
`GET /tasks/:taskId/trace` every 3 s while the task is non-terminal; emit with
`TraceConnection.POLLING`. Stop polling when the task reaches a terminal status
or the flow is cancelled.

#### `observeHistory()`

```kotlin
dao.observeHistory(limit)
    .map { entities -> entities.map { it.toListItem() } }
    .also { /* fire-and-forget sync of the list from the backend */ }
```

#### `unfinishedTasks()`

`dao.getUnfinished().map { it.toListItem() }`

#### `submitFeedback()`

`api.submitFeedback(taskId, FeedbackRequestDto(rating, comment))`.

#### `providerHealth()`

`api.providerStatus()` → map via `Mappers.kt`.

---

## A4 — Background sync worker

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/data/work/`

### `TaskSyncWorker.kt`

`@HiltWorker` extending `CoroutineWorker`. Syncs non-terminal tasks from Room
with the backend. Schedule with `WorkManager` as a `PeriodicWorkRequest` every
15 minutes on `NetworkType.CONNECTED`. Limit to the 10 most-recently-updated
non-terminal tasks to stay polite on quota.

```kotlin
@HiltWorker
class TaskSyncWorker @AssistedInject constructor(
    @Assisted context: Context,
    @Assisted workerParams: WorkerParameters,
    private val repository: TaskRepository,
) : CoroutineWorker(context, workerParams)
```

---

## A5 — Hilt dependency graph

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/di/`

### A5.1 `NetworkModule.kt`

```kotlin
@Module @InstallIn(SingletonComponent::class)
object NetworkModule {
    @Provides @Singleton @Named("apiKey")
    fun apiKey(): String = BuildConfig.API_KEY

    @Provides @Singleton @Named("wsBaseUrl")
    fun wsBaseUrl(): String = BuildConfig.WS_BASE_URL

    @Provides @Singleton
    fun okHttp(interceptor: ApiKeyInterceptor): OkHttpClient

    @Provides @Singleton
    fun json(): Json = Json { ignoreUnknownKeys = true; explicitNulls = false; isLenient = true }

    @Provides @Singleton
    fun retrofit(@Named("apiKey") apiKey: String, okHttp: OkHttpClient, json: Json): Retrofit

    @Provides @Singleton
    fun api(retrofit: Retrofit): ModelMeshApi
}
```

`explicitNulls = false` is the one non-negotiable setting: the backend's Zod
schema uses `.strict()` at every level and rejects explicit `null` for optional
fields (`HANDOFF.md` §6, rule 2).

`ignoreUnknownKeys = true` keeps the app alive when the backend adds fields.

### A5.2 `DatabaseModule.kt`

```kotlin
@Module @InstallIn(SingletonComponent::class)
object DatabaseModule {
    @Provides @Singleton
    fun database(@ApplicationContext ctx: Context): ModelMeshDatabase =
        Room.databaseBuilder(ctx, ModelMeshDatabase::class.java, ModelMeshDatabase.DATABASE_NAME)
            .fallbackToDestructiveMigration()  // dev only — migrations needed for production
            .build()

    @Provides
    fun taskDao(db: ModelMeshDatabase): TaskDao = db.taskDao()
}
```

### A5.3 `RepositoryModule.kt`

```kotlin
@Module @InstallIn(SingletonComponent::class)
abstract class RepositoryModule {
    @Binds @Singleton
    abstract fun taskRepository(impl: TaskRepositoryImpl): TaskRepository

    @Binds @Singleton
    abstract fun attachmentPreprocessor(impl: OnDevicePreprocessor): AttachmentPreprocessor
}
```

### A5.4 `WorkModule.kt`

```kotlin
@Module @InstallIn(SingletonComponent::class)
object WorkModule {
    @Provides @Singleton
    fun workManager(@ApplicationContext ctx: Context): WorkManager = WorkManager.getInstance(ctx)
}
```

---

## A6 — Application class

**Target file:** `apps/android/app/src/main/kotlin/com/modelmesh/ModelMeshApplication.kt`

```kotlin
@HiltAndroidApp
class ModelMeshApplication : Application() {

    @Inject lateinit var workManager: WorkManager

    override fun onCreate() {
        super.onCreate()
        scheduleBackgroundSync()
    }

    private fun scheduleBackgroundSync() {
        val request = PeriodicWorkRequestBuilder<TaskSyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(Constraints(requiredNetworkType = NetworkType.CONNECTED))
            .build()
        workManager.enqueueUniquePeriodicWork(
            "task-sync",
            ExistingPeriodicWorkPolicy.KEEP,
            request,
        )
    }
}
```

---

## A7 — Proguard rules

**Target file:** `apps/android/app/proguard-rules.pro`

```pro
# kotlinx.serialization
-keepattributes *Annotation*, InnerClasses
-dontnote kotlinx.serialization.AnnotationsKt
-keep,includedescriptorclasses class com.modelmesh.**$$serializer { *; }
-keepclassmembers class com.modelmesh.** {
    *** Companion;
}
-keepclasseswithmembers class com.modelmesh.** {
    kotlinx.serialization.KSerializer serializer(...);
}

# socket.io-client
-keep class io.socket.** { *; }
-keep class io.socket.client.** { *; }

# Retrofit + OkHttp
-dontwarn okhttp3.**
-keep class retrofit2.** { *; }
-keep interface retrofit2.** { *; }
-keepattributes Exceptions

# Room
-keep class * extends androidx.room.RoomDatabase
-dontwarn androidx.room.**

# ML Kit
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.** { *; }

# Hilt
-keep class dagger.hilt.** { *; }
-keep @dagger.hilt.InstallIn class * { *; }
-keep @dagger.hilt.android.HiltAndroidApp class * { *; }

# Enums
-keepclassmembers enum com.modelmesh.** {
    public static **[] values();
    public static ** valueOf(java.lang.String);
}
```

---

## A8 — JVM unit tests

**Target directory:** `apps/android/app/src/test/kotlin/com/modelmesh/`

Write tests that run on the JVM without a device. Prioritize:

1. `data/local/ConvertersTest.kt` — round-trip every converter: a fully-populated
   domain object → JSON string → back. Assert field-level equality. No Room/Android
   involved.
2. `domain/usecases/SubmitTaskUseCaseTest.kt` — mock `TaskRepository`, verify
   `InputType` derivation (text-only → TEXT, single image no intent → IMAGE,
   barcode hit → QR, mixed → MULTIPART) and that `userIntent` and attachment text
   stay separate (Rule 6: `submission.userIntent` never contains
   `attachment.detectedText`).
3. `util/AppResultTest.kt` — `map`, `onSuccess`, `onFailure`, `getOrNull` edge cases.
4. `data/models/ExecutionTimelineTest.kt` — fold events, check `stages`, `subtasks`,
   `outcome`, `withEvent` deduplication.

Run via `pnpm --filter @modelmesh/android test` if Android test runner is
configured in the gradle setup, or document exactly how to run them.

---

## A9 — Scripts

**Target directory:** `/home/pramodsb/Downloads/newmodel/Model_Mesh/scripts/`

Read `apps/api/package.json` for the exact script names before writing these.
The root `package.json` delegates `pnpm run seed` → `pnpm --filter @modelmesh/api run seed`
and `pnpm run test-providers` → the same for `test-providers`.

### A9.1 `setup.sh`

Covers the actual prerequisites:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Check Node version (≥ 20)
# 2. Check pnpm (≥ 11)
# 3. pnpm install
# 4. Check Redis is reachable (REDIS_URL from .env or default)
# 5. Check Postgres is reachable (DATABASE_URL from .env or skip with a warning)
# 6. pnpm --filter @modelmesh/api prisma generate
# 7. pnpm --filter @modelmesh/api prisma migrate dev (if DATABASE_URL is set)
# 8. Print next steps for Android (requires JDK 17, Android Studio / SDK)
```

Read `apps/api/src/config.ts` for the exact env-var names so the checks match.
Do not hard-code any URL.

### A9.2 `seed-keys.ts`

Invoked as `pnpm --filter @modelmesh/api tsx ../../scripts/seed-keys.ts`.

Reads provider keys from env vars (`GEMINI_API_KEYS`, `GROQ_API_KEYS`, …), calls
the running API at `API_URL` (env, default `http://localhost:3000`) with
`POST /api/v1/providers/keys` for each. Uses the app's own `API_SECRET` env var as
the X-API-Key header. Idempotent (the backend deduplicates by key hash).

Read `apps/api/src/keys/manager.ts` for the expected request shape before writing
the POST body.

### A9.3 `test-providers.ts`

Submits a minimal text task through the running API (`POST /api/v1/tasks`), polls
`GET /api/v1/tasks/:id` until terminal, and prints a summary. Uses the mock
provider when no real keys are configured (`MOCK_PROVIDER=true` or no provider
keys in env). Never requires real keys.

---

## A10 — Documentation

### `README.md` (project root)

Describe the **implemented** project:

1. What ModelMesh is and what it does (2–3 paragraphs, from `CLAUDE.md` §1)
2. Architecture overview — backend pipeline, Android app, the six rules
3. Directory structure — from `CLAUDE.md` §3, trimmed to what was actually built
4. Prerequisites — Node ≥ 20, pnpm ≥ 11, Postgres 15, Redis 7, Android Studio
   Ladybug (AGP 8.7.3, JDK 17, Android SDK 35)
5. Quick start — `./scripts/setup.sh`, then server, then Android Studio
6. Running tests — `pnpm test`, what the 192 backend tests cover
7. Environment variables — table from `CLAUDE.md` §5 mapped to actual config.ts names
8. Android app — screens, socket protocol, Rule 6 user-intent separation
9. Contributing / license placeholder

### `.claude/IMPLEMENTATION-NOTES.md`

Record every deviation from the spec:

- Missing `.claude/` doc files (03, 05-partial, 10-15) and how gaps were bridged
- `MemoryStore`/`MemoryPersistence`/`MockProvider` used where spec implied Postgres/Redis
- Integration test rate limits raised to avoid false failures
- Telemetry honesty fix (pipeline.ts) and what the old code would have claimed
- Cleartext HTTP fix in the manifest
- `@Serializable` mirror classes in `Converters.kt` (frozen domain models cannot carry annotations)
- Any Track A deviation from the frozen contract (if any — list explicitly)

---

## A11 — Static validation (run these, report real output)

After writing every file:

```bash
# 1. Package consistency
find apps/android -name '*.kt' | while read f; do
  pkg=$(grep '^package' "$f" | head -1 | awk '{print $2}')
  expected=$(echo "$f" | sed 's|.*/kotlin/||; s|/|.|g; s|\.kt$||')
  [ "$pkg" != "$expected" ] && echo "MISMATCH: $f declares $pkg expected $expected"
done

# 2. Symbol cross-reference: every imported com.modelmesh.* exists
grep -rho 'com\.modelmesh\.[A-Za-z0-9_.]*' apps/android --include='*.kt' | sort -u > /tmp/refs.txt
find apps/android -name '*.kt' | xargs grep -lh 'class\|object\|interface\|fun\|enum' \
  | xargs grep -ho 'package com\.modelmesh[A-Za-z0-9_.]*\|class [A-Za-z0-9_]*\|object [A-Za-z0-9_]*\|interface [A-Za-z0-9_]*\|enum class [A-Za-z0-9_]*' \
  | sort -u > /tmp/symbols.txt
# diff /tmp/refs.txt /tmp/symbols.txt  (manual inspection)

# 3. No hard-coded secrets
grep -rn 'AIzaSy\|sk-\|gsk_\|mistral-' apps/android --include='*.kt' && echo "FOUND SECRET" || echo "clean"

# 4. Rule 6 — userIntent never gets detectedText appended
grep -rn 'userIntent.*detectedText\|detectedText.*userIntent\|+=.*detectedText' \
  apps/android --include='*.kt' && echo "RULE 6 VIOLATION" || echo "clean"

# 5. Retrofit paths match backend
grep -n '@POST\|@GET\|@PUT\|@DELETE' apps/android/app/src/main/kotlin/com/modelmesh/data/api/ModelMeshApi.kt

# 6. Socket event names
grep -n 'EVENT_\|"trace\|"subscribe\|"unsubscribe\|"trace_history"' \
  apps/android/app/src/main/kotlin/com/modelmesh/data/api/TraceSocketClient.kt

# 7. Room schema export exists after first build
ls apps/android/app/schemas/

# 8. Backend tests still pass
cd /home/pramodsb/Downloads/newmodel/Model_Mesh && pnpm --filter @modelmesh/api test
pnpm --filter @modelmesh/api typecheck
pnpm --filter @modelmesh/api build
```

Paste the **real output** of every command into `.claude/TRACK-A-REPORT.md`.

---

## A12 — Report

Write to `.claude/TRACK-A-REPORT.md` in this exact structure:

```
PHASE 3 TRACK A — DATA LAYER
Status:
Files created:
Files modified:
Architecture implemented:
Static validation performed:  <exact commands + real output>
Compilation:  <what ran, exact reason if nothing could>
Problems found:
Problems fixed:
Remaining problems:
Exact next task:
```

Also run and report:
```
pnpm --filter @modelmesh/api test       # must still say 192 passed
pnpm --filter @modelmesh/api typecheck  # must be clean
pnpm --filter @modelmesh/api build      # must succeed
```
