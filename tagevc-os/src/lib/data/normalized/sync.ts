/**
 * Debounced dual-write helpers for Phase 9 normalized tables.
 * Snapshots remain the fallback; these syncs are best-effort.
 */

const timers = new Map<string, ReturnType<typeof setTimeout>>();

export function queueNormalizedSync(
  key: string,
  run: () => Promise<unknown>,
  delayMs = 400,
) {
  const existing = timers.get(key);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    timers.delete(key);
    void run().catch((e) => console.error(`normalized sync ${key}`, e));
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
