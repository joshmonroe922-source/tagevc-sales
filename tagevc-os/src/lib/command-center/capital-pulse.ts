/**
 * Command Center Capital Pulse — live IES / finance actuals only.
 *
 * Never falls back to seed/sample portfolio P&L.
 * Real operating entities: Tage VC (firm), Recruit 619, Instant NDA, Signent HR.
 */

import type { IesEntityFinanceRow, IesFinanceReport } from '@/lib/ies/report';

export type CapitalPulseSource = 'ies' | 'not_connected';

export type CapitalPulse = {
  portfolio_arr_k: number | null;
  portfolio_gross_margin: number | null;
  portfolio_net_burn_k: number | null;
  portfolio_cash_k: number | null;
  firm_cash_k: number | null;
  consolidated_cash_k: number | null;
  min_runway_mo: number | null;
  runway_breach: boolean;
  source: CapitalPulseSource;
  as_of: string | null;
  /** Human label for the Command Center badge / card description. */
  source_label: string;
};

const FIRM_ENTITY = 'ENT-FIRM';

/** Dollars → $k for Capital Pulse labels. */
function toK(dollars: number | null | undefined): number | null {
  if (dollars == null || Number.isNaN(dollars)) return null;
  return Math.round(dollars / 1000);
}

function sumNullable(values: Array<number | null>): number | null {
  let total = 0;
  let any = false;
  for (const v of values) {
    if (v != null) {
      total += v;
      any = true;
    }
  }
  return any ? total : null;
}

function isLiveFeed(row: IesEntityFinanceRow): boolean {
  return row.feed_status === 'ok' || row.feed_status === 'partial';
}

/**
 * Build Capital Pulse from an IES finance report.
 * Missing feeds → null metrics (UI shows Not connected / —), never seed inflation.
 */
export function buildCapitalPulseFromIes(
  report: IesFinanceReport | null | undefined,
): CapitalPulse {
  if (!report) {
    return emptyPulse('not_connected', 'Not connected');
  }

  const live = report.companies.filter(isLiveFeed);
  if (live.length === 0) {
    const label =
      !report.configured
        ? 'Not connected'
        : report.connections.length === 0
          ? 'Not connected — connect IES'
          : 'Not connected — pull IES';
    return emptyPulse('not_connected', label);
  }

  const firm = live.find((c) => c.entity_id === FIRM_ENTITY) ?? null;
  const portfolio = live.filter((c) => c.entity_id !== FIRM_ENTITY);

  const firm_cash_k = toK(firm?.cash_on_hand ?? null);
  const portfolio_cash_k = toK(
    sumNullable(portfolio.map((c) => c.cash_on_hand)),
  );
  const consolidated_cash_k = toK(
    sumNullable([
      firm?.cash_on_hand ?? null,
      ...portfolio.map((c) => c.cash_on_hand),
    ]),
  );

  // IES burn_rate_monthly is absolute monthly expenses (dollars).
  const portfolio_net_burn_k = toK(
    sumNullable(portfolio.map((c) => c.burn_rate_monthly)),
  );

  // ARR / gross margin are not on the IES feed contract — stay null (honest).
  const portfolio_arr_k: number | null = null;
  const portfolio_gross_margin: number | null = null;

  const runways: number[] = [];
  for (const c of portfolio) {
    const cash = c.cash_on_hand;
    const burn = c.burn_rate_monthly;
    if (cash != null && burn != null && burn > 0) {
      runways.push(cash / burn);
    }
  }
  const min_runway_mo =
    runways.length > 0
      ? Math.round(Math.min(...runways) * 10) / 10
      : null;
  const runway_breach = runways.some((m) => m < 12);

  const as_of =
    report.consolidated.as_of ??
    live.map((c) => c.as_of).find((d): d is string => Boolean(d)) ??
    null;

  const partial = live.some((c) => c.feed_status === 'partial');
  return {
    portfolio_arr_k,
    portfolio_gross_margin,
    portfolio_net_burn_k,
    portfolio_cash_k,
    firm_cash_k,
    consolidated_cash_k,
    min_runway_mo,
    runway_breach,
    source: 'ies',
    as_of,
    source_label: partial ? 'IES (partial)' : 'IES live',
  };
}

function emptyPulse(
  source: CapitalPulseSource,
  source_label: string,
): CapitalPulse {
  return {
    portfolio_arr_k: null,
    portfolio_gross_margin: null,
    portfolio_net_burn_k: null,
    portfolio_cash_k: null,
    firm_cash_k: null,
    consolidated_cash_k: null,
    min_runway_mo: null,
    runway_breach: false,
    source,
    as_of: null,
    source_label,
  };
}
