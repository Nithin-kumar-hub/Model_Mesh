import { AgentRole } from '@modelmesh/types';
import type {
  DAGNode,
  ExecutionStrategy,
  OptimizedTask,
  ProviderCapability,
  TaskClassification,
} from '@modelmesh/types';
import { asRecord, parseJsonLoose } from '../../infra/json';
import { logger } from '../../infra/logger';
import { countTokens } from '../../infra/text';
import { getRoleDefinition, parseRole, ROLE_PIPELINES } from '../agents/roles';
import type { ContextSlicer } from '../optimizer/context';
import type { SubTaskExecutor } from '../orchestrator/executor';
import type { TokenProfiler } from './profiler';

/**
 * Layer 5 — decomposition (Rule 2: a DAG, never a list).
 *
 * Known task types decompose deterministically from the role pipelines in
 * docs/09-AGENT-ROLES.md — no LLM round-trip for the common cases. Unknown
 * shapes fall back to an LLM decomposition that is then validated: bad ids,
 * cycles, and missing synthesis are repaired rather than trusted.
 */

export interface DecomposeOptions {
  strategy: ExecutionStrategy;
  /** base64 images, attached to vision-capable nodes only. */
  images?: string[];
}

export interface DecompositionResult {
  nodes: DAGNode[];
  decomposedBy: 'single' | 'pipeline' | 'llm';
  masterContextTokens: number;
  slicedContextTokens: number;
}

/** Per-role instruction templates. Written to be specific and checkable. */
const INSTRUCTIONS: Partial<Record<AgentRole, string>> = {
  [AgentRole.SECURITY_ANALYZER]:
    'Identify every security vulnerability in the material: injection, authentication and authorization flaws, sensitive data exposure, unsafe deserialization, path traversal, command execution. For each: severity, exact location, exploitation scenario, and the corrected code.',
  [AgentRole.CODER]:
    'Identify every bug, runtime error, and logic flaw. For each: exact location, root cause, corrected code, and the edge case that triggers it.',
  [AgentRole.PERFORMANCE_ANALYZER]:
    'Analyze algorithmic complexity, memory usage, query patterns, and I/O. Report N+1 queries, superlinear loops, missing indexes, and leaks, each with an estimated impact.',
  [AgentRole.ARCHITECT]:
    'Evaluate design patterns, layering, coupling and cohesion, dependency direction, and testability. Give recommendations with their trade-offs.',
  [AgentRole.CODE_REVIEWER]:
    'Review readability, maintainability, naming, error handling, and test coverage. Prioritize each finding as critical, major, or minor.',
  [AgentRole.SUMMARIZER]:
    'Produce a structured summary that preserves every load-bearing detail: key points, supporting specifics, conclusions, and action items.',
  [AgentRole.RESEARCHER]:
    'Answer the goal from the supplied material. Cite the specific evidence behind each claim and mark anything the material does not establish.',
  [AgentRole.VISION_ANALYZER]:
    'Analyze the supplied image(s): transcribe text, describe objects and layout, and extract any tabular or chart data.',
  [AgentRole.AUDIO_TRANSCRIBER]:
    'Transcribe the supplied audio with speaker turns where distinguishable, then list the key points and any action items.',
  [AgentRole.SYNTHESIZER]:
    'Merge the upstream agent results into one report with sections: Summary, Critical Issues, Recommendations, Evidence. Remove duplicates, flag contradictions explicitly, and preserve every specific location and code example.',
  [AgentRole.CRITIC]:
    'Review the upstream results adversarially: what is missing, what is asserted without support, what assumption is unsafe.',
};

const VISION_ROLES = new Set<AgentRole>([AgentRole.VISION_ANALYZER]);
const AUDIO_ROLES = new Set<AgentRole>([AgentRole.AUDIO_TRANSCRIBER]);

export class TaskDecomposer {
  constructor(
    private readonly slicer: ContextSlicer,
    private readonly profiler: TokenProfiler,
    private readonly executor?: SubTaskExecutor,
  ) {}

