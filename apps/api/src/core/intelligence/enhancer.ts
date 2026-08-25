import { AgentRole } from '@modelmesh/types';
import type {
  EnhancedTask,
  ExecutionStrategy,
  OutputFormat,
  TaskClassification,
  TaskInput,
} from '@modelmesh/types';
import { asRecord, asStringArray, parseJsonLoose } from '../../infra/json';
import { logger } from '../../infra/logger';
import { countTokens, normalizeWhitespace } from '../../infra/text';
import type { SubTaskExecutor } from '../orchestrator/executor';

/**
 * Layer 3 — task enhancement.
 *
 * "fix this bug" is not a specification. This layer turns raw input into a
 * goal, constraints, an output contract, and edge cases — and, critically,
 * keeps the user's intent physically separate from untrusted document content
 * so the safety boundary survives all the way to the provider call (Rule 6).
 */

const VAGUE_MARKERS = [
  /^\s*(?:fix|help|check|review|analy[sz]e|improve|explain|debug)\b[\s\S]{0,40}$/i,
  /\b(?:this|it|that|these)\b/i,
  /\bsomething(?:'s| is)? wrong\b/i,
];

const FORMAT_HINTS: Array<[RegExp, OutputFormat]> = [
  [/\bas json\b|\breturn json\b|\bjson format\b/i, 'json'],
  [/\bjust the code\b|\bonly code\b|\bcode only\b/i, 'code'],
  [/\bplain text\b|\bno markdown\b/i, 'text'],
];

/** Text-ish payloads we can read directly; everything else is preprocessed on-device. */
const TEXTUAL_MIME = /^(?:text\/|application\/(?:json|xml|javascript|x-ndjson|sql|x-yaml))/;

/** Lines that mark the start of pasted source rather than a sentence about it. */
const CODE_START = [
  /^\s*(?:public|private|protected|internal|static|final|abstract)\s+[\w<>[\]]+\s+\w+/,
  /^\s*(?:class|interface|struct|enum|impl|trait|module|namespace)\s+\w+/,
  /^\s*(?:function|def|fun|fn|sub|proc)\s+\w+/,
  /^\s*(?:import|from|#include|package|using|require)\s+[\w./{}@*-]/,
  /^\s*(?:const|let|var|val)\s+\w+\s*[:=]/,
  /^\s*(?:@\w+|#\[|<\?php|#!)/,
  /^\s*(?:SELECT|INSERT|UPDATE|CREATE TABLE)\s+/i,
  /^\s*[}\])];?\s*$/,
];

/** Above this, a text field is carrying material, not just an instruction. */
const MATERIAL_SPLIT_TOKENS = 900;
/** Hard ceiling on what stays in the directive channel. */
const INTENT_TOKEN_CEILING = 220;

export interface EnhanceOptions {
  strategy: ExecutionStrategy;
  /** Digest of earlier tasks in the same session, from ContextMemory. */
  sessionMemory?: string;
}

export class TaskEnhancer {
  constructor(private readonly executor?: SubTaskExecutor) {}

  async enhance(
    input: TaskInput,
    classification: TaskClassification,
    options: EnhanceOptions,
  ): Promise<EnhancedTask> {
    const split = this.splitIntentAndMaterial(normalizeWhitespace(input.text ?? '').trim(), classification);
    const userIntent = split.intent;
    const documentContent = [split.material, this.collectDocumentContent(input)]
      .filter((block) => block.trim().length > 0)
      .join('\n\n');
    const baseline = this.enhanceByRules(userIntent, documentContent, classification, options);

    const shouldCallLlm =
      Boolean(this.executor) &&
      options.strategy !== 'draft' &&
      (this.isVague(userIntent) || classification.complexity !== 'simple');

    if (!shouldCallLlm) return baseline;

    try {
      const result = await this.executor!.invoke({
        role: AgentRole.ENHANCER,
        strategy: options.strategy,
        responseFormat: 'json',
        taskType: classification.taskType,
        prompt: [
          'Turn this request into a precise specification. Respond with JSON only, using keys:',
          'goal, constraints (array), expected_output_format (markdown|json|text|code),',
          'helpful_context (string), edge_cases_to_consider (array).',
          '',
          `Task type: ${classification.taskType}. Complexity: ${classification.complexity}.`,
          '',
          '<user_intent>',
          userIntent.slice(0, 3_000) || '(no text supplied — see attached material)',
          '</user_intent>',
          '',
          '<material_excerpt>',
          documentContent.slice(0, 2_000),
          '</material_excerpt>',
        ].join('\n'),
      });

      const parsed = asRecord(parseJsonLoose(result.text));
      const goal = typeof parsed.goal === 'string' && parsed.goal.trim() ? parsed.goal.trim() : baseline.goal;
      const constraints = asStringArray(parsed.constraints);
      const edgeCases = asStringArray(parsed.edge_cases_to_consider ?? parsed.edgeCases);
      const helpfulContext =
        typeof parsed.helpful_context === 'string' ? parsed.helpful_context.trim() : baseline.helpfulContext;

      const enhanced: EnhancedTask = {
        ...baseline,
        goal,
        constraints: constraints.length > 0 ? constraints : baseline.constraints,
        edgeCases: edgeCases.length > 0 ? edgeCases : baseline.edgeCases,
        helpfulContext,
        expectedOutputFormat:
          this.coerceFormat(parsed.expected_output_format) ?? baseline.expectedOutputFormat,
        enhancedBy: 'llm',
      };

      return { ...enhanced, fullText: this.assembleFullText(enhanced, options.sessionMemory) };
    } catch (error) {
      logger.warn({ err: (error as Error).message }, 'LLM enhancement failed — keeping rule-based spec');
      return baseline;
    }
  }

