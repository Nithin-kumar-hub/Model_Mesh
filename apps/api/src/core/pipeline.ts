import type {
  EnhancedTask,
  ExecutionPlan,
  ExecutionStrategy,
  ExecutionTelemetry,
  SubmitTaskRequest,
  TaskClassification,
  TaskResult,
  TraceEmitter,
  VerificationResult,
} from '@modelmesh/types';
import { config } from '../config';
import { logger } from '../infra/logger';
import type { Persistence } from '../infra/persistence';
import { countTokens } from '../infra/text';
import { ResultCollector } from './aggregator/collector';
import { ConflictDetector } from './aggregator/conflict';
import { ResultDeduplicator } from './aggregator/deduplicator';
import { ResultAggregator, shouldVerify } from './aggregator/synthesizer';
import type { ContextMemory } from './cache/context-memory';
import { TaskClassifier } from './intelligence/classifier';
import { TaskDecomposer } from './intelligence/decomposer';
import { TaskEnhancer } from './intelligence/enhancer';
import type { TokenProfiler } from './intelligence/profiler';
import { GlobalTokenOptimizer } from './optimizer/token';
import { DAG } from './orchestrator/dag';
import type { ExecutionPlanner } from './orchestrator/planner';
import type { WorkloadScheduler } from './orchestrator/scheduler';
import type { TelemetryRecorder } from './telemetry/metrics';
import { ConsistencyChecker } from './verifier/consistency';
import { Critic } from './verifier/critic';

/**
 * The conductor.
 *
 * Runs the fifteen layers of docs/01-ARCHITECTURE.md in order for one task,
 * emitting a trace event at every stage boundary (that trace is both the demo
 * surface and the debugging surface), and persisting enough state that a task
 * can be inspected after the fact.
 *
 * Failure policy: a stage that can degrade, degrades. Only a failure that
 * leaves nothing to answer with fails the task.
 */

export interface PipelineDeps {
  db: Persistence;
  classifier: TaskClassifier;
  enhancer: TaskEnhancer;
  decomposer: TaskDecomposer;
  tokenOptimizer: GlobalTokenOptimizer;
  planner: ExecutionPlanner;
  scheduler: WorkloadScheduler;
  aggregator: ResultAggregator;
  critic: Critic;
  consistency: ConsistencyChecker;
  telemetry: TelemetryRecorder;
  profiler: TokenProfiler;
  contextMemory: ContextMemory;
}

export interface RunOptions {
  taskId: string;
  request: SubmitTaskRequest;
  emit: TraceEmitter;
  /** Groups tasks from one phone session for context memory. */
  sessionId?: string;
}

export class TaskFailedError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = 'TaskFailedError';
  }
}

export class TaskPipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async run(options: RunOptions): Promise<TaskResult> {
    const { taskId, request, emit } = options;
    const startedAt = Date.now();
    const deadlineAt = startedAt + config.execution.taskTimeoutMs;
    const strategy: ExecutionStrategy = request.strategy ?? config.execution.defaultStrategy;

    emit({ event: 'task_received', strategy, inputType: request.input.type });
    await this.deps.db.updateTask(taskId, { status: 'received', startedAt: new Date(startedAt) });

