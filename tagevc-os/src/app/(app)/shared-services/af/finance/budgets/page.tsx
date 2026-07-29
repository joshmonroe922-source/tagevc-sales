import { PageHeader } from '@/components/ui/page-header';
import { AfBackLink, Money, StatusPill } from '@/components/af/af-ui';
import { MetricCardBoard } from '@/components/platform/metric-card-board';
import {
  buildAllBudgets,
  getAfStore,
  type BudgetScenario,
} from '@/lib/af';
import { resolveAfEntityParam } from '@/lib/af/page-helpers';
import { requirePermission } from '@/lib/rbac/session';

type Props = {
  searchParams?: Promise<{ entity?: string; scenario?: string }>;
};

const SCENARIOS: BudgetScenario[] = ['Cons', 'Base', 'Agg'];

function usd(n: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n);
}

export default async function BudgetsPage({ searchParams }: Props) {
  await requirePermission('read:shared_services');
  const params = (await searchParams) ?? {};
  const { qs, entityId } = await resolveAfEntityParam(searchParams);
  const scenario = (SCENARIOS.includes(params.scenario as BudgetScenario)
    ? params.scenario
    : 'Base') as BudgetScenario;
  const store = getAfStore();
  let budgets = buildAllBudgets(store.openingBalances, scenario);
  if (entityId) budgets = budgets.filter((b) => b.entityCode === entityId);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Finance"
        title="Budgets"
        description={`FY${budgets[0]?.fiscalYear ?? new Date().getFullYear()} · scenario ${scenario}. Annual + YTD actual vs budget.`}
        secondaryActions={
          <AfBackLink href={`/shared-services/af/finance${qs}`} label="Finance" />
        }
      />

      <div className="flex flex-wrap gap-2">
        {SCENARIOS.map((s) => (
          <a
            key={s}
            href={`/shared-services/af/finance/budgets?scenario=${s}${
              entityId ? `&entity=${entityId}` : ''
            }`}
            className={
              scenario === s
                ? 'rounded-md bg-[#3a414f] px-3 py-1.5 text-xs font-medium text-white'
                : 'rounded-md bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground'
            }
          >
            {s}
          </a>
        ))}
      </div>

      <MetricCardBoard
        surface="af-finance-budgets"
        columns={4}
        items={budgets.map((b) => ({
          id: b.entityCode,
          label: b.entityCode,
          value: usd(b.revenueBudget),
          hint: `${b.health} · Exp ${usd(b.expenseBudget)} · Cash ${usd(b.cashActual)}`,
        }))}
      />

      {budgets.map((b) => (
        <section key={b.entityCode} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-[#3a414f]">
              {b.entityCode} · {b.version}
            </h2>
            <StatusPill status={b.health} />
          </div>
          <div className="overflow-hidden rounded-xl border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-left text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3">Line</th>
                  <th className="px-4 py-3 text-right">Budget</th>
                  <th className="px-4 py-3 text-right">Actual</th>
                  <th className="px-4 py-3 text-right">Variance</th>
                </tr>
              </thead>
              <tbody>
                {b.lines.map((line) => (
                  <tr key={line.account} className="border-t border-border/70">
                    <td className="px-4 py-3">
                      <span className="font-medium">{line.label}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {line.account}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={line.budget} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={line.actual} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Money value={line.variance} />
                      <span className="ml-1 text-xs text-muted-foreground">
                        ({(line.variancePct * 100).toFixed(1)}%)
                      </span>
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
