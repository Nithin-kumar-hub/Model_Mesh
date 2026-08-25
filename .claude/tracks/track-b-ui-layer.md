# ModelMesh — Track B: Android UI Layer

> **Read [`HANDOFF.md`](./HANDOFF.md) first.** This file is the task list for one
> of two parallel implementation tracks. The frozen contracts it depends on are in
> `HANDOFF.md` §5, and the backend/socket contract is in §6 — those are already
> written and committed; code against them.
>
> **Track B owns:** `MainActivity.kt`, everything under `ui/`, everything under
> `app/src/main/res/`, and optional `androidTest/`.
>
> **Track B does NOT touch:** `data/`, `domain/`, `di/`, `ModelMeshApplication.kt`,
> `AndroidManifest.xml`, any `*.gradle.kts`, `apps/api/`, `scripts/`, or `README.md`.
> Every one of those is either frozen or owned by Track A.

---

## Startup sequence

Before writing a single line:

1. Read `HANDOFF.md` in full — especially §3 (environment: **you cannot claim
   compilation** unless your machine really has Android SDK + Gradle + JDK 17),
   §4 (ownership), §5 (frozen contract), §7 (the six rules).
2. Read these frozen files — they are the entire API your screens consume:
   - `data/models/Enums.kt`
   - `data/models/TaskSubmission.kt`
   - `data/models/TaskSnapshot.kt`
   - `data/models/TraceEvent.kt`
   - `data/models/ExecutionTimeline.kt`   ← the trace screen's whole data model
   - `data/models/TraceStream.kt`
   - `domain/preprocess/AttachmentPreprocessor.kt`
   - `domain/usecases/*.kt`  (all eight)
   - `util/AppResult.kt`
3. `cat apps/android/app/src/main/AndroidManifest.xml` — note every `@xml`,
   `@string`, `@style`, `@mipmap` reference. Every one is a file you must create
   (§B1), because the manifest is frozen and already points at them.
4. `cat apps/android/app/build.gradle.kts` — confirm which libraries you may use.
   **If a library is not in there, you may not use it** (you cannot edit the build
   file). In particular there is **no `com.google.android.material:material`**, so
   XML themes cannot use a `Theme.Material3.*` parent.

Only then write code.

---

## Hard constraints (consequences of the frozen build config)

| Constraint | Why | What to do instead |
|---|---|---|
| No Material Components XML library | not a dependency | `res/values/themes.xml` uses `parent="android:Theme.Material.Light.NoActionBar"`; Material 3 lives in Compose only |
| No `FileProvider` declared, manifest frozen | cannot add a provider | camera output goes to `context.cacheDir`, read in-process; never share a URI out |
| No binary assets can be authored | text-only tooling | launcher icon must be an **adaptive icon built from vector XML** (§B1.5) |
| `minSdk = 26` | frozen | no `LocalDate`/`java.time` desugaring worries, but no API-31-only APIs without a guard |
| ViewModels get their deps by constructor injection | Track A owns the DI graph | `@HiltViewModel class X @Inject constructor(private val useCase: …)` — never build a repository or Retrofit instance yourself |
| Compose BOM 2024.12.01 | frozen | Material 3 1.3.x API surface |
| `Theme.ModelMesh` is referenced by both `<application>` and `<activity>` | frozen manifest | the style name must match exactly |

Available and intended for use: `androidx.navigation:navigation-compose`,
`androidx.hilt:hilt-navigation-compose` (`hiltViewModel()`),
`androidx.lifecycle:lifecycle-runtime-compose` (`collectAsStateWithLifecycle()`),
`compose-material-icons-extended`, `coil-compose`, CameraX (`camera-view`'s
`PreviewView` + `LifecycleCameraController`), `accompanist-permissions`,
`media3-exoplayer` + `media3-ui`.

---

## B1 — Resources

**Target directory:** `apps/android/app/src/main/res/`

Every file here is referenced by the frozen manifest or by §B2. Missing any one of
them is a build failure.

### B1.1 `values/strings.xml`
`app_name` is required by the manifest. Add the user-facing strings your screens
need rather than hard-coding them in Composables — at minimum screen titles,
button labels, the Rule 6 explainer, and empty/error states.

