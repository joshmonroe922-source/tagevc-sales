'use client';

import { DashboardMetricBoard } from '@/components/dashboard/dashboard-metric-board';
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { ViewModeLayout } from '@/components/ui/view-mode-toggle';
import { formatRunway, formatUsdK } from '@/lib/format';
import type { PortfolioRollup } from '@/lib/types';
import { PORTFOLIO_HEALTH } from '@/lib/types';
import { VIEW_MODE_DEFAULTS } from '@/lib/view-mode';

type Props = {
  companyCount: number;
  rollup: PortfolioRollup;
};

/** Portfolio ARR / burn / runway + health counts with Cards | List. */
export function DashboardPortfolioBoards({ companyCount, rollup }: Props) {
  const summaryItems = [
    { id: 'companies', label: 'Companies', value: String(companyCount) },
    {
      id: 'arr',
      label: 'Portfolio ARR ($k)',
      value: formatUsdK(rollup.portfolio_arr_k),
    },
    {
      id: 'burn',
      label: 'Net Burn ($k)',
      value: formatUsdK(rollup.portfolio_net_burn_k),
    },
    {
      id: 'runway',
      label: 'Min runway',
      value: formatRunway(rollup.min_runway_mo),
      hint: rollup.runway_breach ? 'REVIEW — sub <12 mo' : 'ok',
    },
  ];

  const healthCards = (
    <div className="grid gap-3 sm:grid-cols-4">
      {PORTFOLIO_HEALTH.map((status) => (
        <Card key={status}>
          <CardHeader className="pb-2">
            <CardDescription>{status}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {rollup.health_counts[status]}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  );

  const healthList = (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/40 text-left text-xs text-muted-foreground">
            <th className="px-4 py-2.5 font-medium">Health</th>
            <th className="px-4 py-2.5 font-medium text-right">Companies</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {PORTFOLIO_HEALTH.map((status) => (
            <tr key={status} className="hover:bg-muted/30">
              <td className="px-4 py-2.5 font-medium text-[#3a414f]">
                {status}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums font-semibold">
                {rollup.health_counts[status]}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="space-y-6">
      <DashboardMetricBoard
        surface="dashboard-portfolio-summary"
        items={summaryItems}
        columns={4}
      />
      <ViewModeLayout
        surface="dashboard-portfolio-health"
        defaultMode={VIEW_MODE_DEFAULTS['dashboard-portfolio-health']}
        label="View"
        cards={healthCards}
        list={healthList}
      />
    </div>
  );
}
