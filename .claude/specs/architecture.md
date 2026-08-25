# 01 — System Architecture

## The Complete Flow

ModelMesh processes every task through 15 layers. Each layer is independently testable.

```
┌─────────────────────────────────────────────────────────┐
│                   USER / ANDROID APP                    │
│  Text | Code | Camera | QR | PDF | Image | Audio | Video │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 1: LOCAL PREPROCESSING              │
│  (Android on-device — before any network call)          │
│  ML Kit OCR | Barcode | Dimensions | Duration | Metadata │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 2: TASK UNDERSTANDING               │
│  Intent | Modality | Complexity | Confidence             │
│  Rule-based → On-device LLM → Cloud classifier          │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 3: TASK ENHANCER                    │
│  Goal | Constraints | Structure | Expected Output Format │
│  Transforms vague → structured specification            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 4: TOKEN OPTIMIZER (GLOBAL)         │
│  Remove redundancy | Compress | Normalize | Deduplicate  │
│  Operates on the enhanced master task                    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 5: TASK DECOMPOSER                  │
│  Single task OR Multi-subtask DAG                       │
│  Builds dependency graph between subtasks               │
└──────────────────────┬──────────────────────────────────┘
                       │
          ┌────────────┼───────────────┐
          ▼            ▼               ▼
     SUBTASK A    SUBTASK B       SUBTASK C
          │            │               │
          ▼            ▼               ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 6: PER-SUBTASK PROFILING            │
│  Estimate: input tokens | output tokens | latency | cost │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 7: PER-SUBTASK OPTIMIZATION         │
│  Context slicing | Prompt optimization | Compression     │
│  Each subtask gets ONLY the context it needs            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 8: EXECUTION PLAN OPTIMIZER         │
│  Generate 3 candidate plans:                            │
│    Plan A (draft): cheapest, serial                     │
│    Plan B (balanced): best cost/latency/quality trade    │
│    Plan C (premium): best quality, max parallel          │
│  Select based on user's chosen strategy                  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 9: PARALLEL SCHEDULER               │
│  Extract independent groups from DAG                    │
│  Schedule parallel batches, sequential where needed     │
│  Consider: quota, latency, failure risk                 │
└──────────────────────┬──────────────────────────────────┘
                       │
              ┌────────┴────────┐
              ▼                 ▼
         PARALLEL          SEQUENTIAL
         EXECUTION         EXECUTION
              │                 │
              └────────┬────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 10: KEY MANAGER                     │
│  Per-provider key pool | Health scoring | Quota tracking │
│  Priority queue: highest-health key first               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 11: PROVIDER ADAPTERS               │
│  Gemini | Groq | Together | Mistral | OpenRouter        │
│  Unified interface: all return SubTaskResult            │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 12: FAILURE RECOVERY                │
│  classify error → retry → rotate key → swap model       │
│  Dynamic re-planning if plan becomes invalid            │
│  Other subtasks continue during individual failures     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 13: RESULT AGGREGATOR               │
│  Collect all results → Deduplicate → Detect conflicts   │
│  Synthesize into coherent combined answer               │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 14: VERIFIER                        │
│  Triggered when: confidence < 0.6 | conflict detected   │
│  Critic model checks consistency, evidence, accuracy    │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               LAYER 15: OUTPUT OPTIMIZER                │
│  Structure | Remove duplicates | Format | Quality check  │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│               TELEMETRY + CALIBRATION                   │
│  Estimated vs Actual: tokens | latency | cost            │
│  Prediction error → calibration → better future estimates│
└─────────────────────────────────────────────────────────┘
```

---

## Subsystem Relationships

