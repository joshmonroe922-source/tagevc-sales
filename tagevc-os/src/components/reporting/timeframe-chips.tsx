'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  REPORTING_PERIOD_CHIPS,
  type ReportingPeriodChip,
} from '@/lib/reporting/timeframes';

/**
 * Reusable reporting timeframe chips (Today / This week / This month).
 * Writes `tf` query param; preserve other search params.
 */
export function TimeframeChips({
  active,
  paramKey = 'tf',
  className,
}: {
  active: ReportingPeriodChip;
  paramKey?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {REPORTING_PERIOD_CHIPS.map((chip) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set(paramKey, chip.id);
        const href = `${pathname}?${next.toString()}`;
        const isActive = active === chip.id;
        return (
          <Link
            key={chip.id}
            href={href}
            className={cn(
              'rounded-md border px-3 py-1.5 text-sm transition-colors',
              isActive
                ? 'border-foreground/20 bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            {chip.label}
          </Link>
        );
      })}
    </div>
  );
}
