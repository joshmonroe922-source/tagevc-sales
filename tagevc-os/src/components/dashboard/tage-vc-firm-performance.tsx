'use client';

import Link from 'next/link';
import { IesSyncControls } from '@/components/ies/ies-sync-controls';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  formatPnlMetric,
  type FirmPerformanceView,
} from '@/lib/dashboard/ies-pnl-view';
import { cn } from '@/lib/utils';

/**
 * Explicit Tage Venture Capital (parent) financial + KPI surface.
 * Visible to Visionary and Accounting / Finance (ssc_finance) — not
 * only under subsidiary portfolio boards.
 */
export function TageVcFirmPerformancePanel({
  view,
  canConnect = false,
  canRefresh = false,
  configured = true,
  syncEnabled = true,
}: {
  view: FirmPerformanceView;
  canConnect?: boolean;
  canRefresh?: boolean;
  configured?: boolean;
  syncEnabled?: boolean;
}) {
  const kpis = [
    { label: 'Revenue (MTD)', value: formatPnlMetric(view.revenue) },
    { label: 'Expenses (MTD)', value: formatPnlMetric(view.expenses) },
    { label: 'Net income', value: formatPnlMetric(view.net_income) },
    { label: 'Firm cash', value: formatPnlMetric(view.cash_on_hand) },
    { label: 'AR', value: formatPnlMetric(view.ar_balance) },
    { label: 'AP', value: formatPnlMetric(view.ap_balance) },
  ];

  return (
    <Card
      id="tage-vc-firm-performance"
      className="border-[#3a414f]/20 bg-gradient-to-br from-card to-muted/20"
    >
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
              Parent firm
            </p>
            <CardTitle className="text-base">{view.title}</CardTitle>
            <CardDescription>{view.subtitle}</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge
              variant="outline"
              className={cn(
                'font-normal capitalize',
                view.state === 'live' && 'border-emerald-300 text-emerald-800',
                view.state === 'partial' && 'border-amber-300 text-amber-900',
              )}
            >
              {view.state === 'not_connected' ? 'Not Connected' : view.state}
            </Badge>
            <Badge variant="secondary">Visionary · Accounting / Finance</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {view.state === 'not_connected' ? (
          <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-4">
            <p className="text-sm text-muted-foreground">
              Not Connected — Tage Venture Capital parent books have no live
              IES snapshot yet. Connect the parent company and Refresh all
              connected books.
            </p>
            <IesSyncControls
              entityId="ENT-FIRM"
              canConnect={canConnect}
              canRefresh={canRefresh}
              showConnect={canConnect}
              showOpenInIes
              lastSyncedAt={view.last_synced_at}
              configured={configured}
              syncEnabled={syncEnabled}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {kpis.map((m) => (
              <div
                key={m.label}
                className="rounded-md border border-border bg-card/80 px-3 py-2"
              >
                <p className="text-xs tracking-wide text-muted-foreground uppercase">
                  {m.label}
                </p>
                <p className="mt-1 font-heading text-lg font-semibold tabular-nums">
                  {m.value}
                </p>
              </div>
            ))}
          </div>
        )}
        {view.state !== 'not_connected' ? (
          <IesSyncControls
            entityId="ENT-FIRM"
            canConnect={canConnect}
            canRefresh={canRefresh}
            showConnect={false}
            showOpenInIes
            lastSyncedAt={view.last_synced_at}
            configured={configured}
            syncEnabled={syncEnabled}
          />
        ) : null}
        <p className="text-xs text-muted-foreground">{view.note}</p>
        <div className="flex flex-wrap gap-3 text-xs">
          <Link
            href="/dashboard?scope=company&entity=ENT-FIRM"
            className="font-medium underline-offset-2 hover:underline"
          >
            Dashboard · Tage VC scope
          </Link>
          <Link
            href={view.finance_href}
            className="font-medium underline-offset-2 hover:underline"
          >
            Finance · parent books
          </Link>
          <Link
            href="/firm"
            className="font-medium underline-offset-2 hover:underline"
          >
            Firm home
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
