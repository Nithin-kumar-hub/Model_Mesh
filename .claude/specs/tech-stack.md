# 02 — Tech Stack

## Backend

### Fastify (not Express)
- 2-3x faster throughput than Express
- Built-in Zod/JSON schema validation
- Pino logger integrated
- TypeScript first-class
- Plugin system fits our modular architecture

### BullMQ (not simple Promise.all)
Why we need a proper job queue for orchestration:
- **Retry with backoff**: subtask fails → automatic retry with exponential backoff
- **Priority**: premium tasks jump the queue
- **Concurrency control**: don't hammer a single provider
- **Persistence**: if server restarts mid-execution, jobs aren't lost
- **Rate limiting**: per-provider rate limits enforced at queue level
- **Job groups**: related subtasks tracked together
- **Dashboard**: Bull Board for debugging during development

### Prisma (not raw SQL, not TypeORM)
- Type-safe queries without string SQL
- Migration system built-in
- Schema is the single source of truth
- Works great with PostgreSQL JSON columns
- Much better TypeScript ergonomics than TypeORM

### Redis (dual use)
- **BullMQ backend**: job queue persistence
- **Semantic cache**: store processed results to avoid repeat LLM calls
- **Rate limiting**: per-provider per-second limits
- **Session state**: execution plan state during long jobs

---

## AI Providers — Why Multiple

### Why not just use one provider?
```
Single provider problems:
- Rate limits hit → whole system stalls
- Model not specialized for the task
- Outage → complete failure
- Cost: one model for everything is expensive

ModelMesh advantage:
- Route code tasks to code-specialist models
- Route reasoning tasks to reasoning-specialist models
- Auto-failover across providers
- Use cheap models where quality doesn't need to be premium
```

### Provider Capability Matrix

| Provider | Model | Best For | Context | Speed | Cost |
|----------|-------|----------|---------|-------|------|
| Google AI | gemini-1.5-flash | Multimodal, speed | 1M tokens | Fast | Low |
| Google AI | gemini-1.5-pro | Complex reasoning, vision | 2M tokens | Medium | Medium |
| Groq | llama-3.1-70b-versatile | Fast code, general | 128K | Very Fast | Very Low |
| Groq | llama-3.1-8b-instant | Simple tasks | 128K | Fastest | Lowest |
| Together | deepseek-coder-v2 | Deep code analysis | 128K | Medium | Low |
| Together | Qwen2.5-72B | Research, reasoning | 128K | Medium | Low |
| Mistral | mistral-large-2 | European, reasoning | 128K | Medium | Medium |
| OpenRouter | (aggregator) | Fallback to 100+ models | Varies | Varies | Varies |

### Key selection logic
```
task.type == CODE → try Groq deepseek → fallback to Gemini Flash
task.type == VISION → Gemini 1.5 Pro (only real multimodal option)
task.type == RESEARCH → Together Qwen → Mistral Large
task.type == SIMPLE → Groq llama-3.1-8b-instant (fastest + cheapest)
task.type == COMPLEX_REASONING → Gemini 1.5 Pro → Mistral Large
```

---

## Android App

### Jetpack Compose (not XML layouts)
- Modern declarative UI
- Better performance for reactive state
- Less boilerplate than ViewBinding
- Native support for animations (execution trace screen)
- Material 3 design system

### Hilt (not Koin, not Dagger directly)
- Google-recommended DI
- Compile-time verification
- Zero runtime cost
- ViewModels + WorkManager + Retrofit all integrate cleanly

### CameraX
- Vendor-specific abstractions (important for iQOO)
- Auto-handles camera lifecycle
- Preview + capture + analysis modes
- Works with ML Kit analyzer pipeline

### ML Kit (on-device processing)
- Text recognition (OCR): works offline
- Barcode/QR scanning: instant, offline
- Document Scanner API: full PDF flow on device
- Language detection: route to correct language model
- Smart Reply: optional feature

Why this matters for iQOO hackathon:
> The official guidance explicitly rewards local/on-device work. Every byte of preprocessing done on the phone before hitting the cloud demonstrates phone-native thinking.

### Room (local cache)
- Task history (survives network outages)
- Recent results (offline viewing)
- Config cache (providers available, strategies)

---

## Monorepo Setup

### Turborepo + pnpm workspaces
```
Why monorepo?
- Shared TypeScript types between API and potential web dashboard
- Single CI/CD pipeline
- Atomic commits across frontend/backend
- Turbo's build cache: unchanged packages don't rebuild

Package structure:
packages/types/  ← shared TypeScript types
                   (used by both api and any web client)
apps/api/        ← backend (consumes packages/types)
apps/android/    ← Android (has its own Kotlin types)
```

### Why NOT Docker for Android?
The Android app is built natively with Android Studio / Gradle. Docker is only used for PostgreSQL and Redis in development.

---

## Database Design Philosophy

### PostgreSQL over MongoDB/SQLite
- Proper ACID transactions for quota management (key rotation)
- JSON columns for flexible task metadata
- Strong indexing for telemetry queries
- Native array types for storing multiple API keys
- Mature, production-proven

### What goes in PostgreSQL vs Redis
```
PostgreSQL:
- Tasks (durable, queryable)
- Subtasks and their results
- Provider configurations
- Telemetry records (for calibration)
- Key metadata (health, quota)

Redis:
- Job queues (BullMQ)
- Semantic cache (TTL-based)
- Rate limit counters (sliding window)
- Active execution state (ttl = task timeout)
```

---

## Development Environment

```bash
# Prerequisites
node 20.x          # via nvm or fnm
pnpm 8.x           # npm install -g pnpm
docker             # for postgres + redis
android studio     # for android app

# For Android: set ANDROID_HOME, JAVA_HOME to JDK 17
```

### Recommended VS Code extensions
```json
{
  "recommendations": [
    "prisma.prisma",
    "bradlc.vscode-tailwindcss",
    "dbaeumer.vscode-eslint",
    "esbenp.prettier-vscode",
    "ZixuanChen.vitest-explorer",
    "ms-vscode.vscode-typescript-next"
  ]
}
```
