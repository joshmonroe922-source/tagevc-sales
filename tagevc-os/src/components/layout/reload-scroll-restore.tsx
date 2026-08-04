'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'os.reload-scroll.v2';
const LEGACY_STORAGE_KEY = 'os.reload-scroll.v1';

type Saved = { path: string; y: number; ts: number };

/** Survives React Strict Mode remounts within one document load. */
let restoreHandledForLoad = false;

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
  // Enough content to hold the saved offset (allow half-viewport slack).
  return el.scrollHeight >= y + el.clientHeight * 0.5;
}

/**
 * Full document load: restore scroll for the same path (shell main scroller
 * or window). Soft client route changes: scroll shell back to top.
 * Hash URLs: prefer the hash target over a saved Y.
 *
 * Lives in the root layout so soft navigations do not remount this component;
 * restore only runs on the first mount of a document load.
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
      restoreHandledForLoad = true;
      return;
    }

    const saved = loadSaved();
    // Root-layout mount only happens on full document loads. Soft SPA
    // navigations keep this component mounted and take the branch below.
    // Do NOT gate on performance Navigation Timing — some browsers omit it
    // or report non-reload types for Cmd/Ctrl+R in edge cases.
    const shouldRestore =
      !restoreHandledForLoad &&
      !readyRef.current &&
      saved?.path === pathname &&
      saved.y > 0;

    if (shouldRestore) {
      const y = saved.y;
      restoreHandledForLoad = true;
      skipSaveRef.current = true;
      let settled = 0;
      let cancelled = false;
      let succeeded = false;
      let ro: ResizeObserver | null = null;
      let mo: MutationObserver | null = null;
      let pollId = 0;
      const started = performance.now();
      const maxMs = 4000;

      const cleanup = () => {
        if (pollId) window.clearInterval(pollId);
        ro?.disconnect();
        mo?.disconnect();
      };

      const finish = (ok: boolean) => {
        if (cancelled) return;
        cancelled = true;
        succeeded = ok;
        cleanup();
        skipSaveRef.current = false;
        if (ok) clearSaved();
      };

      const tryRestore = () => {
        if (cancelled) return;
        const el = getScroller();
        writeY(el, y);
        const applied = readY(el);
        const close = Math.abs(applied - y) <= 2;
        const ready = canApply(el, y);

        if (close && ready) {
          settled += 1;
          // Two consecutive successes so late layout shifts don't yank back.
          if (settled >= 2) {
            finish(true);
            return;
          }
        } else {
          settled = 0;
        }

        if (performance.now() - started > maxMs) {
          finish(close);
        }
      };

      const armObservers = () => {
        const el = getScroller();
        if (el && typeof ResizeObserver !== 'undefined') {
          ro = new ResizeObserver(() => tryRestore());
          ro.observe(el);
          if (el.firstElementChild) ro.observe(el.firstElementChild);
        }
        mo = new MutationObserver(() => tryRestore());
        mo.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
          attributeFilter: ['style', 'class'],
        });
        pollId = window.setInterval(tryRestore, 100);
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (cancelled) return;
          armObservers();
          tryRestore();
        });
      });

      readyRef.current = true;
      return () => {
        // Strict Mode remount: allow the next mount to continue restoring
        // unless we already stuck the position and cleared storage.
        cancelled = true;
        cleanup();
        skipSaveRef.current = false;
        if (!succeeded) {
          restoreHandledForLoad = false;
          readyRef.current = false;
        }
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
    restoreHandledForLoad = true;
  }, [pathname]);

  useEffect(() => {
    let throttle: ReturnType<typeof setTimeout> | null = null;
    let attached: HTMLElement | null = null;

    const persist = () => {
      if (skipSaveRef.current) return;
      save(pathRef.current, readY(getScroller()));
    };

    const onScroll = () => {
      if (throttle != null) return;
      throttle = setTimeout(() => {
        throttle = null;
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
      }
    };

    bindScroller();
    // Capture phase catches overflow-panel scrolls even before direct bind;
    // also picks up late-mounted `[data-scroll-restoration]`.
    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', persist);
    document.addEventListener('visibilitychange', onVisibility);

    const mo = new MutationObserver(() => bindScroller());
    mo.observe(document.body, { childList: true, subtree: true });

    // Heartbeat so a missed scroll event still leaves a usable position.
    const beat = window.setInterval(persist, 1000);

    return () => {
      if (throttle != null) clearTimeout(throttle);
      window.clearInterval(beat);
      mo.disconnect();
      if (attached) attached.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', persist);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  return null;
}
