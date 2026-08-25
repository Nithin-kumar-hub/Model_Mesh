import { AgentRole } from '@modelmesh/types';
import type { Complexity, InputType, TaskClassification, TaskInput, TaskType } from '@modelmesh/types';
import { logger } from '../../infra/logger';
import { asNumber, asRecord, parseJsonLoose } from '../../infra/json';
import { countTokens } from '../../infra/text';
import { ROLE_PIPELINES } from '../agents/roles';
import type { SubTaskExecutor } from '../orchestrator/executor';

/**
 * Layer 2 — task understanding.
 *
 * Rules first: they are free, instant, and deterministic, and they resolve the
 * overwhelming majority of real inputs. The cloud classifier is only paid for
 * when the rules are genuinely unsure — classifying every task with an LLM
 * would add a round-trip to the critical path of even a one-line question.
 */

interface Rule {
  taskType: TaskType;
  patterns: RegExp[];
  weight: number;
}

const RULES: Rule[] = [
  { taskType: 'CODE_ANALYSIS', patterns: [/\b(?:security|vulnerab|owasp|inject|exploit|cve)\w*\b/i, /\banaly[sz]e\b[\s\S]{0,40}\b(?:code|backend|service|api|repo)\b/i], weight: 3 },
  { taskType: 'CODE_REVIEW', patterns: [/\b(?:review|critique|assess)\b[\s\S]{0,30}\b(?:code|pr|pull request|diff|commit)\b/i, /\bcode review\b/i], weight: 3 },
  { taskType: 'BUG_FIX', patterns: [/\b(?:fix|debug|why (?:is|does)|broken|crash|stack ?trace|exception|error)\b/i, /\bnot working\b/i], weight: 2 },
  { taskType: 'CODE_GENERATION', patterns: [/\b(?:write|generate|implement|create|build|scaffold)\b[\s\S]{0,30}\b(?:function|class|method|endpoint|component|script|test)\w*\b/i], weight: 3 },
  { taskType: 'PDF_EXTRACTION', patterns: [/\bextract\b[\s\S]{0,30}\b(?:pdf|document|table|invoice|form)\b/i], weight: 3 },
  { taskType: 'DOCUMENT_QA', patterns: [/\b(?:according to|in (?:this|the) (?:document|pdf|paper)|what does (?:it|the document) say)\b/i], weight: 3 },
  { taskType: 'DOCUMENT_ANALYSIS', patterns: [/\banaly[sz]e\b[\s\S]{0,30}\b(?:document|pdf|report|paper|contract)\b/i], weight: 3 },
  { taskType: 'OCR', patterns: [/\b(?:ocr|read the text|transcribe (?:this )?(?:image|photo|screenshot)|what does (?:this|the) (?:sign|label) say)\b/i], weight: 4 },
  { taskType: 'VISUAL_QA', patterns: [/\b(?:what(?:'s| is) (?:in|on) (?:this|the) (?:image|photo|picture)|describe (?:this|the) (?:image|photo))\b/i], weight: 4 },
  { taskType: 'IMAGE_ANALYSIS', patterns: [/\b(?:image|photo|picture|screenshot|diagram|chart)\b/i], weight: 1 },
  { taskType: 'AUDIO_TRANSCRIPTION', patterns: [/\b(?:transcribe|transcript|what did (?:they|he|she) say)\b/i], weight: 4 },
  { taskType: 'AUDIO_ANALYSIS', patterns: [/\b(?:audio|recording|voice ?note|meeting)\b/i], weight: 2 },
  { taskType: 'RESEARCH', patterns: [/\b(?:research|investigate|compare|pros and cons|trade-?offs?|evaluate options|which is better)\b/i], weight: 3 },
  { taskType: 'SUMMARIZATION', patterns: [/\b(?:summari[sz]e|tl;?dr|key points|brief overview|condense)\b/i], weight: 4 },
  { taskType: 'TRANSLATION', patterns: [/\btranslate\b/i, /\bin (?:spanish|french|german|hindi|japanese|chinese|tamil|telugu|kannada)\b/i], weight: 4 },
  { taskType: 'CREATIVE_WRITING', patterns: [/\b(?:write (?:a|an) (?:story|poem|essay|blog|email|caption)|rewrite|make it sound)\b/i], weight: 3 },
  { taskType: 'DATA_ANALYSIS', patterns: [/\b(?:csv|dataset|statistics|trend|correlat|forecast|chart the)\b/i], weight: 3 },
  { taskType: 'COMPLEX_REASONING', patterns: [/\b(?:why|explain how|prove|derive|step by step|reason(?:ing)? through|architect)\b/i], weight: 2 },
];

const CODE_SIGNALS = [
  /^\s*(?:public|private|protected|static|final)\s+\w+/m,
  /\b(?:function|def|fun|class|interface|struct|impl)\s+\w+/,
  /\b(?:import|from|#include|package|using)\s+[\w./{}@-]+/,
  /=>|::|->|;\s*$/m,
  /\{[\s\S]*\}/,
  /```/,
];

const MODALITY_BY_MIME: Array<[RegExp, InputType]> = [
  [/^image\//, 'image'],
  [/^audio\//, 'audio'],
  [/^video\//, 'video'],
  [/pdf/, 'pdf'],
  [/^text\/(?:x-|plain)/, 'code'],
];

export class TaskClassifier {
  constructor(private readonly executor?: SubTaskExecutor) {}

  /** Deterministic pass. Cheap and, for most inputs, sufficient. */
  classifyByRules(input: TaskInput): TaskClassification {
    const text = input.text ?? '';
    const detected = [
      input.localMetadata?.detectedText ?? '',
      ...(input.files ?? []).map((file) => file.metadata?.detectedText ?? ''),
    ]
      .filter(Boolean)
      .join('\n');

    const haystack = `${text}\n${detected}`;
    const modalities = this.detectModalities(input);
    const requiresVision = modalities.includes('image') || modalities.includes('video');
    const requiresCode = modalities.includes('code') || CODE_SIGNALS.some((pattern) => pattern.test(haystack));

    const scores = new Map<TaskType, number>();
    for (const rule of RULES) {
      for (const pattern of rule.patterns) {
        if (pattern.test(haystack)) scores.set(rule.taskType, (scores.get(rule.taskType) ?? 0) + rule.weight);
      }
    }

    // Modality is strong evidence on its own.
    if (requiresVision) {
      scores.set('IMAGE_ANALYSIS', (scores.get('IMAGE_ANALYSIS') ?? 0) + 2);
      if (input.localMetadata?.barcodeData) scores.set('OCR', (scores.get('OCR') ?? 0) + 3);
    }
    if (modalities.includes('pdf')) {
      scores.set('DOCUMENT_ANALYSIS', (scores.get('DOCUMENT_ANALYSIS') ?? 0) + 2);
    }
    if (modalities.includes('audio')) {
      scores.set('AUDIO_TRANSCRIPTION', (scores.get('AUDIO_TRANSCRIPTION') ?? 0) + 2);
    }
    if (requiresCode) {
      for (const codeType of ['CODE_ANALYSIS', 'CODE_REVIEW', 'BUG_FIX'] as const) {
        if (scores.has(codeType)) scores.set(codeType, (scores.get(codeType) ?? 0) + 1);
      }
      if (scores.size === 0) scores.set('CODE_REVIEW', 2);
    }

    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked[0];
    const runnerUp = ranked[1];

    const contentTokens = countTokens(haystack);
    const complexity = this.assessComplexity(contentTokens, haystack, requiresVision, modalities.length);

    const taskType: TaskType =
      top?.[0] ?? (contentTokens < 60 ? 'SIMPLE_QA' : requiresCode ? 'CODE_REVIEW' : 'COMPLEX_REASONING');

    // Confident when one type wins clearly; unsure when nothing or two things match.
    const margin = (top?.[1] ?? 0) - (runnerUp?.[1] ?? 0);
    const confidence = top
      ? Math.min(0.96, 0.55 + Math.min(0.25, (top[1] ?? 0) * 0.05) + Math.min(0.16, margin * 0.05))
      : 0.45;

    return {
      taskType,
      modalities,
      complexity,
      requiresVision,
      requiresCode,
      requiresReasoning: complexity !== 'simple' || taskType === 'COMPLEX_REASONING',
      estimatedSubtasks: this.estimateSubtasks(taskType, complexity),
      confidence: Number(confidence.toFixed(3)),
      classifiedBy: 'rule',
    };
  }

  /**
   * Rules, then a cloud classifier only if the rules are unsure.
   * On-device classification (Android ML Kit) arrives pre-computed in
   * `localMetadata` and is treated as a strong prior.
   */
  async classify(input: TaskInput, strategy: 'draft' | 'balanced' | 'premium'): Promise<TaskClassification> {
    const ruleResult = this.classifyByRules(input);
    if (ruleResult.confidence >= 0.7 || !this.executor || strategy === 'draft') return ruleResult;

    try {
      const result = await this.executor.invoke({
        role: AgentRole.CLASSIFIER,
        strategy,
        responseFormat: 'json',
        maxTokens: 256,
        prompt: [
          'Classify this task. Respond with JSON only.',
          '',
          'Allowed taskType values:',
          'CODE_ANALYSIS, CODE_REVIEW, CODE_GENERATION, BUG_FIX, DOCUMENT_ANALYSIS, PDF_EXTRACTION,',
          'DOCUMENT_QA, IMAGE_ANALYSIS, OCR, VISUAL_QA, AUDIO_TRANSCRIPTION, AUDIO_ANALYSIS, RESEARCH,',
          'SUMMARIZATION, TRANSLATION, CREATIVE_WRITING, DATA_ANALYSIS, SIMPLE_QA, COMPLEX_REASONING',
          '',
          `Modalities present: ${ruleResult.modalities.join(', ')}`,
          '',
          '<input>',
          (input.text ?? '').slice(0, 4_000),
          '</input>',
        ].join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(result.text));
      const taskType = this.coerceTaskType(parsed.taskType) ?? ruleResult.taskType;
      const complexity = this.coerceComplexity(parsed.complexity) ?? ruleResult.complexity;

      return {
        ...ruleResult,
        taskType,
        complexity,
        requiresVision: ruleResult.requiresVision || parsed.requiresVision === true,
        requiresCode: ruleResult.requiresCode || parsed.requiresCode === true,
        requiresReasoning: parsed.requiresReasoning === true || ruleResult.requiresReasoning,
        estimatedSubtasks: Math.max(
          1,
          Math.min(8, Math.round(asNumber(parsed.estimatedSubtasks, ruleResult.estimatedSubtasks))),
        ),
        confidence: Math.max(ruleResult.confidence, Math.min(0.98, asNumber(parsed.confidence, 0.8))),
        classifiedBy: 'cloud',
      };
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'Cloud classification failed — keeping rule result');
      return ruleResult;
    }
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private detectModalities(input: TaskInput): InputType[] {
    const modalities = new Set<InputType>();
    if (input.text?.trim()) modalities.add('text');
    if (input.localMetadata?.barcodeData) modalities.add('qr');

    for (const file of input.files ?? []) {
      const match = MODALITY_BY_MIME.find(([pattern]) => pattern.test(file.mimeType));
      modalities.add(match?.[1] ?? 'text');
    }

    if (input.type !== 'multipart') modalities.add(input.type);
    if (modalities.size === 0) modalities.add('text');
    return [...modalities];
  }

  private assessComplexity(
    tokens: number,
    text: string,
    requiresVision: boolean,
    modalityCount: number,
  ): Complexity {
    let score = 0;
    if (tokens > 400) score += 1;
    if (tokens > 2_000) score += 1;
    if (tokens > 8_000) score += 1;
    if (modalityCount > 1) score += 1;
    if (requiresVision) score += 1;
    // Multiple questions or an explicit list of asks.
    if ((text.match(/\?/g) ?? []).length > 2) score += 1;
    if (/\band also\b|\badditionally\b|^\s*\d+\.\s/m.test(text)) score += 1;

    if (score >= 4) return 'very_complex';
    if (score >= 2) return 'complex';
    if (score >= 1) return 'medium';
    return 'simple';
  }

  private estimateSubtasks(taskType: TaskType, complexity: Complexity): number {
    if (complexity === 'simple') return 1;
    const pipeline = ROLE_PIPELINES[taskType];
    if (!pipeline) return complexity === 'very_complex' ? 4 : 2;
    return pipeline.parallel.length + pipeline.then.length;
  }

  private coerceTaskType(value: unknown): TaskType | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toUpperCase().replace(/[\s-]+/g, '_');
    return RULES.some((rule) => rule.taskType === normalized) ||
      ['SIMPLE_QA', 'COMPLEX_REASONING', 'DOCUMENT_ANALYSIS'].includes(normalized)
      ? (normalized as TaskType)
      : null;
  }

  private coerceComplexity(value: unknown): Complexity | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, '_');
    return ['simple', 'medium', 'complex', 'very_complex'].includes(normalized)
      ? (normalized as Complexity)
      : null;
  }
}
