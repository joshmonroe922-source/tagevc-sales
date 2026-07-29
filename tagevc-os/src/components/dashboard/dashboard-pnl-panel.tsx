'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';
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
  type DashboardPnlView,
} from '@/lib/dashboard/ies-pnl-view';
import {
  CONSOLIDATED_SELECT_LABEL,
  CONSOLIDATED_SELECT_VALUE,
  sortEntitiesForSelect,
} from '@/lib/entities/display-order';
import { cn } from '@/lib/utils';

type CompanyOption = { entity_id: string; name: string };

function StateBadge({ state }: { state: DashboardPnlView['state'] }) {
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-normal capitalize',
        state === 'live' && 'border-emerald-300 text-emerald-800',
        state === 'partial' && 'border-amber-300 text-amber-900',
      )}
    >
      {state === 'not_connected' ? 'Not Connected' : state}
    </Badge>
  );
}

/** Native IES-synced P&L for Dashboard (consolidated or selected company). */
export function DashboardPnlPanel({
  view,
  companies,
  canViewConsolidated = true,
  canConnect = false,
  canRefresh = false,
  configured = true,
  syncEnabled = true,
}: {
  view: DashboardPnlView;
  /** Role-scoped real entities only (no samples). */
  companies: CompanyOption[];
  /** When false, Consolidated is hidden (COO / Subsidiary Leader). */
  canViewConsolidated?: boolean;
  canConnect?: boolean;
  canRefresh?: boolean;
  configured?: boolean;
  syncEnabled?: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const companyOptions = sortEntitiesForSelect(
    companies.map((c) => ({
      entity_id: c.entity_id,
      name: c.name,
    })),
  ).map((c) => ({
    entity_id: String(c.entity_id),
    name: String(c.name ?? c.entity_id),
  }));

  const selectValue =
    view.scope === 'company' && view.entity_id
      ? view.entity_id
      : canViewConsolidated
        ? CONSOLIDATED_SELECT_VALUE
        : (view.entity_id ?? companyOptions[0]?.entity_id ?? '');

  function setScope(value: string) {
    const next = new URLSearchParams(params.toString());
    if (value === CONSOLIDATED_SELECT_VALUE) {
      next.set('scope', 'consolidated');
      next.delete('entity');
    } else {
      next.set('scope', 'company');
      next.set('entity', value);
    }
    startTransition(() => {
      router.replace(`/dashboard?${next.toString()}`);
    });
  }

  const metrics = [
    { label: 'Revenue', value: formatPnlMetric(view.revenue) },
    { label: 'Expenses', value: formatPnlMetric(view.expenses) },
    { label: 'Net income', value: formatPnlMetric(view.net_income) },
    { label: 'Cash', value: formatPnlMetric(view.cash_on_hand) },
    { label: 'AR', value: formatPnlMetric(view.ar_balance) },
    { label: 'AP', value: formatPnlMetric(view.ap_balance) },
  ];

  const showScopeSelect =
    canViewConsolidated || companyOptions.length > 1;

  return (
    <Card id="dashboard-pnl">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{view.title}</CardTitle>
            <CardDescription>{view.subtitle}</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showScopeSelect ? (
              <label className="text-xs text-muted-foreground">
                P&amp;L view
                <select
                  aria-label="P&L view scope"
                  className="ml-2 h-9 min-w-[14rem] rounded-md border border-border bg-background px-2 text-sm text-foreground"
                  value={selectValue}
                  disabled={pending}
                  onChange={(e) => setScope(e.target.value)}
                >
                  {canViewConsolidated ? (
                    <option value={CONSOLIDATED_SELECT_VALUE}>
                      {CONSOLIDATED_SELECT_LABEL}
                    </option>
                  ) : null}
                  {companyOptions.map((c) => (
                    <option key={c.entity_id} value={c.entity_id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            <StateBadge state={view.state} />
            {view.stale && view.state !== 'not_connected' ? (
              <Badge variant="outline">Stale · refresh needed</Badge>
            ) : null}
            <Badge variant="secondary">Native IES sync</Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {view.state === 'not_connected' ? (
          <div className="space-y-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-4">
            <p className="text-sm text-muted-foreground">
              Not Connected — no live IES P&amp;L for this scope. Connect this
              company (if you manage IES) or Refresh all connected books.
              Numbers are never invented.
            </p>
            <IesSyncControls
              entityId={view.entity_id}
              canConnect={canConnect}
              canRefresh={canRefresh}
              showConnect={canConnect}
              showOpenInIes={Boolean(view.open_in_ies_href)}
              lastSyncedAt={view.last_synced_at}
              configured={configured}
              syncEnabled={syncEnabled}
            />
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            {metrics.map((m) => (
              <div
                key={m.label}
                className="rounded-md border border-border px-3 py-2"
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
            entityId={view.entity_id}
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
        {view.data_gaps.length > 0 && view.state !== 'live' ? (
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {view.data_gaps.slice(0, 4).map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        ) : null}
        <Link
          href={view.finance_href}
          className="inline-flex text-xs font-medium underline-offset-2 hover:underline"
        >
          Open Finance books →
        </Link>
      </CardContent>
    </Card>
  );
}