### B1.2 `values/themes.xml`
```xml
<resources>
    <style name="Theme.ModelMesh" parent="android:Theme.Material.Light.NoActionBar">
        <item name="android:statusBarColor">@android:color/transparent</item>
        <item name="android:windowBackground">@color/window_background</item>
    </style>
</resources>
```
Optionally add `values-night/themes.xml`. **Do not** use a `Theme.Material3.*` or
`Theme.MaterialComponents.*` parent — that library is not on the classpath.

### B1.3 `values/colors.xml`
`window_background` plus `ic_launcher_background` (needed by §B1.5).

### B1.4 `xml/network_security_config.xml` — **required, the app cannot reach the backend without it**
The manifest sets `android:networkSecurityConfig="@xml/network_security_config"`.
Cleartext must be permitted for the dev backend hosts only:
```xml
<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <!-- The dev backend is plain HTTP on the emulator host alias or a LAN box.
         Everything else still requires TLS. -->
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">10.0.2.2</domain>
        <domain includeSubdomains="false">localhost</domain>
        <domain includeSubdomains="false">127.0.0.1</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false" />
</network-security-config>
```
If a physical device points at a LAN IP, that IP must be added here too — note
this in your report so it is discoverable.

### B1.5 Launcher icon (vector only)
- `mipmap-anydpi-v26/ic_launcher.xml` and `ic_launcher_round.xml` — `<adaptive-icon>`
  with `@color/ic_launcher_background` and `@drawable/ic_launcher_foreground`
- `drawable/ic_launcher_foreground.xml` — a `<vector>`. A mesh/graph motif
  (nodes + edges) fits the product; keep it simple and legible at 48 dp.

### B1.6 `xml/backup_rules.xml` and `xml/data_extraction_rules.xml`
Both are referenced by the frozen manifest. Exclude the Room database from
cloud backup — restoring another device's task cache would show tasks whose
backend rows do not exist.

---

