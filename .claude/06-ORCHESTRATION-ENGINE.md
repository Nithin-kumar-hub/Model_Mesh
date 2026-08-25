# 06 — Orchestration Engine

The orchestration engine is the heart of ModelMesh. It takes a classified + enhanced task and produces a final result through intelligent decomposition, planning, scheduling, and execution.

---

## Components

### 1. Decomposer (`core/intelligence/decomposer.ts`)

Decides if a task should be split into subtasks and builds the DAG.

**Input:** Enhanced task specification + classification
**Output:** `DAGNode[]` with dependency links

#### Decision logic

```typescript
class TaskDecomposer {
  async decompose(task: EnhancedTask, classification: TaskClassification): Promise<DAGNode[]> {
    // Simple tasks: no decomposition needed
    if (classification.complexity === 'simple') {
      return [this.buildSingleNode(task, classification)];
    }

    // Domain-specific decomposition strategies
    switch (classification.taskType) {
      case 'CODE_ANALYSIS':
        return this.decomposeCodeAnalysis(task);
      case 'DOCUMENT_ANALYSIS':
        return this.decomposeDocumentAnalysis(task);
      case 'RESEARCH':
        return this.decomposeResearch(task);
      case 'IMAGE_ANALYSIS':
        return this.decomposeImageAnalysis(task);
      default:
        // LLM-assisted decomposition for unknown task types
        return this.llmDecompose(task, classification);
    }
  }

  private async decomposeCodeAnalysis(task: EnhancedTask): Promise<DAGNode[]> {
    // Four parallel subtasks → one synthesis
    const shared = this.buildSharedContext(task);

    const bug = this.makeNode('bug_analysis', AgentRole.CODER, [], shared, 'Identify all bugs, runtime errors, and logic flaws...');
    const perf = this.makeNode('perf_analysis', AgentRole.PERFORMANCE_ANALYZER, [], shared, 'Analyze algorithmic complexity, memory usage...');
    const security = this.makeNode('sec_analysis', AgentRole.SECURITY_ANALYZER, [], shared, 'Identify OWASP vulnerabilities, injection risks...');
    const arch = this.makeNode('arch_analysis', AgentRole.ARCHITECT, [], shared, 'Evaluate design patterns, coupling, cohesion...');

    // Synthesis depends on all four
    const synthesis = this.makeNode(
      'synthesis', AgentRole.SYNTHESIZER,
      ['bug_analysis', 'perf_analysis', 'sec_analysis', 'arch_analysis'],
      '',
      'Merge all analysis results into a comprehensive report...'
    );

    return [bug, perf, security, arch, synthesis];
  }
}
```

#### Decomposition strategies per task type

| Task Type | Subtask Pattern |
|-----------|----------------|
| CODE_ANALYSIS | bug + perf + security + arch → synthesis |
| CODE_REVIEW | style + logic + security + tests → synthesis |
| DOCUMENT_ANALYSIS | extract + structure + key_points + qa → output |
| RESEARCH | decompose_questions → parallel search → compare → synthesize → verify |
| IMAGE_ANALYSIS | vision + ocr + object → combine |
| PDF_EXTRACTION | chunk → parallel extract → merge |
| AUDIO | transcribe → analyze |
| COMPLEX_REASONING | chain_of_thought in sequence |

---

### 2. Planner (`core/orchestrator/planner.ts`)

Generates 3 candidate execution plans and selects the best one.

