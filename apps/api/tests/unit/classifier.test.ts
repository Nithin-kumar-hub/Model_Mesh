import { describe, expect, it } from 'vitest';
import type { TaskInput } from '@modelmesh/types';
import { TaskClassifier } from '../../src/core/intelligence/classifier';
import type { SubTaskExecutor } from '../../src/core/orchestrator/executor';

/**
 * Layer 2. Rules resolve most inputs for free; the cloud classifier is only
 * paid for when the rules are genuinely unsure.
 */

const input = (overrides: Partial<TaskInput> = {}): TaskInput => ({
  type: 'text',
  ...overrides,
});

const JAVA = [
  'public class ReportService {',
  '  public User login(String user, String pass) throws Exception {',
  '    Statement st = conn.createStatement();',
  '    return st.executeQuery("SELECT * FROM users WHERE name=\'" + user + "\'");',
  '  }',
  '}',
].join('\n');

describe('TaskClassifier.classifyByRules', () => {
  const classifier = new TaskClassifier();

  it('recognizes a security review of pasted code', () => {
    const result = classifier.classifyByRules(
      input({ type: 'code', text: `Analyze this backend for security vulnerabilities.\n\n${JAVA}` }),
    );

    expect(result.taskType).toBe('CODE_ANALYSIS');
    expect(result.requiresCode).toBe(true);
    expect(result.classifiedBy).toBe('rule');
    expect(result.confidence).toBeGreaterThan(0.6);
  });

  it('recognizes a summarization request', () => {
    const result = classifier.classifyByRules(input({ text: 'Summarize this article in five bullet points.' }));
    expect(result.taskType).toBe('SUMMARIZATION');
  });

  it('recognizes a research comparison', () => {
    const result = classifier.classifyByRules(
      input({ text: 'Compare Redis and Postgres for a job queue and list the trade-offs.' }),
    );
    expect(result.taskType).toBe('RESEARCH');
  });

  it('recognizes a translation request', () => {
    const result = classifier.classifyByRules(input({ text: 'Translate this paragraph into Spanish.' }));
    expect(result.taskType).toBe('TRANSLATION');
  });

  it('falls back to SIMPLE_QA for a short question that matches nothing', () => {
    const result = classifier.classifyByRules(input({ text: 'What is the capital of France?' }));

    expect(result.taskType).toBe('SIMPLE_QA');
    expect(result.complexity).toBe('simple');
    expect(result.estimatedSubtasks).toBe(1);
  });

  it('treats an attached image as vision evidence', () => {
    const result = classifier.classifyByRules(
      input({
        type: 'image',
        text: 'What is going on here?',
        files: [{ id: 'f1', mimeType: 'image/jpeg', base64: 'AAAA' }],
      }),
    );

    expect(result.requiresVision).toBe(true);
    expect(result.modalities).toContain('image');
    expect(result.taskType).toBe('IMAGE_ANALYSIS');
  });

  it('treats a barcode payload as an OCR signal', () => {
    const result = classifier.classifyByRules(
      input({
        type: 'image',
        files: [{ id: 'f1', mimeType: 'image/png', base64: 'AAAA' }],
        localMetadata: { barcodeData: 'https://example.test/product/42' },
      }),
    );

    expect(result.taskType).toBe('OCR');
    expect(result.modalities).toContain('qr');
  });

  it('classifies a PDF attachment as document analysis', () => {
    const result = classifier.classifyByRules(
      input({
        type: 'pdf',
        text: 'Analyze this document and pull out the payment terms.',
        files: [{ id: 'f1', mimeType: 'application/pdf', metadata: { pageCount: 12 } }],
      }),
    );

    expect(result.modalities).toContain('pdf');
    expect(result.taskType).toBe('DOCUMENT_ANALYSIS');
  });

  it('reads on-device OCR text as classification evidence', () => {
    const result = classifier.classifyByRules(
      input({
        type: 'image',
        files: [{ id: 'f1', mimeType: 'image/png', base64: 'AAAA' }],
        localMetadata: { detectedText: 'Summarize the key points of this whiteboard.' },
      }),
    );

    expect(result.taskType).toBe('SUMMARIZATION');
  });

  it('scores complexity up as the input grows', () => {
    const short = classifier.classifyByRules(input({ text: 'Fix this typo.' }));
    const long = classifier.classifyByRules(
      input({ type: 'code', text: `Analyze this service.\n\n${JAVA.repeat(400)}` }),
    );

    expect(short.complexity).toBe('simple');
    expect(['complex', 'very_complex']).toContain(long.complexity);
    expect(long.estimatedSubtasks).toBeGreaterThan(short.estimatedSubtasks);
  });

  it('marks a multi-question prompt as needing reasoning', () => {
    const result = classifier.classifyByRules(
      input({
        text: 'Why does this fail? What should we change? Which option scales better for our traffic?',
      }),
    );

    expect(result.requiresReasoning).toBe(true);
  });
});

describe('TaskClassifier.classify', () => {
  const failingExecutor = {
    invoke: async (): Promise<never> => {
      throw new Error('executor must not be called');
    },
  } as unknown as SubTaskExecutor;

  it('does not pay for a cloud call when the rules are confident', async () => {
    const classifier = new TaskClassifier(failingExecutor);

    const result = await classifier.classify(
      input({ text: 'Summarize this article in five bullet points.' }),
      'balanced',
    );

    expect(result.classifiedBy).toBe('rule');
  });

  it('never pays for a cloud call on the draft strategy', async () => {
    const classifier = new TaskClassifier(failingExecutor);

    const result = await classifier.classify(input({ text: 'hmm' }), 'draft');

    expect(result.classifiedBy).toBe('rule');
  });

  it('escalates to the cloud classifier when the rules are unsure', async () => {
    const executor = {
      invoke: async (): Promise<{ text: string }> => ({
        text: JSON.stringify({
          taskType: 'complex reasoning',
          complexity: 'complex',
          requiresReasoning: true,
          estimatedSubtasks: 3,
          confidence: 0.88,
        }),
      }),
    } as unknown as SubTaskExecutor;
    const classifier = new TaskClassifier(executor);

    const result = await classifier.classify(input({ text: 'hmm' }), 'balanced');

    expect(result.classifiedBy).toBe('cloud');
    expect(result.taskType).toBe('COMPLEX_REASONING');
    expect(result.complexity).toBe('complex');
    expect(result.estimatedSubtasks).toBe(3);
  });

  it('keeps the rule result when the cloud classifier fails', async () => {
    const classifier = new TaskClassifier(failingExecutor);
    const rules = classifier.classifyByRules(input({ text: 'hmm' }));

    const result = await classifier.classify(input({ text: 'hmm' }), 'balanced');

    expect(result.classifiedBy).toBe('rule');
    expect(result.taskType).toBe(rules.taskType);
  });

  it('ignores a cloud taskType outside the allowed set', async () => {
    const executor = {
      invoke: async (): Promise<{ text: string }> => ({
        text: JSON.stringify({ taskType: 'MAKE_ME_A_SANDWICH', confidence: 0.99 }),
      }),
    } as unknown as SubTaskExecutor;
    const classifier = new TaskClassifier(executor);
    const rules = classifier.classifyByRules(input({ text: 'hmm' }));

    const result = await classifier.classify(input({ text: 'hmm' }), 'balanced');

    expect(result.taskType).toBe(rules.taskType);
  });
});