  async decompose(
    task: OptimizedTask,
    classification: TaskClassification,
    options: DecomposeOptions,
  ): Promise<DecompositionResult> {
    const context = task.optimizedText;

    const { skeleton, decomposedBy } = await this.buildSkeleton(task, classification, options);
    const nodes = await this.finalize(skeleton, context, classification, options);

    return {
      nodes,
      decomposedBy,
      masterContextTokens: countTokens(context),
      slicedContextTokens: nodes.reduce((sum, node) => sum + countTokens(node.contextSlice), 0),
    };
  }

  private async buildSkeleton(
    task: OptimizedTask,
    classification: TaskClassification,
    options: DecomposeOptions,
  ): Promise<{ skeleton: DAGNode[]; decomposedBy: DecompositionResult['decomposedBy'] }> {
    // Simple tasks: decomposition would cost more than it saves.
    if (classification.complexity === 'simple' || classification.estimatedSubtasks <= 1) {
      return { skeleton: [this.buildSingleNode(task, classification)], decomposedBy: 'single' };
    }

    if (classification.taskType === 'RESEARCH') {
      return { skeleton: this.decomposeResearch(task, options.strategy), decomposedBy: 'pipeline' };
    }

    const pipeline = ROLE_PIPELINES[classification.taskType];
    if (pipeline) {
      return {
        skeleton: this.fromPipeline(pipeline, task, classification, options.strategy),
        decomposedBy: 'pipeline',
      };
    }

    const llmNodes = await this.llmDecompose(task, classification, options.strategy);
    if (llmNodes) return { skeleton: llmNodes, decomposedBy: 'llm' };

    return { skeleton: [this.buildSingleNode(task, classification)], decomposedBy: 'single' };
  }

  // ─── Deterministic strategies ───────────────────────────────────────────

  private buildSingleNode(task: OptimizedTask, classification: TaskClassification): DAGNode {
    const role = classification.requiresVision
      ? AgentRole.VISION_ANALYZER
      : classification.modalities.includes('audio')
        ? AgentRole.AUDIO_TRANSCRIBER
        : classification.taskType === 'SUMMARIZATION'
          ? AgentRole.SUMMARIZER
          : classification.requiresCode
            ? AgentRole.CODER
            : AgentRole.RESEARCHER;

    return this.makeNode('main', role, [], `${task.goal}\n\n${INSTRUCTIONS[role] ?? ''}`.trim(), 10);
  }

  private fromPipeline(
    pipeline: { parallel: AgentRole[]; then: AgentRole[] },
    task: OptimizedTask,
    classification: TaskClassification,
    strategy: ExecutionStrategy,
  ): DAGNode[] {
    // Draft trades breadth for cost: keep the two highest-value analyses.
    const parallelRoles = strategy === 'draft' ? pipeline.parallel.slice(0, 2) : pipeline.parallel;
    const seen = new Map<AgentRole, number>();

    const parallelNodes = parallelRoles.map((role, index) => {
      const occurrence = (seen.get(role) ?? 0) + 1;
      seen.set(role, occurrence);
      const id = occurrence > 1 ? `${role}_${occurrence}` : String(role);
      return this.makeNode(
        id,
        role,
        [],
        `${INSTRUCTIONS[role] ?? getRoleDefinition(role).description}\n\nGoal: ${task.goal}`,
        10 - index,
      );
    });

    const dependencyIds = parallelNodes.map((node) => node.id);
    const tailNodes = pipeline.then.map((role, index) =>
      this.makeNode(
        role === AgentRole.SYNTHESIZER ? 'synthesis' : `${role}_stage`,
        role,
        dependencyIds,
        `${INSTRUCTIONS[role] ?? getRoleDefinition(role).description}\n\nGoal: ${task.goal}`,
        5 - index,
      ),
    );

    // Premium adds an adversarial pass over the synthesized answer.
    if (strategy === 'premium' && tailNodes.length > 0 && classification.complexity !== 'medium') {
      const last = tailNodes[tailNodes.length - 1];
      if (last) {
        last.requiresEnsemble = classification.complexity === 'very_complex';
        tailNodes.push(
          this.makeNode(
            'critique',
            AgentRole.CRITIC,
            [last.id],
            INSTRUCTIONS[AgentRole.CRITIC] ?? 'Critique the synthesized result.',
            1,
            true,
          ),
        );
      }
    }

    return [...parallelNodes, ...tailNodes];
  }