```typescript
class ExecutionPlanner {
  async generatePlans(
    nodes: DAGNode[],
    budget: TaskBudget,
    strategy: ExecutionStrategy
  ): Promise<ExecutionPlan[]> {

    const plans: ExecutionPlan[] = [];

    // Plan A: Draft — cheapest, minimal parallelism
    plans.push(this.buildDraftPlan(nodes));

    // Plan B: Balanced — best tradeoff
    plans.push(this.buildBalancedPlan(nodes));

    // Plan C: Premium — best quality, max parallel
    plans.push(this.buildPremiumPlan(nodes));

    // Filter plans that violate budget constraints
    const feasible = plans.filter(p =>
      p.estimatedTotalTokens <= budget.maxTokens &&
      p.estimatedTotalLatencyMs <= budget.maxLatencyMs
    );

    // Select based on strategy
    return this.selectPlan(feasible, strategy);
  }

  private buildBalancedPlan(nodes: DAGNode[]): ExecutionPlan {
    const groups = this.extractParallelGroups(nodes);

    // Route each node to a balanced model
    const routedNodes = nodes.map(node => ({
      ...node,
      assignedProvider: this.providerRegistry.getBalancedModel(node.capabilities)
    }));

    const estimatedTokens = routedNodes.reduce(
      (sum, n) => sum + n.estimatedInputTokens + n.estimatedOutputTokens, 0
    );

    const estimatedLatency = this.calculateDAGLatency(groups, routedNodes);

    return {
      id: ulid(),
      strategy: 'balanced',
      nodes: routedNodes,
      parallelGroups: groups,
      estimatedTotalTokens: estimatedTokens,
      estimatedTotalLatencyMs: estimatedLatency,
      estimatedTotalCost: this.estimateCost(routedNodes),
      reliabilityScore: this.calculateReliability(routedNodes),
      reasoning: `${groups.length} parallel batches reduce latency by ~${this.latencySavingPercent(groups, routedNodes)}% vs sequential`
    };
  }

  private extractParallelGroups(nodes: DAGNode[]): string[][] {
    // Topological sort with Kahn's algorithm
    const inDegree = new Map(nodes.map(n => [n.id, n.dependencies.length]));
    const queue = nodes.filter(n => n.dependencies.length === 0).map(n => n.id);
    const groups: string[][] = [];

    while (queue.length > 0) {
      // All nodes in queue can run in parallel
      groups.push([...queue]);
      const currentBatch = [...queue];
      queue.length = 0;

      for (const completedId of currentBatch) {
        // Find nodes whose all dependencies are now satisfied
        nodes
          .filter(n => n.dependencies.includes(completedId))
          .forEach(n => {
            const degree = (inDegree.get(n.id) ?? 0) - 1;
            inDegree.set(n.id, degree);
            if (degree === 0) queue.push(n.id);
          });
      }
    }

    return groups;
  }
}
```

---

### 3. Scheduler (`core/orchestrator/scheduler.ts`)

Executes the plan's parallel groups in order.

