'use client';

import { usePathname } from 'next/navigation';
import { isFullBleedPath } from '@/lib/platform/shell/full-bleed-routes';
import { cn } from '@/lib/utils';

/**
 * Shared shell content frame. Default pages span sidebar → viewport edge
 * (Recruit 619 `max-w-none` pattern). Messaging fills the pane and scrolls
 * internally.
 */
export function AppContentFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = isFullBleedPath(pathname);

  return (
    <div
      className={cn(
        fullBleed
          ? 'flex min-h-0 min-w-0 flex-1 flex-col'
          : 'w-full max-w-none px-4 py-6 sm:px-6 lg:px-8',
      )}
      data-content-frame={fullBleed ? 'full-bleed' : 'full-width'}
    >
      {children}
    </div>
  );
}
