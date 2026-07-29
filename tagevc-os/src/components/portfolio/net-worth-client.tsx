'use client';

import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { MetricCardBoard } from '@/components/platform/metric-card-board';
import { formatUsdK } from '@/lib/format';
import type {
  FirmAumSnapshot,
  NetWorthBreakdown,
} from '@/lib/net-worth/assets';

function money(n: number): string {
  if (Math.abs(n) >= 1000) return `$${formatUsdK(n / 1000)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export function NetWorthClient({
  breakdown,
  firmAum,
  error,
}: {
  breakdown: NetWorthBreakdown;
  firmAum: FirmAumSnapshot;
  error?: string;
}) {
  const investmentsTotal =
    breakdown.investments + breakdown.crypto + breakdown.retirement;

  const items = [
    {
      id: 'business',
      label: 'Businesses',
      value: breakdown.business,
      href: '/entities',
    },
    {
      id: 'real_estate',
      label: 'Real Estate',
      value: breakdown.real_estate,
      href: '/portfolio/real-estate',
    },
    {
      id: 'investments',
      label: 'Investments',
      value: investmentsTotal,
      href: '/portfolio/investments',
    },
  ];

  return (
    <div className="space-y-6">
      {error ? (
        <p className="text-sm text-muted-foreground">
          Asset registry unavailable until Phase 73 SQL is applied: {error}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-2xl">
            {money(breakdown.total)}
          </CardTitle>
          <CardDescription>
            Total Net Worth · roll-up of Businesses + Real Estate + Investments ·
            as of{' '}
            {breakdown.freshest_as_of
              ? breakdown.freshest_as_of.slice(0, 16).replace('T', ' ')
              : '—'}
            {breakdown.stale_count > 0
              ? ` · ${breakdown.stale_count} stale (>7d)`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">Visionary-only</Badge>
          <Badge variant="outline">{firmAum.label}</Badge>
          <Badge variant="outline">Firm slice {money(firmAum.total)}</Badge>
        </CardContent>
      </Card>

      <MetricCardBoard
        surface="net-worth-breakdown"
        items={items}
        columns={3}
      />
    </div>
  );
}
