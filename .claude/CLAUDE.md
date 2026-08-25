# ModelMesh — Claude Code Fast Controller

> Execution controller only. Deep project specifications live in `.claude/specs/` and are loaded on demand. **Do not read every `.claude` file.**

## Mission
ModelMesh is an AI Workload Planner & Orchestrator: classify → enhance → optimize → DAG-decompose → plan → schedule → execute across providers → recover → aggregate → verify → telemetry/calibration.

## Non-negotiables
- Preserve the existing architecture unless the user explicitly requests an architectural change.
- Do not refactor unrelated code.
- Do not modify frozen/shared contracts merely because they are inconvenient.
- Never invent APIs, models, files, test results, or environment capabilities.
- Never expose secrets.
- Prefer the smallest correct change.
- Verification must be proportional to the change.
- Do not scan the whole repository for an isolated task.

## Default workflow
1. Classify the task using `.claude/routing/task-router.md`.
2. Load **only** the relevant workflow and at most 2 relevant specs.
3. Locate target files/symbols and inspect immediate dependencies.
4. Implement the smallest correct patch.
5. Run the narrowest meaningful validation.
6. If validation fails, debug the failure before broadening scope.
7. Report changed files + validation and stop.

## Normal scope limits
- Start with ≤8 source files inspected.
- Start with ≤2 specs loaded.
- Prefer targeted tests/typecheck over full suites.
- Never run a full monorepo build/test as a ritual.
- Exceed limits only when dependency analysis requires it.

## Modes
- `/fast` — normal implementation; minimal scope + targeted validation.
- `/debug` — reproduce → isolate → patch → regression validation.
- `/test` — diagnose tests/build/type errors without unrelated edits.
- `/architect` — cross-module/new subsystem work; broader inspection allowed.
- `/deep` — major correctness investigation; full evidence allowed.

No mode = **FAST**.

## Anchors
- Backend: `apps/api/`
- Android: `apps/android/`
- Docs: `docs/`
- Router: `.claude/routing/task-router.md`
- State: `.claude/state/PROJECT-STATE.md`
- Ownership: `.claude/state/FILE-OWNERSHIP.md`
- Specs: `.claude/specs/`

## Current constraints
- Stack: `.claude/specs/tech-stack.md`
- Current state: `.claude/state/PROJECT-STATE.md`
- Parallel Android ownership: `.claude/state/FILE-OWNERSHIP.md`
- Historical handoff/logs are in `.claude/archive/` and are **not routine context**.

## Completion rule
Done = requested behavior implemented + appropriate validation passes. Do not continue searching for hypothetical improvements.
