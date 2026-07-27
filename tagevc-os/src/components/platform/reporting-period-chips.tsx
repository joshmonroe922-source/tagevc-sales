'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  DEFAULT_REPORTING_PERIODS,
  type ReportingPeriod,
} from '@/lib/platform/reporting-timeframes';
import { cn } from '@/lib/utils';

const LABELS: Record<ReportingPeriod, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  ytd: 'YTD',
  custom: 'Custom',
};

/** Query-param period chips (`?period=week`) for any reports surface. */
export function ReportingPeriodChips({
  active,
  periods = DEFAULT_REPORTING_PERIODS,
  paramName = 'period',
  className,
}: {
  active: ReportingPeriod;
  periods?: ReportingPeriod[];
  paramName?: string;
  className?: string;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <div className={cn('flex flex-wrap gap-2', className)}>
      {periods.map((p) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set(paramName, p);
        const href = `${pathname}?${next.toString()}`;
        const isActive = active === p;
        return (
          <Link
            key={p}
            href={href}
            className={cn(
              'rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
              isActive
                ? 'border-foreground bg-foreground text-background'
                : 'border-border bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            {LABELS[p]}
          </Link>
        );
      })}
    </div>
  );
}
