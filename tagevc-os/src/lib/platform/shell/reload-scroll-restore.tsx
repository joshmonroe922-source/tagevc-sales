'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'os.reload-scroll.v1';

type Saved = { path: string; y: number; ts: number };

function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType(
      'navigation',
    )[0] as PerformanceNavigationTiming | undefined;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}

/** Prefer marked shell scroller, then overflow main, else window (null). */
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
    const shouldRestore =
      !readyRef.current &&
      isReloadNavigation() &&
      saved?.path === pathname &&
      saved.y > 0;

    if (shouldRestore) {
      const y = saved.y;
      skipSaveRef.current = true;
      let attempts = 0;
      const maxAttempts = 24;
      const timers: number[] = [];
      let cancelled = false;

      const finish = () => {
        if (cancelled) return;
        skipSaveRef.current = false;
        clearSaved();
      };

      const tryRestore = () => {
        if (cancelled) return;
        writeY(getScroller(), y);
        attempts += 1;
        if (attempts < maxAttempts) {
          timers.push(window.setTimeout(tryRestore, 50));
          return;
        }
        finish();
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(tryRestore);
      });
      readyRef.current = true;
      return () => {
        cancelled = true;
        for (const t of timers) window.clearTimeout(t);
        skipSaveRef.current = false;
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

    const persist = () => {
      if (skipSaveRef.current) return;
      save(pathRef.current, readY(getScroller()));
    };

    const onScroll = () => {
      if (throttle != null) return;
      throttle = setTimeout(() => {
        throttle = null;
        persist();
      }, 150);
    };

    const onHide = () => persist();

    document.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);

    return () => {
      if (throttle != null) clearTimeout(throttle);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
    };
  }, []);

  return null;
}