  /**
   * Split one text field into the directive part and the material part.
   *
   * On a phone, "analyze this for security" and 40KB of pasted code arrive in
   * the same string. If all of it stays as user intent, every subtask receives
   * every byte and context slicing has nothing to slice — Rule 1 is lost before
   * the DAG is even built. So the bulk is reclassified as material here, which
   * is also the truthful classification: pasted code is data, not instruction.
   */
  splitIntentAndMaterial(
    text: string,
    classification: TaskClassification,
  ): { intent: string; material: string } {
    if (!text) return { intent: '', material: '' };

    // 1. Fenced blocks are unambiguous material.
    const fences = [...text.matchAll(/```[\s\S]*?```|~~~[\s\S]*?~~~/g)].map((match) => match[0]);
    const fencedChars = fences.reduce((sum, block) => sum + block.length, 0);
    if (fencedChars > 200) {
      const intent = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, ' ').replace(/\s+/g, ' ').trim();
      return { intent: intent || 'Analyze the supplied material', material: fences.join('\n\n') };
    }

    // 2. Unfenced code: the first line that looks like code starts the material.
    if (classification.requiresCode) {
      const lines = text.split('\n');
      const codeStart = lines.findIndex((line) => CODE_START.some((pattern) => pattern.test(line)));
      if (codeStart > 0) {
        return {
          intent: lines.slice(0, codeStart).join(' ').replace(/\s+/g, ' ').trim(),
          material: lines.slice(codeStart).join('\n'),
        };
      }
      if (codeStart === 0 && countTokens(text) > INTENT_TOKEN_CEILING) {
        return { intent: 'Analyze the supplied code', material: text };
      }
    }

    // 3. Long prose: the opening paragraphs are the ask, the rest is material.
    if (countTokens(text) > MATERIAL_SPLIT_TOKENS) {
      const paragraphs = text.split(/\n{2,}/);
      const intentParts: string[] = [];
      let tokens = 0;
      let index = 0;

      while (index < paragraphs.length) {
        const paragraph = paragraphs[index] ?? '';
        const paragraphTokens = countTokens(paragraph);
        if (intentParts.length > 0 && tokens + paragraphTokens > INTENT_TOKEN_CEILING) break;
        intentParts.push(paragraph);
        tokens += paragraphTokens;
        index += 1;
      }

      const material = paragraphs.slice(index).join('\n\n');
      if (material.trim()) {
        return { intent: intentParts.join('\n\n').trim(), material };
      }
    }

