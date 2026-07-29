'use client';

import Link from 'next/link';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { cn } from '@/lib/utils';
import { defaultViewModeFor } from '@/lib/platform/view-mode';

export type ModuleLinkItem = {
  id: string;
  label: string;
  href: string;
  description?: string;
  meta?: string;
};

type Props = {
  /** localStorage surface key — must be unique per board */
  surface: string;
  items: readonly ModuleLinkItem[];
  columns?: 2 | 3 | 4;
  /** Card visual style */
  variant?: 'module' | 'metric' | 'plain';
  className?: string;
  label?: string;
};

/**
 * Platform-standard navigational / summary board with Cards | List toggle.
 * Use for A&F module hubs, Personal Finance, Net Worth breakdowns, and any
 * future card section. List mode is a real table — not a stub.
 */
export function ModuleLinkBoard({
  surface,
  items,
  columns = 3,
  variant = 'module',
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
      {items.map((item) => (
        <Link
          key={item.id}
          href={item.href}
          className={cn(
            'group relative overflow-hidden rounded-xl border border-border/80 px-4 py-4 transition-all hover:border-[#3a414f]/30 hover:shadow-sm',
            variant === 'module' &&
              'bg-gradient-to-br from-white via-[#f7f6f3] to-[#eef1f6]',
            variant === 'metric' &&
              'bg-gradient-to-b from-white to-[#f5f6f8]',
            variant === 'plain' && 'bg-card',
          )}
        >
          {variant === 'module' ? (
            <div className="pointer-events-none absolute -right-6 -top-6 h-20 w-20 rounded-full bg-[#3a414f]/[0.04] transition-transform group-hover:scale-110" />
          ) : null}
          <p className="font-heading text-base font-semibold text-[#3a414f]">
            {item.label}
          </p>
          {item.meta ? (
            <p className="mt-2 font-heading text-xl font-semibold text-[#3a414f]">
              {item.meta}
            </p>
          ) : null}
          {item.description ? (
            <p className="mt-1 text-sm text-muted-foreground">
              {item.description}
            </p>
          ) : null}
        </Link>
      ))}
    </div>
  );

  const list = (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Name</th>
            <th className="px-4 py-2.5 font-medium">Detail</th>
            <th className="hidden px-4 py-2.5 font-medium sm:table-cell">
              Value
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.map((item) => (
            <tr key={item.id} className="hover:bg-muted/30">
              <td className="px-4 py-2.5">
                <Link
                  href={item.href}
                  className="font-medium text-[#3a414f] underline-offset-2 hover:underline"
                >
                  {item.label}
                </Link>
              </td>
              <td className="px-4 py-2.5 text-muted-foreground">
                {item.description ?? '—'}
              </td>
              <td className="hidden px-4 py-2.5 tabular-nums sm:table-cell">
                {item.meta ?? '—'}
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
