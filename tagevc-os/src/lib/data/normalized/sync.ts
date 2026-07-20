/**
 * Debounced dual-write helpers for normalized tables.
 * Snapshots remain the fallback; these syncs are best-effort.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();

type SyncStat = {
  ok: number;
  fail: number;
  lastOkAt: string | null;
  lastFailAt: string | null;
  lastError: string | null;
};

const syncStats = new Map<string, SyncStat>();

function ensureStat(key: string): SyncStat {
  let s = syncStats.get(key);
  if (!s) {
    s = { ok: 0, fail: 0, lastOkAt: null, lastFailAt: null, lastError: null };
    syncStats.set(key, s);
  }
  return s;
}

export function recordNormalizedSyncResult(
  key: string,
  ok: boolean,
  error?: unknown,
) {
  const s = ensureStat(key);
  const now = new Date().toISOString();
  if (ok) {
    s.ok += 1;
    s.lastOkAt = now;
    s.lastError = null;
  } else {
    s.fail += 1;
    s.lastFailAt = now;
    s.lastError =
      error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'sync failed';
    console.error(`normalized sync ${key}`, error ?? 'failed');
  }
}

export function getNormalizedSyncStats(): Record<string, SyncStat> {
  return Object.fromEntries(syncStats.entries());
}

export function queueNormalizedSync(
  key: string,
  run: () => Promise<unknown>,
  delayMs = 400,
) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(key);
    void run()
      .then((result) => {
        // Repos return boolean; treat undefined as ok (fire-and-forget voids)
        if (result === false) {
          recordNormalizedSyncResult(key, false, 'returned false');
        } else {
          recordNormalizedSyncResult(key, true);
        }
      })
      .catch((e) => {
        recordNormalizedSyncResult(key, false, e);
      });
  }, delayMs);
  timers.set(key, timer);
}

/** Prefer SQL when tables exist and have rows, or when force flag is set. */
export function preferNormalizedTables(): boolean {
  return (
    process.env.USE_NORMALIZED_TABLES === '1' ||
    process.env.USE_NORMALIZED_TABLES === 'true'
  );
}

/**
 * Dual-read gate used by store hydrates and master-data.
 * - null rows → table unavailable (keep snapshot/seed)
 * - non-empty OR USE_NORMALIZED_TABLES → prefer SQL
 */
export function shouldUseNormalizedRows<T>(rows: T[] | null): rows is T[] {
  return rows != null && (rows.length > 0 || preferNormalizedTables());
}
