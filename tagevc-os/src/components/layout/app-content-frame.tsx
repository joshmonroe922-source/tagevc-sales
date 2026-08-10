'use client';

import { usePathname } from 'next/navigation';
import { isFullBleedPath } from '@/lib/platform/shell/full-bleed-routes';
import { cn } from '@/lib/utils';

/**
 * Shared shell content frame. Default pages stay max-w-6xl; messaging (and
 * future full-bleed tools) use the full main column beside the sidebar.
 */
export function AppContentFrame({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const fullBleed = isFullBleedPath(pathname);

  return (
    <div
      className={cn(
        fullBleed
          ? 'flex min-h-0 min-w-0 flex-1 flex-col'
          : 'mx-auto max-w-6xl px-6 py-8 md:px-10',
      )}
      data-content-frame={fullBleed ? 'full-bleed' : 'constrained'}
    >
      {children}
    </div>
  );
}
