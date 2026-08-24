import type { SupabaseClient } from '@supabase/supabase-js';

/** Sanitize user input for Postgres `websearch_to_tsquery`. */
export function toWebsearchQuery(raw: string): string | null {
  const q = raw
    .trim()
    .replace(/[%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return q.length >= 2 ? q : null;
}

/** Fallback for simple `.textSearch` (no rank). Prefer ranked RPCs. */
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

type RankedRow = { id: string; rank?: number };

export function isMissingRpcError(error: unknown): boolean {
  const msg =
    error && typeof error === 'object' && 'message' in error
      ? String((error as { message: unknown }).message)
      : String(error ?? '');
  return /could not find the function|schema cache|does not exist/i.test(msg);
}

/**
 * Default CRM search: call a `*_ranked` RPC that orders by `ts_rank_cd`.
 * Returns IDs best-match-first, or `null` if the RPC is not applied yet
 * (caller should fall back to unranked `.textSearch`).
 */
export async function rankedSearchIds(
  client: SupabaseClient,
  rpcName: string,
  args: Record<string, unknown>,
): Promise<string[] | null> {
  const { data, error } = await client.rpc(rpcName, args);
  if (error) {
    if (isMissingRpcError(error)) return null;
    throw error;
  }
  return ((data ?? []) as RankedRow[]).map((r) => String(r.id));
}

/** Re-apply RPC rank order after hydrating full rows with `.in('id', ids)`. */
export function orderByIdList<T extends { id: string }>(
  rows: T[],
  ids: string[],
): T[] {
  const map = new Map(rows.map((r) => [r.id, r]));
  const out: T[] = [];
  for (const id of ids) {
    const row = map.get(id);
    if (row) out.push(row);
  }
  return out;
}
