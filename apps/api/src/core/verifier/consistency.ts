import type { SubTaskResult } from '@modelmesh/types';
import { cosineSimilarity } from '../../infra/text';

/**
 * Layer 14b — structural consistency checks.
 *
 * Deterministic, zero-cost, and complementary to the critic: it catches the
 * failures a model reviewing prose tends to miss — an answer that dropped an
 * agent's entire contribution, a severity claimed in the summary but absent
 * from the body, an answer shorter than its own inputs warrant.
 */

export interface ConsistencyIssue {
  code:
    | 'MISSING_AGENT_CONTRIBUTION'
    | 'SEVERITY_MISMATCH'
    | 'SUSPICIOUSLY_SHORT'
    | 'TRUNCATED_OUTPUT'
    | 'EMPTY_SECTION';
  message: string;
}

export interface ConsistencyReport {
  consistent: boolean;
  issues: ConsistencyIssue[];
  /** Fraction of agent outputs represented in the final answer. */
  coverage: number;
}

const COVERAGE_FLOOR = 0.35;
const SHORT_OUTPUT_RATIO = 0.08;

export class ConsistencyChecker {
  check(output: string, analyses: SubTaskResult[]): ConsistencyReport {
    const issues: ConsistencyIssue[] = [];
    const substantive = analyses.filter((result) => result.output.trim().length > 80);

    let represented = 0;
    for (const result of substantive) {
      // Either the agent's language survived, or a distinctive token did.
      const similarity = cosineSimilarity(result.output, output);
      const marker = this.distinctiveToken(result.output);
      const present = similarity > 0.12 || (marker !== null && output.includes(marker));

      if (present) {
        represented += 1;
      } else {
        issues.push({
          code: 'MISSING_AGENT_CONTRIBUTION',
          message: `Output does not reflect any finding from ${result.subtaskId} (${result.role})`,
        });
      }
    }

    const coverage = substantive.length === 0 ? 1 : represented / substantive.length;

    const claimedSeverity = /\b(critical|high)[- ]severity\b|\*\*critical\*\*/i.test(output);
    const hasBody = /^\s*(?:[-*]|\d+\.)\s+\S/m.test(output);
    if (claimedSeverity && !hasBody) {
      issues.push({
        code: 'SEVERITY_MISMATCH',
        message: 'A critical/high severity is claimed but no itemized finding supports it',
      });
    }

    const inputChars = substantive.reduce((sum, result) => sum + result.output.length, 0);
    if (inputChars > 2_000 && output.length < inputChars * SHORT_OUTPUT_RATIO) {
      issues.push({
        code: 'SUSPICIOUSLY_SHORT',
        message: `Final answer (${output.length} chars) is very short relative to ${inputChars} chars of agent output`,
      });
    }

    if (/\b(?:\.\.\.|\[truncated\]|continued below)\s*$/i.test(output.trim())) {
      issues.push({ code: 'TRUNCATED_OUTPUT', message: 'Output appears to end mid-thought' });
    }

    for (const match of output.matchAll(/^#{2,6}\s+(.+)$\n+(?=#{2,6}\s|\s*$)/gm)) {
      issues.push({ code: 'EMPTY_SECTION', message: `Section "${match[1]?.trim()}" has no content` });
    }

    return {
      consistent: issues.length === 0 && coverage >= COVERAGE_FLOOR,
      issues,
      coverage: Number(coverage.toFixed(3)),
    };
  }

  /** A rare-looking token (identifier, path, or line reference) to trace. */
  private distinctiveToken(text: string): string | null {
    const match =
      /\b[A-Z][a-zA-Z0-9]{6,}\b/.exec(text) ??
      /\b[a-z][a-zA-Z0-9]*_[a-zA-Z0-9_]{3,}\b/.exec(text) ??
      /\bline \d+\b/.exec(text);
    return match?.[0] ?? null;
  }
}
