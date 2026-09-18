/**
 * Run work after the browser is idle so first paint / hydration stay free.
 * Falls back to a short timeout when requestIdleCallback is missing.
 */
export function afterIdle(fn: () => void, timeoutMs = 1800): () => void {
  let cancelled = false;
  const run = () => {
    if (cancelled) return;
    cancelled = true;
    fn();
  };

  if (typeof window === 'undefined') {
    return () => {
      cancelled = true;
    };
  }

  if (typeof window.requestIdleCallback === 'function') {
    const idleId = window.requestIdleCallback(run, { timeout: timeoutMs });
    return () => {
      cancelled = true;
      window.cancelIdleCallback(idleId);
    };
  }

  const timeoutId = window.setTimeout(run, Math.min(400, timeoutMs));
  return () => {
    cancelled = true;
    window.clearTimeout(timeoutId);
  };
}
