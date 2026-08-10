'use client';

/**
 * Portable app `<main>` — constrained scroll vs full-bleed Messaging fill.
 * Copy with `app-content-frame.tsx` when cloning subsidiary shells.
 */
import { usePathname } from 'next/navigation';
import { ShellAppContentFrame } from '@/lib/platform/shell/app-content-frame';
import { isFullBleedPath } from '@/lib/platform/shell/full-bleed-routes';
import { cn } from '@/lib/utils';

export function ShellAppMain({ children }: { children: React.ReactNode }) {
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
      <ShellAppContentFrame>{children}</ShellAppContentFrame>
    </main>
  );
}