## B2 — Theme

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/theme/`

### `Color.kt`
A Material 3 palette in light and dark. The palette carries meaning in this app —
define semantic colors for the execution states so the trace screen and the status
chips agree:

| Semantic | Used for |
|---|---|
| running | `StageState.RUNNING`, `SubtaskStatus.RUNNING` |
| done | `DONE`, `COMPLETED` |
| failed | `FAILED` |
| skipped | `SKIPPED` (visually distinct from failed — a skipped subtask is a consequence, not a fault) |
| pending | `PENDING` |
| savings | the token-savings readout |

Expose them via a small `@Immutable data class ExecutionColors` and a
`staticCompositionLocalOf`, or as extension properties on `ColorScheme`. Either is
fine; be consistent.

### `Type.kt`
Material 3 `Typography`. Include a monospace style for code/output blocks — the
result screen renders model output that is often markdown with fenced code.

### `Theme.kt`
```kotlin
@Composable
fun ModelMeshTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
)
```
Dynamic color requires API 31 — guard with `Build.VERSION.SDK_INT >= 31` since
`minSdk` is 26. Provide the `ExecutionColors` for the active scheme.

---

## B3 — MainActivity

**Target file:** `apps/android/app/src/main/kotlin/com/modelmesh/MainActivity.kt`

```kotlin
@AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        val shared = intent.parseSharedContent()   // see below
        setContent {
            ModelMeshTheme { ModelMeshNavHost(sharedContent = shared) }
        }
    }
}
```

`@AndroidEntryPoint` is mandatory — `hiltViewModel()` resolves through the
activity's component. `ModelMeshApplication` is `@HiltAndroidApp` and is Track A's
file; do not create it.

### Shared-intent handling
The frozen manifest registers an `ACTION_SEND` filter for `text/plain`, `image/*`,
and `application/pdf`. Parse it into a small type:
```kotlin
data class SharedContent(
    val text: String? = null,
    val streamUri: String? = null,   // Uri.toString(); the preprocessor takes a String
    val mimeType: String? = null,
)
```
Read `Intent.EXTRA_TEXT` and `Intent.EXTRA_STREAM`. Pass it into the nav host and
on to the input screen as an initial value.

**Rule 6 applies here.** Shared *text* may prefill the intent field, because the
user chose to send it as their instruction. A shared *image or PDF* must become an
attachment and go through `PreprocessAttachmentUseCase` — never dumped into the
intent field, not even as a preview string.

Also handle `onNewIntent` so a share into a running app is not dropped.

---

## B4 — Navigation

**Target file:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/ModelMeshNavHost.kt`

Three destinations, as specified in `CLAUDE.md` §3:

| Route | Screen | Args |
|---|---|---|
| `input` | `MultimodalInputScreen` | none (start destination) |
| `execution/{taskId}` | `ExecutionTraceScreen` | `taskId: String` |
| `result/{taskId}` | `ResultScreen` | `taskId: String` |

Define them as a sealed class or object with `fun route(taskId: String)` builders —
never string-concatenate a route at the call site.

Rules:
- **Only the `taskId` crosses a navigation boundary.** No snapshots, no timelines,
  no attachment bytes. Each screen's ViewModel reads `taskId` from
  `SavedStateHandle` and re-observes from the repository, which is what makes
  process death survivable.
- `input → execution` on a successful submit. Use
  `popUpTo("input") { inclusive = false }` so back returns to a clean input screen.
- `execution → result` when the timeline reports a terminal state. Replace
  execution in the back stack (`popUpTo("execution/{taskId}") { inclusive = true }`)
  so back from the result goes to input, not to a finished trace.
- The result screen must also be reachable directly from history, since a task can
  finish while the app is closed.
- Every ViewModel obtained with `hiltViewModel()`.

---

## B5 — Shared components

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/components/`

Build only what is used more than once. The justified set:

### `TaskStatusChip.kt`
Renders `TaskStatus` / `SubtaskStatus` / `StageState` with the semantic color and
the enum's own `label`. Single source of truth for state color across screens.

### `ExecutionStageCard.kt`
One `StageProgress`: stage label, state indicator, `detail` line, and
`durationMs` when known. The eight `PipelineStage` values are the visible proof
that this is a pipeline and not one API call, so this card carries the demo.

### `SubtaskProgressCard.kt`
One `SubtaskProgress`: `role.label`, status, `provider/model`, tokens, latency,
confidence, `failovers` (show a retry indicator when > 0), `fromCache` badge,
`error` / `skipReason` when present.
**Never hide a failed or skipped subtask** — truthful telemetry (`HANDOFF.md` §7).

### `TelemetryCard.kt`
`TelemetryView` or `RunOutcome`: actual tokens, saved tokens, savings percent,
`modelsUsed`, failovers, cache hits. When the run is `partial`, the savings figure
must be labelled as covering only the subtasks that ran — the backend already
computes it that way, and the UI must not imply otherwise.

### `ContextSavingsCard.kt`
`ContextSavings`: master context tokens vs sliced vs naive, and the reduction
percent. This is Rule 1 made visible — the single most important number in the
product. A simple two-bar comparison reads better than text.

### `PlanDagView.kt`
`PlanPreview.parallelGroups` / `PlanSummary.parallelGroups` drawn as ordered
batches — each group a row of nodes, groups stacked in execution order, with an
indication that within-row nodes ran concurrently. This is Rule 2 made visible
(**a DAG, not a checklist**). A `Column` of `Row`s with connectors is enough; do
not attempt a general graph layout.

### `AttachmentPreview.kt`
One `PreparedAttachment`: thumbnail via Coil for images, an icon for other types,
`displayName`, size, and **the on-device extraction result** — "1,240 characters
extracted on device" / "barcode found" / "no text found". This is where the
phone-native work becomes visible, and it is also the Rule 6 boundary the user can
see: extracted text is shown as *material*, clearly separate from their instruction.

### `TraceTimeline.kt`
The raw `List<TraceEvent>` as a scrollable timeline using each event's `summary`
and `offsetMs`. Collapsed by default behind a "show raw trace" toggle; it is the
audit view, not the primary one.

### `ErrorBanner.kt`
An `AppResult.Failure`: message plus an action appropriate to the `ErrorCode`
(retry for `OFFLINE`/`TIMEOUT`/`RATE_LIMITED`, edit-input for `INVALID_INPUT`/
`PROMPT_INJECTION`/`UNSUPPORTED_MODALITY`/`FILE_TOO_LARGE`).

---

## B6 — MultimodalInputScreen

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/input/`

### `MultimodalInputViewModel.kt`
```kotlin
@HiltViewModel
class MultimodalInputViewModel @Inject constructor(
    private val submitTask: SubmitTaskUseCase,
    private val preprocessAttachment: PreprocessAttachmentUseCase,
    private val getHistory: GetTaskHistoryUseCase,
    private val recoverUnfinished: RecoverUnfinishedTasksUseCase,
) : ViewModel()
```

State:
```kotlin
data class InputUiState(
    val userIntent: String = "",
    val attachments: List<PreparedAttachment> = emptyList(),
    val strategy: ExecutionStrategy = ExecutionStrategy.BALANCED,
    val preferences: TaskPreferences = TaskPreferences(),
    val budget: TaskBudget? = null,
    val preprocessing: Set<String> = emptySet(),   // display names in flight
    val submitting: Boolean = false,
    val error: AppResult.Failure? = null,
    val accepted: TaskAccepted? = null,            // consumed once to navigate
    val history: List<TaskListItem> = emptyList(),
    val unfinished: List<TaskListItem> = emptyList(),
)
```
Expose as `StateFlow<InputUiState>`. Navigation is a one-shot: expose `accepted`
and have the screen call `onConsumed()` after navigating, or use a
`Channel`-backed event flow. Do not navigate from inside the ViewModel.

Behaviour:
- `onIntentChange(String)` — plain state update.
- `onAttachmentPicked(uri, mimeType, displayName)` — mark in-flight, call
  `preprocessAttachment`, append the `PreparedAttachment` on success, surface the
  failure on error. Enforce **max 10 attachments** and **20 MB per file** locally
  (`HANDOFF.md` §6) so the user gets an instant message instead of a 400.
- `onRemoveAttachment(id)`.
- `onStrategyChange`, `onPreferLocalModelsChange`.
- `submit()` — call `submitTask(userIntent, attachments, strategy, budget, preferences)`
  and put the result in state. **Never construct a `TaskSubmission` here.**
- On `unfinished.isNotEmpty()`, offer to reopen those tasks — that is the
  recover-unfinished-work requirement.

### `MultimodalInputScreen.kt`
- A multiline `OutlinedTextField` for the instruction, labelled unambiguously as
  *your instruction* — the directive channel.
- An attachment row (`AttachmentPreview` per item) under a heading that reads as
  *material* (e.g. "Attached material — extracted on device"). The visual
  separation between the two is Rule 6 shown to the user.
- Add-attachment actions: gallery/document picker via
  `rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument())`
  (`arrayOf("image/*", "application/pdf", "text/*", "audio/*")`), plus camera.
- Strategy selector: a three-way `SegmentedButton` using each
  `ExecutionStrategy.label` and `.blurb`.
- A "prefer on-device models" toggle bound to `preferences.preferLocalModels`.
  It is a *hint* — the copy must not promise the backend will obey it (Rule 3).
- Submit button, disabled while `submitting` or when intent is blank and there are
  no attachments (mirrors the backend's own requirement).
- Recent tasks list from `history`, tapping through to `result/{taskId}`.
- A resume banner when `unfinished` is non-empty.

### `CameraCapture.kt` (same directory)
CameraX capture as a Composable, using `camera-view`'s `LifecycleCameraController`
with `PreviewView` in an `AndroidView`. Request `CAMERA` with
`accompanist-permissions` (`rememberPermissionState`) and render a clear rationale
when denied — a denied permission must not leave a black box.

Write the JPEG to `File(context.cacheDir, "capture-<timestamp>.jpg")` via
`ImageCapture.OutputFileOptions.Builder(file)`, then hand
`Uri.fromFile(file).toString()` to `onAttachmentPicked`. **No `FileProvider`** —
the manifest is frozen and none is declared (`HANDOFF.md` §10.6).

---

## B7 — ExecutionTraceScreen

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/execution/`

This screen is the product demo. It must make the orchestration visible.

### `ExecutionTraceViewModel.kt`
```kotlin
@HiltViewModel
class ExecutionTraceViewModel @Inject constructor(
    private val observeTrace: ObserveTraceUseCase,
    private val observeTask: ObserveTaskUseCase,
    savedStateHandle: SavedStateHandle,
) : ViewModel() {
    private val taskId: String = checkNotNull(savedStateHandle["taskId"])
}
```
The `taskId` key must match the nav argument name in §B4 exactly.

Combine the two sources: `observeTrace(taskId)` gives the live
`TimelineUpdate`; `observeTask(taskId)` gives the authoritative snapshot
(status, final telemetry). Expose:
```kotlin
data class ExecutionUiState(
    val taskId: String,
    val timeline: ExecutionTimeline,
    val connection: TraceConnection,
    val snapshot: TaskSnapshot? = null,
    val showRawTrace: Boolean = false,
) {
    val isTerminal: Boolean get() = timeline.isFinished || snapshot?.isTerminal == true
}
```
Everything the screen renders — stages, per-subtask rows, plan, context savings,
outcome — is already derived by `ExecutionTimeline`. **Do not re-implement that
folding in the ViewModel.**

Signal terminal state to the screen so it can navigate to `result/{taskId}`; the
ViewModel does not navigate.

### `ExecutionTraceScreen.kt`
Sections, top to bottom:
1. **Header** — task id (short), elapsed time from `timeline.elapsedMs`, and a
   connection indicator from `TraceConnection`. `POLLING` must say so: claiming
   "live" while polling would be a lie the user can't check.
2. **Pipeline** — the eight `PipelineStage` cards via `ExecutionStageCard`.
3. **Plan** — `PlanDagView` from `timeline.plan`, with reasoning text, plus the
   `downgraded` case surfaced (`requestedStrategy` ≠ `strategy` means the backend
   chose differently, and the user should see that).
4. **Context savings** — `ContextSavingsCard` from `timeline.contextSavings`.
5. **Subtasks** — `SubtaskProgressCard` per `timeline.subtasks`, grouped by
   parallel batch when `plan.parallelGroups` is available so concurrency is
   visible.
6. **Re-planning** — when any `REPLANNING` event exists, show it explicitly with
   the failed subtask ids. Recovering from failure is a feature; hiding it wastes
   the feature.
7. **Outcome** — `TelemetryCard` from `timeline.outcome` once present, including
   `partial` and `failedSubtasks`.
8. **Raw trace** — `TraceTimeline`, collapsed behind a toggle.

Auto-scroll to the newest activity while running; stop hijacking scroll once the
user scrolls manually.

---

## B8 — ResultScreen

**Target directory:** `apps/android/app/src/main/kotlin/com/modelmesh/ui/result/`

### `ResultViewModel.kt`
```kotlin
@HiltViewModel
class ResultViewModel @Inject constructor(
    private val observeTask: ObserveTaskUseCase,
    private val getTask: GetTaskUseCase,
    private val submitFeedback: SubmitFeedbackUseCase,
    savedStateHandle: SavedStateHandle,
) : ViewModel()
```
State: the `TaskSnapshot?`, a refreshing flag, an `AppResult.Failure?`, and
whether feedback has been submitted. `refresh()` calls `getTask`. Because
`observeTask` is offline-first, the screen renders a cached result with the radio
off — say so in the UI rather than showing a spinner over stale-but-valid data.

### `ResultScreen.kt`
Must render, in this priority order:
1. **A partial-result banner when `output.partial` is true** — state plainly that
   some subtasks did not produce a result, and list them from
   `snapshot.unfinished` (id + `role.label` + `errorCode`/skip reason).
   Never present a partial answer as complete.
2. **The output** — `output.text` as markdown-ish text with a monospace style for
   fenced blocks. A copy-to-clipboard action. Do not truncate silently; if you
   collapse a long output, make the expand affordance obvious.
3. **Confidence** — `output.confidence`, and `verification` when present
   (`verified`, `confidence`, `issues`, `verifiedBy`). When verification raised
   issues, show them. Rule 5 means low confidence triggered extra compute; the
   user should see that it happened.
4. **Telemetry** — `TelemetryCard` from `snapshot.telemetry`, including
   `modelsUsed`. Showing several distinct provider/model pairs for one request is
   the clearest evidence of the mesh.
5. **Plan summary** — subtask count, `widestBatch`, estimated vs actual tokens.
6. **Per-subtask breakdown** — `SubtaskProgressCard` for `snapshot.subtasks`,
   with failed/skipped ones present and clearly marked.
7. **Feedback** — a 1–5 rating plus optional comment via `SubmitFeedbackUseCase`.
   This feeds the backend's calibration loop (Rule 4), so it is a real control,
   not decoration.
8. **Error state** — `errorCode` when the task failed, via `ErrorBanner`, with a
   retry that returns to input carrying the original instruction if available.

Also provide a link back to `execution/{taskId}` to re-read the trace.

---

## B9 — Static validation (run these, report real output)

No Android toolchain is available in the originating environment, so validate by
inspection. If your machine *does* have SDK + Gradle + JDK 17, run
`./gradlew :app:assembleDebug` and report the real result instead of this list.

```bash
cd /home/pramodsb/Downloads/newmodel/Model_Mesh

# 1. Package declaration matches directory for every new file
find apps/android -name '*.kt' | while read f; do
  pkg=$(grep -m1 '^package' "$f" | awk '{print $2}')
  exp=$(echo "$f" | sed 's|.*/kotlin/||; s|/[^/]*\.kt$||; s|/|.|g')
  [ "$pkg" != "$exp" ] && echo "MISMATCH $f: $pkg != $exp"
