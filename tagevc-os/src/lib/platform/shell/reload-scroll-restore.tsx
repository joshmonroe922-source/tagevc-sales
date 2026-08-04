'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';

const STORAGE_KEY = 'os.scroll.v3';
const ROOT_SELECTOR =
  '[data-scroll-restoration-root], [data-scroll-restoration]';

type Saved = { path: string; y: number };

/** Survives React Strict Mode remount within one document load. */
let didRestoreThisLoad = false;

function getRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>(ROOT_SELECTOR);
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
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ path, y: Math.max(0, Math.round(y)) }),
    );
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
 * Hard refresh: restore scrollTop on the shell overflow panel (not window).
 * Soft SPA navigations: jump to top. Hash URLs prefer the hash target.
 */
export function ReloadScrollRestore() {
  const pathname = usePathname();
  const pathRef = useRef(pathname);
  const readyRef = useRef(false);
  const restoringRef = useRef(false);

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
      didRestoreThisLoad = true;
      return;
    }

    const saved = loadSaved();
    // Root-layout component remounts only on full document loads; soft SPA
    // navigations keep it mounted and take the path-change branch below.
    const shouldRestore =
      !didRestoreThisLoad &&
      !readyRef.current &&
      saved?.path === pathname &&
      saved.y > 0;

    if (shouldRestore) {
      const y = saved.y;
      didRestoreThisLoad = true;
      restoringRef.current = true;
      readyRef.current = true;

      const started = performance.now();
      const maxMs = 2000;
      let raf = 0;
      const timers: number[] = [];
      let cancelled = false;

      const finish = () => {
        if (cancelled) return;
        cancelled = true;
        restoringRef.current = false;
        if (raf) cancelAnimationFrame(raf);
        for (const t of timers) window.clearTimeout(t);
        clearSaved();
      };

      const apply = () => {
        if (cancelled) return;
        writeY(getRoot(), y);
      };

      const loop = () => {
        if (cancelled) return;
        apply();
        if (performance.now() - started < maxMs) {
          raf = requestAnimationFrame(loop);
        } else {
          finish();
        }
      };

      requestAnimationFrame(() => {
        requestAnimationFrame(loop);
      });
      for (const ms of [0, 50, 100, 200, 400, 800, 1200, 1600, 2000]) {
        timers.push(window.setTimeout(apply, ms));
      }
      timers.push(window.setTimeout(finish, maxMs + 50));

      return () => {
        // Strict Mode remount: allow the next mount to restore again.
        cancelled = true;
        if (raf) cancelAnimationFrame(raf);
        for (const t of timers) window.clearTimeout(t);
        restoringRef.current = false;
        didRestoreThisLoad = false;
        readyRef.current = false;
      };
    }

    if (readyRef.current && prev !== pathname) {
      restoringRef.current = true;
      writeY(getRoot(), 0);
      clearSaved();
      requestAnimationFrame(() => {
        restoringRef.current = false;
      });
    }

    readyRef.current = true;
    didRestoreThisLoad = true;
  }, [pathname]);

  useEffect(() => {
    let throttle: ReturnType<typeof setTimeout> | null = null;
    let attached: HTMLElement | null = null;

    const persist = () => {
      if (restoringRef.current) return;
      const y = readY(getRoot());
      // Don't clobber a real offset with transient 0 before paint/content.
      if (y <= 0) {
        const existing = loadSaved();
        if (existing && existing.path === pathRef.current && existing.y > 0) {
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

    const bind = () => {
      const el = getRoot();
      if (el === attached) return;
      if (attached) attached.removeEventListener('scroll', onScroll);
      attached = el;
      if (attached) {
        attached.addEventListener('scroll', onScroll, { passive: true });
      }
    };

    bind();
    // Capture phase catches overflow-panel scrolls even before direct bind.
    document.addEventListener('scroll', onScroll, {
      passive: true,
      capture: true,
    });
    window.addEventListener('pagehide', persist);
    window.addEventListener('beforeunload', persist);

    const mo = new MutationObserver(() => bind());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    const beat = window.setInterval(() => {
      bind();
      persist();
    }, 500);

    return () => {
      if (throttle != null) clearTimeout(throttle);
      window.clearInterval(beat);
      mo.disconnect();
      if (attached) attached.removeEventListener('scroll', onScroll);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('pagehide', persist);
      window.removeEventListener('beforeunload', persist);
    };
  }, []);

  return null;
}
