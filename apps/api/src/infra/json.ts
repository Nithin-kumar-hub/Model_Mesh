/**
 * Tolerant JSON extraction.
 *
 * Even with a JSON response format, models wrap output in ``` fences or add a
 * sentence before the object. Every JSON-shaped role goes through this, and a
 * parse failure is a normal, handled outcome — never a thrown error that takes
 * a subtask down.
 */
export const parseJsonLoose = <T>(text: string): T | null => {
  if (!text) return null;

  const candidates: string[] = [];
  const trimmed = text.trim();
  candidates.push(trimmed);

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fenced?.[1]) candidates.push(fenced[1].trim());

  // Widest brace/bracket span — handles prose on either side of the payload.
  for (const [open, close] of [
    ['{', '}'],
    ['[', ']'],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start >= 0 && end > start) candidates.push(trimmed.slice(start, end + 1));
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try the next candidate.
    }
  }

  return null;
};

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

export const asStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  }
  return typeof value === 'string' && value.trim() ? [value] : [];
};

export const asNumber = (value: unknown, fallback: number): number => {
  const parsed = typeof value === 'string' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fallback;
};

export const asBoolean = (value: unknown, fallback: boolean): boolean => {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return fallback;
};
