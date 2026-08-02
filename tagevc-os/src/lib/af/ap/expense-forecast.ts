/**
 * AP-driven expense timeline / cash-flow forecast shells (D05).
 * Extends A&F finance reporting when inbound bills / VM monthly hints exist.
 */

import type { EntityCode } from '@/lib/af/types';

export type ExpenseForecastPoint = {
  period: string; // YYYY-MM
  amount: number;
  source: 'ap_open' | 'ap_recurring' | 'vm_monthly_hint' | 'projected';
};

export type ExpenseForecastSeries = {
  entityCode: EntityCode | 'CONSOLIDATED';
  horizonMonths: number;
  points: ExpenseForecastPoint[];
  totalProjected: number;
};

export function buildExpenseTimeline(input: {
  entityCode?: EntityCode | null;
  openBillAmountsByMonth?: Record<string, number>;
  recurringMonthly?: number;
  vmMonthlyHint?: number;
  horizonMonths?: number;
  start?: Date;
}): ExpenseForecastSeries {
  const horizon = input.horizonMonths ?? 12;
  const start = input.start ?? new Date();
  const points: ExpenseForecastPoint[] = [];
  let total = 0;

  for (let i = 0; i < horizon; i++) {
    const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const open = input.openBillAmountsByMonth?.[key] ?? 0;
    const recurring = input.recurringMonthly ?? 0;
    const vm = i === 0 ? (input.vmMonthlyHint ?? 0) : (input.vmMonthlyHint ?? 0);
    const amount = open + recurring + vm;
    total += amount;
    points.push({
      period: key,
      amount,
      source:
        open > 0
          ? 'ap_open'
          : recurring > 0
            ? 'ap_recurring'
            : vm > 0
              ? 'vm_monthly_hint'
              : 'projected',
    });
  }

  return {
    entityCode: input.entityCode ?? 'CONSOLIDATED',
    horizonMonths: horizon,
    points,
    totalProjected: total,
  };
}

export function buildCashFlowShell(input: {
  openingCash: number;
  expenseSeries: ExpenseForecastSeries;
  inflowMonthly?: number;
}): Array<{ period: string; cash: number; expense: number; inflow: number }> {
  let cash = input.openingCash;
  const inflow = input.inflowMonthly ?? 0;
  return input.expenseSeries.points.map((p) => {
    cash = cash + inflow - p.amount;
    return { period: p.period, cash, expense: p.amount, inflow };
  });
}
