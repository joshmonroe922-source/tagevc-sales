/**
 * Server-side spend normalization (BUILD_HANDOFF §6).
 * Never accept client-authored monthly_usd / waste / utilization.
 */

export type BillingCadence = 'Monthly' | 'Quarterly' | 'Semi-Annual' | 'Annual';
export type PricingModel = 'Per User' | 'Fixed' | 'Usage' | 'Hybrid';

export const CADENCE_DIVISOR: Record<BillingCadence, number> = {
  Monthly: 1,
  Quarterly: 3,
  'Semi-Annual': 6,
  Annual: 12,
};

export type VendorSpendInput = {
  pricing_model: PricingModel | string;
  billing_cadence: BillingCadence | string;
  invoice_amount: number;
  currency?: string;
  rate_to_usd?: number;
  seats_contracted?: number | null;
  seats_active?: number | null;
  unit_price?: number | null;
};

export type VendorSpendComputed = {
  monthly_usd: number;
  annual_usd: number;
  utilization_pct: number | null;
  waste_monthly: number;
};

function cadenceDivisor(cadence: string): number {
  return CADENCE_DIVISOR[cadence as BillingCadence] ?? 1;
}

/** Invoice → monthly USD (after FX). */
export function invoiceMonthlyUsd(
  invoiceAmount: number,
  billingCadence: string,
  rateToUsd = 1,
): number {
  const amt = Number(invoiceAmount) || 0;
  const rate = Number(rateToUsd) || 1;
  return (amt * rate) / cadenceDivisor(billingCadence);
}

/**
 * Per User prefer seats_active × unit_price when both present; else invoice/cadence.
 */
export function computeVendorSpend(input: VendorSpendInput): VendorSpendComputed {
  const rate = Number(input.rate_to_usd) || 1;
  const seatsActive = input.seats_active ?? null;
  const seatsContracted = input.seats_contracted ?? null;
  const unitPrice = input.unit_price ?? null;

  let monthly_usd: number;
  const perUser =
    (input.pricing_model === 'Per User' || input.pricing_model === 'Hybrid') &&
    seatsActive != null &&
    unitPrice != null &&
    Number.isFinite(Number(seatsActive)) &&
    Number.isFinite(Number(unitPrice));

  if (perUser) {
    monthly_usd = Number(seatsActive) * Number(unitPrice) * rate;
  } else {
    monthly_usd = invoiceMonthlyUsd(
      input.invoice_amount,
      input.billing_cadence,
      rate,
    );
  }

  const annual_usd = monthly_usd * 12;

  let utilization_pct: number | null = null;
  let waste_monthly = 0;
  if (
    seatsContracted != null &&
    seatsContracted > 0 &&
    seatsActive != null &&
    unitPrice != null
  ) {
    utilization_pct = Math.min(1, Number(seatsActive) / Number(seatsContracted));
    const unused = Math.max(0, Number(seatsContracted) - Number(seatsActive));
    waste_monthly = unused * Number(unitPrice) * rate;
  }

  return {
    monthly_usd: round2(monthly_usd),
    annual_usd: round2(annual_usd),
    utilization_pct:
      utilization_pct == null ? null : Math.round(utilization_pct * 1000) / 10,
    waste_monthly: round2(waste_monthly),
  };
}

export type RenewalStage =
  | 'OK'
  | '90-DAY'
  | '60-DAY'
  | '30-DAY'
  | 'EXPIRED';

/** Renewal stages from contract_end − as_of. */
export function renewalStage(
  contractEnd: string | Date | null | undefined,
  asOf: string | Date = new Date(),
): { days_to_end: number | null; stage: RenewalStage } {
  if (!contractEnd) return { days_to_end: null, stage: 'OK' };
  const end = toDate(contractEnd);
  const asOfD = toDate(asOf);
  if (!end || !asOfD) return { days_to_end: null, stage: 'OK' };
  const days = Math.floor((end.getTime() - asOfD.getTime()) / 86_400_000);
  let stage: RenewalStage = 'OK';
  if (days < 0) stage = 'EXPIRED';
  else if (days <= 30) stage = '30-DAY';
  else if (days <= 60) stage = '60-DAY';
  else if (days <= 90) stage = '90-DAY';
  return { days_to_end: days, stage };
}

export function chargebackPctSum(pcts: number[]): number {
  return round4(pcts.reduce((a, b) => a + (Number(b) || 0), 0));
}

export function chargebackValid(pcts: number[], method: 'Seats' | 'Fixed %'): boolean {
  if (method === 'Seats') return true;
  return Math.abs(chargebackPctSum(pcts) - 1) < 0.0001;
}

/** Allocate monthly $ by Fixed % weights (must sum to 1). */
export function allocateChargebackFixed(
  monthlyUsd: number,
  pctByEntity: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, pct] of Object.entries(pctByEntity)) {
    out[k] = round2(monthlyUsd * (Number(pct) || 0));
  }
  return out;
}

