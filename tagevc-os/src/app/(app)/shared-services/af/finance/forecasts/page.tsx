import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import {
  FORECAST_HORIZONS,
  buildAllForecasts,
  build13WeekCash,
  getAfStore,
} from '@/lib/af';
import type { ForecastHorizonId } from '@/lib/af';
import {
  buildCashFlowShell,
  buildExpenseTimeline,
} from '@/lib/af/ap/expense-forecast';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';
import Link from 'next/link';

type Props = {
  searchParams?: Promise<{ entity?: string; horizon?: string }>;
};

export default async function ForecastsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const horizonId = (
    FORECAST_HORIZONS.some((h) => h.id === params.horizon)
      ? params.horizon
      : '12m'
  ) as ForecastHorizonId;

  const store = getAfStore();
  let forecasts = buildAllForecasts(store.openingBalances, horizonId);
  if (entityId) {
    forecasts = forecasts.filter((f) => f.entityCode === entityId);
  }
  const cashEntity = (entityId as 'TVC' | 'R619' | 'SHR' | 'INDA') || 'R619';
  const weeks = build13WeekCash({
    entityCode: cashEntity,
    balances: store.openingBalances[cashEntity] ?? {},
  });

  const openByMonth: Record<string, number> = {};
  for (const b of store.bills) {
    if (entityId && b.entityCode !== entityId) continue;
    if (b.status === 'Paid' || b.status === 'Rejected') continue;
    const due = (b.dueDate || '').slice(0, 7);
    if (!due) continue;
    openByMonth[due] = (openByMonth[due] ?? 0) + (b.amount - b.amountPaid);
  }
  const expenseSeries = buildExpenseTimeline({
    entityCode: entityId as 'TVC' | 'R619' | 'SHR' | 'INDA' | null,
    openBillAmountsByMonth: openByMonth,
    horizonMonths: 12,
  });
  const openingCash =
    (store.openingBalances[cashEntity] as Record<string, number> | undefined)
      ?.Cash ?? 0;
  const cashFlow = buildCashFlowShell({
    openingCash,
    expenseSeries,
  });

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="AI forecasts"
        description="Driver-based horizons 3m–10y with Cons/Base/Agg scenario posture. Cash path health uses On Track | Watch | At Risk | Critical."
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      <div className="flex flex-wrap gap-2">
        {FORECAST_HORIZONS.map((h) => {
          const href = `/shared-services/af/finance/forecasts?horizon=${h.id}${
            entityId ? `&entity=${entityId}` : ''
          }`;
          const active = h.id === horizonId;
          return (
            <Link
              key={h.id}
              href={href}
              className={
                active
                  ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white'
                  : 'rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground'
              }
            >
              {h.label}
            </Link>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {forecasts.map((f) => {
          const last = f.points[f.points.length - 1];
          return (
            <div
              key={f.entityCode}
              className="rounded-xl border border-border/80 bg-gradient-to-br from-white via-[#f7f6f3] to-[#eef1f6] px-5 py-4"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-heading text-lg font-semibold text-[#3a414f]">
                    {f.entityCode}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Scenario {f.drivers.scenario} · +
                    {(f.drivers.revenueGrowthMoM * 100).toFixed(1)}% MoM rev
                  </p>
                </div>
                <StatusPill status={f.health} />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Ending cash</dt>
                  <dd className="font-medium">
                    <Money value={f.endingCash} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Terminal monthly NI
                  </dt>
                  <dd className="font-medium">
                    <Money value={last?.netIncome ?? 0} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Revenue (end)</dt>
                  <dd>
                    <Money value={last?.revenue ?? 0} />
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Expenses (end)</dt>
                  <dd>
                    <Money value={last?.expenses ?? 0} />
                  </dd>
                </div>
              </dl>
            </div>
          );
        })}
      </div>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          AP expense timeline · {expenseSeries.entityCode}
        </h2>
        <p className="text-sm text-muted-foreground">
          Shell from open AP bills (D05). Total projected{' '}
          <Money value={expenseSeries.totalProjected} /> over{' '}
          {expenseSeries.horizonMonths} months.
        </p>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Period</th>
                <th className="px-4 py-3">Source</th>
                <th className="px-4 py-3 text-right">Expense</th>
                <th className="px-4 py-3 text-right">Cash (shell)</th>
              </tr>
            </thead>
            <tbody>
              {expenseSeries.points.map((p, i) => (
                <tr key={p.period} className="border-t border-border/70">
                  <td className="px-4 py-2">{p.period}</td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">
                    {p.source}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={p.amount} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={cashFlow[i]?.cash ?? 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
          13-week cash · {cashEntity}
        </h2>
        <div className="overflow-hidden rounded-xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3">Week</th>
                <th className="px-4 py-3 text-right">In</th>
                <th className="px-4 py-3 text-right">Out</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">Ending</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => (
                <tr key={w.week} className="border-t border-border/70">
                  <td className="px-4 py-2">
                    W{w.week} · {w.label}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={w.inflows} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={w.outflows} />
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Money value={w.net} />
                  </td>
                  <td className="px-4 py-2 text-right font-medium">
                    <Money value={w.endingCash} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
