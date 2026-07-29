'use client';

import Link from 'next/link';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { cn } from '@/lib/utils';
import { defaultViewModeFor } from '@/lib/platform/view-mode';

export type MetricBoardItem = {
  id: string;
  label: string;
  value: number | string;
  href?: string;
  hint?: string;
};

function money(n: number): string {
  if (Math.abs(n) >= 1000) {
    const k = n / 1000;
    const formatted =
      Math.abs(k) >= 100
        ? k.toFixed(0)
        : Math.abs(k) >= 10
          ? k.toFixed(1)
          : k.toFixed(2);
    return `$${formatted}k`;
  }
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function formatValue(value: number | string): string {
  return typeof value === 'number' ? money(value) : value;
}

type Props = {
  surface: string;
  items: readonly MetricBoardItem[];
  columns?: 2 | 3 | 4;
  className?: string;
  label?: string;
};

/**
 * Metric / breakdown board with Cards | List (Net Worth, KPI strips, etc.).
 */
export function MetricCardBoard({
  surface,
  items,
  columns = 3,
  className,
  label = 'View',
}: Props) {
  const colClass =
    columns === 2
      ? 'sm:grid-cols-2'
      : columns === 3
        ? 'sm:grid-cols-2 lg:grid-cols-3'
        : 'sm:grid-cols-2 lg:grid-cols-4';

  const cards = (
    <div className={cn('grid gap-3', colClass)}>
      {items.map((item) => {
        const inner = (
          <>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {item.label}
            </p>
            <p className="mt-1 font-heading text-xl font-semibold tabular-nums text-[#3a414f]">
              {formatValue(item.value)}
            </p>
            {item.hint ? (
              <p className="mt-1 text-xs text-muted-foreground">{item.hint}</p>
            ) : item.href ? (
              <p className="mt-1 text-xs text-muted-foreground">Open →</p>
            ) : null}
          </>
        );
        const cls =
          'rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-[#3a414f]/35';
        return item.href ? (
          <Link key={item.id} href={item.href} className={cls}>
            {inner}
          </Link>
        ) : (
          <div key={item.id} className={cls}>
            {inner}
          </div>
        );
      })}
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
                {item.href ? (
                  <Link
                    href={item.href}
                    className="underline-offset-2 hover:underline"
                  >
                    {item.label}
                  </Link>
                ) : (
                  item.label
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                {formatValue(item.value)}
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
      defaultMode={defaultViewModeFor(surface)}
      label={label}
      className={className}
      cards={cards}
      list={list}
    />
  );
}
