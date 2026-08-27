'use client';

/**
 * Portable content frame — full-width pages vs full-bleed tools (Messaging).
 * Copy into subsidiary app shells when cloning; keep FULL_BLEED_PREFIXES in sync.
 */
import { usePathname } from 'next/navigation';
import { isFullBleedPath } from '@/lib/platform/shell/full-bleed-routes';
import { cn } from '@/lib/utils';

export function ShellAppContentFrame({
  children,
}: {
  children: React.ReactNode;
}) {
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