/** Seats method = headcount share. */
export function allocateChargebackSeats(
  monthlyUsd: number,
  headcountByEntity: Record<string, number>,
): Record<string, number> {
  const total = Object.values(headcountByEntity).reduce(
    (a, b) => a + Math.max(0, Number(b) || 0),
    0,
  );
  const out: Record<string, number> = {};
  if (total <= 0) {
    for (const k of Object.keys(headcountByEntity)) out[k] = 0;
    return out;
  }
  for (const [k, hc] of Object.entries(headcountByEntity)) {
    out[k] = round2(monthlyUsd * (Math.max(0, Number(hc) || 0) / total));
  }
  return out;
}

export type HireSimInput = {
  baseSalaryAnnual: number;
  commissionTargetAnnual?: number;
  fte?: number;
  techLicMonthly?: number;
  burdenPct: number;
  benefitsMonthly: number;
  recruitingPct: number;
  equipmentOnetime: number;
  training90d: number;
  facilitiesMonthly: number;
  mgmtOverheadPct: number;
  seatInflation?: number;
};

export type HireSimResult = {
  monthly_run_rate: number;
  day1: number;
  first_30d: number;
  first_90d: number;
  y1_total: number;
  y2_run_rate_annual: number;
  y3_cumulative: number;
  recruiting_onetime: number;
  onetime_total: number;
};

/** Pure offboard planner — used by tests + lifecycle before DB writes. */
export function applyOffboardRevoke(input: {
  entitlements: Array<{
    emp_id: string;
    product_id: string;
    assigned: boolean;
    source: string;
    assigned_at?: string | null;
    revoked_at?: string | null;
  }>;
  products: Array<{
    id: string;
    offboard_action: 'Revoke' | 'Keep org' | string;
  }>;
  hasLinkedAdmin?: boolean;
}): {
  entitlements: Array<{
    emp_id: string;
    product_id: string;
    assigned: boolean;
    source: string;
    assigned_at?: string | null;
    revoked_at?: string | null;
  }>;
  revokedProductIds: string[];
  keepOrgProductIds: string[];
  deactivateAdmin: boolean;
} {
  const byId = new Map(input.products.map((p) => [p.id, p]));
  const revokedProductIds: string[] = [];
  const keepOrgProductIds: string[] = [];
  const entitlements = input.entitlements.map((e) => {
    const product = byId.get(e.product_id);
    const keep = product?.offboard_action === 'Keep org';
    if (keep) {
      keepOrgProductIds.push(e.product_id);
      return { ...e, assigned: false, revoked_at: e.revoked_at ?? null };
    }
    revokedProductIds.push(e.product_id);
    return { ...e, assigned: false, revoked_at: e.revoked_at ?? null };
  });
  return {
    entitlements,
    revokedProductIds,
    keepOrgProductIds,
    deactivateAdmin: Boolean(input.hasLinkedAdmin),
  };
}

/** Pure birthright planner from role_products matrix. */
export function planEntitlementsForHire(input: {
  empId: string;
  roleId: string;
  roleProducts: Array<{
    role_id: string;
    product_id: string;
    is_birthright: boolean;
  }>;
}): Array<{
  emp_id: string;
  product_id: string;
  assigned: boolean;
  source: 'birthright';
}> {
  return input.roleProducts
    .filter((r) => r.role_id === input.roleId && r.is_birthright)
    .map((r) => ({
      emp_id: input.empId,
      product_id: r.product_id,
      assigned: true,
      source: 'birthright' as const,
    }));
}

export function computeHireCost(input: HireSimInput): HireSimResult {
  const fte = input.fte ?? 1;
  const baseMo = (Number(input.baseSalaryAnnual) || 0) / 12 * fte;
  const commMo = (Number(input.commissionTargetAnnual) || 0) / 12 * fte;
  const burden = (baseMo + commMo) * (Number(input.burdenPct) || 0);
  const benefits = Number(input.benefitsMonthly) || 0;
  const facilities = Number(input.facilitiesMonthly) || 0;
  const mgmt = baseMo * (Number(input.mgmtOverheadPct) || 0);
  const tech = Number(input.techLicMonthly) || 0;
  const monthly = round2(baseMo + commMo + burden + benefits + facilities + mgmt + tech);

  const recruiting = round2(
    (Number(input.baseSalaryAnnual) || 0) * fte * (Number(input.recruitingPct) || 0),
  );
  const equipment = Number(input.equipmentOnetime) || 0;
  const training = Number(input.training90d) || 0;
  const onetime = round2(recruiting + equipment + training);
  const inflation = Number(input.seatInflation) || 0.05;

  const y1 = round2(onetime + monthly * 12);
  const y2Annual = round2(monthly * 12 * (1 + inflation));
  const y3Annual = round2(monthly * 12 * (1 + inflation) ** 2);
  const y3cum = round2(y1 + y2Annual + y3Annual);

  return {
    monthly_run_rate: monthly,
    day1: round2(recruiting + equipment),
    first_30d: round2(onetime + monthly),
    first_90d: round2(onetime + monthly * 3),
    y1_total: y1,
    y2_run_rate_annual: y2Annual,
    y3_cumulative: y3cum,
    recruiting_onetime: recruiting,
    onetime_total: onetime,
  };
}

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

function round4(n: number): number {
  return Math.round((Number(n) || 0) * 10000) / 10000;
}

function toDate(v: string | Date): Date | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
