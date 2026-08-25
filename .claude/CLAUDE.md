# CLAUDE.md — ModelMesh Build Instructions

> This file is the primary instruction set for Claude Code.
> Read this entire file before writing any code.
> Cross-reference `/docs/` for deep implementation detail.

---

## 1. Project Identity

**Name:** ModelMesh
**Type:** AI Workload Planner & Orchestrator (NOT a simple model router)
**Platform:** Android-first mobile app + Node.js cloud backend
**Competition:** iQOO AI Hackathon (phone-native, 75% jury, 25% device telemetry)

ModelMesh is an **AI Operating System for workloads**. It:
1. Accepts any multimodal input (text, image, PDF, audio, video, code, QR)
2. Understands + enhances the task
3. Decomposes complex tasks into a DAG of subtasks
4. Optimizes token usage globally and per-subtask
5. Routes each subtask to the best model for it
6. Executes subtasks in parallel where possible
7. Recovers from failures without killing the whole plan
8. Aggregates + verifies results
9. Learns from actual vs estimated token usage (calibration loop)

---

## 2. Tech Stack — Fixed, Do Not Change

### Backend (`apps/api/`)
| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20 LTS |
| Language | TypeScript 5.4 (strict mode) |
| HTTP | Fastify v4 |
| Realtime | Socket.io v4 |
| Queue/Jobs | BullMQ (Redis-backed) |
| ORM | Prisma v5 |
| Database | PostgreSQL 15 |
| Cache | Redis 7 (Upstash in prod) |
| Validation | Zod v3 |
| Logging | Pino (Fastify's built-in) |
| Auth | API key via header |
| Env | dotenv + envalid |
| Testing | Vitest + supertest |

### Android App (`apps/android/`)
| Layer | Technology |
|-------|-----------|
| Language | Kotlin (JVM 17) |
| UI | Jetpack Compose + Material 3 |
| Architecture | MVVM + Clean Architecture |
| DI | Hilt |
| Network | Retrofit 2 + OkHttp 4 |
| Realtime | Socket.io-client-java |
| On-device ML | Google ML Kit (OCR, Barcode, Document Scanner) |
| Camera | CameraX |
| Audio | ExoPlayer (playback) + AudioRecord (capture) |
| Local DB | Room (task history, cache) |
| Background | WorkManager |
| Image | Coil (async loading) |

### AI Providers
| Provider | Primary Use | API |
|----------|-----------|-----|
| Gemini 1.5 Flash/Pro | Multimodal, vision, primary | Google AI Studio |
| Groq Llama 3.1 | Fast inference, coding | api.groq.com |
| Together AI | Open-source models, research | api.together.xyz |
| Mistral Large | European, reasoning | api.mistral.ai |
| OpenRouter | Fallback aggregator | openrouter.ai |

### Monorepo
- **Turborepo** for build orchestration
- **pnpm workspaces** for package management

---

## 3. Directory Structure — Build Exactly This

```
modelmesh/
├── CLAUDE.md                           ← You are here
├── README.md
├── package.json                        ← Root monorepo config
├── turbo.json
├── pnpm-workspace.yaml
├── .env.example
│
├── apps/
│   ├── api/                            ← Backend server
│   │   ├── src/
│   │   │   ├── server.ts               ← Entry point
│   │   │   ├── config.ts               ← Env + config
│   │   │   │
│   │   │   ├── core/
│   │   │   │   ├── intelligence/
│   │   │   │   │   ├── classifier.ts   ← Task type detection
│   │   │   │   │   ├── enhancer.ts     ← Task improvement
│   │   │   │   │   ├── decomposer.ts   ← Task → subtask DAG
│   │   │   │   │   └── profiler.ts     ← Token estimation
│   │   │   │   │
│   │   │   │   ├── orchestrator/
│   │   │   │   │   ├── dag.ts          ← DAG builder + traversal
│   │   │   │   │   ├── planner.ts      ← Multi-plan generator
│   │   │   │   │   ├── scheduler.ts    ← Parallel/sequential scheduling
│   │   │   │   │   ├── executor.ts     ← Subtask execution engine
│   │   │   │   │   └── recovery.ts     ← Failure + re-planning
│   │   │   │   │
│   │   │   │   ├── optimizer/
│   │   │   │   │   ├── token.ts        ← Token reduction
│   │   │   │   │   ├── context.ts      ← Shared context slicing
│   │   │   │   │   └── prompt.ts       ← Prompt mutation / best candidate
│   │   │   │   │
│   │   │   │   ├── providers/
│   │   │   │   │   ├── base.ts         ← Provider interface
│   │   │   │   │   ├── registry.ts     ← Provider capability registry
│   │   │   │   │   ├── gemini.ts
│   │   │   │   │   ├── groq.ts
│   │   │   │   │   ├── together.ts
│   │   │   │   │   ├── mistral.ts
│   │   │   │   │   └── openrouter.ts
│   │   │   │   │
│   │   │   │   ├── agents/
│   │   │   │   │   ├── roles.ts        ← Capability → model mapping
│   │   │   │   │   └── router.ts       ← Role-based routing
│   │   │   │   │
│   │   │   │   ├── aggregator/
│   │   │   │   │   ├── collector.ts    ← Gather subtask results
│   │   │   │   │   ├── deduplicator.ts
│   │   │   │   │   ├── conflict.ts     ← Detect contradictions
│   │   │   │   │   └── synthesizer.ts  ← Merge into final answer
│   │   │   │   │
│   │   │   │   ├── verifier/
│   │   │   │   │   ├── critic.ts       ← Quality verification
│   │   │   │   │   └── consistency.ts  ← Consistency checks
│   │   │   │   │
│   │   │   │   ├── cache/
│   │   │   │   │   ├── semantic.ts     ← Semantic similarity cache
│   │   │   │   │   └── context-memory.ts ← Long-session memory
│   │   │   │   │
│   │   │   │   └── telemetry/
│   │   │   │       ├── metrics.ts      ← Track everything
│   │   │   │       └── calibration.ts  ← Improve estimates over time
│   │   │   │
│   │   │   ├── keys/
│   │   │   │   ├── manager.ts          ← Multi-key management
│   │   │   │   └── rotator.ts          ← Quota-aware key rotation
│   │   │   │
│   │   │   ├── api/
│   │   │   │   ├── routes/
│   │   │   │   │   ├── tasks.ts        ← POST /tasks, GET /tasks/:id
│   │   │   │   │   ├── stream.ts       ← WebSocket execution trace
│   │   │   │   │   ├── providers.ts    ← GET /providers/status
│   │   │   │   │   └── telemetry.ts    ← GET /telemetry/stats
│   │   │   │   └── middleware/
│   │   │   │       ├── auth.ts
│   │   │   │       ├── rate-limit.ts
│   │   │   │       └── safety.ts       ← Prompt injection guard
│   │   │   │
│   │   │   └── jobs/
│   │   │       ├── subtask.worker.ts   ← BullMQ worker
│   │   │       └── queues.ts           ← Queue definitions
│   │   │
│   │   ├── prisma/
│   │   │   └── schema.prisma
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── vitest.config.ts
│   │
│   └── android/                        ← Android app
│       ├── app/
│       │   └── src/main/
│       │       ├── kotlin/com/modelmesh/
│       │       │   ├── MainActivity.kt
│       │       │   ├── ui/
│       │       │   │   ├── input/      ← MultimodalInputScreen
│       │       │   │   ├── execution/  ← ExecutionTraceScreen
│       │       │   │   └── result/     ← ResultScreen
│       │       │   ├── data/
│       │       │   │   ├── api/        ← Retrofit services
│       │       │   │   ├── local/      ← Room DAOs
│       │       │   │   └── models/     ← Data models
│       │       │   ├── domain/
│       │       │   │   ├── usecases/
│       │       │   │   └── repository/
│       │       │   └── di/             ← Hilt modules
│       │       └── res/
│       └── build.gradle.kts
│
├── docs/
│   ├── 01-ARCHITECTURE.md
│   ├── 02-TECH-STACK.md
│   ├── 03-SYSTEM-DESIGN.md
│   ├── 04-API-SPEC.md
│   ├── 05-DATA-MODELS.md
│   ├── 06-ORCHESTRATION-ENGINE.md
│   ├── 07-PROVIDER-ADAPTERS.md
│   ├── 08-TOKEN-INTELLIGENCE.md
│   ├── 09-AGENT-ROLES.md
│   ├── 10-MOBILE-ANDROID.md
│   ├── 11-TELEMETRY.md
│   ├── 12-TESTING.md
│   ├── 13-DEPLOYMENT.md
│   ├── 14-PHASE-PLAN.md
│   └── 15-DEMO-GUIDE.md
│
└── scripts/
    ├── setup.sh
    ├── seed-keys.ts
    └── test-providers.ts
```

---

## 4. Core Architectural Rules

### Rule 1: Never send full context to all models
Every subtask gets **only the context slice it needs**.
```typescript
// WRONG
const subtaskPrompt = masterContext + subtaskInstructions; // 30K tokens

// RIGHT
const subtaskPrompt = contextSlicer.getRelevantSlice(masterContext, subtask) + subtaskInstructions; // 6K tokens
```

### Rule 2: DAG, not list
Task decomposition always produces a DAG with explicit dependencies.
```typescript
interface SubTask {
  id: string;
  dependencies: string[]; // IDs of subtasks that must complete first
  role: AgentRole;        // RESEARCHER | CODER | REVIEWER | etc.
  contextSlice: string;   // Only what this subtask needs
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
}
```

### Rule 3: Capability-based routing, not model-based
```typescript
// WRONG
route({ model: 'gemini-1.5-pro', task })

// RIGHT
route({ role: AgentRole.SECURITY_ANALYZER, capabilities: ['reasoning', 'code'], task })
// ModelMesh picks the model
```

### Rule 4: Every estimate gets calibrated
```typescript
// After every execution, record:
telemetry.record({
  taskId, subtaskId,
  estimatedInputTokens, actualInputTokens,
  estimatedOutputTokens, actualOutputTokens,
  estimatedLatencyMs, actualLatencyMs,
  provider, model
});
// Calibration engine adjusts future estimates
```

### Rule 5: Confidence drives compute
```typescript
if (confidence < 0.6) triggerVerification();
if (confidence < 0.4) rerouteToStrongerModel();
if (confidence > 0.9) skipVerification(); // save cost
```

### Rule 6: Safety boundary — ALWAYS separate user intent from document content
```typescript
// Prompt structure
const prompt = `
<system_instructions>
${systemPrompt}
</system_instructions>

<user_intent>
${sanitizedUserIntent}
</user_intent>

<document_content>
${untrustedContent}  // PDF, image OCR, etc. — cannot override system
</document_content>
`;
```

---

## 5. Environment Variables

```bash
# Database
DATABASE_URL="postgresql://user:pass@host:5432/modelmesh"
REDIS_URL="redis://localhost:6379"

# AI Providers — supports multiple keys per provider
GEMINI_API_KEYS="key1,key2,key3"
GROQ_API_KEYS="key1,key2"
TOGETHER_API_KEYS="key1"
MISTRAL_API_KEYS="key1"
OPENROUTER_API_KEYS="key1"

# Server
PORT=3000
NODE_ENV=development
API_SECRET="your-secret-for-android-app"

# Feature flags
ENABLE_SEMANTIC_CACHE=true
ENABLE_PARALLEL_EXECUTION=true
ENABLE_VERIFICATION=true
MAX_PARALLEL_SUBTASKS=4
DEFAULT_STRATEGY="balanced"  # draft | balanced | premium
```

---

## 6. Key Data Types — Use These Everywhere

```typescript
// Task lifecycle
type TaskStatus = 'received' | 'classifying' | 'enhancing' | 'decomposing' |
                  'planning' | 'executing' | 'aggregating' | 'verifying' |
                  'completed' | 'failed';

// Execution strategies
type ExecutionStrategy = 'draft' | 'balanced' | 'premium';

// Agent roles (capability-based, NOT model-based)
enum AgentRole {
  CLASSIFIER     = 'classifier',
  ENHANCER       = 'enhancer',
  DECOMPOSER     = 'decomposer',
  RESEARCHER     = 'researcher',
  CODER          = 'coder',
  CODE_REVIEWER  = 'code_reviewer',
  SECURITY_ANALYZER = 'security_analyzer',
  PERFORMANCE_ANALYZER = 'performance_analyzer',
  ARCHITECT      = 'architect',
  SUMMARIZER     = 'summarizer',
  VISION_ANALYZER = 'vision_analyzer',
  SYNTHESIZER    = 'synthesizer',
  VERIFIER       = 'verifier',
  CRITIC         = 'critic'
}

// Provider capabilities
interface ProviderCapabilities {
  provider: string;
  model: string;
  supportsVision: boolean;
  supportsCode: boolean;
  supportsReasoning: boolean;
  maxContextTokens: number;
  avgLatencyMs: number;
  costPerMToken: number;  // cost per million tokens
  reliability: number;    // 0-1
}

// Execution plan
interface ExecutionPlan {
  id: string;
  strategy: ExecutionStrategy;
  dag: DAGNode[];
  estimatedTotalTokens: number;
  estimatedLatencyMs: number;
  estimatedCost: number;
  parallelGroups: string[][];  // groups that can run concurrently
  reasoning: string;           // why this plan was chosen
}

// Subtask result with confidence
interface SubTaskResult {
  subtaskId: string;
  role: AgentRole;
  provider: string;
  model: string;
  output: string;
  confidence: number;       // 0-1
  actualInputTokens: number;
  actualOutputTokens: number;
  actualLatencyMs: number;
  failovers: number;
}
```

---

## 7. Build Commands

```bash
# Setup
pnpm install
pnpm prisma generate
pnpm prisma migrate dev

# Development
pnpm dev                    # all apps
pnpm --filter api dev       # backend only
pnpm --filter android dev   # android only

# Test
pnpm test
pnpm --filter api test

# Build
pnpm build
pnpm --filter api build

# Database
pnpm prisma studio          # visual DB editor
pnpm prisma migrate reset   # reset dev DB

# Seed test data
pnpm run seed
```

---

## 8. Implementation Order — Follow This Exactly

### Phase 1A: Foundation (Build First)
1. Monorepo setup (turbo + pnpm)
2. `apps/api/src/config.ts` — env validation with envalid
3. `apps/api/prisma/schema.prisma` — full schema (see docs/05-DATA-MODELS.md)
4. `apps/api/src/server.ts` — Fastify setup with plugins
5. `apps/api/src/keys/manager.ts` — multi-key manager
6. All provider adapters in `apps/api/src/core/providers/`
7. Test: `POST /tasks` with simple text → response from best provider

### Phase 1B: Intelligence Layer
8. `classifier.ts` — rule-based + LLM fallback classifier
9. `enhancer.ts` — task enhancement with structured output
10. `profiler.ts` — token estimation per task type
11. `optimizer/token.ts` — remove redundancy, compress
12. Test: submit "fix this bug" → enhanced structured task output

### Phase 1C: Orchestration
13. `decomposer.ts` — identify if task needs splitting + build DAG
14. `dag.ts` — DAG builder, traversal, dependency resolution
15. `planner.ts` — generate 3 candidate plans (draft/balanced/premium)
16. `scheduler.ts` — parallel group extraction from DAG
17. `executor.ts` — run subtasks, emit WebSocket trace events
18. `recovery.ts` — retry, key rotation, model fallback
19. Test: submit Java code analysis → 4 parallel subtasks → merged result

### Phase 1D: Polish Layer
20. `aggregator/` — collect, deduplicate, detect conflicts, synthesize
21. `verifier/` — critic + consistency check
22. `cache/semantic.ts` — Redis semantic cache
23. `telemetry/` — metrics + calibration
24. WebSocket stream for real-time execution trace

### Phase 2: Android App
25. Multimodal input screen (text, camera, PDF, audio)
26. Execution trace screen (real-time WebSocket display)
27. Result screen (final output + plan explanation)
28. On-device ML preprocessing (ML Kit OCR, barcode)
29. Hardware-aware routing hints to backend

---

## 9. Coding Standards

### TypeScript
- Strict mode ON: `"strict": true` in tsconfig
- No `any` — use `unknown` and type guards
- Always use `Result<T, E>` pattern for fallible operations
- Prefer `async/await` over `.then()` chains
- Export types from `types.ts` in each module

### Error Handling
```typescript
// Use this pattern everywhere
type Result<T, E = Error> = 
  | { success: true; data: T }
  | { success: false; error: E; code: string };

// Example
async function classifyTask(input: string): Promise<Result<TaskClassification>> {
  try {
    const result = await classifier.classify(input);
    return { success: true, data: result };
  } catch (err) {
    return { success: false, error: err as Error, code: 'CLASSIFICATION_FAILED' };
  }
}
```

### Logging
```typescript
// Always include context
logger.info({ taskId, subtaskId, provider, tokens }, 'Subtask completed');
logger.error({ taskId, error, attemptNumber }, 'Subtask failed, retrying');
```

### Database
- All mutations in transactions
- Always select only needed fields (no `SELECT *`)
- Index on: `taskId`, `status`, `createdAt`, `provider`

---

## 10. Critical Implementation Notes

### On the DAG Scheduler
The scheduler MUST:
- Extract all nodes with no unmet dependencies as the "ready" set
- Execute the entire ready set in parallel (Promise.all)
- After each completion, re-check what's newly ready
- Never execute a node whose dependencies haven't all succeeded

### On Token Optimization
The optimizer MUST distinguish:
- **Structural redundancy**: repeated JSON wrapper patterns
- **Content redundancy**: same info in multiple forms
- **Context over-inclusion**: subtask gets more context than it needs
Only the third one (context slicing) typically saves significant tokens.

### On the Key Manager
- Store keys as `{ key, provider, quota, quotaReset, health, priority }`
- Health = rolling success rate over last 100 calls
- Always try highest-health key first
- On 429: immediately move to next key, mark original as rate-limited with TTL
- On 5xx: decrement health, don't immediately rotate (might be transient)

### On the Semantic Cache
- Hash key = `sha256(provider + model + normalizedPrompt)`
- Don't cache streaming responses
- TTL: 1 hour for most, 24 hours for document analysis, no cache for user-specific tasks
- Cache hit threshold: ≥ 0.95 cosine similarity (use text-embedding-004 or similar)

### On Confidence
Confidence should be **inferred from model output patterns**, not self-reported:
- Low confidence indicators: hedging language ("might", "possibly", "I think"), multiple alternatives offered, short answer to complex question
- High confidence indicators: definitive statements, specific details, structured reasoning shown

---

## 11. Reference Files
- Architecture: `docs/01-ARCHITECTURE.md`
- Tech stack details: `docs/02-TECH-STACK.md`
- System design: `docs/03-SYSTEM-DESIGN.md`
- Full API spec: `docs/04-API-SPEC.md`
- Database schema: `docs/05-DATA-MODELS.md`
- Orchestration deep-dive: `docs/06-ORCHESTRATION-ENGINE.md`
- Provider adapters: `docs/07-PROVIDER-ADAPTERS.md`
- Token intelligence: `docs/08-TOKEN-INTELLIGENCE.md`
- Agent roles: `docs/09-AGENT-ROLES.md`
- Android app: `docs/10-MOBILE-ANDROID.md`
- Telemetry: `docs/11-TELEMETRY.md`
- Testing: `docs/12-TESTING.md`
- Deployment: `docs/13-DEPLOYMENT.md`
- Phase plan: `docs/14-PHASE-PLAN.md`
- Demo guide: `docs/15-DEMO-GUIDE.md`