done; echo "package check done"

# 2. Every com.modelmesh.* import resolves to a real file
grep -rho '^import com\.modelmesh\.[A-Za-z0-9_.]*' apps/android --include='*.kt' \
  | sed 's/^import //' | sort -u
# compare against: find apps/android -name '*.kt'

# 3. Every resource reference exists
grep -rhoE 'R\.(string|drawable|xml|color|mipmap|style)\.[a-z_0-9]+' apps/android --include='*.kt' | sort -u
grep -rhoE '@(string|drawable|xml|color|mipmap|style)/[a-z_0-9.]+' apps/android/app/src/main/res apps/android/app/src/main/AndroidManifest.xml | sort -u
ls -R apps/android/app/src/main/res

# 4. Manifest still parses, and every reference in it is satisfied
python3 -c "import xml.dom.minidom;xml.dom.minidom.parse('apps/android/app/src/main/AndroidManifest.xml');print('manifest OK')"

# 5. Every res XML parses
find apps/android/app/src/main/res -name '*.xml' -exec python3 -c "
import sys,xml.dom.minidom
for p in sys.argv[1:]:
    try: xml.dom.minidom.parse(p)
    except Exception as e: print('BAD', p, e)
" {} +

# 6. Nav routes: every navigate() target is a registered composable
grep -rn 'navigate(\|composable(' apps/android/app/src/main/kotlin/com/modelmesh/ui

