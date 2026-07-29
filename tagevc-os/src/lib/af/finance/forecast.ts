/**
 * Driver-based + AI forecast horizons (3m–10y) and 13-week cash forecast.
 */

import type { EntityCode, GlBalanceMap, HealthStatus } from '@/lib/af/types';
import { AF_ENTITIES } from '@/lib/af/master-data';

export const FORECAST_HORIZONS = [
  { id: '3m', months: 3, label: '3 months' },
  { id: '6m', months: 6, label: '6 months' },
  { id: '12m', months: 12, label: '12 months' },
  { id: '24m', months: 24, label: '24 months' },
  { id: '3y', months: 36, label: '3 years' },
  { id: '5y', months: 60, label: '5 years' },
  { id: '10y', months: 120, label: '10 years' },
] as const;

export type ForecastHorizonId = (typeof FORECAST_HORIZONS)[number]['id'];

export type ForecastDrivers = {
  revenueGrowthMoM: number;
  expenseGrowthMoM: number;
  collectionLagDays: number;
  scenario: 'Cons' | 'Base' | 'Agg';
};

export type ForecastPoint = {
  monthOffset: number;
  label: string;
  revenue: number;
  expenses: number;
  cash: number;
  netIncome: number;
};

export type EntityForecast = {
  entityCode: EntityCode;
  horizonId: ForecastHorizonId;
  drivers: ForecastDrivers;
  points: ForecastPoint[];
  endingCash: number;
  health: HealthStatus;
};

const DEFAULT_DRIVERS: ForecastDrivers = {
  revenueGrowthMoM: 0.02,
  expenseGrowthMoM: 0.01,
  collectionLagDays: 30,
  scenario: 'Base',
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function monthLabel(offset: number): string {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() + offset);
  return d.toISOString().slice(0, 7);
}

function baseMonthlyRevenue(entityCode: EntityCode, bals: GlBalanceMap): number {
  // Approximate run-rate from AR + operating cash posture
  const ar = bals['1100'] ?? 0;
  const op = bals['1000'] ?? 0;
  const byEntity: Record<EntityCode, number> = {
    TVC: Math.max(op * 0.08, 25000),
    R619: Math.max(ar * 0.45, 40000),
    SHR: Math.max(ar * 0.35, 18000),
    INDA: Math.max(ar * 0.55, 12000),
  };
  return byEntity[entityCode];
}

function baseMonthlyExpense(entityCode: EntityCode, bals: GlBalanceMap): number {
  const ap = bals['2000'] ?? 0;
  const byEntity: Record<EntityCode, number> = {
    TVC: Math.max(ap * 2.2, 22000),
    R619: Math.max(ap * 3.5, 32000),
    SHR: Math.max(ap * 3.0, 14000),
    INDA: Math.max(ap * 2.5, 9000),
  };
  return byEntity[entityCode];
}

function healthFromCashPath(ending: number, start: number): HealthStatus {
  const ratio = start > 0 ? ending / start : ending > 0 ? 1 : 0;
  if (ending < 0) return 'Critical';
  if (ratio < 0.5) return 'At Risk';
  if (ratio < 0.85) return 'Watch';
  return 'On Track';
}

export function buildEntityForecast(input: {
  entityCode: EntityCode;
  balances: GlBalanceMap;
  horizonId: ForecastHorizonId;
  drivers?: Partial<ForecastDrivers>;
}): EntityForecast {
  const horizon =
    FORECAST_HORIZONS.find((h) => h.id === input.horizonId) ??
    FORECAST_HORIZONS[2];
  const drivers: ForecastDrivers = { ...DEFAULT_DRIVERS, ...input.drivers };
  const scenarioMult =
    drivers.scenario === 'Cons' ? 0.85 : drivers.scenario === 'Agg' ? 1.2 : 1;

  let revenue = baseMonthlyRevenue(input.entityCode, input.balances) * scenarioMult;
  let expenses = baseMonthlyExpense(input.entityCode, input.balances);
  let cash = (input.balances['1000'] ?? 0) + (input.balances['1040'] ?? 0);
  const startCash = cash;
  const points: ForecastPoint[] = [];

  for (let m = 1; m <= horizon.months; m++) {
    revenue = round2(revenue * (1 + drivers.revenueGrowthMoM));
    expenses = round2(expenses * (1 + drivers.expenseGrowthMoM));
    const netIncome = round2(revenue - expenses);
    // Simplified cash: NI ± collection lag drag
    const lagDrag = drivers.collectionLagDays > 35 ? revenue * 0.05 : 0;
    cash = round2(cash + netIncome - lagDrag);
    points.push({
      monthOffset: m,
      label: monthLabel(m),
      revenue,
      expenses,
      cash,
      netIncome,
    });
  }

  return {
    entityCode: input.entityCode,
    horizonId: horizon.id,
    drivers,
    points,
    endingCash: cash,
    health: healthFromCashPath(cash, startCash),
  };
}

export function buildAllForecasts(
  balances: Record<string, GlBalanceMap>,
  horizonId: ForecastHorizonId = '12m',
): EntityForecast[] {
  return AF_ENTITIES.map((e) =>
    buildEntityForecast({
      entityCode: e.code,
      balances: balances[e.code] ?? {},
      horizonId,
    }),
  );
}

export type CashWeek = {
  week: number;
  label: string;
  inflows: number;
  outflows: number;
  net: number;
  endingCash: number;
};

/** 13-week cash forecast from operating cash + AR/AP posture. */
export function build13WeekCash(input: {
  entityCode: EntityCode;
  balances: GlBalanceMap;
  loanPaymentsMonthly?: number;
}): CashWeek[] {
  let cash = input.balances['1000'] ?? 0;
  const ar = input.balances['1100'] ?? 0;
  const ap = input.balances['2000'] ?? 0;
  const commission = input.balances['2250'] ?? 0;
  const weeklyIn = ar / 8;
  const weeklyOut = ap / 6 + commission / 12 + (input.loanPaymentsMonthly ?? 0) / 4;
  const weeks: CashWeek[] = [];
  const now = new Date();

  for (let w = 1; w <= 13; w++) {
    const inflows = round2(weeklyIn * (w <= 4 ? 1.1 : 0.95));
    const outflows = round2(weeklyOut * (w % 4 === 0 ? 1.25 : 1));
    const net = round2(inflows - outflows);
    cash = round2(cash + net);
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() + w * 7);
    weeks.push({
      week: w,
      label: d.toISOString().slice(0, 10),
      inflows,
      outflows,
      net,
      endingCash: cash,
    });
  }
  return weeks;
}
