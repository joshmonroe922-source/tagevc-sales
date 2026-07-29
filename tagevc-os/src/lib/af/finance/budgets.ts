/**
 * Budgets — annual + rolling vs actual (Spec - Forecast & Loans / Reporting).
 */

import type { EntityCode, GlBalanceMap, HealthStatus } from '@/lib/af/types';
import { AF_ENTITIES } from '@/lib/af/master-data';
import { OPERATING_GL, AR_GL, AP_GL } from '@/lib/af/constants';

export type BudgetScenario = 'Cons' | 'Base' | 'Agg';

export type BudgetLine = {
  account: string;
  label: string;
  budget: number;
  actual: number;
  variance: number;
  variancePct: number;
};

export type EntityBudget = {
  entityCode: EntityCode;
  scenario: BudgetScenario;
  fiscalYear: number;
  version: 'annual' | 'rolling';
  revenueBudget: number;
  expenseBudget: number;
  cashBudget: number;
  revenueActual: number;
  expenseActual: number;
  cashActual: number;
  lines: BudgetLine[];
  health: HealthStatus;
};

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function scenarioMult(s: BudgetScenario) {
  return s === 'Cons' ? 0.9 : s === 'Agg' ? 1.15 : 1;
}

function revenueRunRate(entityCode: EntityCode, bals: GlBalanceMap): number {
  const ar = bals[AR_GL] ?? 0;
  const op = bals[OPERATING_GL] ?? 0;
  const map: Record<EntityCode, number> = {
    TVC: Math.max(op * 0.9, 280000),
    R619: Math.max(ar * 6, 480000),
    SHR: Math.max(ar * 5, 210000),
    INDA: Math.max(ar * 8, 145000),
  };
  return map[entityCode];
}

function expenseRunRate(entityCode: EntityCode, bals: GlBalanceMap): number {
  const ap = bals[AP_GL] ?? 0;
  const map: Record<EntityCode, number> = {
    TVC: Math.max(ap * 18, 240000),
    R619: Math.max(ap * 40, 360000),
    SHR: Math.max(ap * 35, 160000),
    INDA: Math.max(ap * 28, 110000),
  };
  return map[entityCode];
}

function healthFromVariance(revVarPct: number, expVarPct: number): HealthStatus {
  if (revVarPct < -0.15 || expVarPct > 0.2) return 'Critical';
  if (revVarPct < -0.08 || expVarPct > 0.1) return 'At Risk';
  if (revVarPct < -0.03 || expVarPct > 0.05) return 'Watch';
  return 'On Track';
}

export function buildEntityBudget(input: {
  entityCode: EntityCode;
  balances: GlBalanceMap;
  scenario?: BudgetScenario;
  fiscalYear?: number;
  version?: 'annual' | 'rolling';
}): EntityBudget {
  const scenario = input.scenario ?? 'Base';
  const mult = scenarioMult(scenario);
  const revenueBudget = round2(revenueRunRate(input.entityCode, input.balances) * mult);
  const expenseBudget = round2(expenseRunRate(input.entityCode, input.balances));
  const cashBudget = round2((input.balances[OPERATING_GL] ?? 0) * 1.05);
  // YTD actuals approximated from GL posture (run-rate × months elapsed)
  const month = new Date().getUTCMonth() + 1;
  const ytdFrac = input.version === 'rolling' ? month / 12 : month / 12;
  const revenueActual = round2(revenueBudget * ytdFrac * 0.97);
  const expenseActual = round2(expenseBudget * ytdFrac * 1.02);
  const cashActual = input.balances[OPERATING_GL] ?? 0;

  const lines: BudgetLine[] = [
    {
      account: '4xxx',
      label: 'Revenue',
      budget: round2(revenueBudget * ytdFrac),
      actual: revenueActual,
      variance: 0,
      variancePct: 0,
    },
    {
      account: '6xxx',
      label: 'Operating expenses',
      budget: round2(expenseBudget * ytdFrac),
      actual: expenseActual,
      variance: 0,
      variancePct: 0,
    },
    {
      account: OPERATING_GL,
      label: 'Operating cash',
      budget: cashBudget,
      actual: cashActual,
      variance: 0,
      variancePct: 0,
    },
  ].map((l) => {
    const variance = round2(l.actual - l.budget);
    const variancePct = l.budget !== 0 ? variance / l.budget : 0;
    return { ...l, variance, variancePct };
  });

  const revLine = lines[0];
  const expLine = lines[1];

  return {
    entityCode: input.entityCode,
    scenario,
    fiscalYear: input.fiscalYear ?? new Date().getUTCFullYear(),
    version: input.version ?? 'annual',
    revenueBudget,
    expenseBudget,
    cashBudget,
    revenueActual,
    expenseActual,
    cashActual,
    lines,
    health: healthFromVariance(revLine.variancePct, -expLine.variancePct),
  };
}

export function buildAllBudgets(
  balances: Record<string, GlBalanceMap>,
  scenario: BudgetScenario = 'Base',
): EntityBudget[] {
  return AF_ENTITIES.map((e) =>
    buildEntityBudget({
      entityCode: e.code,
      balances: balances[e.code] ?? {},
      scenario,
    }),
  );
}
