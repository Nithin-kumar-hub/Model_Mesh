import { AgentRole } from '@modelmesh/types';
import type { ExecutionStrategy, SubTaskResult, VerificationResult } from '@modelmesh/types';
import { asNumber, asRecord, asStringArray, parseJsonLoose } from '../../infra/json';
import { logger } from '../../infra/logger';
import { truncateToTokens } from '../../infra/text';
import type { SubTaskExecutor } from '../orchestrator/executor';

/**
 * Layer 14 — critic verification.
 *
 * Runs only when it has a reason to (Rule 5): low confidence, a detected
 * conflict, or premium strategy. Verification that always runs is a tax; one
 * that runs on the 20% of answers that need it is quality.
 */

export interface VerifyOptions {
  strategy: ExecutionStrategy;
  reason: string;
  goal: string;
}

export class Critic {
  constructor(private readonly executor?: SubTaskExecutor) {}

  async verify(
    output: string,
    analyses: SubTaskResult[],
    options: VerifyOptions,
  ): Promise<VerificationResult> {
    if (!this.executor || !output.trim()) {
      return { verified: true, issues: [], corrections: [], confidence: 0.75, verifiedBy: 'skipped' };
    }

    const evidence = analyses
      .map((result) => `### ${result.subtaskId} (${result.role})\n${truncateToTokens(result.output, 700)}`)
      .join('\n\n');

    try {
      const response = await this.executor.invoke({
        role: AgentRole.VERIFIER,
        strategy: options.strategy,
        responseFormat: 'json',
        maxTokens: 900,
        prompt: [
          `Verify this answer against the evidence it was built from. Goal: ${options.goal}`,
          `Verification was triggered because: ${options.reason}.`,
          '',
          'Check for: claims unsupported by the evidence, internal contradictions, logical errors,',
          'and anything materially missing. Do not introduce new findings of your own.',
          '',
          'Respond with JSON only: {"verified":boolean,"issues":[],"corrections":[],"final_confidence":number}',
          '',
          '<answer>',
          truncateToTokens(output, 3_000),
          '</answer>',
          '',
          '<evidence>',
          evidence,
          '</evidence>',
        ].join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(response.text));
      const issues = asStringArray(parsed.issues);
      const corrections = asStringArray(parsed.corrections);
      // "verified: true" alongside a list of issues is a contradiction; trust the list.
      const verified = parsed.verified === true && issues.length === 0;

      return {
        verified,
        issues,
        corrections,
        confidence: Math.max(
          0.1,
          Math.min(0.98, asNumber(parsed.final_confidence ?? parsed.confidence, verified ? 0.85 : 0.6)),
        ),
        verifiedBy: 'critic',
      };
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'Critic verification failed');
      return { verified: true, issues: [], corrections: [], confidence: 0.7, verifiedBy: 'skipped' };
    }
  }

  /** Verification findings are surfaced to the user, not silently swallowed. */
  applyToOutput(output: string, verification: VerificationResult): string {
    if (verification.verified || (verification.issues.length === 0 && verification.corrections.length === 0)) {
      return output;
    }

    const lines = ['', '## Verification Notes', ''];
    if (verification.issues.length > 0) {
      lines.push('**Issues found during verification:**');
      for (const issue of verification.issues) lines.push(`- ${issue}`);
      lines.push('');
    }
    if (verification.corrections.length > 0) {
      lines.push('**Suggested corrections:**');
      for (const correction of verification.corrections) lines.push(`- ${correction}`);
    }

    return `${output}\n${lines.join('\n')}`;
  }
}
