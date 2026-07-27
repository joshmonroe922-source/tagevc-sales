'use client';

import { useEffect } from 'react';

/**
 * Locks document scroll while the app shell is mounted so long main content
 * cannot drag the left sidebar off-screen via body overflow.
 */
export function AppShellScrollLock() {
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverflow = body.style.overflow;
    html.style.overflow = 'hidden';
    body.style.overflow = 'hidden';
    return () => {
      html.style.overflow = prevHtmlOverflow;
      body.style.overflow = prevBodyOverflow;
    };
  }, []);

  return null;
}
