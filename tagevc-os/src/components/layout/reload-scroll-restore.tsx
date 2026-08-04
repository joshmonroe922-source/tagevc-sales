'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'os.reload-scroll.v2';
const PENDING_KEY = 'os.reload-scroll.pending.v2';

type Saved = { path: string; y: number; ts: number };

/** Survives React Strict Mode effect re-entry for a single document load. */
let restoreLockForTimeOrigin: number | null = null;

function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming | undefined;
    if (nav?.type === 'reload') return true;
  } catch {
    /* ignore */
  }
  try {
    const legacy = (
      performance as unknown as { navigation?: { type?: number } }
    ).navigation;
    if (legacy?.type === 1) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function consumePendingReload(): boolean {
  try {
    const pending = sessionStorage.getItem(PENDING_KEY);
    if (pending) {
      sessionStorage.removeItem(PENDING_KEY);
      return pending === '1';
    }
  } catch {
    /* ignore */
  }
  return false;
}

function markPendingReload() {
  try {
    sessionStorage.setItem(PENDING_KEY, '1');
  } catch {
    /* ignore */
  }
}

/** Prefer marked shell scroller, then overflow main, else window (null). */
function getScroller(): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>(
    '[data-scroll-restoration]',
  );
  if (marked) return marked;

  const mains = document.querySelectorAll('main');
  for (const main of mains) {
    if (!(main instanceof HTMLElement)) continue;
    const oy = getComputedStyle(main).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return main;
    if (main.scrollHeight > main.clientHeight + 1) return main;
  }

  const candidates = document.querySelectorAll<HTMLElement>(
    '.overflow-y-auto, .overflow-auto',
  );
  let best: HTMLElement | null = null;
  let bestOverflow = 0;
  for (const el of candidates) {
    const overflow = el.scrollHeight - el.clientHeight;
    if (overflow > bestOverflow) {
      bestOverflow = overflow;
      best = el;
    }
  }
  return bestOverflow > 0 ? best : null;
}

function readY(el: HTMLElement | null): number {
  if (el) return el.scrollTop;
  return window.scrollY || document.documentElement.scrollTop || 0;
}

function writeY(el: HTMLElement | null, y: number) {
  if (el) el.scrollTop = y;
  else window.scrollTo(0, y);
}

function loadSaved(): Saved | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Saved;
    if (typeof parsed?.path !== 'string' || typeof parsed?.y !== 'number') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function save(path: string, y: number) {
  try {
    const payload: Saved = {
      path,
      y: Math.max(0, Math.round(y)),
      ts: Date.now(),
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* private mode / quota */
  }
}

function clearSaved() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function canHoldY(el: HTMLElement | null, y: number): boolean {
  if (!el) {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    return max >= y - 1;
  }
  return el.scrollHeight - el.clientHeight >= y - 1;
}

function runRestore(
  y: number,
  onDone: (applied: boolean) => void,
): () => void {
  let cancelled = false;
  let settled = false;
  const started = Date.now();
  // Admin Suspense fallbacks (e.g. /admin/migration SF ops) can take far
  // longer than a couple seconds before the real scroll height appears.
  const maxMs = 90_000;
  let raf = 0;
  let holdFrames = 0;
  let pollId = 0;
  const observers: Array<ResizeObserver | MutationObserver> = [];

  const finish = (applied: boolean) => {
    if (settled) return;
    settled = true;
    for (const ob of observers) ob.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (pollId) window.clearInterval(pollId);
    onDone(applied);
  };

  const tryRestore = () => {
    if (cancelled || settled) return;
    const el = getScroller();
    writeY(el, y);
    const applied = readY(el);
    const closeEnough = Math.abs(applied - y) <= 2;
    const tallEnough = canHoldY(el, y);

    if (closeEnough && tallEnough) {
      holdFrames += 1;
      if (holdFrames >= 8) {
        finish(true);
        return;
      }
    } else {
      holdFrames = 0;
    }

    if (Date.now() - started > maxMs) {
      finish(closeEnough);
      return;
    }

    raf = requestAnimationFrame(tryRestore);
  };

  requestAnimationFrame(() => {
    requestAnimationFrame(tryRestore);
  });
  // rAF stops when the tab is backgrounded; keep a wall-clock poll too.
  pollId = window.setInterval(tryRestore, 250);

  const armScrollerObservers = () => {
    const scroller = getScroller();
    if (!scroller || settled || cancelled) return;
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        if (!settled && !cancelled) tryRestore();
      });
      ro.observe(scroller);
      if (scroller.firstElementChild) ro.observe(scroller.firstElementChild);
      observers.push(ro);
    }
    if (typeof MutationObserver !== 'undefined') {
      const mo = new MutationObserver(() => {
        if (!settled && !cancelled) tryRestore();
      });
      mo.observe(scroller, { childList: true, subtree: true });
      // Also watch body: Suspense can replace the whole main subtree.
      mo.observe(document.body, { childList: true, subtree: true });
      observers.push(mo);
    }
  };
  armScrollerObservers();

  return () => {
    cancelled = true;
    for (const ob of observers) ob.disconnect();
    if (raf) cancelAnimationFrame(raf);
    if (pollId) window.clearInterval(pollId);
  };
}

