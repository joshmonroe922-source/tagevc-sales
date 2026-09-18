'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';

type NavPendingContextValue = {
  pendingHref: string | null;
  markPending: (href: string) => void;
};

const NavPendingContext = createContext<NavPendingContextValue>({
  pendingHref: null,
  markPending: () => undefined,
});

function pathOnly(href: string) {
  const trimmed = href.trim();
  const withoutOrigin = trimmed.startsWith('http')
    ? (() => {
        try {
          return new URL(trimmed).pathname;
        } catch {
          return trimmed;
        }
      })()
    : trimmed;
  const q = withoutOrigin.indexOf('?');
  const h = withoutOrigin.indexOf('#');
  const end =
    q === -1 ? (h === -1 ? withoutOrigin.length : h) : h === -1 ? q : Math.min(q, h);
  return withoutOrigin.slice(0, end) || '/';
}

function isInternalAppHref(href: string) {
  if (!href || href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('tel:')) {
    return false;
  }
  if (href.startsWith('http://') || href.startsWith('https://')) {
    try {
      return new URL(href).origin === window.location.origin;
    } catch {
      return false;
    }
  }
  return href.startsWith('/');
}

export function NavPendingProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const markPending = useCallback((href: string) => {
    const next = pathOnly(href);
    if (!next || next === pathname) return;
    setPendingHref(next);
  }, [pathname]);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  useEffect(() => {
    if (!pendingHref) return;
    const timeoutId = window.setTimeout(() => setPendingHref(null), 8000);
    return () => window.clearTimeout(timeoutId);
  }, [pendingHref]);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented) return;
      if (event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest('a');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) {
        return;
      }
      const href = anchor.getAttribute('href');
      if (!href || !isInternalAppHref(href)) return;
      markPending(href);
    }
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [markPending]);

  const value = useMemo(
    () => ({ pendingHref, markPending }),
    [pendingHref, markPending],
  );

  return (
    <NavPendingContext.Provider value={value}>
      {children}
    </NavPendingContext.Provider>
  );
}

export function useNavPendingHref() {
  return useContext(NavPendingContext).pendingHref;
}

export function NavProgressBar() {
  const pendingHref = useNavPendingHref();
  if (!pendingHref) return null;
  return (
    <div
      role="progressbar"
      aria-busy="true"
      aria-label="Navigating"
      className="pointer-events-none fixed inset-x-0 top-0 z-[200] h-[2px] overflow-hidden bg-primary/20"
    >
      <div className="h-full w-1/3 bg-primary motion-safe:animate-pulse" />
    </div>
  );
}
