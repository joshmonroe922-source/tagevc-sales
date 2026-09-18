'use client';

import dynamic from 'next/dynamic';

function ThinkTankSkeleton() {
  return (
    <section
      className="rounded-lg border border-border bg-card p-5 shadow-sm"
      aria-busy="true"
      aria-label="Loading Think Tank"
    >
      <div className="mb-3 h-5 w-36 animate-pulse rounded bg-muted" />
      <div className="space-y-2">
        <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
        <div className="h-3 w-8/12 animate-pulse rounded bg-muted" />
        <div className="h-24 animate-pulse rounded bg-muted" />
      </div>
    </section>
  );
}

const ThinkTankClient = dynamic(
  () => import('@/components/think-tank/ThinkTankClient').then((mod) => mod.ThinkTankClient),
  { ssr: false, loading: () => <ThinkTankSkeleton /> },
);

export function ThinkTankLazy({
  roleBand = 'deal',
  viewAsLabel = null,
  compact = false,
}: {
  roleBand?: string;
  viewAsLabel?: string | null;
  compact?: boolean;
}) {
  return (
    <ThinkTankClient
      roleBand={roleBand}
      viewAsLabel={viewAsLabel}
      compact={compact}
    />
  );
}
