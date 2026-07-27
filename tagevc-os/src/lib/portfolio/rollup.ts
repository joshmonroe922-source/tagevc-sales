import type {
  EntityMonthPnl,
  PortfolioCompany,
  PortfolioHealthCounts,
  PortfolioRollup,
} from '@/lib/types';
import { PORTFOLIO_HEALTH } from '@/lib/types/enums';

function emptyHealthCounts(): PortfolioHealthCounts {
  return {
    'On Track': 0,
    Watch: 0,
    'At Risk': 0,
    Critical: 0,
  };
}

/** COUNT Health statuses — feeds Command Center. */
export function countPortfolioHealth(
  companies: PortfolioCompany[],
): PortfolioHealthCounts {
  const counts = emptyHealthCounts();
  for (const c of companies) {
    counts[c.health] += 1;
  }
  return counts;
}

/**
 * Portfolio Roll-up methods from Core Structure §3A:
 * SUM money · WEIGHTED margin from sums · MIN runway among burners · COUNT health.
 *
 * ARR / burn / cash / runway come from the visible company rows so KPI cards and
 * Roll-up proof match the company table. COGS / margin use period P&L for those
 * same entities. Firm cash is injected by the caller from a live feed (or null).
 */
export function computePortfolioRollup(args: {
  period: string;
  companies: PortfolioCompany[];
  pnlRows: EntityMonthPnl[];
  /** Live firm cash ($k). null = Not Connected (do not use seed firm P&L). */
  liveFirmCashK?: number | null;
}): PortfolioRollup {
  const { period, companies, pnlRows } = args;
  const liveFirmCashK = args.liveFirmCashK ?? null;
  const visibleIds = new Set(companies.map((c) => c.entity_id));
  const subPnl = pnlRows.filter(
    (r) =>
      r.period === period &&
      !r.is_firm &&
      (visibleIds.size === 0 || visibleIds.has(r.entity_id)),
  );

  // Company-row money — matches Portfolio Active / Dashboard table.
  const portfolio_arr_k = sum(companies.map((c) => c.arr_k));
  const portfolio_net_burn_k = sum(companies.map((c) => c.net_burn_k));
  const portfolio_cash_k = sum(companies.map((c) => c.cash_k));

  // P&L structure for visible entities only (never sample / hidden rows).
  const portfolio_cogs_k = sum(subPnl.map((r) => r.cogs_k));
  const portfolio_gross_profit_k = portfolio_arr_k - portfolio_cogs_k;
  const portfolio_opex_k = sum(subPnl.map((r) => r.opex_k));
  const portfolio_ebitda_k = portfolio_gross_profit_k - portfolio_opex_k;

  const firm_cash_k = liveFirmCashK;
  const consolidated_cash_k =
    firm_cash_k == null ? null : portfolio_cash_k + firm_cash_k;

  const portfolio_gross_margin =
    portfolio_arr_k > 0 ? portfolio_gross_profit_k / portfolio_arr_k : null;

  const burningRunways = companies
    .filter((c) => c.net_burn_k > 0 && c.runway_mo != null)
    .map((c) => c.runway_mo as number);
  const min_runway_mo =
    burningRunways.length > 0 ? Math.min(...burningRunways) : null;
  const runway_breach = burningRunways.some((m) => m < 12);

  const health_counts = countPortfolioHealth(companies);
  const attention_required =
    health_counts['At Risk'] + health_counts.Critical;

  return {
    period,
    portfolio_arr_k,
    portfolio_cogs_k,
    portfolio_gross_profit_k,
    portfolio_gross_margin,
    portfolio_opex_k,
    portfolio_ebitda_k,
    portfolio_net_burn_k,
    portfolio_cash_k,
    firm_cash_k,
    consolidated_cash_k,
    min_runway_mo,
    runway_breach,
    health_counts,
    active_company_count: companies.length,
    attention_required,
  };
}

function sum(values: number[]): number {
  return values.reduce((a, b) => a + b, 0);
}

export function healthBadgeClass(health: (typeof PORTFOLIO_HEALTH)[number]): string {
  switch (health) {
    case 'On Track':
      return 'bg-emerald-50 text-emerald-800 border-emerald-200';
    case 'Watch':
      return 'bg-amber-50 text-amber-900 border-amber-200';
    case 'At Risk':
      return 'bg-orange-50 text-orange-900 border-orange-200';
    case 'Critical':
      return 'bg-red-50 text-red-900 border-red-200';
  }
}
