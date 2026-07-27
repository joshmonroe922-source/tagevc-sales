'use client';

import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { cn } from '@/lib/utils';
import { VIEW_MODE_DEFAULTS, type ViewModeSurface } from '@/lib/view-mode';

export type DashboardMetricItem = {
  id: string;
  label: string;
  value: string;
  hint?: string;
};

type Props = {
  surface: ViewModeSurface;
  items: DashboardMetricItem[];
  /** Card grid columns at lg breakpoint */
  columns?: 2 | 3 | 4;
  className?: string;
};

/**
 * Cards | List for KPI / metric boards on Dashboard and Command Center.
 * List mode is a real table of the same rows — not a stub.
 */
export function DashboardMetricBoard({
  surface,
  items,
  columns = 4,
  className,
}: Props) {
  const colClass =
    columns === 2
      ? 'sm:grid-cols-2'
      : columns === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4';

  const cards = (
    <div className={cn('grid gap-3', colClass)}>
      {items.map((item) => (
        <div
          key={item.id}
          className="rounded-lg border border-border bg-card px-4 py-3"
        >
          <p className="text-xs tracking-wide text-muted-foreground uppercase">
            {item.label}
          </p>
          <p className="mt-1 font-heading text-2xl font-semibold tabular-nums text-foreground">
            {item.value}
          </p>
          {item.hint ? (
            <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
          ) : null}
        </div>
      ))}
    </div>
  );

  const list = (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Metric</th>
            <th className="px-4 py-2.5 font-medium text-right">Value</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Notes
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted/30">
              <td className="px-4 py-2.5 font-medium text-[#3a414f]">
                {item.label}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                {item.value}
              </td>
              <td className="hidden px-4 py-2.5 text-muted-foreground sm:table-cell">
                {item.hint ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <ViewModeLayout
      surface={surface}
      defaultMode={VIEW_MODE_DEFAULTS[surface] ?? 'cards'}
      label="View"
      className={className}
      cards={cards}
      list={list}
    />
  );
}
