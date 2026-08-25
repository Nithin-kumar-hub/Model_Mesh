PHASE 3 TRACK B — ANDROID UI

Status: COMPLETE. All of B1–B10 implemented. Track B is code-complete and statically
validated. It cannot be *compiled* in this environment (no Kotlin/Android toolchain —
see "Compilation" below) and cannot be *assembled* into an APK until Track A lands two
runtime deliverables it does not own (see "Remaining problems"). No frozen contract was
modified; no Track A file was authored.

------------------------------------------------------------------------------------
Files created  (net-new; these are the ONLY untracked paths in `git status`)
------------------------------------------------------------------------------------
Kotlin — presentation layer (23 files), all under
apps/android/app/src/main/kotlin/com/modelmesh/ :

  MainActivity.kt                          B3  @AndroidEntryPoint, edge-to-edge, share intake
  ui/navigation/ModelMeshNavHost.kt        B4  3 routes; only taskId crosses a boundary
  ui/input/SharedContent.kt                B4  Rule-6 split at the share boundary
  ui/input/MultimodalInputScreen.kt        B6  compose intent + attach material + strategy
  ui/input/MultimodalInputViewModel.kt     B6  @HiltViewModel over the frozen use cases
  ui/input/CameraCapture.kt                B6  CameraX; writes to cacheDir; NO FileProvider
  ui/execution/ExecutionTraceScreen.kt     B7  live pipeline/DAG/subtasks/telemetry
  ui/execution/ExecutionTraceViewModel.kt  B7  combine(observeTrace, observeTask)
  ui/result/ResultScreen.kt                B8  output + verification + telemetry + feedback
  ui/result/ResultViewModel.kt             B8  snapshot + 1–5 rating -> SubmitFeedbackUseCase
  ui/theme/Color.kt  ui/theme/Type.kt  ui/theme/Theme.kt                       B2
  ui/components/TaskStatusChip.kt          Formatting.kt        ExecutionStageCard.kt   B5
  ui/components/SubtaskProgressCard.kt     TelemetryCard.kt     ContextSavingsCard.kt   B5
  ui/components/PlanDagView.kt             AttachmentPreview.kt TraceTimeline.kt        B5
  ui/components/ErrorBanner.kt                                                          B5

res/ resources (11 files) under apps/android/app/src/main/res/ :               B1
  values/{colors,strings,themes}.xml   values-night/{colors,themes}.xml
  drawable/ic_launcher_foreground.xml  mipmap-anydpi-v26/{ic_launcher,ic_launcher_round}.xml
  xml/{backup_rules,data_extraction_rules,network_security_config}.xml

Docs (Track B-owned):
  .claude/TRACK-B-REPORT.md            (this file)
  .claude/TRACK-B-CONTRACT-REQUESTS.md (records 0 contract changes + 2 Track A runtime deps)

