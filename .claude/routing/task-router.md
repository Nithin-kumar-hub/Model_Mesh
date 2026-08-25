# Task Router

| Task signal | Area | Load on demand |
|---|---|---|
| token, compression, estimator, context budget | intelligence | `specs/token-intelligence.md` |
| DAG, planner, scheduler, parallel, executor, recovery | orchestration | `specs/orchestration.md` |
| provider, Gemini, Groq, Mistral, fallback, quota | providers | `specs/providers.md` |
| role, capability, routing | agent routing | `specs/agent-roles.md` |
| API route, DTO, websocket, endpoint | API | `specs/api.md` |
| schema, Prisma, persistence, model contract | data | `specs/data-models.md` |
| system-wide design | architecture | `specs/architecture.md` |
| Kotlin, Compose, ViewModel, Room, Android | Android | relevant track file + source |
| test/build/typecheck failure | testing | target source + failure output; no broad spec unless needed |
| docs/README | documentation | target document only |

## Search policy
- Exact filename/symbol first; broad search only if needed.
- Start in the directory named by the task.
- Ignore `dist/`, caches, `node_modules`, build outputs and Gradle outputs unless debugging them.
- Prefer dependency/call-path inspection over reading whole modules.

## Escalate only when
- target cannot be identified;
- narrow fix fails;
- change crosses module boundaries;
- user explicitly requests deep analysis.
