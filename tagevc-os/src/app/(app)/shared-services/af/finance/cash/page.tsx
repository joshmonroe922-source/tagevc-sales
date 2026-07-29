import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { MetricCardBoard } from '@/components/platform/metric-card-board';
import {
  AF_ENTITIES,
  build13WeekCash,
  getAfStore,
  OPERATING_GL,
  SAVINGS_GL,
  INVESTMENTS_GL,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = { searchParams?: Promise<{ entity?: string }> };

function usd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function CashForecastPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const store = getAfStore();
  const entities = entityId
    ? AF_ENTITIES.filter((e) => e.code === entityId)
    : AF_ENTITIES;

  const grids = entities.map((e) => {
    const bals = store.openingBalances[e.code] ?? {};
    const weeks = build13WeekCash({
      entityCode: e.code,
      balances: bals,
      loanPaymentsMonthly: (bals['2500'] ?? 0) > 0 ? 1200 : 0,
    });
    const op = bals[OPERATING_GL] ?? 0;
    const reserves =
      (bals[SAVINGS_GL] ?? 0) + (bals[INVESTMENTS_GL] ?? 0);
    const ending = weeks[weeks.length - 1]?.endingCash ?? op;
    const health =
      ending < 0
        ? 'Critical'
        : ending < op * 0.5
          ? 'At Risk'
          : ending < op * 0.85
            ? 'Watch'
            : 'On Track';
    return { entity: e, weeks, op, reserves, ending, health };
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Cash forecast"
        description="13-week grid from Operating 1000. Reserves (1040/1010) shown separately — excluded from free-cash default."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      <MetricCardBoard
        surface="af-finance-cash"
        columns={4}
        items={grids.map((g) => ({
          id: g.entity.code,
          label: g.entity.code,
          value: usd(g.ending),
          hint: `${g.health} · Op ${usd(g.op)} · Reserves ${usd(g.reserves)}`,
        }))}
      />

      {grids.map((g) => (
        <section key={g.entity.code} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              {g.entity.legalName} · 13-week
            </h2>
            <StatusPill status={g.health} />
          </div>
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Week</th>
                  <th className="px-4 py-3">Ending</th>
                  <th className="px-4 py-3 text-right">Inflows</th>
                  <th className="px-4 py-3 text-right">Outflows</th>
                  <th className="px-4 py-3 text-right">Net</th>
                  <th className="px-4 py-3 text-right">Cash</th>
                </tr>
              </thead>
              <tbody>
                {g.weeks.map((w) => (
                  <tr key={w.week} className="border-t border-border/70">
                    <td className="px-4 py-3">W{w.week}</td>
                    <td className="px-4 py-3 text-muted-foreground">{w.label}</td>
                    <td className="px-4 py-3 text-right">
                      <Money value={w.inflows} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={w.outflows} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={w.net} />
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      <Money value={w.endingCash} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
