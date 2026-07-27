'use client';

import { Suspense } from 'react';
import { TimeframeChips } from '@/components/reporting/timeframe-chips';
import {
  parseReportingPeriod,
  periodWindow,
  resolveReportingTimeZone,
  type ReportingPeriodChip,
} from '@/lib/reporting/timeframes';
import { useSearchParams } from 'next/navigation';

function ReportingTimeframeBarInner({
  timeZone,
  defaultPeriod = 'week',
}: {
  timeZone?: string | null;
  defaultPeriod?: ReportingPeriodChip;
}) {
  const sp = useSearchParams();
  const parsed = parseReportingPeriod(sp.get('tf'), defaultPeriod);
  const period: ReportingPeriodChip =
    parsed === 'day' || parsed === 'week' || parsed === 'month'
      ? parsed
      : defaultPeriod;
  const tz = resolveReportingTimeZone(timeZone);
  const win = periodWindow(period, tz);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-muted/20 px-3 py-2">
      <div className="space-y-0.5">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Reporting timeframe
        </p>
        <p className="text-sm text-foreground">{win.rangeLabel}</p>
      </div>
      <TimeframeChips active={period} />
    </div>
  );
}

/** Shared Today / This week / This month control for Tage + subsidiary dashboards. */
export function ReportingTimeframeBar(props: {
  timeZone?: string | null;
  defaultPeriod?: ReportingPeriodChip;
}) {
  return (
    <Suspense fallback={null}>
      <ReportingTimeframeBarInner {...props} />
    </Suspense>
  );
}