  /** RESEARCH: one researcher per question, then compare and synthesize. */
  private decomposeResearch(task: OptimizedTask, strategy: ExecutionStrategy): DAGNode[] {
    const questions = this.extractQuestions(task);
    const limit = strategy === 'draft' ? 2 : strategy === 'balanced' ? 4 : 6;

    const researchNodes = questions.slice(0, limit).map((question, index) =>
      this.makeNode(
        `research_${index + 1}`,
        AgentRole.RESEARCHER,
        [],
        `Investigate this specific question and cite the evidence for every claim:\n\n${question}`,
        10 - index,
      ),
    );

    const synthesis = this.makeNode(
      'synthesis',
      AgentRole.SYNTHESIZER,
      researchNodes.map((node) => node.id),
      `${INSTRUCTIONS[AgentRole.SYNTHESIZER]}\n\nOverall goal: ${task.goal}`,
      5,
    );

    return [...researchNodes, synthesis];
  }

  private extractQuestions(task: OptimizedTask): string[] {
    const source = `${task.userIntent}\n${task.goal}`;

    const explicit = [
      ...source.matchAll(/(?:^|\n)\s*(?:\d+[.)]|[-*])\s*(.+)/g),
      ...source.matchAll(/([^.!?\n]{15,240}\?)/g),
    ]
      .map((match) => match[1]?.trim())
      .filter((entry): entry is string => Boolean(entry && entry.length > 12));

    const unique = [...new Set(explicit)];
    if (unique.length >= 2) return unique;

