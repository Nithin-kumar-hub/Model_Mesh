import type { TaskType } from '@modelmesh/types';
import { RedisKeys, type KeyValueStore } from '../../infra/store';
import { countTokens, truncateToTokens } from '../../infra/text';

export interface MemoryEntry {
  taskId: string;
  taskType: TaskType | string;
  summary: string;
  at: number;
}

const MAX_ENTRIES = 12;
const MAX_MEMORY_TOKENS = 700;
const TTL_SECONDS = 60 * 60 * 6;

/**
 * Long-session memory.
 *
 * A phone session asks follow-up questions ("now check the same file for
 * performance"). Carrying a compact digest of earlier tasks lets the enhancer
 * resolve those references without re-uploading the original context — which
 * is a token saving, not just a convenience.
 *
 * Session-scoped and TTL-bounded: nothing here outlives the conversation.
 */
export class ContextMemory {
  constructor(private readonly store: KeyValueStore) {}

  async remember(sessionId: string, entry: MemoryEntry): Promise<void> {
    const entries = await this.read(sessionId);
    entries.push(entry);
    const trimmed = entries.slice(-MAX_ENTRIES);
    await this.store.setex(RedisKeys.contextMemory(sessionId), TTL_SECONDS, JSON.stringify(trimmed));
  }

  async read(sessionId: string): Promise<MemoryEntry[]> {
    const raw = await this.store.get(RedisKeys.contextMemory(sessionId));
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as MemoryEntry[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /** Token-bounded digest, newest first, for injection into the enhancer. */
  async recall(sessionId: string): Promise<string> {
    const entries = await this.read(sessionId);
    if (entries.length === 0) return '';

    const lines: string[] = [];
    let tokens = 0;

    for (const entry of [...entries].reverse()) {
      const line = `- [${entry.taskType}] ${entry.summary}`;
      const lineTokens = countTokens(line);
      if (tokens + lineTokens > MAX_MEMORY_TOKENS) break;
      lines.push(line);
      tokens += lineTokens;
    }

    return truncateToTokens(lines.join('\n'), MAX_MEMORY_TOKENS);
  }

  async forget(sessionId: string): Promise<void> {
    await this.store.del(RedisKeys.contextMemory(sessionId));
  }
}
