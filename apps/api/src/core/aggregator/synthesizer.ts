import { AgentRole } from '@modelmesh/types';
import type {
  AggregatedResult,
  Conflict,
  ExecutionPlan,
  ExecutionStrategy,
  OutputFormat,
  SubTaskResult,
} from '@modelmesh/types';
import { config } from '../../config';
import { logger } from '../../infra/logger';
import { truncateToTokens } from '../../infra/text';
import type { SubTaskExecutor } from '../orchestrator/executor';
import { OutputOptimizer } from '../optimizer/output';
import { ResultCollector } from './collector';
import { ConflictDetector } from './conflict';
import { ResultDeduplicator } from './deduplicator';

/**
 * Layer 13d + 15 — synthesis and output optimization.
 *
 * If the plan contained a synthesis node, its output is the answer. If that
 * node failed, or there was never one, the aggregator merges deterministically
 * from the deduplicated findings — so a partial run still returns a real,
 * readable answer instead of an error page.
 */

export interface AggregateOptions {
  strategy: ExecutionStrategy;
  outputFormat: OutputFormat;
  goal: string;
}

export interface AggregationOutcome extends AggregatedResult {
  conflicts: Conflict[];
  synthesizedBy: 'plan_node' | 'llm' | 'deterministic';
}

export class ResultAggregator {
  private readonly outputOptimizer = new OutputOptimizer();

  constructor(
    private readonly collector: ResultCollector,
    private readonly deduplicator: ResultDeduplicator,
    private readonly conflictDetector: ConflictDetector,
    private readonly executor?: SubTaskExecutor,
  ) {}

  async aggregate(
    results: Map<string, SubTaskResult>,
    plan: ExecutionPlan,
    options: AggregateOptions,
  ): Promise<AggregationOutcome> {
    const collected = this.collector.collect(results, plan);

    if (collected.all.length === 0) {
      return {
        output: '',
        outputFormat: options.outputFormat,
        conflicts: [],
        conflictsFound: 0,
        conflictsResolved: 0,
        confidence: 0,
        duplicatesRemoved: 0,
        synthesizedBy: 'deterministic',
      };
    }

    // A single-node plan needs no merge — just the output pass.
    if (collected.all.length === 1 && collected.analyses.length === 1) {
      const only = collected.analyses[0]!;
      const optimized = this.outputOptimizer.optimize(only.output, options.outputFormat);
      return {
        output: optimized.output,
        outputFormat: options.outputFormat,
        conflicts: [],
        conflictsFound: 0,
        conflictsResolved: 0,
        confidence: only.confidence,
        duplicatesRemoved: optimized.duplicatesRemoved,
        synthesizedBy: 'plan_node',
      };
    }

    const conflicts = await this.conflictDetector.detect(collected.analyses, options.strategy);
    const resolved: Conflict[] = [];
    for (const conflict of conflicts) {
      resolved.push(await this.conflictDetector.resolve(conflict, collected.analyses, options.strategy));
    }

    const dedupe = this.deduplicator.deduplicate(collected.analyses);

    let output: string;
    let synthesizedBy: AggregationOutcome['synthesizedBy'];

    if (collected.synthesis && collected.synthesis.output.trim().length > 0) {
      output = collected.synthesis.output;
      synthesizedBy = 'plan_node';
    } else {
      const llmMerged = await this.synthesizeWithLlm(collected.analyses, options);
      if (llmMerged) {
        output = llmMerged;
        synthesizedBy = 'llm';
      } else {
        output = this.synthesizeDeterministically(collected.analyses, dedupe.findings, options);
        synthesizedBy = 'deterministic';
      }
    }

    output = this.appendConflictSection(output, resolved);
    if (collected.critique?.output.trim()) {
      // Drop the critic's own leading header so we don't stack two headers.
      const critique = collected.critique.output.trim().replace(/^#{1,6}\s+.*\n+/, '');
      output = `${output}\n\n## Adversarial Review\n\n${critique}`;
    }

    const optimized = this.outputOptimizer.optimize(output, options.outputFormat);

    return {
      output: optimized.output,
      outputFormat: options.outputFormat,
      conflicts: resolved,
      conflictsFound: resolved.length,
      conflictsResolved: resolved.filter((conflict) => Boolean(conflict.resolution)).length,
      confidence: this.adjustConfidenceForConflicts(collected.overallConfidence, resolved),
      duplicatesRemoved: dedupe.duplicatesRemoved + optimized.duplicatesRemoved,
      synthesizedBy,
    };
  }

  /** Fallback synthesis when the plan's synthesis node did not produce output. */
  private async synthesizeWithLlm(
    analyses: SubTaskResult[],
    options: AggregateOptions,
  ): Promise<string | null> {
    if (!this.executor || analyses.length === 0) return null;

    const budgetPerAnalysis = Math.max(400, Math.floor(4_000 / analyses.length));
    const body = analyses
      .map(
        (result) =>
          `### ${result.subtaskId} (${result.role}, confidence ${result.confidence.toFixed(2)})\n${truncateToTokens(
            result.output,
            budgetPerAnalysis,
          )}`,
      )
      .join('\n\n');

    try {
      const response = await this.executor.invoke({
        role: AgentRole.SYNTHESIZER,
        strategy: options.strategy,
        prompt: [
          `Merge these specialist results into one report answering: ${options.goal}`,
          'Sections: Summary, Critical Issues, Recommendations, Evidence.',
          'Remove duplicates, preserve every specific location and code example, flag contradictions.',
          '',
          body,
        ].join('\n'),
      });
      return response.text.trim() || null;
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'Fallback LLM synthesis failed — merging locally');
      return null;
    }
  }

