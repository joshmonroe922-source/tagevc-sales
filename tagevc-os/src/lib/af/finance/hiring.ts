/**
 * Hiring estimator — fully-loaded cost vs waterfall dept envelopes.
 */

import type {
  AllocationLedgerRow,
  EntityCode,
  HealthStatus,
  WaterfallBucketCode,
} from '@/lib/af/types';
import { bucketBalances } from '@/lib/af/waterfall/engine';

export type HirePlan = {
  id: string;
  entityCode: EntityCode;
  title: string;
  dept: WaterfallBucketCode | string;
  baseSalary: number;
  burdenPct: number;
  startMonthOffset: number;
};

export type HireAffordability = {
  plan: HirePlan;
  fullyLoadedAnnual: number;
  fullyLoadedMonthly: number;
  envelopeAvailable: number;
  monthsCovered: number;
  affordable: boolean;
  health: HealthStatus;
  gap: number;
};

const DEFAULT_BURDEN = 0.32;

export const SEED_HIRE_PLANS: HirePlan[] = [
  {
    id: 'HIRE-R619-AE',
    entityCode: 'R619',
    title: 'Account Executive',
    dept: 'SALES',
    baseSalary: 85000,
    burdenPct: DEFAULT_BURDEN,
    startMonthOffset: 1,
  },
  {
    id: 'HIRE-R619-REC',
    entityCode: 'R619',
    title: 'Recruiter',
    dept: 'DIR',
    baseSalary: 72000,
    burdenPct: DEFAULT_BURDEN,
    startMonthOffset: 2,
  },
  {
    id: 'HIRE-INDA-ENG',
    entityCode: 'INDA',
    title: 'Full-stack Engineer',
    dept: 'TECH',
    baseSalary: 140000,
    burdenPct: 0.28,
    startMonthOffset: 1,
  },
  {
    id: 'HIRE-SHR-CS',
    entityCode: 'SHR',
    title: 'Client Success Manager',
    dept: 'GA',
    baseSalary: 78000,
    burdenPct: DEFAULT_BURDEN,
    startMonthOffset: 3,
  },
  {
    id: 'HIRE-TVC-AF',
    entityCode: 'TVC',
    title: 'Staff Accountant',
    dept: 'GA',
    baseSalary: 90000,
    burdenPct: 0.3,
    startMonthOffset: 1,
  },
];

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

export function fullyLoadedAnnual(plan: HirePlan): number {
  return round2(plan.baseSalary * (1 + plan.burdenPct));
}

export function assessHireAffordability(
  plan: HirePlan,
  allocationLedger: AllocationLedgerRow[],
): HireAffordability {
  const entityRows = allocationLedger.filter(
    (r) => r.entityCode === plan.entityCode,
  );
  const buckets = bucketBalances(entityRows);
  const deptKey = plan.dept as WaterfallBucketCode;
  const envelope =
    (buckets[deptKey] ?? 0) +
    (deptKey !== 'PROFIT' ? (buckets.PROFIT ?? 0) * 0.15 : 0);

  const annual = fullyLoadedAnnual(plan);
  const monthly = round2(annual / 12);
  const monthsCovered =
    monthly > 0 ? Math.floor(envelope / monthly) : 0;
  const affordable = monthsCovered >= 3;
  const gap = round2(Math.max(monthly * 3 - envelope, 0));

  let health: HealthStatus = 'On Track';
  if (!affordable && monthsCovered === 0) health = 'Critical';
  else if (!affordable && monthsCovered < 2) health = 'At Risk';
  else if (monthsCovered < 6) health = 'Watch';

  return {
    plan,
    fullyLoadedAnnual: annual,
    fullyLoadedMonthly: monthly,
    envelopeAvailable: round2(envelope),
    monthsCovered,
    affordable,
    health,
    gap,
  };
}

export function assessAllHires(
  plans: HirePlan[],
  allocationLedger: AllocationLedgerRow[],
  entityFilter?: EntityCode | null,
): HireAffordability[] {
  return plans
    .filter((p) => !entityFilter || p.entityCode === entityFilter)
    .map((p) => assessHireAffordability(p, allocationLedger));
}
