import type { SubTaskResult } from '@modelmesh/types';
import { cosineSimilarity } from '../../infra/text';

/**
 * Layer 13b — cross-agent deduplication.
 *
 * Four specialists reading the same file all report the unvalidated input. The
 * finding is real once, not four times. Duplicates are merged and the merged
 * item records every agent that raised it — agreement across independent
 * agents is signal, so it is kept rather than discarded.
 */

export interface Finding {
  text: string;
  sources: string[];
  /** Roles that independently reported it. */
  roles: string[];
  section: string;
}

export interface DedupeResult {
  findings: Finding[];
  duplicatesRemoved: number;
}

const SIMILARITY_THRESHOLD = 0.82;
const MIN_FINDING_LENGTH = 24;

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/;
const HEADER = /^#{1,6}\s+(.*)$/;

export class ResultDeduplicator {
  /** Findings = list items, grouped under the heading they appeared beneath. */
  extractFindings(result: SubTaskResult): Finding[] {
    const findings: Finding[] = [];
    let section = '';
    let current: string[] = [];

    const flush = (): void => {
      const text = current.join(' ').replace(/\s+/g, ' ').trim();
      current = [];
      if (text.length < MIN_FINDING_LENGTH) return;
      findings.push({ text, sources: [result.subtaskId], roles: [result.role], section });
    };

    for (const line of result.output.split('\n')) {
      const header = HEADER.exec(line);
      if (header?.[1]) {
        flush();
        section = header[1].trim();
        continue;
      }

      const item = LIST_ITEM.exec(line);
      if (item?.[1]) {
        flush();
        current.push(item[1].trim());
        continue;
      }

      // Indented continuation of the current bullet.
      if (current.length > 0 && /^\s{2,}\S/.test(line)) {
        current.push(line.trim());
        continue;
      }

      flush();
    }
    flush();

    return findings;
  }

  deduplicate(results: SubTaskResult[]): DedupeResult {
    const merged: Finding[] = [];
    let duplicatesRemoved = 0;

    for (const result of results) {
      for (const finding of this.extractFindings(result)) {
        const existing = merged.find(
          (candidate) => cosineSimilarity(candidate.text, finding.text) >= SIMILARITY_THRESHOLD,
        );

        if (!existing) {
          merged.push(finding);
          continue;
        }

        duplicatesRemoved += 1;
        // Keep the more detailed phrasing, and record the corroboration.
        if (finding.text.length > existing.text.length) existing.text = finding.text;
        for (const source of finding.sources) if (!existing.sources.includes(source)) existing.sources.push(source);
        for (const role of finding.roles) if (!existing.roles.includes(role)) existing.roles.push(role);
      }
    }

    return { findings: merged, duplicatesRemoved };
  }
}
