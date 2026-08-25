import { AgentRole } from '@modelmesh/types';
import type { DAGNode } from '@modelmesh/types';
import { countTokens, tokenize, truncateToTokens } from '../../infra/text';

/**
 * Level 2 — per-subtask context slicing (Rule 1, docs/08-TOKEN-INTELLIGENCE.md).
 *
 * This is where the real savings live. A SQL-injection reviewer does not need
 * the pagination helper; a performance analyst does not need the auth code.
 * Everything else in the token stack is rounding error next to not sending
 * 24K tokens of irrelevant context to four agents in parallel.
 */

export interface RelevancyRule {
  keywords: string[];
  sections: string[];
  maxTokens: number;
}

export interface SliceReport {
  slice: string;
  tokensBefore: number;
  tokensAfter: number;
  strategy: 'passthrough' | 'keyword' | 'llm';
  keptChunks: number;
  totalChunks: number;
}

/** Optional LLM extractor, injected so this module stays free of provider deps. */
export type LlmExtractor = (input: {
  context: string;
  role: AgentRole;
  instructions: string;
  maxTokens: number;
}) => Promise<string>;

const DEFAULT_RULE: RelevancyRule = { keywords: [], sections: [], maxTokens: 8_000 };

const RELEVANCY_RULES: Partial<Record<AgentRole, RelevancyRule>> = {
  [AgentRole.SECURITY_ANALYZER]: {
    keywords: [
      'password', 'auth', 'sql', 'query', 'inject', 'xss', 'csrf', 'input', 'sanitize', 'escape',
      'encrypt', 'hash', 'token', 'session', 'cookie', 'admin', 'role', 'permission', 'secret',
      'exec', 'eval', 'deserialize', 'upload', 'path', 'request', 'header',
    ],
    sections: ['security', 'auth', 'input handling', 'database', 'api', 'controller', 'middleware'],
    maxTokens: 8_000,
  },
  [AgentRole.PERFORMANCE_ANALYZER]: {
    keywords: [
      'loop', 'for', 'while', 'query', 'select', 'join', 'cache', 'index', 'n+1', 'algorithm',
      'complexity', 'memory', 'async', 'await', 'thread', 'lock', 'sync', 'batch', 'stream',
      'collection', 'list', 'map', 'sort', 'recursive',
    ],
    sections: ['performance', 'database', 'algorithm', 'caching', 'repository', 'service'],
    maxTokens: 7_000,
  },
  [AgentRole.CODER]: {
    keywords: [
      'function', 'method', 'class', 'return', 'exception', 'error', 'throw', 'catch', 'null',
      'undefined', 'bug', 'if', 'else', 'switch', 'validate', 'parse', 'convert', 'index',
    ],
    sections: ['implementation', 'logic', 'error handling', 'service', 'util'],
    maxTokens: 9_000,
  },
  [AgentRole.CODE_REVIEWER]: {
    keywords: [
      'class', 'function', 'test', 'mock', 'assert', 'todo', 'fixme', 'deprecated', 'interface',
      'abstract', 'comment', 'naming', 'duplicate', 'copy',
    ],
    sections: ['implementation', 'tests', 'style', 'structure'],
    maxTokens: 8_000,
  },
  [AgentRole.ARCHITECT]: {
    keywords: [
      'service', 'module', 'layer', 'dependency', 'interface', 'pattern', 'design', 'coupling',
      'cohesion', 'import', 'export', 'inject', 'factory', 'repository', 'controller', 'config',
    ],
    sections: ['architecture', 'structure', 'design', 'overview', 'module', 'config'],
    maxTokens: 6_000,
  },
  [AgentRole.RESEARCHER]: {
    keywords: ['because', 'evidence', 'result', 'conclusion', 'data', 'study', 'claim', 'source', 'therefore'],
    sections: ['summary', 'findings', 'results', 'discussion', 'conclusion', 'abstract'],
    maxTokens: 10_000,
  },
  [AgentRole.SUMMARIZER]: {
    keywords: ['summary', 'conclusion', 'key', 'important', 'overall', 'total', 'result'],
    sections: ['summary', 'abstract', 'conclusion', 'overview', 'introduction'],
    maxTokens: 12_000,
  },
  [AgentRole.VISION_ANALYZER]: {
    keywords: ['image', 'photo', 'diagram', 'chart', 'table', 'text', 'ocr', 'label'],
    sections: ['image', 'figure', 'caption'],
    maxTokens: 4_000,
  },
  [AgentRole.SYNTHESIZER]: {
    // Synthesis works from agent results, not the raw source material.
    keywords: [],
    sections: [],
    maxTokens: 12_000,
  },
  [AgentRole.VERIFIER]: { keywords: [], sections: [], maxTokens: 8_000 },
  [AgentRole.CRITIC]: { keywords: [], sections: [], maxTokens: 8_000 },
};

