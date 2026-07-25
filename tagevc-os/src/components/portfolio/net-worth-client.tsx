'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createNetWorthAssetAction,
  deleteNetWorthAssetAction,
  importNetWorthCsvAction,
} from '@/app/(app)/portfolio/net-worth/actions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { entityDisplayName } from '@/lib/entities/display-name';
import { formatUsdK } from '@/lib/format';
import type {
  FirmAumSnapshot,
  InvestorAsset,
  NetWorthBreakdown,
} from '@/lib/net-worth/assets';
import type { ConnectorProbe } from '@/lib/net-worth/connectors';
import {
  assetClassLabel,
  type InvestorAssetClass,
} from '@/lib/net-worth/visibility';

function money(n: number): string {
  if (Math.abs(n) >= 1000) return `$${formatUsdK(n / 1000)}k`;
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const PRIVATE_CLASSES: InvestorAssetClass[] = [
  'brokerage',
  'retirement',
  'stock_fund',
  'crypto',
  'private_other',
];
const FIRM_CLASSES: InvestorAssetClass[] = [
  'business_equity',
  'real_estate',
  'firm_cash',
  'firm_other',
];

export function NetWorthClient({
  assets,
  breakdown,
  firmAum,
  connectors,
  error,
}: {
  assets: InvestorAsset[];
  breakdown: NetWorthBreakdown;
  firmAum: FirmAumSnapshot;
  connectors: ConnectorProbe[];
  error?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [csv, setCsv] = useState('');

  const cards = [
    { key: 'investments', label: 'Investments', value: breakdown.investments },
    { key: 'crypto', label: 'Crypto', value: breakdown.crypto },
    { key: 'retirement', label: 'Retirement', value: breakdown.retirement },
    { key: 'business', label: 'Business / portfolio', value: breakdown.business },
    { key: 'real_estate', label: 'Real estate', value: breakdown.real_estate },
    { key: 'firm_other', label: 'Other firm / cash', value: breakdown.firm_other },
  ] as const;

  return (
    <div className="space-y-6">
      {message ? (
        <p className="text-xs text-muted-foreground">{message}</p>
      ) : null}
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
            Total Net Worth · as of{' '}
            {breakdown.freshest_as_of
              ? breakdown.freshest_as_of.slice(0, 16).replace('T', ' ')
              : '—'}
            {breakdown.stale_count > 0
              ? ` · ${breakdown.stale_count} stale (>7d)`
              : ''}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2 text-xs">
          <Badge variant="secondary">Visionary-only private I-quadrant</Badge>
          <Badge variant="outline">{firmAum.label}</Badge>
          <Badge variant="outline">Firm slice {money(firmAum.total)}</Badge>
          <Link
            href="/portfolio/net-worth/credit"
            className="underline-offset-4 hover:underline"
          >
            Credit Management
          </Link>
        </CardContent>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <div
            key={c.key}
            className="rounded-lg border border-border bg-card px-4 py-3"
          >
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              {c.label}
            </p>
            <p className="mt-1 font-heading text-xl font-semibold tabular-nums">
              {money(c.value)}
            </p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Add asset</CardTitle>
            <CardDescription>
              Manual entry. Class sets visibility automatically (private vs
              firm-visible).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form
              className="grid gap-3 sm:grid-cols-2"
              action={(fd) =>
                start(async () => {
                  const res = await createNetWorthAssetAction(fd);
                  setMessage(res.ok ? res.message : res.error);
                  router.refresh();
                })
              }
            >
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="institution">Institution</Label>
                <Input id="institution" name="institution" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="asset_class">Class</Label>
                <select
                  id="asset_class"
                  name="asset_class"
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  defaultValue="brokerage"
                >
                  <optgroup label="Private I-quadrant">
                    {PRIVATE_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {assetClassLabel(c)}
                      </option>
                    ))}
                  </optgroup>
                  <optgroup label="Firm-visible">
                    {FIRM_CLASSES.map((c) => (
                      <option key={c} value={c}>
                        {assetClassLabel(c)}
                      </option>
                    ))}
                  </optgroup>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="balance">Balance</Label>
                <Input
                  id="balance"
                  name="balance"
                  type="number"
                  step="0.01"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="currency">Currency</Label>
                <Input id="currency" name="currency" defaultValue="USD" />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="entity_id">Company (optional ENT-…)</Label>
                <Input id="entity_id" name="entity_id" placeholder="ENT-R619" />
              </div>
              <div className="sm:col-span-2">
                <Button type="submit" size="sm" disabled={pending}>
                  Add asset
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">CSV import</CardTitle>
            <CardDescription>
              Columns: name,institution,asset_class,balance,currency,entity_id
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <textarea
              className="min-h-28 w-full rounded-md border border-input bg-background p-2 text-sm"
              value={csv}
              onChange={(e) => setCsv(e.target.value)}
              placeholder="Fidelity Brokerage,Fidelity,brokerage,250000,USD,"
            />
            <Button
              size="sm"
              disabled={pending || !csv.trim()}
              onClick={() =>
                start(async () => {
                  const res = await importNetWorthCsvAction(csv);
                  setMessage(res.ok ? res.message : res.error);
                  router.refresh();
                })
              }
            >
              Import CSV
            </Button>
            <div className="space-y-1 text-xs text-muted-foreground">
              <p className="font-medium text-foreground">Connectors (fail-soft)</p>
              {connectors.map((c) => (
                <p key={c.kind}>
                  {c.kind}: {c.configured ? 'creds present' : 'not configured'} —{' '}
                  {c.detail}
                </p>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Holdings</CardTitle>
          <CardDescription>
            Drill-down by class. Private rows never appear in Firm AUM for other
            roles.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {assets.length === 0 ? (
            <p className="text-muted-foreground">
              No assets yet — add manually or import CSV.
            </p>
          ) : (
            assets.map((a) => (
              <div
                key={a.id}
                className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2"
              >
                <div>
                  <p className="font-medium">{a.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {assetClassLabel(a.asset_class)}
                    {a.institution ? ` · ${a.institution}` : ''}
                    {a.entity_id
                      ? ` · ${entityDisplayName(a.entity_id)}`
                      : ''}
                    {' · '}
                    {a.visibility_scope === 'visionary_private'
                      ? 'private'
                      : 'firm-visible'}
                    {' · as of '}
                    {a.as_of.slice(0, 10)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums font-medium">
                    {money(a.balance)}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() =>
                      start(async () => {
                        if (!window.confirm(`Remove ${a.name}?`)) return;
                        const res = await deleteNetWorthAssetAction(a.id);
                        setMessage(res.ok ? res.message : res.error);
                        router.refresh();
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
