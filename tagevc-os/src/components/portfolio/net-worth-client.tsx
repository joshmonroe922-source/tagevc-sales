'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
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
  showCredit = true,
}: {
  breakdown: NetWorthBreakdown;
  firmAum: FirmAumSnapshot;
  error?: string;
  /** Credit Management chip + card — false for Think Tank. */
  showCredit?: boolean;
}) {
  const investmentsTotal =
    breakdown.investments + breakdown.crypto + breakdown.retirement;

  const cards = [
    {
      key: 'business',
      label: 'Businesses',
      value: breakdown.business,
      href: '/entities',
    },
    {
      key: 'real_estate',
      label: 'Real Estate',
      value: breakdown.real_estate,
      href: '/portfolio/real-estate',
    },
    {
      key: 'investments',
      label: 'Investments',
      value: investmentsTotal,
      href: '/portfolio/investments',
    },
  ] as const;

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
          {showCredit ? (
            <Link
              href="/portfolio/net-worth/credit"
              className="underline-offset-4 hover:underline"
            >
              Credit Management
            </Link>
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.key}
            href={c.href}
            className="rounded-lg border border-border bg-card px-4 py-3 transition-colors hover:border-[#3a414f]/35"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {c.label}
            </p>
            <p className="mt-1 font-heading text-xl font-semibold tabular-nums">
              {money(c.value)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Open →</p>
          </Link>
        ))}
      </div>

      {showCredit ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Credit management</CardTitle>
            <CardDescription>
              Personal and business bureau tracking stays on Net Worth — not under
              Investments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Link
              href="/portfolio/net-worth/credit"
              className="text-sm font-medium underline-offset-4 hover:underline"
            >
              Open Credit Management →
            </Link>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