    return { intent: text, material: '' };
  }

  // ─── Deterministic baseline ─────────────────────────────────────────────

  enhanceByRules(
    userIntent: string,
    documentContent: string,
    classification: TaskClassification,
    options: EnhanceOptions,
  ): EnhancedTask {
    const constraints: string[] = [];
    if (classification.requiresCode) constraints.push('Reference exact locations (file, symbol, or line) for every finding');
    if (classification.modalities.includes('pdf') || classification.modalities.includes('image')) {
      constraints.push('Use only what the supplied material states; do not infer missing content');
    }
    if (options.strategy === 'draft') constraints.push('Keep the answer short — highest-impact points only');
    if (options.strategy === 'premium') constraints.push('Cover edge cases and second-order effects');

    const edgeCases: string[] = [];
    if (classification.requiresCode) edgeCases.push('Null/empty inputs', 'Concurrent access', 'Boundary values');
    if (classification.modalities.includes('image')) edgeCases.push('Low-quality or partially cropped capture');
    if (documentContent.length > 20_000) edgeCases.push('Material may be truncated for context limits');

    const enhanced: EnhancedTask = {
      goal: this.deriveGoal(userIntent, classification),
      constraints,
      expectedOutputFormat: this.detectFormat(userIntent, classification),
      helpfulContext: this.deriveHelpfulContext(classification),
      edgeCases,
      documentContent,
      userIntent,
      fullText: '',
      enhancedBy: 'rule',
    };

    return { ...enhanced, fullText: this.assembleFullText(enhanced, options.sessionMemory) };
  }

  /**
   * The master context that decomposition and slicing operate on. User intent
   * is included as a labelled header, never merged into the material itself.
   */
  private assembleFullText(task: EnhancedTask, sessionMemory?: string): string {
    const blocks = [`GOAL: ${task.goal}`];

    if (task.constraints.length > 0) {
      blocks.push(`CONSTRAINTS:\n${task.constraints.map((entry) => `- ${entry}`).join('\n')}`);
    }
    if (task.helpfulContext) blocks.push(`CONTEXT: ${task.helpfulContext}`);
    if (sessionMemory) blocks.push(`EARLIER IN THIS SESSION:\n${sessionMemory}`);
    if (task.edgeCases.length > 0) {
      blocks.push(`EDGE CASES:\n${task.edgeCases.map((entry) => `- ${entry}`).join('\n')}`);
    }
    if (task.documentContent) blocks.push(`MATERIAL:\n${task.documentContent}`);

    return blocks.join('\n\n');
  }

  private deriveGoal(userIntent: string, classification: TaskClassification): string {
    if (userIntent.length > 12) {
      const firstSentence = /^[\s\S]{12,240}?[.!?](?:\s|$)/.exec(userIntent)?.[0]?.trim();
      return firstSentence ?? userIntent.slice(0, 240);
    }

    switch (classification.taskType) {
      case 'CODE_ANALYSIS':
        return 'Analyze the supplied code for bugs, security issues, performance problems, and design weaknesses';
      case 'OCR':
        return 'Extract all text present in the supplied image';
      case 'AUDIO_TRANSCRIPTION':
        return 'Transcribe the supplied audio and highlight the key points';
      case 'DOCUMENT_ANALYSIS':
        return 'Analyze the supplied document and report its structure, key points, and conclusions';
      case 'IMAGE_ANALYSIS':
        return 'Describe the supplied image and extract any information it contains';
      default:
        return userIntent || 'Answer the request using the supplied material';
    }
  }

  private deriveHelpfulContext(classification: TaskClassification): string {
    const parts = [`Task type ${classification.taskType} (${classification.complexity})`];
    if (classification.modalities.length > 1) parts.push(`multimodal input: ${classification.modalities.join(' + ')}`);
    return parts.join('; ');
  }

  private detectFormat(userIntent: string, classification: TaskClassification): OutputFormat {
    for (const [pattern, format] of FORMAT_HINTS) if (pattern.test(userIntent)) return format;
    return classification.taskType === 'CODE_GENERATION' ? 'code' : 'markdown';
  }

  private coerceFormat(value: unknown): OutputFormat | null {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return ['markdown', 'json', 'text', 'code'].includes(normalized) ? (normalized as OutputFormat) : null;
  }

  private isVague(userIntent: string): boolean {
    if (countTokens(userIntent) < 12) return true;
    return VAGUE_MARKERS.some((pattern) => pattern.test(userIntent));
  }

  /**
   * Untrusted material, assembled from what the phone already extracted.
   * On-device OCR/text extraction is authoritative — re-doing it in the cloud
   * would cost tokens for a worse result.
   */
  private collectDocumentContent(input: TaskInput): string {
    const blocks: string[] = [];

    if (input.localMetadata?.detectedText?.trim()) {
      blocks.push(`[on-device extraction]\n${input.localMetadata.detectedText.trim()}`);
    }
    if (input.localMetadata?.barcodeData?.trim()) {
      blocks.push(`[barcode/QR payload]\n${input.localMetadata.barcodeData.trim()}`);
    }

    for (const file of input.files ?? []) {
      const label = `[file ${file.id} ${file.mimeType}]`;
      const detected = file.metadata?.detectedText?.trim();

      if (detected) {
        blocks.push(`${label}\n${detected}`);
        continue;
      }
      if (file.base64 && TEXTUAL_MIME.test(file.mimeType)) {
        try {
          blocks.push(`${label}\n${Buffer.from(file.base64, 'base64').toString('utf8')}`);
          continue;
        } catch {
          // Fall through to the descriptor.
        }
      }
      // Binary payloads travel to vision/audio models as-is; describe them here.
      blocks.push(
        `${label} (binary, ${file.metadata?.sizeBytes ?? 'unknown'} bytes${
          file.metadata?.pageCount ? `, ${file.metadata.pageCount} pages` : ''
        })`,
      );
    }

    return blocks.join('\n\n');
  }
}
