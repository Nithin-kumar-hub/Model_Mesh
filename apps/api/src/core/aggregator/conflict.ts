import { AgentRole } from '@modelmesh/types';
import type { Conflict, ExecutionStrategy, SubTaskResult } from '@modelmesh/types';
import { conflictId } from '../../infra/ids';
import { asRecord, asStringArray, parseJsonLoose } from '../../infra/json';
import { logger } from '../../infra/logger';
import { cosineSimilarity, truncateToTokens } from '../../infra/text';
import type { SubTaskExecutor } from '../orchestrator/executor';

/**
 * Layer 13c — contradiction detection.
 *
 * Two independent agents disagreeing is the most useful signal a multi-agent
 * system produces, and the easiest to paper over. A cheap deterministic pass
 * catches polarity flips on the same subject; an LLM pass catches semantic
 * disagreement. Anything found forces verification (Layer 14).
 */

/** Assertion pairs that cannot both be true of the same subject. */
const POLARITY_PAIRS: Array<[RegExp, RegExp]> = [
  [/\bis (?:secure|safe)\b/i, /\bis (?:insecure|unsafe|vulnerable)\b/i],
  [/\bno (?:vulnerabilit|security issue)/i, /\b(?:critical|high)[- ]severity\b/i],
  [/\bthread[- ]safe\b/i, /\bnot thread[- ]safe\b/i],
  [/\bno (?:performance|bottleneck) (?:issue|problem)/i, /\b(?:n\+1|o\(n²\)|bottleneck)\b/i],
  [/\bcorrect(?:ly)?\b/i, /\bincorrect(?:ly)?\b|\bwrong\b/i],
  [/\bhandles? (?:null|errors?)\b/i, /\b(?:does not|doesn't) handle (?:null|errors?)\b/i],
  [/\brecommend(?:ed)?\b/i, /\bnot recommended\b|\bavoid\b/i],
];

const CLAIM_SIMILARITY_FLOOR = 0.35;
const MAX_LLM_INPUT_TOKENS = 2_400;

export class ConflictDetector {
  constructor(private readonly executor?: SubTaskExecutor) {}

  /** Deterministic: opposite polarity assertions about a similar subject. */
  detectByRules(results: SubTaskResult[]): Conflict[] {
    const conflicts: Conflict[] = [];

    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const left = results[i];
        const right = results[j];
        if (!left || !right) continue;

        for (const [positive, negative] of POLARITY_PAIRS) {
          const leftClaim = this.findSentence(left.output, positive);
          const rightClaim = this.findSentence(right.output, negative);
          if (!leftClaim || !rightClaim) continue;

          // Only a conflict if they are talking about the same thing.
          if (cosineSimilarity(leftClaim, rightClaim) < CLAIM_SIMILARITY_FLOOR) continue;

          conflicts.push({
            id: conflictId(),
            claimA: leftClaim,
            claimB: rightClaim,
            sourceA: left.subtaskId,
            sourceB: right.subtaskId,
            severity: /\bcritical|high|vulnerab|insecure\b/i.test(`${leftClaim}${rightClaim}`) ? 'high' : 'medium',
          });
        }
      }
    }

    return conflicts;
  }

  async detect(results: SubTaskResult[], strategy: ExecutionStrategy): Promise<Conflict[]> {
    const ruleConflicts = this.detectByRules(results);

    // Draft skips the extra call; two or fewer outputs rarely disagree usefully.
    if (!this.executor || strategy === 'draft' || results.length < 2) return ruleConflicts;

    try {
      const excerpt = results
        .map(
          (result) =>
            `### ${result.subtaskId} (${result.role})\n${truncateToTokens(
              result.output,
              Math.floor(MAX_LLM_INPUT_TOKENS / results.length),
            )}`,
        )
        .join('\n\n');

      const response = await this.executor.invoke({
        role: AgentRole.CRITIC,
        strategy,
        responseFormat: 'json',
        maxTokens: 600,
        prompt: [
          'Do these agent outputs contain contradictory claims about the same subject?',
          'Respond with JSON only: {"conflicts":[{"claimA","claimB","sourceA","sourceB","severity"}]}',
          'Return an empty array if they are merely different in emphasis or scope.',
          '',
          excerpt,
        ].join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(response.text));
      const raw = Array.isArray(parsed.conflicts) ? parsed.conflicts : [];

      const llmConflicts: Conflict[] = raw
        .map((entry) => asRecord(entry))
        .filter((entry) => typeof entry.claimA === 'string' && typeof entry.claimB === 'string')
        .map((entry) => ({
          id: conflictId(),
          claimA: String(entry.claimA),
          claimB: String(entry.claimB),
          sourceA: typeof entry.sourceA === 'string' ? entry.sourceA : 'unknown',
          sourceB: typeof entry.sourceB === 'string' ? entry.sourceB : 'unknown',
          severity: this.coerceSeverity(entry.severity),
        }));

      return this.mergeConflicts(ruleConflicts, llmConflicts);
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'LLM conflict detection failed — using rule results');
      return ruleConflicts;
    }
  }

  /** Ask a reasoning model which claim the material actually supports. */
  async resolve(conflict: Conflict, results: SubTaskResult[], strategy: ExecutionStrategy): Promise<Conflict> {
    if (!this.executor) return conflict;

    const sourceOutputs = results
      .filter((result) => result.subtaskId === conflict.sourceA || result.subtaskId === conflict.sourceB)
      .map((result) => `### ${result.subtaskId} (${result.role})\n${truncateToTokens(result.output, 900)}`)
      .join('\n\n');

    try {
      const response = await this.executor.invoke({
        role: AgentRole.VERIFIER,
        strategy,
        responseFormat: 'json',
        maxTokens: 500,
        prompt: [
          'Two agents disagree. Decide which claim the evidence supports, or state that it is unresolved.',
          'Respond with JSON only: {"verified":boolean,"issues":[],"corrections":["the resolution"],"final_confidence":number}',
          '',
          `CLAIM A (${conflict.sourceA}): ${conflict.claimA}`,
          `CLAIM B (${conflict.sourceB}): ${conflict.claimB}`,
          '',
          sourceOutputs,
        ].join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(response.text));
      const corrections = asStringArray(parsed.corrections);
      return {
        ...conflict,
        resolution:
          corrections[0] ??
          (parsed.verified === true ? `Claim A is supported: ${conflict.claimA}` : 'Unresolved — both claims are reported'),
      };
    } catch (error) {
      logger.warn({ err: (error as Error).message, conflictId: conflict.id }, 'Conflict resolution failed');
      return { ...conflict, resolution: 'Unresolved — both claims are reported' };
    }
  }

  private mergeConflicts(ruleConflicts: Conflict[], llmConflicts: Conflict[]): Conflict[] {
    const merged = [...ruleConflicts];
    for (const candidate of llmConflicts) {
      const duplicate = merged.some(
        (existing) =>
          cosineSimilarity(existing.claimA, candidate.claimA) > 0.7 &&
          cosineSimilarity(existing.claimB, candidate.claimB) > 0.7,
      );
      if (!duplicate) merged.push(candidate);
    }
    return merged;
  }

  private findSentence(text: string, pattern: RegExp): string | null {
    for (const sentence of text.split(/(?<=[.!?])\s+|\n/)) {
      if (pattern.test(sentence)) return sentence.trim().slice(0, 280);
    }
    return null;
  }

  private coerceSeverity(value: unknown): Conflict['severity'] {
    const normalized = String(value ?? '').toLowerCase();
    return normalized === 'high' || normalized === 'low' ? normalized : 'medium';
  }
}
