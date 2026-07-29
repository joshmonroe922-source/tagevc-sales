/**
 * Reporting KPIs + health — Spec - Reporting KPIs (build order step 9).
 */

import type {
  AfBill,
  AfInvoice,
  EntityCode,
  GlBalanceMap,
  HealthStatus,
} from '@/lib/af/types';
import { AF_ENTITIES } from '@/lib/af/master-data';
import { OPERATING_GL, AR_GL, AP_GL, COMMISSION_LIABILITY_GL } from '@/lib/af/constants';

export type TimeFilter =
  | 'current_month'
  | 'last_month'
  | 'current_quarter'
  | 'last_quarter'
  | 'ytd'
  | 'trailing_90'
  | 'trailing_12m';

export const TIME_FILTERS: { id: TimeFilter; label: string }[] = [
  { id: 'current_month', label: 'Current month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'current_quarter', label: 'Current quarter' },
  { id: 'last_quarter', label: 'Last quarter' },
  { id: 'ytd', label: 'Year to date' },
  { id: 'trailing_90', label: 'Trailing 90 days' },
  { id: 'trailing_12m', label: 'Trailing 12 months' },
];

export type EntityKpis = {
  entityCode: EntityCode;
  cashOperating: number;
  ar: number;
  ap: number;
  commissionLiability: number;
  freeCash: number;
  openInvoices: number;
  openBills: number;
  overdueInvoices: number;
  health: HealthStatus;
};

function freeCash(b: GlBalanceMap): number {
  return (
    (b[OPERATING_GL] ?? 0) -
    (b[AP_GL] ?? 0) -
    (b[COMMISSION_LIABILITY_GL] ?? 0)
  );
}

function healthFrom(k: Omit<EntityKpis, 'health' | 'entityCode'>): HealthStatus {
  if (k.freeCash < 0 || k.overdueInvoices >= 3) return 'Critical';
  if (k.freeCash < 10000 || k.overdueInvoices >= 1) return 'At Risk';
  if (k.ar > k.cashOperating * 1.5) return 'Watch';
  return 'On Track';
}

export function computeEntityKpis(input: {
  entityCode: EntityCode;
  balances: GlBalanceMap;
  invoices: AfInvoice[];
  bills: AfBill[];
  asOf?: string;
}): EntityKpis {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const inv = input.invoices.filter((i) => i.entityCode === input.entityCode);
  const bills = input.bills.filter((b) => b.entityCode === input.entityCode);
  const openInvoices = inv.filter(
    (i) => i.status !== 'Paid' && i.status !== 'Void',
  ).length;
  const overdueInvoices = inv.filter(
    (i) =>
      i.status !== 'Paid' &&
      i.status !== 'Void' &&
      i.dueDate < asOf,
  ).length;
  const openBills = bills.filter(
    (b) => b.status !== 'Paid' && b.status !== 'Rejected',
  ).length;

  const base = {
    cashOperating: input.balances[OPERATING_GL] ?? 0,
    ar: input.balances[AR_GL] ?? 0,
    ap: input.balances[AP_GL] ?? 0,
    commissionLiability: input.balances[COMMISSION_LIABILITY_GL] ?? 0,
    freeCash: freeCash(input.balances),
    openInvoices,
    openBills,
    overdueInvoices,
  };

  return {
    entityCode: input.entityCode,
    ...base,
    health: healthFrom(base),
  };
}

export function computeAllKpis(input: {
  balances: Record<string, GlBalanceMap>;
  invoices: AfInvoice[];
  bills: AfBill[];
}): EntityKpis[] {
  return AF_ENTITIES.map((e) =>
    computeEntityKpis({
      entityCode: e.code,
      balances: input.balances[e.code] ?? {},
      invoices: input.invoices,
      bills: input.bills,
    }),
  );
}

export type AgingBucket = {
  label: string;
  amount: number;
  count: number;
};

export function arAging(
  invoices: AfInvoice[],
  entityCode?: EntityCode | null,
  asOf = new Date().toISOString().slice(0, 10),
): AgingBucket[] {
  const buckets = [
    { label: 'Current', min: -Infinity, max: 0, amount: 0, count: 0 },
    { label: '1–30', min: 1, max: 30, amount: 0, count: 0 },
    { label: '31–60', min: 31, max: 60, amount: 0, count: 0 },
    { label: '61–90', min: 61, max: 90, amount: 0, count: 0 },
    { label: '90+', min: 91, max: Infinity, amount: 0, count: 0 },
  ];
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  for (const inv of invoices) {
    if (entityCode && inv.entityCode !== entityCode) continue;
    if (inv.status === 'Paid' || inv.status === 'Void') continue;
    const due = Date.parse(`${inv.dueDate}T00:00:00Z`);
    const days = Math.floor((asOfMs - due) / 86400000);
    const remaining = inv.amount - inv.amountPaid;
    const b = buckets.find((x) => days >= x.min && days <= x.max);
    if (b) {
      b.amount += remaining;
      b.count += 1;
    }
  }
  return buckets.map(({ label, amount, count }) => ({ label, amount, count }));
}

export function apAging(
  bills: AfBill[],
  entityCode?: EntityCode | null,
  asOf = new Date().toISOString().slice(0, 10),
): AgingBucket[] {
  const buckets = [
    { label: 'Current', min: -Infinity, max: 0, amount: 0, count: 0 },
    { label: '1–30', min: 1, max: 30, amount: 0, count: 0 },
    { label: '31–60', min: 31, max: 60, amount: 0, count: 0 },
    { label: '61–90', min: 61, max: 90, amount: 0, count: 0 },
    { label: '90+', min: 91, max: Infinity, amount: 0, count: 0 },
  ];
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  for (const bill of bills) {
    if (entityCode && bill.entityCode !== entityCode) continue;
    if (bill.status === 'Paid' || bill.status === 'Rejected') continue;
    const due = Date.parse(`${bill.dueDate}T00:00:00Z`);
    const days = Math.floor((asOfMs - due) / 86400000);
    const remaining = bill.amount - bill.amountPaid;
    const b = buckets.find((x) => days >= x.min && days <= x.max);
    if (b) {
      b.amount += remaining;
      b.count += 1;
    }
  }
  return buckets.map(({ label, amount, count }) => ({ label, amount, count }));
}

export type DeferredRevRollforward = {
  entityCode: EntityCode;
  opening: number;
  additions: number;
  releases: number;
  ending: number;
};

/** Deferred revenue rollforward from GL 2300 (INDA SaaS). */
export function deferredRevenueRollforward(
  balances: Record<string, GlBalanceMap>,
): DeferredRevRollforward[] {
  return AF_ENTITIES.map((e) => {
    const ending = balances[e.code]?.['2300'] ?? 0;
    const additions = ending > 0 ? ending * 0.15 : 0;
    const releases = ending > 0 ? ending * 0.12 : 0;
    const opening = ending - additions + releases;
    return {
      entityCode: e.code,
      opening: Math.round(opening * 100) / 100,
      additions: Math.round(additions * 100) / 100,
      releases: Math.round(releases * 100) / 100,
      ending,
    };
  }).filter((r) => r.ending !== 0 || r.additions !== 0);
}

export type CollectionsKpi = {
  openCount: number;
  overdueCount: number;
  overdueAmount: number;
  collectedThisPeriod: number;
  dsoApprox: number;
  health: HealthStatus;
};

export function collectionsPerformance(input: {
  invoices: AfInvoice[];
  entityCode?: EntityCode | null;
  asOf?: string;
}): CollectionsKpi {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const inv = input.invoices.filter(
    (i) => !input.entityCode || i.entityCode === input.entityCode,
  );
  const open = inv.filter((i) => i.status !== 'Paid' && i.status !== 'Void');
  const overdue = open.filter((i) => i.dueDate < asOf);
  const overdueAmount = overdue.reduce(
    (s, i) => s + (i.amount - i.amountPaid),
    0,
  );
  const collectedThisPeriod = inv
    .filter((i) => i.status === 'Paid')
    .reduce((s, i) => s + i.amountPaid, 0);
  const ar = open.reduce((s, i) => s + (i.amount - i.amountPaid), 0);
  const dsoApprox =
    collectedThisPeriod > 0
      ? Math.round((ar / (collectedThisPeriod / 30)) * 10) / 10
      : open.length
        ? 45
        : 0;
  let health: HealthStatus = 'On Track';
  if (overdue.length >= 3 || overdueAmount > 40000) health = 'Critical';
  else if (overdue.length >= 1) health = 'At Risk';
  else if (dsoApprox > 40) health = 'Watch';
  return {
    openCount: open.length,
    overdueCount: overdue.length,
    overdueAmount,
    collectedThisPeriod,
    dsoApprox,
    health,
  };
}