/**
 * Hard refresh: restore scroll for the same path (shell main scroller or window).
 * Client route changes: scroll shell back to top.
 * Hash URLs: prefer the hash target over a saved Y.
 */
export function ReloadScrollRestore() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const readyRef = useRef(false);
  const skipSaveRef = useRef(false);

  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
  }, []);

  useEffect(() => {
    const prev = pathRef.current;
    pathRef.current = pathname;

    if (typeof window !== 'undefined' && window.location.hash) {
      clearSaved();
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (id) {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView();
        });
      }
      readyRef.current = true;
      return;
    }

    const saved = loadSaved();
    const pending = consumePendingReload();
    const freshSave =
      saved != null && Date.now() - saved.ts < 15_000;
    const alreadyLocked =
      restoreLockForTimeOrigin === performance.timeOrigin;
    const shouldRestore =
      !readyRef.current &&
      saved?.path === pathname &&
      saved.y > 0 &&
      (alreadyLocked ||
        isReloadNavigation() ||
        (pending && freshSave));

    if (shouldRestore) {
      restoreLockForTimeOrigin = performance.timeOrigin;
      const y = saved.y;
      skipSaveRef.current = true;
      readyRef.current = true;

      const stop = runRestore(y, (applied) => {
        skipSaveRef.current = false;
        if (applied) clearSaved();
      });

      return () => {
        stop();
        // Strict Mode: allow the remounted effect to continue restoring.
        readyRef.current = false;
        skipSaveRef.current = true;
      };
    }

    if (readyRef.current && prev !== pathname) {
      skipSaveRef.current = true;
      writeY(getScroller(), 0);
      clearSaved();
      requestAnimationFrame(() => {
        skipSaveRef.current = false;
      });
    }

    readyRef.current = true;
  }, [pathname]);

  useEffect(() => {
    let throttle: ReturnType<typeof setTimeout> | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;
    let attached: HTMLElement | null = null;

    const persist = () => {
      if (skipSaveRef.current) return;
      const y = readY(getScroller());
      // Avoid clobbering a good pre-reload Y with a transient 0 while
      // Suspense / late content still hasn't created overflow height.
      if (y <= 0) {
        const existing = loadSaved();
        if (
          existing &&
          existing.path === pathRef.current &&
          existing.y > 0 &&
          Date.now() - existing.ts < 90_000
        ) {
          return;
        }
      }
      save(pathRef.current, y);
    };

    const onScroll = () => {
      if (throttle != null) return;
      throttle = setTimeout(() => {
        throttle = null;
        persist();
      }, 100);
    };

    const onPageExit = () => {
      persist();
      markPendingReload();
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist();
    };

    const attachToScroller = () => {
      const el = getScroller();
      if (el === attached) return;
      if (attached) {
        attached.removeEventListener('scroll', onScroll);
      }
      attached = el;
      if (attached) {
        attached.addEventListener('scroll', onScroll, { passive: true });
      }
    };

    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener('pagehide', onPageExit);
    window.addEventListener('beforeunload', onPageExit);
    document.addEventListener('visibilitychange', onVisibility);

    attachToScroller();
    poll = setInterval(() => {
      attachToScroller();
      persist();
    }, 500);

    return () => {
      if (throttle != null) clearTimeout(throttle);
      if (poll != null) clearInterval(poll);
      if (attached) attached.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', onPageExit);
      window.removeEventListener('beforeunload', onPageExit);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
