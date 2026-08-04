'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'os.reload-scroll.v2';
const LEGACY_STORAGE_KEY = 'os.reload-scroll.v1';

type Saved = { path: string; y: number; ts: number };

/**
 * Pending restore for this document load. Module-level so React Strict Mode
 * remounts and late Suspense content (admin/loading skeletons) still reconnect.
 */
let pendingRestore: { path: string; y: number } | null = null;
let restoreSucceeded = false;

function getScroller(): HTMLElement | null {
  const marked = document.querySelector<HTMLElement>(
    '[data-scroll-restoration]',
  );
  if (marked) return marked;
  const main = document.querySelector('main');
  if (main instanceof HTMLElement) {
    const oy = getComputedStyle(main).overflowY;
    if (oy === 'auto' || oy === 'scroll' || oy === 'overlay') return main;
  }
  return null;
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
    for (const key of [STORAGE_KEY, LEGACY_STORAGE_KEY]) {
      const raw = sessionStorage.getItem(key);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as Saved;
      if (typeof parsed?.path !== 'string' || typeof parsed?.y !== 'number') {
        continue;
      }
      return parsed;
    }
    return null;
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
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* private mode / quota */
  }
}

function clearSaved() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

function canApply(el: HTMLElement | null, y: number): boolean {
  if (!el) {
    return (
      (document.documentElement.scrollHeight || document.body.scrollHeight) >=
      y + (window.innerHeight || 0) * 0.5
    );
  }
  return el.scrollHeight >= y + el.clientHeight * 0.5;
}

/**
 * Full document load: restore scroll for the same path (shell main scroller
 * or window). Soft client route changes: scroll shell back to top.
 * Hash URLs: prefer the hash target over a saved Y.
 *
 * Lives in the root layout so soft navigations do not remount this component.
 * Pending restore survives Suspense fallback → real content (slow admin pages).
 */
export function ReloadScrollRestore() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const readyRef = useRef(false);

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
      pendingRestore = null;
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
    const shouldArm =
      !restoreSucceeded &&
      !readyRef.current &&
      saved?.path === pathname &&
      saved.y > 0;

    if (shouldArm) {
      pendingRestore = { path: pathname, y: saved.y };
    }

    // Soft SPA navigations: jump to top and abort any pending restore.
    if (readyRef.current && prev !== pathname) {
      pendingRestore = null;
      restoreSucceeded = false;
      writeY(getScroller(), 0);
      clearSaved();
    }

    readyRef.current = true;
  }, [pathname]);

  useEffect(() => {
    let settled = 0;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    let pollId = 0;
    let attached: HTMLElement | null = null;
    let throttle: ReturnType<typeof setTimeout> | null = null;
    const started = performance.now();
    // Admin pages can stream Suspense fallbacks for a long time (SF ops).
    const maxMs = 90_000;

    const tryRestore = () => {
      const pending = pendingRestore;
      if (!pending || restoreSucceeded) return;
      if (pending.path !== pathRef.current) {
        pendingRestore = null;
        return;
      }
      if (performance.now() - started > maxMs) {
        // Leave saved Y for a later refresh; stop fighting the page.
        pendingRestore = null;
        return;
      }

      const el = getScroller();
      writeY(el, pending.y);
      const applied = readY(el);
      const close = Math.abs(applied - pending.y) <= 2;
      const ready = canApply(el, pending.y);

      if (close && ready) {
        settled += 1;
        if (settled >= 2) {
          restoreSucceeded = true;
          pendingRestore = null;
          clearSaved();
          return;
        }
      } else {
        settled = 0;
      }
    };

    const persist = () => {
      const el = getScroller();
      const y = readY(el);
      const pending = pendingRestore;

      // Never clobber a pending restore with skeleton/zero scroll.
      if (pending && pending.path === pathRef.current) {
        if (y <= 0) return;
        // User scrolled away from the restore target — adopt their position.
        if (Math.abs(y - pending.y) > 80) {
          pendingRestore = null;
        } else {
          return;
        }
      }

      save(pathRef.current, y);
    };

    const onScroll = () => {
      if (throttle != null) return;
      throttle = setTimeout(() => {
        throttle = null;
        // A real user scroll while pending: if they moved, persist() handles it.
        tryRestore();
        persist();
      }, 100);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') persist();
    };

    const bindScroller = () => {
      const el = getScroller();
      if (el === attached) return;
      if (attached) attached.removeEventListener('scroll', onScroll);
      attached = el;
      if (attached) {
        attached.addEventListener('scroll', onScroll, { passive: true });
        if (typeof ResizeObserver !== 'undefined') {
          ro?.disconnect();
          ro = new ResizeObserver(() => tryRestore());
          ro.observe(attached);
          if (attached.firstElementChild) ro.observe(attached.firstElementChild);
        }
      }
      tryRestore();
    };

    bindScroller();
    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', persist);
    document.addEventListener('visibilitychange', onVisibility);

    mo = new MutationObserver(() => {
      bindScroller();
      tryRestore();
    });
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['style', 'class'],
    });

    pollId = window.setInterval(() => {
      tryRestore();
      persist();
    }, 250);

    requestAnimationFrame(() => {
      requestAnimationFrame(tryRestore);
    });

    return () => {
      if (throttle != null) clearTimeout(throttle);
      if (pollId) window.clearInterval(pollId);
      ro?.disconnect();
      mo?.disconnect();
      if (attached) attached.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', persist);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
