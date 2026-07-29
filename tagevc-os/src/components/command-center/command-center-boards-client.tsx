'use client';

import { DashboardMetricBoard } from '@/components/dashboard/dashboard-metric-board';
import { IesSyncControls } from '@/components/ies/ies-sync-controls';
import { HealthBadge } from '@/components/portfolio/health-badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import {
  formatPct,
  formatRunway,
  formatUsdK,
} from '@/lib/format';
import type { CommandCenterSnapshot } from '@/lib/types';
import { PORTFOLIO_HEALTH } from '@/lib/types';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

type Props = {
  snap: CommandCenterSnapshot;
  canConnectIes?: boolean;
  canRefreshIes?: boolean;
  iesConfigured?: boolean;
  iesSyncEnabled?: boolean;
  iesLastSyncedAt?: string | null;
};

/** Funnel, capital pulse, and portfolio health with Cards | List. */
export function CommandCenterBoardsClient({
  snap,
  canConnectIes = false,
  canRefreshIes = false,
  iesConfigured = true,
  iesSyncEnabled = true,
  iesLastSyncedAt = null,
}: Props) {
  const capitalDisconnected =
    snap.capital.firm_cash_k == null &&
    snap.capital.consolidated_cash_k == null;

  const funnelItems = [
    {
      id: 'active_leads',
      label: 'Active leads',
      value: String(snap.funnel.active_leads),
    },
    {
      id: 'ready_for_dd',
      label: 'Ready for DD',
      value: String(snap.funnel.ready_for_dd),
    },
    {
      id: 'open_dd',
      label: 'Open DD tasks',
      value: String(snap.funnel.open_dd_tasks),
    },
    {
      id: 'blocked_dd',
      label: 'Blocked DD tasks',
      value: String(snap.funnel.blocked_dd_tasks),
    },
    {
      id: 'active_deals',
      label: 'Active deals',
      value: String(snap.funnel.active_deals),
    },
    {
      id: 'closing',
      label: 'Deals in closing',
      value: String(snap.funnel.deals_in_closing),
    },
  ];

  const capitalItems = [
    {
      id: 'arr',
      label: 'Portfolio ARR ($k)',
      value: formatUsdK(snap.capital.portfolio_arr_k),
    },
    {
      id: 'gm',
      label: 'Gross margin',
      value: formatPct(snap.capital.portfolio_gross_margin),
    },
    {
      id: 'burn',
      label: 'Net burn ($k)',
      value: formatUsdK(snap.capital.portfolio_net_burn_k),
    },
    {
      id: 'pf_cash',
      label: 'Portfolio cash ($k)',
      value: formatUsdK(snap.capital.portfolio_cash_k),
    },
    {
      id: 'firm_cash',
      label: 'Firm cash ($k)',
      value:
        snap.capital.firm_cash_k == null
          ? 'Not Connected'
          : formatUsdK(snap.capital.firm_cash_k),
    },
    {
      id: 'consol_cash',
      label: 'Consolidated cash ($k)',
      value:
        snap.capital.consolidated_cash_k == null
          ? 'Not Connected'
          : formatUsdK(snap.capital.consolidated_cash_k),
    },
    {
      id: 'runway',
      label: 'Min runway',
      value: formatRunway(snap.capital.min_runway_mo),
      hint: snap.capital.runway_breach
        ? 'REVIEW — at least one sub <12 mo'
        : 'ok',
    },
  ];

  const healthCards = (
    <div className="grid grid-cols-2 gap-3">
      {PORTFOLIO_HEALTH.map((status) => (
        <div
          key={status}
          className="rounded-md border border-border px-3 py-2"
        >
          <div className="mb-1">
            <HealthBadge health={status} />
          </div>
          <p className="text-xl font-semibold tabular-nums">
            {snap.portfolio_health[status]}
          </p>
        </div>
      ))}
    </div>
  );

  const healthList = (
    <div className="overflow-hidden rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-3 py-2 font-medium">Health</th>
            <th className="px-3 py-2 font-medium text-right">Count</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PORTFOLIO_HEALTH.map((status) => (
            <tr key={status}>
              <td className="px-3 py-2">
                <HealthBadge health={status} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums font-semibold">
                {snap.portfolio_health[status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className="text-sm font-medium tracking-wide text-[#7c7871] uppercase">
          Funnel snapshot
        </h2>
        <DashboardMetricBoard
          surface="command-center-funnel"
          items={funnelItems}
          columns={3}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Portfolio health</CardTitle>
            <CardDescription>
              {snap.active_portfolio_companies} active companies · attention
              required:{' '}
              <span className="font-medium text-foreground">
                {snap.attention_required}
              </span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ViewModeLayout
              surface="command-center-portfolio-health"
              defaultMode={
                VIEW_MODE_DEFAULTS['command-center-portfolio-health']
              }
              label="View"
              cards={healthCards}
              list={healthList}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Capital pulse</CardTitle>
            <CardDescription>
              Portfolio totals with firm cash kept separate, then combined.
              Live IES only — Refresh syncs all connected companies.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DashboardMetricBoard
              surface="command-center-capital"
              items={capitalItems}
              columns={2}
            />
            <IesSyncControls
              entityId="ENT-FIRM"
              canConnect={canConnectIes}
              canRefresh={canRefreshIes}
              showConnect={capitalDisconnected && canConnectIes}
              showOpenInIes
              lastSyncedAt={iesLastSyncedAt}
              configured={iesConfigured}
              syncEnabled={iesSyncEnabled}
            />
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
