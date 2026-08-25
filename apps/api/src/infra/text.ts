/**
 * Text + token utilities.
 *
 * Token counts are estimates by design: every provider tokenizes differently,
 * and the calibration loop (core/telemetry/calibration.ts) corrects the drift
 * from observed usage instead of us shipping five tokenizers.
 */

/** ~4 characters per token, with a nudge for code-dense text. */
export const countTokens = (text: string): number => {
  if (!text) return 0;
  const symbolRatio = (text.match(/[{}()[\];=<>/\\|&*+#$]/g)?.length ?? 0) / text.length;
  const charsPerToken = symbolRatio > 0.06 ? 3.2 : 4;
  return Math.ceil(text.length / charsPerToken);
};

export const truncateToTokens = (text: string, maxTokens: number): string => {
  if (maxTokens <= 0) return '';
  if (countTokens(text) <= maxTokens) return text;
  // Cut on a paragraph boundary when one is close to the budget.
  const approxChars = maxTokens * 4;
  const slice = text.slice(0, approxChars);
  const lastBreak = slice.lastIndexOf('\n\n');
  return lastBreak > approxChars * 0.6 ? slice.slice(0, lastBreak) : slice;
};

export const normalizeWhitespace = (text: string): string =>
  text.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Stable prompt normalization for cache keys — case and spacing insensitive. */
export const normalizeForCache = (text: string): string =>
  normalizeWhitespace(text).toLowerCase().replace(/[^\w\s{}()[\].,;:'"-]/g, '');

const TOKEN_SPLIT = /[^a-z0-9_]+/;

export const tokenize = (text: string): string[] =>
  text.toLowerCase().split(TOKEN_SPLIT).filter((word) => word.length > 2);

/**
 * Bag-of-words cosine similarity. Cheap, dependency-free, and good enough for
 * near-duplicate detection; the semantic cache upgrades to real embeddings when
 * an embedding-capable provider key is configured.
 */
export const cosineSimilarity = (a: string, b: string): number => {
  const freq = (text: string): Map<string, number> => {
    const map = new Map<string, number>();
    for (const word of tokenize(text)) map.set(word, (map.get(word) ?? 0) + 1);
    return map;
  };

  const left = freq(a);
  const right = freq(b);
  if (left.size === 0 || right.size === 0) return 0;

  let dot = 0;
  for (const [word, count] of left) dot += count * (right.get(word) ?? 0);

  const norm = (map: Map<string, number>): number =>
    Math.sqrt([...map.values()].reduce((sum, count) => sum + count * count, 0));

  const denominator = norm(left) * norm(right);
  return denominator === 0 ? 0 : dot / denominator;
};

export const cosineSimilarityVectors = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < length; i++) {
    const left = a[i] ?? 0;
    const right = b[i] ?? 0;
    dot += left * right;
    normA += left * left;
    normB += right * right;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  return denominator === 0 ? 0 : dot / denominator;
};

/** Split markdown-ish text into `## heading` sections. */
export interface TextSection {
  header: string;
  content: string;
}

export const parseSections = (text: string): TextSection[] => {
  const lines = text.split('\n');
  const sections: TextSection[] = [];
  let header = '';
  let buffer: string[] = [];

  const flush = (): void => {
    const content = buffer.join('\n').trim();
    if (header || content) sections.push({ header, content });
    buffer = [];
  };

  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) {
      flush();
      header = line.trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections;
};

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/** Full jitter exponential backoff, capped. */
export const exponentialBackoff = (attempt: number, baseMs = 300, capMs = 8_000): number => {
  const ceiling = Math.min(capMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(ceiling / 2 + Math.random() * (ceiling / 2));
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

/** Rejects with a TIMEOUT error if the promise outlives `ms`. */
export const withTimeout = async <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(Object.assign(new Error(`${label} timed out after ${ms}ms`), { code: 'ETIMEDOUT' }));
        }, ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};