------------------------------------------------------------------------------------
Files modified
------------------------------------------------------------------------------------
NONE by me. `git status` shows " M" against ~250 files across the whole monorepo
(apps/api/**, packages/types/**, .claude/**, gradle files, and Track A's data/ + domain/).
That flag is a pre-existing line-ending (CRLF<->LF) artifact of the Windows->Linux mount,
NOT authored content — proven below. My entire authored contribution is the untracked
paths listed above.

------------------------------------------------------------------------------------
Architecture implemented
------------------------------------------------------------------------------------
Single-Activity + Jetpack Compose + Material 3, Hilt-injected ViewModels that depend
ONLY on the 8 frozen use cases, Navigation-Compose with process-death-safe state.

  Rule 1 (never send full context to every model): the UI never assembles or forwards a
    master context. Attachments travel as PreparedAttachment; per-subtask token counts
    are shown from telemetry, never synthesised.
  Rule 2 (DAG, not a list): PlanDagView renders parallel groups / widest batch from
    PlanSummary & PlanPreview — dependencies are shown, not a flat sequence.
  Rule 3 (capability routing): the "prefer on-device models" control is labelled a hint
    ("It routes on capability and may override this."), never a guarantee.
  Rule 4 (calibration): ResultScreen collects a 1–5 rating + optional comment ->
    SubmitFeedbackUseCase. Telemetry is captioned as covering only what completed.
  Rule 5 (confidence drives compute): confidence surfaced on output, verification and
    subtasks via formatConfidence; the strategy selector exposes DRAFT/BALANCED/PREMIUM.
  Rule 6 (intent vs. untrusted material) — enforced at THREE layers:
    (a) system share: MainActivity.parseSharedContent keeps text (instruction) and
        image/PDF EXTRA_STREAM (material) in separate SharedContent fields;
    (b) input screen: shared/typed text only ever fills the instruction field; a shared
        or picked file is routed via onAttachmentPicked and never merged into text;
    (c) the instruction field and the attachment list are structurally distinct and the
        UI never copies extracted document text into the instruction.

Truthful telemetry: failed / skipped / partial each have an explicit rendering path;
no savings or success numbers are shown for work that did not run.

Secrets: none in Kotlin. No API keys, tokens, or secrets appear anywhere in Track B
(secrets sweep returned zero hits). Key handling stays in Track A's build config / data
layer, untouched.

------------------------------------------------------------------------------------
Static validation performed   (exact commands + REAL output; no compilation claimed)
------------------------------------------------------------------------------------
1) Toolchain availability
   $ for t in kotlinc gradle ktlint javac java; do command -v $t; done; echo $ANDROID_HOME
   -> kotlinc: absent | gradle: absent | ktlint: absent | javac: absent
      java: PRESENT (/usr/bin/java, JRE launcher only) | ANDROID_HOME=<unset>

2) Package declaration vs directory path  (all 23 Track B .kt files)
   -> package/path mismatches: 0

3) Brace / paren / bracket balance  (string- & comment-aware, all 23 files)
   -> files checked: 23 | imbalanced: 0

4) XML well-formedness  (all 11 res files, via xml.dom.minidom)
   -> res xml files malformed: 0

5) Banned patterns in Track B
   $ grep -rn "com.google.android.material" <ui/ + MainActivity.kt>  -> none
   $ grep -rn "FileProvider"                <ui/ + MainActivity.kt>  -> 1 hit, and it is
       a COMMENT in CameraCapture.kt documenting that FileProvider is deliberately NOT
       used (capture writes to cacheDir and returns a file:// URI). No API usage.

6) Secrets sweep  (sk-*, api_key/secret/bearer literals) in Track B  -> none

7) Track A import resolution  (every com.modelmesh.{data,domain,util} symbol Track B
   imports must have a declaration on disk)
   -> 35 imported symbols, unresolved: 0.  Includes all 8 frozen use cases
      (Get/GetHistory/ObserveTask/ObserveTrace/Preprocess/Recover/SubmitFeedback/SubmitTask).

8) Ownership boundary  (git status --porcelain)
   -> untracked (net-new) paths = exactly: MainActivity.kt, ui/, res/  (nothing else).
   -> tree-wide " M" proven to be a line-ending artifact, not my edits:
        $ git diff --stat -- data/models/TaskSnapshot.kt  -> 139 insertions, 139 deletions
        $ git diff --stat -- apps/api/src/server.ts        -> 179 insertions, 179 deletions
        $ git diff --ignore-all-space --stat -- apps/api/src/server.ts  -> (empty)
      Equal insert/delete counts on files I never opened (incl. api TypeScript) + an empty
      whitespace-insensitive diff == pure CRLF<->LF flip. Not authored content.

9) Manifest integration  (read-only; AndroidManifest.xml is Track A / frozen)
   -> launches ".MainActivity" as LAUNCHER (my class satisfies it);
   -> declares CAMERA + RECORD_AUDIO (backs CameraCapture's runtime permission request);
   -> ACTION_SEND filter = { text/plain, image/*, application/pdf } — an EXACT match for
      MainActivity.parseSharedContent's accepted types.

------------------------------------------------------------------------------------
Compilation
------------------------------------------------------------------------------------
NOT PERFORMED — impossible in this environment. There is no Kotlin compiler (kotlinc
absent), no Android SDK (ANDROID_HOME unset), no Gradle, no ktlint, and no JDK compiler
(javac absent; only a bare `java` launcher exists). Per the task directive, compilation
was neither run nor fabricated; equivalent structural checks were run instead (above).
Real compilation must be run by a Track owner who has JDK 17 + Android SDK + Gradle.

------------------------------------------------------------------------------------
Problems found
------------------------------------------------------------------------------------
P1  ExecutionTraceViewModel derived `failed` from a fragile string compare
    (status.name == "FAILED").
P2  ExecutionTraceScreen used a `Modifier.clipToDot()` helper that referenced .clip/
    .background without imports, plus an unused graphics.Color import.
P3  MainActivity carried an unused `import ...ui.navigation.Screen` (routing is fully
    internal to the nav host).

------------------------------------------------------------------------------------
Problems fixed
------------------------------------------------------------------------------------
P1  Now compares against the typed enum: `snapshot?.status == TaskStatus.FAILED`
    (import added); `replanning` simplified to the last-event == TraceEventName.REPLANNING.
P2  Inlined the status dot as size(8.dp).clip(CircleShape).background(dot); added
    foundation.background + shape.CircleShape + draw.clip imports; removed the helper and
    the dead graphics.Color import.
P3  Removed the unused import.
All three were self-caught during construction; no user correction was required.

------------------------------------------------------------------------------------
Remaining problems  (all are cross-track dependencies, NOT Track B defects)
------------------------------------------------------------------------------------
R1  ModelMeshApplication.kt is ABSENT. The frozen manifest sets
    android:name=".ModelMeshApplication"; the app will not launch until Track A provides
    that @HiltAndroidApp class. Track A owns it — Track B must not create it.
R2  di/ (Hilt modules binding the repository + use cases) is ABSENT. Track B's
    @HiltViewModels resolve their use cases at compile/assemble time from these modules.
    Track A owns di/ — Track B must not create it.
Both have KNOWN, stable contracts (the 8 use cases already exist on disk and all resolve),
so this is normal concurrent-engineering sequencing, not a contract gap. No contract
CHANGE is requested — see TRACK-B-CONTRACT-REQUESTS.md.

Note: repo is on branch `main`, not `track/b-ui-layer`. Flagged for whoever integrates;
Track B did not create or switch branches.

------------------------------------------------------------------------------------
Exact next task
------------------------------------------------------------------------------------
Hand off to Track A to (1) add ModelMeshApplication.kt (@HiltAndroidApp) and (2) complete
di/ Hilt modules. Once both exist alongside this UI, run a real Gradle build
(./gradlew :app:assembleDebug) on a machine with JDK 17 + Android SDK to obtain the
compilation result this environment could not produce, then wire an optional androidTest/
smoke test for the input -> execution -> result nav flow.
