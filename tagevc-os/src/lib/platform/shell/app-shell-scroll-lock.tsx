'use client';

import { useEffect } from 'react';

/**
 * Portable twin — locks document scroll while the app shell is mounted so
 * long main content cannot drag the left sidebar off-screen via body overflow.
 * Copy into each subsidiary OS; wire from `(app)/layout.tsx`.
 */
export function AppShellScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlHeight = html.style.height;
    const prevBodyHeight = body.style.height;
    html.style.overflow = 'hidden';
    html.style.height = '100%';
    body.style.overflow = 'hidden';
    body.style.height = '100%';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      html.style.height = prevHtmlHeight;
      body.style.overflow = prevBodyOverflow;
      body.style.height = prevBodyHeight;
    };
  }, []);

  return null;
}
