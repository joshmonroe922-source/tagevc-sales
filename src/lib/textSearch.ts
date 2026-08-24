/** Sanitize user input for Postgres `websearch_to_tsquery`. */
export function toWebsearchQuery(raw: string): string | null {
  const q = raw
    .trim()
    .replace(/[%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return q.length >= 2 ? q : null;
}

export const TEXT_SEARCH_OPTS = {
  type: 'websearch' as const,
  config: 'english',
};

/** Browse vs search row caps. Callers may pass a lower limit. */
export function searchLimit(requested: number | undefined, searching: boolean): number {
  const fallback = searching ? 80 : 200;
  const cap = searching ? 100 : 300;
  return Math.min(requested ?? fallback, cap);
}