```typescript
class WorkloadScheduler {
  async execute(
    plan: ExecutionPlan,
    taskId: string,
    onEvent: (event: TraceEvent) => void
  ): Promise<Map<string, SubTaskResult>> {
    const results = new Map<string, SubTaskResult>();
    const failed = new Set<string>();

    for (const group of plan.parallelGroups) {
      // Execute entire group in parallel
      const groupResults = await Promise.allSettled(
        group.map(nodeId => {
          const node = plan.nodes.find(n => n.id === nodeId)!;
          // Inject dependency results into context
          const enrichedNode = this.injectDependencyResults(node, results);
          return this.executor.executeSubTask(enrichedNode, taskId, onEvent);
        })
      );

      // Process results
      groupResults.forEach((result, i) => {
        const nodeId = group[i];
        if (result.status === 'fulfilled') {
          results.set(nodeId, result.value);
          onEvent({ event: 'subtask_done', subtaskId: nodeId, ...result.value });
        } else {
          failed.add(nodeId);
          onEvent({ event: 'subtask_failed', subtaskId: nodeId, error: result.reason });
        }
      });

      // If critical failures, consider re-planning
      if (failed.size > 0 && this.isCriticalFailure(failed, plan)) {
        const replan = await this.recovery.replan(plan, failed, results);
        if (replan) return this.execute(replan, taskId, onEvent);
      }
    }

    return results;
  }

  private injectDependencyResults(
    node: DAGNode,
    completedResults: Map<string, SubTaskResult>
  ): DAGNode {
    // For synthesis nodes: inject all dependency outputs into context
    if (node.dependencies.length === 0) return node;

    const depContext = node.dependencies
      .map(depId => {
        const result = completedResults.get(depId);
        return result ? `## ${depId} Result\n${result.output}` : '';
      })
      .filter(Boolean)
      .join('\n\n');

    return {
      ...node,
      contextSlice: node.contextSlice + '\n\n' + depContext
    };
  }
}
```

---

### 4. Executor (`core/orchestrator/executor.ts`)

Executes a single subtask with retry and failover logic.

```typescript
class SubTaskExecutor {
  async executeSubTask(
    node: DAGNode,
    taskId: string,
    onEvent: (event: TraceEvent) => void
  ): Promise<SubTaskResult> {
    // Check semantic cache first
    const cacheKey = this.cache.buildKey(node);
    const cached = await this.cache.get(cacheKey);
    if (cached) {
      return { ...cached, fromCache: true };
    }

    let attempt = 0;
    let lastError: Error | null = null;

    while (attempt < MAX_ATTEMPTS) {
      attempt++;

      // Get best available key + provider for this role
      const route = await this.agentRouter.route(node.capabilities);

      if (!route) {
        throw new Error('NO_PROVIDERS_AVAILABLE');
      }

      onEvent({ event: 'subtask_started', subtaskId: node.id, ...route, attempt });

      try {
        const startMs = Date.now();
        const response = await this.callProvider(route, node);
        const latencyMs = Date.now() - startMs;

        const result: SubTaskResult = {
          subtaskId: node.id,
          role: node.role,
          provider: route.provider,
          model: route.model,
          output: response.text,
          confidence: this.inferConfidence(response.text),
          actualInputTokens: response.inputTokens,
          actualOutputTokens: response.outputTokens,
          actualLatencyMs: latencyMs,
          failovers: attempt - 1,
          fromCache: false
        };

        // Cache the result
        await this.cache.set(cacheKey, result);

        // Record telemetry
        await this.telemetry.record({ taskId, subtaskId: node.id, ...result, ...node });

        return result;

      } catch (err) {
        lastError = err as Error;
        const errorCode = this.classifyError(err);

        if (errorCode === 'RATE_LIMIT') {
          await this.keyManager.markRateLimited(route.keyId);
          // Will retry with different key
        } else if (errorCode === 'SERVER_ERROR') {
          await this.keyManager.decrementHealth(route.keyId, 0.1);
          await sleep(exponentialBackoff(attempt));
        } else {
          throw err; // non-retryable
        }
      }
    }

    throw lastError ?? new Error('MAX_ATTEMPTS_EXCEEDED');
  }

  private inferConfidence(output: string): number {
    // Heuristic: look for hedging language
    const hedgeWords = ['might', 'possibly', 'could be', 'i think', 'perhaps', 'unclear'];
    const certainWords = ['definitely', 'clearly', 'confirmed', 'the issue is', 'found'];

    const lowerOutput = output.toLowerCase();
    const hedgeCount = hedgeWords.filter(w => lowerOutput.includes(w)).length;
    const certainCount = certainWords.filter(w => lowerOutput.includes(w)).length;

    // Base confidence: 0.75, adjust by hedge/certain ratio
    const base = 0.75;
    const adjustment = (certainCount - hedgeCount * 0.5) * 0.05;
    return Math.max(0.3, Math.min(1.0, base + adjustment));
  }
}
```

---

### 5. Recovery (`core/orchestrator/recovery.ts`)

Handles individual subtask failures and optionally re-plans the whole DAG.

```typescript
class FailureRecovery {
  async handleSubTaskFailure(
    node: DAGNode,
    error: Error,
    attempt: number,
    availableProviders: ProviderModel[]
  ): Promise<RecoveryAction> {
    const code = this.classifyError(error);

    // Rate limit: rotate key and retry immediately
    if (code === 'RATE_LIMIT') {
      return { action: 'RETRY', delay: 0, reason: 'key_rotated' };
    }

    // Server error: exponential backoff
    if (code === 'SERVER_ERROR' && attempt < 3) {
      return { action: 'RETRY', delay: 2 ** attempt * 1000, reason: 'server_error_backoff' };
    }

    // Model failure: try alternative model with same capabilities
    const fallback = this.findFallbackModel(node.capabilities, availableProviders);
    if (fallback) {
      return { action: 'SWAP_MODEL', newRoute: fallback, reason: 'model_fallback' };
    }

    // All options exhausted
    return { action: 'FAIL', reason: 'no_fallback_available' };
  }

