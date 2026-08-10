'use client';

import { usePathname } from 'next/navigation';
import { AppContentFrame } from '@/components/layout/app-content-frame';
import { isFullBleedPath } from '@/lib/platform/shell/full-bleed-routes';
import { cn } from '@/lib/utils';

/**
 * Shared app `<main>`: constrained pages scroll here; full-bleed tools
 * (Messaging) fill the pane and scroll internally.
 */
export function AppMain({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = isFullBleedPath(pathname);

  return (
    <main
      data-scroll-restoration-root
      className={cn(
        'min-h-0 min-w-0 flex-1',
        fullBleed
          ? 'flex flex-col overflow-hidden'
          : 'overflow-y-auto overscroll-contain',
      )}
    >
      <AppContentFrame>{children}</AppContentFrame>
    </main>
  );
}