    try {
      // ── Layer 2: understanding ──────────────────────────────────────────
      emit({ event: 'classifying' });
      await this.deps.db.updateTask(taskId, { status: 'classifying' });

      const classification = await this.deps.classifier.classify(request.input, strategy);
      emit({
        event: 'classified',
        taskType: classification.taskType,
        complexity: classification.complexity,
        confidence: Number(classification.confidence.toFixed(2)),
        classifiedBy: classification.classifiedBy,
        modalities: classification.modalities,
      });
      await this.deps.db.updateTask(taskId, {
        status: 'classifying',
        taskType: classification.taskType,
        confidence: classification.confidence,
      });

      // ── Layer 3: enhancement ────────────────────────────────────────────
      emit({ event: 'enhancing' });
      await this.deps.db.updateTask(taskId, { status: 'enhancing' });

      const sessionMemory = options.sessionId
        ? await this.deps.contextMemory.recall(options.sessionId)
        : '';
      const enhanced = await this.deps.enhancer.enhance(request.input, classification, {
        strategy,
        sessionMemory,
      });

      emit({
        event: 'enhanced',
        originalLength: (request.input.text ?? '').length,
        enhancedLength: enhanced.fullText.length,
        enhancedBy: enhanced.enhancedBy,
        goal: enhanced.goal.slice(0, 200),
      });
      await this.deps.db.updateTask(taskId, {
        status: 'enhancing',
        enhancedSpec: {
          goal: enhanced.goal,
          constraints: enhanced.constraints,
          expectedOutputFormat: enhanced.expectedOutputFormat,
          edgeCases: enhanced.edgeCases,
          enhancedBy: enhanced.enhancedBy,
        },
      });

      // ── Layer 4: global token optimization ──────────────────────────────
      emit({ event: 'optimizing' });
      const optimized = this.deps.tokenOptimizer.optimize(enhanced);
      emit({
        event: 'optimized',
        tokensBefore: optimized.originalEstimatedTokens,
        tokensAfter: optimized.optimizedEstimatedTokens,
        tokensSaved: optimized.tokensSaved,
        passes: optimized.passes.map((pass) => ({ name: pass.name, saved: pass.tokensBefore - pass.tokensAfter })),
      });

      // ── Layers 5-7: decomposition, profiling, context slicing ───────────
      emit({ event: 'decomposing' });
      await this.deps.db.updateTask(taskId, { status: 'decomposing' });

      const images = this.collectImages(request);
      const decomposition = await this.deps.decomposer.decompose(optimized, classification, {
        strategy,
        images,
      });

      const validationErrors = DAG.validate(decomposition.nodes);
      if (validationErrors.length > 0) {
        throw new TaskFailedError(
          `Invalid subtask graph: ${validationErrors.map((error) => error.message).join('; ')}`,
          'DECOMPOSITION_FAILED',
        );
      }

      // Reduction is measured against the counterfactual: every context-taking
      // node receiving the whole master context.
      const contextTakingNodes = decomposition.nodes.filter((node) => node.contextSlice.length > 0).length;
      const naiveContextTokens = decomposition.masterContextTokens * Math.max(1, contextTakingNodes);

      emit({
        event: 'decomposed',
        subtaskCount: decomposition.nodes.length,
        decomposedBy: decomposition.decomposedBy,
        masterContextTokens: decomposition.masterContextTokens,
        slicedContextTokens: decomposition.slicedContextTokens,
        naiveContextTokens,
        contextReductionPercent:
          naiveContextTokens > 0
            ? Math.max(0, Math.round((1 - decomposition.slicedContextTokens / naiveContextTokens) * 100))
            : 0,
        subtasks: decomposition.nodes.map((node) => ({
          id: node.id,
          role: node.role,
          dependencies: node.dependencies,
        })),
      });

      await this.deps.db.createSubTasks(
        decomposition.nodes.map((node) => ({
          taskId,
          nodeId: node.id,
          role: node.role,
          dependencies: node.dependencies,
          contextSlice: node.contextSlice,
          estimatedInputTokens: node.estimatedInputTokens,
          estimatedOutputTokens: node.estimatedOutputTokens,
        })),
      );

      // ── Layer 8: planning ───────────────────────────────────────────────
      emit({ event: 'planning', planCount: 3 });
      await this.deps.db.updateTask(taskId, { status: 'planning' });

      const plans = await this.deps.planner.generatePlans(
        decomposition.nodes,
        classification.taskType,
        request.budget ?? {},
      );
      const selection = this.deps.planner.select(plans, strategy, request.budget ?? {});
      const plan = selection.selected;

      emit({
        event: 'plan_selected',
        strategy: plan.strategy,
        requestedStrategy: strategy,
        downgraded: Boolean(selection.downgradedFrom),
        estimatedTokens: plan.estimatedTotalTokens,
        estimatedLatencyMs: plan.estimatedTotalLatencyMs,
        estimatedCost: plan.estimatedTotalCost,
        reliabilityScore: plan.reliabilityScore,
        parallelGroups: plan.parallelGroups,
        reasoning: plan.reasoning,
        candidates: plans.map((candidate) => ({
          strategy: candidate.strategy,
          tokens: candidate.estimatedTotalTokens,
          latencyMs: candidate.estimatedTotalLatencyMs,
          cost: candidate.estimatedTotalCost,
        })),
        budgetViolations: selection.budgetViolations,
      });

      await this.deps.db.updateTask(taskId, {
        status: 'planning',
        executionPlan: plan,
        strategy: plan.strategy,
        estimatedTokens: plan.estimatedTotalTokens,
        estimatedLatencyMs: plan.estimatedTotalLatencyMs,
      });
      await this.deps.db.createSubTasks(
        plan.nodes.map((node) => ({
          taskId,
          nodeId: node.id,
          role: node.role,
          dependencies: node.dependencies,
          contextSlice: node.contextSlice,
          provider: node.assignedProvider ?? null,
          model: node.assignedModel ?? null,
          estimatedInputTokens: node.estimatedInputTokens,
          estimatedOutputTokens: node.estimatedOutputTokens,
        })),
      );

      // ── Layers 9-12: execution ──────────────────────────────────────────
      await this.deps.db.updateTask(taskId, { status: 'executing' });
      const outcome = await this.deps.scheduler.execute(plan, {
        taskId,
        taskType: classification.taskType,
        strategy: plan.strategy,
        userIntent: enhanced.userIntent,
        emit,
        deadlineAt,
      });

      if (outcome.results.size === 0) {
        throw new TaskFailedError('Every subtask failed', 'ALL_PROVIDERS_FAILED');
      }

      // ── Layers 13 + 15: aggregation and output optimization ─────────────
      emit({ event: 'aggregating', resultCount: outcome.results.size });
      await this.deps.db.updateTask(taskId, { status: 'aggregating' });

      const aggregated = await this.deps.aggregator.aggregate(outcome.results, plan, {
        strategy: plan.strategy,
        outputFormat: enhanced.expectedOutputFormat,
        goal: enhanced.goal,
      });

      emit({
        event: 'aggregating',
        conflictsFound: aggregated.conflictsFound,
        conflictsResolved: aggregated.conflictsResolved,
        duplicatesRemoved: aggregated.duplicatesRemoved,
        synthesizedBy: aggregated.synthesizedBy,
      });

      // ── Layer 14: verification (only when warranted) ────────────────────
      const collected = new ResultCollector().collect(outcome.results, plan);
      const consistency = this.deps.consistency.check(aggregated.output, collected.analyses);
      const verdict = shouldVerify(aggregated.confidence, aggregated.conflictsFound, plan.strategy);
      const needsVerification = verdict.verify || !consistency.consistent;

      let output = aggregated.output;
      let verification: VerificationResult | undefined;
      let confidence = aggregated.confidence;

      if (needsVerification) {
        const reason = verdict.verify ? verdict.reason : `consistency:${consistency.issues[0]?.code ?? 'unknown'}`;
        emit({ event: 'verifying', reason, consistencyIssues: consistency.issues.map((issue) => issue.code) });
        await this.deps.db.updateTask(taskId, { status: 'verifying' });

        verification = await this.deps.critic.verify(output, collected.analyses, {
          strategy: plan.strategy,
          reason,
          goal: enhanced.goal,
        });

        // Structural findings are facts, not opinions — merge them in.
        if (!consistency.consistent) {
          verification = {
            ...verification,
            verified: verification.verified && consistency.issues.length === 0,
            issues: [...verification.issues, ...consistency.issues.map((issue) => issue.message)],
          };
        }

        output = this.deps.critic.applyToOutput(output, verification);
        confidence = Number(((confidence + verification.confidence) / 2).toFixed(3));

        emit({
          event: 'verified',
          verified: verification.verified,
          issues: verification.issues.length,
          confidence: Number(verification.confidence.toFixed(2)),
          coverage: consistency.coverage,
        });
      }

      // ── Telemetry + calibration ─────────────────────────────────────────
      const totalMs = Date.now() - startedAt;
      const telemetry = this.buildTelemetry({
        plan,
        collected,
        enhanced,
        optimized: optimized.tokensSaved,
        totalMs,
        masterContextTokens: decomposition.masterContextTokens,
      });

      const partial = outcome.failed.size > 0 || outcome.skipped.size > 0;
      const failedSubtasks = [...outcome.failed, ...outcome.skipped];

      await this.deps.db.updateTask(taskId, {
        status: 'completed',
        output,
        outputFormat: aggregated.outputFormat,
        outputConfidence: confidence,
        verification: verification ?? null,
        partial,
        actualTokens: telemetry.actualTokens,
        savedTokens: telemetry.savedTokens,
        actualLatencyMs: totalMs,
        failovers: telemetry.failovers,
        cacheHits: telemetry.cacheHits,
        completedAt: new Date(),
      });

      await this.deps.telemetry.recordTask({
        taskId,
        taskType: classification.taskType,
        classificationConfidence: classification.confidence,
        estimatedInputTokens: plan.estimatedTotalTokens,
        actualInputTokens: telemetry.actualTokens,
        estimatedLatencyMs: plan.estimatedTotalLatencyMs,
        actualLatencyMs: totalMs,
        strategy: plan.strategy,
        confidence,
        failovers: telemetry.failovers,
      });

      if (options.sessionId) {
        await this.deps.contextMemory.remember(options.sessionId, {
          taskId,
          taskType: classification.taskType,
          summary: `${enhanced.goal.slice(0, 160)} → ${output.slice(0, 160).replace(/\s+/g, ' ')}`,
          at: Date.now(),
        });
      }

      emit({
        event: 'completed',
        totalTokens: telemetry.actualTokens,
        savedTokens: telemetry.savedTokens,
        savingsPercent: telemetry.savingsPercent,
        ms: totalMs,
        confidence: Number(confidence.toFixed(2)),
        partial,
        failedSubtasks,
        replans: outcome.replans,
        cacheHits: telemetry.cacheHits,
        failovers: telemetry.failovers,
      });

      return {
        taskId,
        status: 'completed',
        output,
        outputFormat: aggregated.outputFormat,
        confidence,
        plan,
        telemetry,
        ...(verification ? { verification } : {}),
        ...(partial ? { partial, failedSubtasks } : {}),
      };
    } catch (error) {
      const code = error instanceof TaskFailedError ? error.code : 'INTERNAL';
      const message = (error as Error).message;

      logger.error({ taskId, err: message, code }, 'Task failed');
      await this.deps.db
        .updateTask(taskId, {
          status: 'failed',
          errorCode: code,
          actualLatencyMs: Date.now() - startedAt,
          completedAt: new Date(),
        })
        .catch(() => undefined);

      emit({ event: 'failed', error: code, message: message.slice(0, 300) });
      throw error;
    }
  }

  private collectImages(request: SubmitTaskRequest): string[] {
    return (request.input.files ?? [])
      .filter((file) => file.mimeType.startsWith('image/') && file.base64)
      .map((file) => file.base64 as string);
  }

  /**
   * `savedTokens` compares the run against the honest naive baseline: the same
   * roles, each handed the whole master context uncompressed. That is what a
   * one-shot-per-agent implementation would actually have spent.
   */
  private buildTelemetry(input: {
    plan: ExecutionPlan;
    collected: ReturnType<ResultCollector['collect']>;
    enhanced: EnhancedTask;
    optimized: number;
    totalMs: number;
    masterContextTokens: number;
  }): ExecutionTelemetry {
    const actualTokens = input.collected.totalInputTokens + input.collected.totalOutputTokens;

    // Only nodes that actually produced a result count toward the baseline —
    // claiming savings for work that never ran would be dishonest arithmetic.
    const executedIds = new Set(input.collected.all.map((result) => result.subtaskId));
    const executedNodes = input.plan.nodes.filter((node) => executedIds.has(node.id));

    const baseline = this.deps.profiler.naiveBaselineTokens(
      input.masterContextTokens + countTokens(input.enhanced.userIntent),
      executedNodes,
    );

    const savedTokens = Math.max(0, baseline - actualTokens);

    return {
      totalMs: input.totalMs,
      estimatedTokens: input.plan.estimatedTotalTokens,
      actualTokens,
      savedTokens,
      savingsPercent: baseline > 0 ? Number(((savedTokens / baseline) * 100).toFixed(2)) : 0,
      cacheHits: input.collected.cacheHits,
      failovers: input.collected.totalFailovers,
      providerBreakdown: input.collected.providerBreakdown,
    };
  }
}

export { ConflictDetector, ResultAggregator, ResultCollector, ResultDeduplicator };
export type { TaskClassification };