  async replan(
    originalPlan: ExecutionPlan,
    failedNodes: Set<string>,
    completedResults: Map<string, SubTaskResult>
  ): Promise<ExecutionPlan | null> {
    // Only replan if the failed nodes are critical path nodes
    const remainingNodes = originalPlan.nodes.filter(
      n => !completedResults.has(n.id) && !failedNodes.has(n.id)
    );

    if (remainingNodes.length === 0) return null;

    // Rebuild plan with remaining work + completed results injected
    return this.planner.generatePlans(remainingNodes, {}, 'balanced');
  }
}
```

---

### 6. Aggregator (`core/aggregator/`)

Merges all subtask results into a final coherent answer.

```typescript
class ResultAggregator {
  async aggregate(
    results: Map<string, SubTaskResult>,
    plan: ExecutionPlan
  ): Promise<AggregatedResult> {

    // Step 1: Collect non-synthesis results
    const analysisResults = [...results.values()]
      .filter(r => r.role !== AgentRole.SYNTHESIZER)
      .map(r => r.output);

    // Step 2: Detect conflicts
    const conflicts = await this.conflictDetector.detect(analysisResults);

    // Step 3: Resolve conflicts if any
    if (conflicts.length > 0) {
      for (const conflict of conflicts) {
        const resolution = await this.conflictResolver.resolve(conflict, results);
        results.set(`resolved_${conflict.id}`, resolution);
      }
    }

    // Step 4: Get synthesis result (if exists) or do synthesis
    const synthesisResult = results.get('synthesis');
    const finalOutput = synthesisResult?.output ??
      await this.synthesize([...results.values()]);

    return {
      output: finalOutput,
      conflictsFound: conflicts.length,
      conflictsResolved: conflicts.length,
      confidence: this.calculateOverallConfidence(results)
    };
  }

  private async conflictDetect(outputs: string[]): Promise<Conflict[]> {
    // Use Gemini Flash for quick conflict detection
    // Prompt: "Do these outputs contain contradictory claims? List them."
    const response = await this.geminiFlash.complete({
      prompt: CONFLICT_DETECTION_PROMPT + outputs.join('\n---\n'),
      maxTokens: 500
    });

    return this.parseConflicts(response);
  }
}
```

---

## Confidence → Action Matrix

| Confidence | Source | Action |
|------------|--------|--------|
| ≥ 0.90 | Subtask output | Skip verification, proceed |
| 0.70–0.89 | Subtask output | Light synthesis check |
| 0.50–0.69 | Subtask output | Full verification triggered |
| < 0.50 | Subtask output | Re-route to stronger model |
| Conflict detected | Aggregator | Always trigger verification |
| User strategy = premium | Any | Always verify |

---

## Dynamic Re-planning Triggers

| Trigger | Response |
|---------|----------|
| Subtask 429 after all keys exhausted | Mark provider unavailable, re-route remaining |
| Critical subtask fails permanently | Attempt synthesis with available results + flag partial |
| Result confidence globally low | Spawn additional verification subtask |
| User cancels | Gracefully stop pending subtasks, return partial |
| Timeout approaching | Complete current group, skip optional subtasks |
