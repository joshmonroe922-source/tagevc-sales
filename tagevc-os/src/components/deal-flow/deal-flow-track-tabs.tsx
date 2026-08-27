'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { resolveActiveNavHref } from '@/lib/platform/shell/nav-active';


const TRACKS = [
  { id: 'hub' as const, href: '/deal-flow', label: 'All tracks' },
  { id: 'vc' as const, href: '/deal-flow/vc', label: 'VC' },
  { id: 'ma' as const, href: '/deal-flow/ma', label: 'M&A' },
  { id: 're' as const, href: '/deal-flow/re', label: 'Real Estate' },
];

type Props = {
  /** Optional override; defaults to longest pathname match. */
  active?: 'hub' | 'vc' | 'ma' | 're';
  className?: string;
};

export function DealFlowTrackTabs({ active, className }: Props) {
  const pathname = usePathname();
  const matchedHref = resolveActiveNavHref(
    pathname,
    TRACKS.map((t) => t.href),
  );
  const activeId =
    active ??
    TRACKS.find((t) => t.href === matchedHref)?.id ??
    'hub';

  return (
    <div
      className={cn(
        'flex flex-wrap gap-1 rounded-lg border border-border bg-muted/40 p-1',
        className,
      )}
      role="tablist"
      aria-label="Deal Flow tracks"
    >
      {TRACKS.map((t) => {
        const isActive = activeId === t.id;
        return (
          <Link
            key={t.id}
            href={t.href}
            role="tab"
            aria-selected={isActive}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
              isActive
                ? 'bg-card text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}