```
                    ┌─────────────────────┐
                    │   INTELLIGENCE CORE  │
                    │  classify            │
                    │  enhance             │
                    │  decompose           │
                    │  profile             │
                    └──────────┬──────────┘
                               │ produces DAG + plan
                    ┌──────────▼──────────┐
                    │  ORCHESTRATION CORE  │
                    │  plan                │
                    │  schedule            │
                    │  execute             │
                    │  recover             │
                    └──────────┬──────────┘
                               │ calls providers
           ┌───────────────────┼───────────────────┐
           │                   │                   │
  ┌────────▼────────┐ ┌────────▼────────┐ ┌───────▼────────┐
  │  KEY MANAGER    │ │ PROVIDER LAYER  │ │  SEMANTIC CACHE │
  │  pool/health/   │ │ gemini/groq/etc │ │  avoid repeat   │
  │  quota/rotation │ │ unified adapter │ │  LLM calls      │
  └────────┬────────┘ └────────┬────────┘ └───────┬────────┘
           └───────────────────┼───────────────────┘
                               │ results
                    ┌──────────▼──────────┐
                    │   AGGREGATION CORE  │
                    │  collect            │
                    │  deduplicate        │
                    │  conflict detect    │
                    │  synthesize         │
                    │  verify             │
                    └──────────┬──────────┘
                               │
                    ┌──────────▼──────────┐
                    │   TELEMETRY CORE    │
                    │  record everything  │
                    │  calibrate models   │
                    │  improve estimates  │
                    └─────────────────────┘
```

---

## DAG Execution Model

The core of ModelMesh's orchestration is a **Directed Acyclic Graph** of subtasks.

### Why DAG?

A simple queue (`[A, B, C, D]`) can only do sequential or all-parallel. A DAG lets you express:

```
A and B are independent → run parallel
C depends on A          → wait for A
D depends on B and C    → wait for both
```

This is expressed as:
```
A ──────────────────────────────────► (done)
                                         │
B ──────────────────────────────────►    │
     │                               C ──┤
     │ (B done)                          │
     └──────────────────────────────►    │
                                    D ───┘
```

### Execution algorithm

```typescript
async function executeDAG(nodes: Map<string, DAGNode>) {
  const completed = new Set<string>();
  const failed = new Set<string>();
  const results = new Map<string, SubTaskResult>();

  while (completed.size + failed.size < nodes.size) {
    // Find all nodes ready to run (all deps completed)
    const ready = [...nodes.values()].filter(
      node =>
        !completed.has(node.id) &&
        !failed.has(node.id) &&
        node.dependencies.every(dep => completed.has(dep))
    );

    if (ready.length === 0) break; // deadlock or all done

    // Execute the entire ready batch in parallel
    const results = await Promise.allSettled(
      ready.map(node => executeSubTask(node))
    );

    // Process results, update completed/failed sets
    results.forEach((result, i) => {
      if (result.status === 'fulfilled') completed.add(ready[i].id);
      else failed.add(ready[i].id);
    });
  }

  return { completed, failed, results };
}
```

---

## Three Execution Strategies

| Dimension | Draft | Balanced | Premium |
|-----------|-------|----------|---------|
| Goal | Cheapest | Best tradeoff | Best quality |
| Parallelism | Minimal | Medium | Maximum |
| Model tier | Fastest/cheapest | Mid-tier | Top models |
| Verification | Skip | When confident < 0.7 | Always |
| Context | Maximally compressed | Optimized | Full relevant context |
| Expected use | Quick questions | Daily work | Critical tasks |

---

## Real-time Execution Trace (WebSocket)

Every stage emits a WebSocket event to the Android app:

```json
{ "event": "task_received",   "taskId": "...", "ts": 1234 }
{ "event": "classified",      "taskType": "CODE_ANALYSIS", "confidence": 0.94 }
{ "event": "enhanced",        "subtaskCount": 4 }
{ "event": "plan_selected",   "strategy": "balanced", "estimatedTokens": 18400 }
{ "event": "subtask_started", "subtaskId": "s1", "role": "SECURITY_ANALYZER" }
{ "event": "subtask_started", "subtaskId": "s2", "role": "CODER" }
{ "event": "subtask_done",    "subtaskId": "s1", "tokens": 3200, "ms": 1840 }
{ "event": "subtask_failed",  "subtaskId": "s2", "reason": "429", "retrying": true }
{ "event": "subtask_done",    "subtaskId": "s2", "tokens": 2800, "ms": 2100, "failovers": 1 }
{ "event": "aggregating",     "conflictsFound": 1 }
{ "event": "verifying",       "reason": "conflict" }
{ "event": "completed",       "totalTokens": 14200, "savedTokens": 4200, "ms": 3100 }
```

This is what powers the real-time execution trace screen in the Android app and makes the technical depth **visible to judges**.