  /**
   * Deterministic merge. No model call, no network: the answer is assembled
   * from the deduplicated findings, grouped by the section each came from.
   */
  synthesizeDeterministically(
    analyses: SubTaskResult[],
    findings: ReturnType<ResultDeduplicator['deduplicate']>['findings'],
    options: AggregateOptions,
  ): string {
    const sections: string[] = [`# ${options.goal}`, '', '## Summary', ''];

    const roles = [...new Set(analyses.map((result) => result.role))];
    sections.push(
      `Merged from ${analyses.length} specialist result${analyses.length === 1 ? '' : 's'} (${roles.join(', ')}).`,
      '',
    );

    // Findings corroborated by more than one agent lead.
    const corroborated = findings.filter((finding) => finding.roles.length > 1);
    const single = findings.filter((finding) => finding.roles.length === 1);

    if (corroborated.length > 0) {
      sections.push('## Critical Issues', '');
      for (const finding of corroborated) {
        sections.push(`- ${finding.text} _(reported by ${finding.roles.join(', ')})_`);
      }
      sections.push('');
    }

    if (single.length > 0) {
      sections.push('## Findings', '');
      const bySection = new Map<string, typeof single>();
      for (const finding of single) {
        const key = finding.section || 'General';
        bySection.set(key, [...(bySection.get(key) ?? []), finding]);
      }
      for (const [sectionName, items] of bySection) {
        sections.push(`### ${sectionName}`, '');
        for (const finding of items) sections.push(`- ${finding.text} _(${finding.roles.join(', ')})_`);
        sections.push('');
      }
    }

    if (findings.length === 0) {
      // No parseable findings: keep the raw agent output rather than lose it.
      sections.push('## Agent Results', '');
      for (const result of analyses) {
        sections.push(`### ${result.role}`, '', truncateToTokens(result.output, 1_200), '');
      }
    }

    return sections.join('\n');
  }

  private appendConflictSection(output: string, conflicts: Conflict[]): string {
    if (conflicts.length === 0) return output;

    const lines = ['', '## Conflicts Detected', ''];
    for (const conflict of conflicts) {
      lines.push(
        `- **${conflict.severity.toUpperCase()}** — \`${conflict.sourceA}\` states: ${conflict.claimA}`,
        `  \`${conflict.sourceB}\` states: ${conflict.claimB}`,
        `  **Resolution:** ${conflict.resolution ?? 'unresolved — both claims are reported above'}`,
      );
    }

    return `${output}\n${lines.join('\n')}`;
  }

  /** Unresolved disagreement is a reason to be less confident, not more. */
  private adjustConfidenceForConflicts(confidence: number, conflicts: Conflict[]): number {
    const unresolved = conflicts.filter((conflict) => !conflict.resolution).length;
    const high = conflicts.filter((conflict) => conflict.severity === 'high').length;
    const penalty = unresolved * 0.08 + high * 0.05;
    return Number(Math.max(0.1, confidence - penalty).toFixed(3));
  }
}

/** Thresholds from docs/06-ORCHESTRATION-ENGINE.md — confidence drives compute (Rule 5). */
export const shouldVerify = (
  confidence: number,
  conflictsFound: number,
  strategy: ExecutionStrategy,
): { verify: boolean; reason: string } => {
  if (!config.features.verification) return { verify: false, reason: 'disabled' };
  if (conflictsFound > 0) return { verify: true, reason: 'conflict' };
  if (strategy === 'premium') return { verify: true, reason: 'premium_strategy' };
  if (strategy === 'draft') return { verify: false, reason: 'draft_strategy' };
  if (confidence < 0.7) return { verify: true, reason: 'low_confidence' };
  return { verify: false, reason: 'high_confidence' };
};
