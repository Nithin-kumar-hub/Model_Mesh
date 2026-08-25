import type Redis from 'ioredis';
import { AgentRole } from '@modelmesh/types';
import { config } from './config';
import { logger } from './infra/logger';
import { createPersistence, type Persistence } from './infra/persistence';
import { createStore, type KeyValueStore } from './infra/store';
import { KeyManager } from './keys/manager';
import { KeyRotator } from './keys/rotator';
import { ROLE_DEFINITIONS } from './core/agents/roles';
import { AgentRouter } from './core/agents/router';
import { ResultCollector } from './core/aggregator/collector';
import { ConflictDetector } from './core/aggregator/conflict';
import { ResultDeduplicator } from './core/aggregator/deduplicator';
import { ResultAggregator } from './core/aggregator/synthesizer';
import { ContextMemory } from './core/cache/context-memory';
import { SemanticCache } from './core/cache/semantic';
import { TaskClassifier } from './core/intelligence/classifier';
import { TaskDecomposer } from './core/intelligence/decomposer';
import { TaskEnhancer } from './core/intelligence/enhancer';
import { TokenProfiler } from './core/intelligence/profiler';
import { ContextSlicer } from './core/optimizer/context';
import { GlobalTokenOptimizer } from './core/optimizer/token';
import { SubTaskExecutor } from './core/orchestrator/executor';
import { ExecutionPlanner } from './core/orchestrator/planner';
import { FailureRecovery } from './core/orchestrator/recovery';
import { WorkloadScheduler } from './core/orchestrator/scheduler';
import { TaskPipeline } from './core/pipeline';
import { ProviderRegistry } from './core/providers/registry';
import { CalibrationEngine } from './core/telemetry/calibration';
import { TelemetryRecorder } from './core/telemetry/metrics';
import { TraceBus } from './core/trace';
import { ConsistencyChecker } from './core/verifier/consistency';
import { Critic } from './core/verifier/critic';

/**
 * Composition root.
 *
 * Every dependency is constructed here, once, and injected downward — which is
 * what lets the test suite build the same graph against in-memory backends and
 * the mock provider with no monkey-patching.
 */
export interface AppContext {
  store: KeyValueStore;
  redis: Redis | null;
  db: Persistence;
  keys: KeyManager;
  rotator: KeyRotator;
  registry: ProviderRegistry;
  router: AgentRouter;
  cache: SemanticCache;
  contextMemory: ContextMemory;
  calibration: CalibrationEngine;
  telemetry: TelemetryRecorder;
  executor: SubTaskExecutor;
  slicer: ContextSlicer;
  profiler: TokenProfiler;
  classifier: TaskClassifier;
  enhancer: TaskEnhancer;
  decomposer: TaskDecomposer;
  tokenOptimizer: GlobalTokenOptimizer;
  planner: ExecutionPlanner;
  recovery: FailureRecovery;
  scheduler: WorkloadScheduler;
  aggregator: ResultAggregator;
  critic: Critic;
  consistency: ConsistencyChecker;
  pipeline: TaskPipeline;
  trace: TraceBus;
  modelsByProvider: Record<string, string[]>;
  close(): Promise<void>;
}

export const createAppContext = async (): Promise<AppContext> => {
  const { store, redis } = await createStore();
  const db = await createPersistence();

  const keys = new KeyManager(store, db);
  await keys.bootstrap();

  const rotator = new KeyRotator(keys);
  const registry = new ProviderRegistry();
  const router = new AgentRouter(registry, keys);

  const cache = new SemanticCache(store, db);
  const contextMemory = new ContextMemory(store);
  const calibration = new CalibrationEngine(db);
  const telemetry = new TelemetryRecorder(db, calibration);

  const executor = new SubTaskExecutor(router, registry, keys, rotator, cache, telemetry, db);

  // The slicer's optional LLM extraction runs through the same executor, so it
  // inherits failover and caching. Declared as a closure to break the cycle.
  const slicer = new ContextSlicer(async ({ context, role, instructions, maxTokens }) => {
    const response = await executor.invoke({
      role: AgentRole.SUMMARIZER,
      strategy: 'draft',
      maxTokens: Math.min(2_048, Math.ceil(maxTokens / 3)),
      // Extraction is a cheap meta-call; it must not become the bottleneck.
      timeoutMs: 15_000,
      maxAttempts: 1,
      prompt: [
        `Extract ONLY the portions of the text below that a ${role} needs in order to: ${instructions}`,
        'Return the extracted text verbatim with no commentary. Preserve code exactly.',
        '',
        context.slice(0, 30_000),
      ].join('\n'),
    });
    return response.text;
  });

  const profiler = new TokenProfiler(calibration);
  const classifier = new TaskClassifier(executor);
  const enhancer = new TaskEnhancer(executor);
  const decomposer = new TaskDecomposer(slicer, profiler, executor);
  const tokenOptimizer = new GlobalTokenOptimizer();

  const planner = new ExecutionPlanner(registry, keys, profiler);
  const recovery = new FailureRecovery(registry, keys, planner);
  const scheduler = new WorkloadScheduler(executor, recovery, db);

  const aggregator = new ResultAggregator(
    new ResultCollector(),
    new ResultDeduplicator(),
    new ConflictDetector(executor),
    executor,
  );
  const critic = new Critic(executor);
  const consistency = new ConsistencyChecker();

  const pipeline = new TaskPipeline({
    db,
    classifier,
    enhancer,
    decomposer,
    tokenOptimizer,
    planner,
    scheduler,
    aggregator,
    critic,
    consistency,
    telemetry,
    profiler,
    contextMemory,
  });

  const trace = new TraceBus(db);

  const modelsByProvider: Record<string, string[]> = {};
  for (const provider of registry.all()) {
    modelsByProvider[provider.name] = provider.models.map((model) => model.model);
  }

  logger.info(
    {
      persistence: db.kind,
      cache: store.kind,
      providers: registry.names(),
      roles: Object.keys(ROLE_DEFINITIONS).length,
      mockProvider: config.mockProviderEnabled,
      realKeys: config.hasRealProviderKeys,
    },
    'ModelMesh context ready',
  );

  return {
    store,
    redis,
    db,
    keys,
    rotator,
    registry,
    router,
    cache,
    contextMemory,
    calibration,
    telemetry,
    executor,
    slicer,
    profiler,
    classifier,
    enhancer,
    decomposer,
    tokenOptimizer,
    planner,
    recovery,
    scheduler,
    aggregator,
    critic,
    consistency,
    pipeline,
    trace,
    modelsByProvider,
    async close(): Promise<void> {
      await store.close().catch(() => undefined);
      await db.close().catch(() => undefined);
    },
  };
};