# 7. SavedStateHandle keys match nav argument names
grep -rn 'savedStateHandle\[\|navArgument\|{taskId}' apps/android/app/src/main/kotlin/com/modelmesh

# 8. No forbidden dependency used (nothing outside app/build.gradle.kts)
grep -rhoE '^import (com|androidx|io|kotlinx|dagger|javax|okhttp3|retrofit2)\.[A-Za-z0-9_.]*' \
  apps/android/app/src/main/kotlin/com/modelmesh/ui | sort -u

# 9. Rule 6 — the intent field never absorbs extracted text
grep -rn 'detectedText' apps/android/app/src/main/kotlin/com/modelmesh/ui
#    every hit must be display-only; none may write into userIntent

# 10. No hard-coded secret or URL in the UI layer
grep -rnE 'http://|https://|AIzaSy|sk-|gsk_' apps/android/app/src/main/kotlin/com/modelmesh/ui

# 11. Track B stayed in its lane
git status --short | grep -v '^?? apps/android/app/src/main/kotlin/com/modelmesh/ui/\|^?? apps/android/app/src/main/res/\|MainActivity.kt\|TRACK-B'
#    should print nothing
```

Also confirm by inspection:
- every `@HiltViewModel` constructor parameter is one of the eight frozen use cases
  (anything else needs a Track A binding you cannot add);
- `MainActivity` is annotated `@AndroidEntryPoint`;
- no Composable calls a repository, Retrofit, Room, or ML Kit directly;
- no `TaskSubmission` is constructed outside `SubmitTaskUseCase`;
- failed, skipped, and partial states each have a rendering path.

---

## B10 — Report

Write to `.claude/TRACK-B-REPORT.md`:

```
PHASE 3 TRACK B — ANDROID UI
Status:
Files created:
Files modified:
Architecture implemented:
Static validation performed:  <exact commands + real output>
Compilation:  <what ran, or the exact reason nothing could — see HANDOFF.md §3>
Problems found:
Problems fixed:
Remaining problems:
Exact next task:
```

If you needed something from the frozen contract that does not exist, **do not add
it** — append it to `.claude/TRACK-B-CONTRACT-REQUESTS.md` with the exact signature
you need and why, and code around it in the meantime (`HANDOFF.md` §4).