    // No explicit questions: attack the goal from complementary angles.
    return [
      `What does the material establish directly about: ${task.goal}?`,
      `What are the trade-offs, alternatives, and counter-arguments relevant to: ${task.goal}?`,
      `What risks, limitations, or missing information affect: ${task.goal}?`,
    ];
  }

  // ─── LLM fallback ───────────────────────────────────────────────────────

  private async llmDecompose(
    task: OptimizedTask,
    classification: TaskClassification,
    strategy: ExecutionStrategy,
  ): Promise<DAGNode[] | null> {
    if (!this.executor) return null;

    try {
      const result = await this.executor.invoke({
        role: AgentRole.DECOMPOSER,
        strategy,
        responseFormat: 'json',
        taskType: classification.taskType,
        prompt: [
          `Decompose this ${classification.complexity} ${classification.taskType} task into 2-5 specialized subtasks.`,
          'Respond with JSON only: {"subtasks":[{"id","role","description","dependencies":[],"contextNeeds":[]}]}',
          'Exactly one subtask must use role "synthesizer" and depend on all the others.',
          '',
          `GOAL: ${task.goal}`,
          task.constraints.length > 0 ? `CONSTRAINTS: ${task.constraints.join('; ')}` : '',
          '',
          '<material_excerpt>',
          task.optimizedText.slice(0, 2_500),
          '</material_excerpt>',
        ]
          .filter(Boolean)
          .join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(result.text));
      const raw = Array.isArray(parsed.subtasks) ? parsed.subtasks : Array.isArray(parsed) ? parsed : [];
      if (raw.length === 0) return null;

      const nodes = this.normalizeLlmNodes(raw, task);
      return nodes.length > 0 ? nodes : null;
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'LLM decomposition failed — using single node');
      return null;
    }
  }

  /** Trust nothing: sanitize ids, drop dangling deps, guarantee a synthesis. */
  private normalizeLlmNodes(raw: unknown[], task: OptimizedTask): DAGNode[] {
    const idMap = new Map<string, string>();
    const cleaned: Array<{ id: string; role: AgentRole; description: string; dependencies: string[] }> = [];

    for (const [index, entry] of raw.entries()) {
      const record = asRecord(entry);
      const rawId = typeof record.id === 'string' ? record.id : `subtask_${index + 1}`;
      const id = rawId.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 40) || `subtask_${index + 1}`;
      if (idMap.has(id)) continue;

      idMap.set(rawId, id);
      cleaned.push({
        id,
        role: parseRole(record.role),
        description:
          typeof record.description === 'string' && record.description.trim()
            ? record.description.trim()
            : `Analyze the material for: ${task.goal}`,
        dependencies: Array.isArray(record.dependencies)
          ? record.dependencies.filter((dep): dep is string => typeof dep === 'string')
          : [],
      });
    }

    if (cleaned.length === 0) return [];

    const validIds = new Set(cleaned.map((entry) => entry.id));
    const nodes = cleaned.map((entry, index) =>
      this.makeNode(
        entry.id,
        entry.role,
        entry.dependencies
          .map((dep) => idMap.get(dep) ?? dep.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_'))
          .filter((dep) => validIds.has(dep) && dep !== entry.id),
        entry.description,
        10 - index,
      ),
    );

    const hasSynthesis = nodes.some((node) => node.role === AgentRole.SYNTHESIZER);
    if (!hasSynthesis && nodes.length > 1) {
      nodes.push(
        this.makeNode(
          'synthesis',
          AgentRole.SYNTHESIZER,
          nodes.filter((node) => node.dependencies.length === 0).map((node) => node.id),
          `${INSTRUCTIONS[AgentRole.SYNTHESIZER]}\n\nOverall goal: ${task.goal}`,
          5,
        ),
      );
    }

    return nodes;
  }

  // ─── Node construction ──────────────────────────────────────────────────

  private makeNode(
    id: string,
    role: AgentRole,
    dependencies: string[],
    instructions: string,
    priority: number,
    optional = false,
  ): DAGNode {
    return {
      id,
      role,
      dependencies,
      contextSlice: '',
      instructions,
      capabilities: [...getRoleDefinition(role).requiredCapabilities],
      estimatedInputTokens: 0,
      estimatedOutputTokens: 0,
      estimatedLatencyMs: 0,
      priority,
      requiresEnsemble: false,
      optional,
    };
  }

  /** Slice context per node (Rule 1), attach media, then profile. */
  private async finalize(
    skeleton: DAGNode[],
    context: string,
    classification: TaskClassification,
    options: DecomposeOptions,
  ): Promise<DAGNode[]> {
    const finalized: DAGNode[] = [];

    for (const node of skeleton) {
      const isSynthesis = node.dependencies.length > 0;
      // Synthesis works from upstream results; re-sending the source material
      // to it is the single most expensive mistake this system can make.
      const slice = isSynthesis
        ? { slice: '', tokensBefore: 0, tokensAfter: 0 }
        : await this.slicer.buildContextSlice(context, node);

      const capabilities: ProviderCapability[] = [...node.capabilities];
      const images = VISION_ROLES.has(node.role) ? options.images : undefined;
      if (images?.length && !capabilities.includes('vision')) capabilities.push('vision');
      if (AUDIO_ROLES.has(node.role) && !capabilities.includes('audio')) capabilities.push('audio');

      const withContext: DAGNode = {
        ...node,
        contextSlice: slice.slice,
        capabilities,
        ...(images?.length ? { images } : {}),
      };

      const profile = await this.profiler.profile(withContext, classification.taskType);
      finalized.push(this.profiler.applyProfile(withContext, profile));
    }

    return finalized;
  }
}
