import type { OutputFormat } from '@modelmesh/types';
import { cosineSimilarity, normalizeWhitespace, parseSections } from '../../infra/text';

/**
 * Level 4 — output optimizer.
 *
 * Multi-model merges arrive with three "In conclusion" paragraphs and four
 * heading styles. This pass makes the answer read as one document without
 * touching evidence: code blocks, locations, and numbers are preserved
 * verbatim, because those are the parts a judge (or a user) checks.
 */

const META_COMMENTARY = [
  /^\s*(?:in conclusion|to summarize|to sum up|as (?:i|we) (?:have )?(?:shown|mentioned|discussed)|as you can see)\b[^.\n]*[.:]?\s*/gim,
  /^\s*(?:i hope this helps|let me know if you (?:need|have)|feel free to ask)[^\n]*$/gim,
  /^\s*(?:here(?:'s| is) (?:a|the) (?:summary|breakdown|analysis|report))\b[^.\n]*[.:]?\s*/gim,
  /^\s*(?:based on (?:my|the) analysis(?: of the (?:provided )?(?:code|document|material))?)[,:]?\s*/gim,
];

const DUPLICATE_SECTION_SIMILARITY = 0.85;

export interface OutputReport {
  output: string;
  duplicatesRemoved: number;
  charactersSaved: number;
}

export class OutputOptimizer {
  optimize(rawOutput: string, outputFormat: OutputFormat = 'markdown'): OutputReport {
    if (outputFormat === 'json') {
      return { output: rawOutput.trim(), duplicatesRemoved: 0, charactersSaved: 0 };
    }

    const { stripped, blocks } = this.protectCode(rawOutput);

    const deduped = this.removeDuplicateConclusions(stripped);
    let text = deduped.text;
    text = this.removeMetaCommentary(text);
    text = this.normalizeHeaders(text);

    const output = this.restoreCode(text, blocks).trim();

    return {
      output,
      duplicatesRemoved: deduped.removed,
      charactersSaved: Math.max(0, rawOutput.length - output.length),
    };
  }

  removeDuplicateConclusions(text: string): { text: string; removed: number } {
    const sections = parseSections(text);
    if (sections.length < 2) return { text, removed: 0 };

    const kept: typeof sections = [];
    const seen: string[] = [];
    let removed = 0;

    for (const section of sections) {
      const body = section.content.trim();
      if (body.length < 40) {
        kept.push(section);
        continue;
      }

      const duplicate = seen.some((existing) => cosineSimilarity(existing, body) > DUPLICATE_SECTION_SIMILARITY);
      if (duplicate) {
        removed += 1;
        continue;
      }

      kept.push(section);
      seen.push(body);
    }

    return {
      text: kept
        .map((section) => (section.header ? `${section.header}\n${section.content}` : section.content))
        .join('\n\n'),
      removed,
    };
  }

  removeMetaCommentary(text: string): string {
    let result = text;
    for (const pattern of META_COMMENTARY) result = result.replace(pattern, '');
    return result;
  }

  /** One heading hierarchy: `#` title, `##` sections, `###` items. */
  normalizeHeaders(text: string): string {
    const lines = normalizeWhitespace(text).split('\n');
    const levels = new Set<number>();

    for (const line of lines) {
      const match = /^(#{1,6})\s+\S/.exec(line);
      if (match?.[1]) levels.add(match[1].length);
    }

    if (levels.size === 0) return lines.join('\n');

    const ordered = [...levels].sort((a, b) => a - b);
    const remap = new Map(ordered.map((level, index) => [level, Math.min(6, index + 1)]));

    return lines
      .map((line) => {
        const match = /^(#{1,6})(\s+.*)$/.exec(line);
        if (!match?.[1] || !match[2]) return line;
        return `${'#'.repeat(remap.get(match[1].length) ?? match[1].length)}${match[2]}`;
      })
      .join('\n');
  }

  private protectCode(text: string): { stripped: string; blocks: string[] } {
    const blocks: string[] = [];
    const stripped = text.replace(/```[\s\S]*?```|~~~[\s\S]*?~~~/g, (match) => {
      blocks.push(match);
      return `\n\nOUTPUT_CODE_${blocks.length - 1}\n\n`;
    });
    return { stripped, blocks };
  }

  private restoreCode(text: string, blocks: string[]): string {
    let result = text;
    for (const [index, block] of blocks.entries()) {
      result = result.replace(`OUTPUT_CODE_${index}`, () => block);
    }
    return result;
  }
}