/** ~60-line windows keep code chunks self-contained enough to reason about. */
const CODE_WINDOW_LINES = 60;
const CODE_WINDOW_OVERLAP = 6;
/** Above this size, a cheap extraction call pays for itself many times over. */
const LLM_EXTRACT_THRESHOLD_TOKENS = 10_000;
/** Orientation prefix so an agent is never handed context with no beginning. */
const HEAD_TOKENS = 250;

interface Chunk {
  index: number;
  text: string;
  header: string;
  tokens: number;
}

export class ContextSlicer {
  constructor(private readonly extractor?: LlmExtractor) {}

  getRelevancyRules(role: AgentRole): RelevancyRule {
    return RELEVANCY_RULES[role] ?? DEFAULT_RULE;
  }

  async buildContextSlice(masterContext: string, node: DAGNode): Promise<SliceReport> {
    const tokensBefore = countTokens(masterContext);
    const rule = this.getRelevancyRules(node.role);

    // Nothing to gain — slicing a small context only risks dropping signal.
    if (tokensBefore <= rule.maxTokens) {
      return {
        slice: masterContext,
        tokensBefore,
        tokensAfter: tokensBefore,
        strategy: 'passthrough',
        keptChunks: 1,
        totalChunks: 1,
      };
    }

    if (tokensBefore > LLM_EXTRACT_THRESHOLD_TOKENS && this.extractor) {
      try {
        const extracted = await this.extractor({
          context: masterContext,
          role: node.role,
          instructions: node.instructions,
          maxTokens: rule.maxTokens,
        });
        const slice = truncateToTokens(extracted.trim(), rule.maxTokens);
        if (countTokens(slice) > 200) {
          return {
            slice,
            tokensBefore,
            tokensAfter: countTokens(slice),
            strategy: 'llm',
            keptChunks: 1,
            totalChunks: 1,
          };
        }
      } catch {
        // Extraction is an optimization; fall through to the deterministic path.
      }
    }

    return this.keywordSlice(masterContext, node, rule, tokensBefore);
  }

  /** Deterministic scoring: keyword density + section match + position. */
  private keywordSlice(
    masterContext: string,
    node: DAGNode,
    rule: RelevancyRule,
    tokensBefore: number,
  ): SliceReport {
    const chunks = this.chunk(masterContext);
    const instructionTerms = new Set(tokenize(node.instructions));
    const keywords = new Set(rule.keywords);

    const scored = chunks.map((chunk) => {
      const words = tokenize(chunk.text);
      const headerLower = chunk.header.toLowerCase();

      let keywordHits = 0;
      let instructionHits = 0;
      for (const word of words) {
        if (keywords.has(word)) keywordHits += 1;
        if (instructionTerms.has(word)) instructionHits += 1;
      }

      const sectionBonus = rule.sections.some((section) => headerLower.includes(section)) ? 6 : 0;
      const density = words.length > 0 ? (keywordHits / words.length) * 40 : 0;
      const positionBonus = chunk.index < 2 ? 1.5 : 0;

      return {
        chunk,
        score: keywordHits + instructionHits * 0.5 + sectionBonus + density + positionBonus,
      };
    });

    const head = truncateToTokens(masterContext, HEAD_TOKENS);
    let budget = rule.maxTokens - countTokens(head);
    const kept: Chunk[] = [];

    for (const { chunk, score } of [...scored].sort((a, b) => b.score - a.score)) {
      if (budget <= 0) break;
      if (score <= 0 && kept.length > 0) continue;
      if (chunk.tokens > budget && kept.length > 0) continue;
      kept.push(chunk);
      budget -= chunk.tokens;
    }

    // Restore document order: agents reason better over coherent text.
    kept.sort((a, b) => a.index - b.index);

    const body = kept.map((chunk) => chunk.text).join('\n\n');
    const slice = truncateToTokens(
      kept.length === chunks.length ? masterContext : `${head}\n\n[…]\n\n${body}`,
      rule.maxTokens,
    );

    return {
      slice,
      tokensBefore,
      tokensAfter: countTokens(slice),
      strategy: 'keyword',
      keptChunks: kept.length,
      totalChunks: chunks.length,
    };
  }

  /** Markdown sections for prose; overlapping line windows for long code. */
  private chunk(text: string): Chunk[] {
    const chunks: Chunk[] = [];
    let header = '';

    const pushProse = (block: string): void => {
      const trimmed = block.trim();
      if (!trimmed) return;
      chunks.push({ index: chunks.length, text: trimmed, header, tokens: countTokens(trimmed) });
    };

    for (const block of text.split(/\n{2,}/)) {
      const headerMatch = /^#{1,6}\s+(.*)$/m.exec(block);
      if (headerMatch?.[1]) header = headerMatch[1];

      const lines = block.split('\n');
      if (lines.length > CODE_WINDOW_LINES) {
        for (let start = 0; start < lines.length; start += CODE_WINDOW_LINES - CODE_WINDOW_OVERLAP) {
          pushProse(lines.slice(start, start + CODE_WINDOW_LINES).join('\n'));
        }
      } else {
        pushProse(block);
      }
    }

    return chunks;
  }
}
