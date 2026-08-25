import { logger } from '../../infra/logger';

/**
 * Prompt-injection guard (Rule 6's enforcement half).
 *
 * Two different jobs, deliberately asymmetric:
 *
 *   User intent  — a directive channel. An override attempt here is an attack
 *                  on the system and is rejected (PROMPT_INJECTION, 400).
 *   Document content — a data channel. A PDF saying "ignore your instructions"
 *                  is the *subject* of analysis, not an attack to reject, so it
 *                  is neutralized (delimiters escaped) and passed through.
 *
 * Rejecting untrusted content outright would make the product useless for its
 * main job: analyzing documents that someone else wrote.
 */

const OVERRIDE_PATTERNS: Array<{ pattern: RegExp; weight: number; label: string }> = [
  { pattern: /\bignore\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)\b/i, weight: 5, label: 'ignore_previous' },
  { pattern: /\bdisregard\s+(?:all\s+)?(?:the\s+)?(?:previous|prior|above|system)\b/i, weight: 5, label: 'disregard' },
  { pattern: /\b(?:reveal|print|repeat|show|output)\s+(?:me\s+)?(?:your|the)\s+(?:system\s+)?(?:prompt|instructions?|rules)\b/i, weight: 5, label: 'exfiltrate_prompt' },
  { pattern: /\byou\s+are\s+now\s+(?:a|an|the)\b/i, weight: 3, label: 'persona_override' },
  { pattern: /\b(?:forget|erase)\s+(?:everything|all)\s+(?:you|above)\b/i, weight: 4, label: 'forget_all' },
  { pattern: /\b(?:developer|debug|god)\s+mode\b/i, weight: 3, label: 'mode_switch' },
  { pattern: /\bDAN\b|\bjailbreak\b/i, weight: 3, label: 'jailbreak' },
  { pattern: /<\/?(?:system_instructions|user_intent|document_content|task_instructions|agent_results|output_contract)>/i, weight: 4, label: 'delimiter_injection' },
  { pattern: /\bnew\s+(?:system\s+)?instructions?\s*:/i, weight: 4, label: 'new_instructions' },
  { pattern: /\bwithout\s+(?:any\s+)?(?:restrictions?|filters?|safety)\b/i, weight: 2, label: 'restriction_bypass' },
];

/** Structural tokens that could break a prompt block boundary. */
const DELIMITERS =
  /<\/?(?:system_instructions|user_intent|document_content|task_instructions|agent_results|output_contract)\s*>/gi;

const REJECT_SCORE = 5;

export interface SafetyVerdict {
  safe: boolean;
  score: number;
  matches: string[];
}

export const scanForInjection = (text: string): SafetyVerdict => {
  const matches: string[] = [];
  let score = 0;

  for (const { pattern, weight, label } of OVERRIDE_PATTERNS) {
    if (pattern.test(text)) {
      score += weight;
      matches.push(label);
    }
  }

  return { safe: score < REJECT_SCORE, score, matches };
};

/**
 * Neutralize untrusted material: break delimiter tokens so content cannot
 * escape its block, and cap absurd repetition used to push instructions out of
 * the model's attention.
 */
export const neutralizeUntrusted = (text: string): string =>
  text
    .replace(DELIMITERS, (match) => match.replace(/[<>]/g, (bracket) => (bracket === '<' ? '(' : ')')))
    .replace(/(.)\1{200,}/g, (_match, char: string) => `${char.repeat(200)} […repetition truncated…]`);

export interface SanitizedInput {
  userIntent: string;
  verdict: SafetyVerdict;
}

/** Applied to the directive channel before anything else sees it. */
export const sanitizeUserIntent = (text: string | undefined): SanitizedInput => {
  const value = text ?? '';
  const verdict = scanForInjection(value);

  if (!verdict.safe) {
    logger.warn({ matches: verdict.matches, score: verdict.score }, 'Prompt injection rejected in user intent');
  }

  return { userIntent: neutralizeUntrusted(value), verdict };
};
