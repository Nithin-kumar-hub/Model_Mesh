/**
 * Shared builders for the unit suite.
 *
 * Every factory returns a fully-typed, minimal-but-valid object so a test only
 * has to state the field it actually cares about.
 */
import { AgentRole } from '@modelmesh/types';
import type {
  DAGNode,
  EnhancedTask,
  ExecutionPlan,
  ProviderModel,
  SubTaskResult,
  TraceEventInput,
  TraceEventName,
} from '@modelmesh/types';
import type { Persistence } from '../../src/infra/persistence';
import type { SubTaskPatch } from '../../src/infra/records';
import { DAG } from '../../src/core/orchestrator/dag';
import type { SubtaskExecutionContext } from '../../src/core/orchestrator/executor';

export const makeNode = (id: string, overrides: Partial<DAGNode> = {}): DAGNode => ({
  id,
  role: AgentRole.RESEARCHER,
  dependencies: [],
  contextSlice: '',
  instructions: `Do the work for ${id}`,
  capabilities: ['text'],
  estimatedInputTokens: 1_000,
  estimatedOutputTokens: 400,
  estimatedLatencyMs: 500,
  priority: 5,
  requiresEnsemble: false,
  ...overrides,
});

/** Nodes + parallelGroups derived from the real DAG, so plans are self-consistent. */
export const makePlan = (nodes: DAGNode[], overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  id: 'plan_test',
  strategy: 'balanced',
  nodes,
  parallelGroups: new DAG(nodes).parallelGroups(),
  estimatedTotalTokens: nodes.reduce(
    (sum, node) => sum + node.estimatedInputTokens + node.estimatedOutputTokens,
    0,
  ),
  estimatedTotalLatencyMs: new DAG(nodes).criticalPathMs(),
  estimatedTotalCost: 0,
  reliabilityScore: 0.95,
  reasoning: 'test plan',
  ...overrides,
});

export const makeResult = (subtaskId: string, overrides: Partial<SubTaskResult> = {}): SubTaskResult => ({
  subtaskId,
  role: AgentRole.RESEARCHER,
  provider: 'mock',
  model: 'mock-balanced',
  output: `## Findings for ${subtaskId}\n\n- Something concrete at line 12.`,
  confidence: 0.8,
  actualInputTokens: 900,
  actualOutputTokens: 300,
  actualLatencyMs: 120,
  failovers: 0,
  fromCache: false,
  ...overrides,
});

export const makeModel = (overrides: Partial<ProviderModel> = {}): ProviderModel => ({
  provider: 'mock',
  model: 'mock-balanced',
  capabilities: ['text', 'code', 'reasoning'],
  maxContextTokens: 128_000,
  avgLatencyMs: 140,
  costPerInputMToken: 0,
  costPerOutputMToken: 0,
  reliability: 0.98,
  quality: 0.72,
  ...overrides,
});

export const makeEnhanced = (overrides: Partial<EnhancedTask> = {}): EnhancedTask => ({
  goal: 'Analyze the supplied service for defects',
  constraints: [],
  expectedOutputFormat: 'markdown',
  helpfulContext: '',
  edgeCases: [],
  documentContent: '',
  userIntent: 'Analyze the supplied service for defects',
  fullText: 'Analyze the supplied service for defects',
  enhancedBy: 'rule',
  ...overrides,
});

export interface TraceRecorder {
  emit: (event: TraceEventInput) => void;
  events: TraceEventInput[];
  names(): string[];
  find(name: TraceEventName): TraceEventInput | undefined;
}

export const makeTrace = (): TraceRecorder => {
  const events: TraceEventInput[] = [];
  return {
    emit: (event) => events.push(event),
    events,
    names: () => events.map((event) => String(event.event)),
    find: (name) => events.find((event) => event.event === name),
  };
};

export interface StubPersistence {
  db: Persistence;
  updates: Array<{ nodeId: string; patch: SubTaskPatch }>;
}

/** Only the calls the scheduler/executor actually make are implemented. */
export const stubPersistence = (): StubPersistence => {
  const updates: Array<{ nodeId: string; patch: SubTaskPatch }> = [];
  const db = {
    updateSubTask: async (_taskId: string, nodeId: string, patch: SubTaskPatch): Promise<void> => {
      updates.push({ nodeId, patch });
    },
  } as unknown as Persistence;
  return { db, updates };
};

export const makeExecContext = (
  overrides: Partial<SubtaskExecutionContext> = {},
): SubtaskExecutionContext => ({
  taskId: 'task_test',
  taskType: 'CODE_ANALYSIS',
  strategy: 'balanced',
  userIntent: 'Analyze the supplied service for defects',
  emit: () => undefined,
  ...overrides,
});
