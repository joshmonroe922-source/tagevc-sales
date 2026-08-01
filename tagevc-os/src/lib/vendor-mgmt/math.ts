/**
 * Server-side formulas from workbook (never accept client-authored computed fields).
 */

import type {
  BillingCadence,
  PricingModel,
  RenewalAlertStage,
  Scenario,
  VmSettings,
  VmVendor,
  VmVendorComputed,
} from '@/lib/vendor-mgmt/types';

export const CADENCE_DIVISOR: Record<BillingCadence, number> = {
  Monthly: 1,
  Quarterly: 3,
  'Semi-Annual': 6,
  Annual: 12,
};

export function cadenceToMonthly(
  invoiceAmount: number,
  cadence: BillingCadence,
  rateToUsd = 1,
): number {
  const div = CADENCE_DIVISOR[cadence] ?? 1;
  return (Number(invoiceAmount) * rateToUsd) / div;
}

/**
 * Per User prefer seats_active × unit_price when both present; else invoice/cadence.
 */
export function computeMonthlyUsd(input: {
  pricing_model: PricingModel;
  billing_cadence: BillingCadence;
  invoice_amount: number;
  seats_active?: number | null;
  unit_price?: number | null;
  rate_to_usd?: number;
}): number {
  const rate = input.rate_to_usd ?? 1;
  if (
    input.pricing_model === 'Per User' &&
    input.seats_active != null &&
    input.unit_price != null &&
    Number(input.seats_active) >= 0 &&
    Number(input.unit_price) >= 0
  ) {
    return Number(input.seats_active) * Number(input.unit_price) * rate;
  }
  return cadenceToMonthly(
    Number(input.invoice_amount),
    input.billing_cadence,
    rate,
  );
}

export function computeUtilization(
  seatsActive: number | null | undefined,
  seatsContracted: number | null | undefined,
): number | null {
  if (seatsContracted == null || seatsContracted <= 0) return null;
  if (seatsActive == null) return null;
  return Number(seatsActive) / Number(seatsContracted);
}

export function computeWasteMonthly(input: {
  seats_contracted?: number | null;
  seats_active?: number | null;
  unit_price?: number | null;
}): number {
  const contracted = Number(input.seats_contracted ?? 0);
  const active = Number(input.seats_active ?? 0);
  const unit = Number(input.unit_price ?? 0);
  if (contracted <= 0 || unit <= 0) return 0;
  return Math.max(0, contracted - active) * unit;
}

export function daysToEnd(
  contractEnd: string | null | undefined,
  asOf: string | Date,
): number | null {
  if (!contractEnd) return null;
  const end = new Date(`${contractEnd}T00:00:00Z`);
  const asOfDate =
    typeof asOf === 'string' ? new Date(`${asOf}T00:00:00Z`) : asOf;
  if (Number.isNaN(end.getTime()) || Number.isNaN(asOfDate.getTime())) {
    return null;
  }
  return Math.round((end.getTime() - asOfDate.getTime()) / 86_400_000);
}

export function renewalAlertStage(days: number | null): RenewalAlertStage {
  if (days == null) return 'OK';
  if (days < 0) return 'EXPIRED';
  if (days <= 30) return '30-DAY';
  if (days <= 60) return '60-DAY';
  if (days <= 90) return '90-DAY';
  return 'OK';
}

export function enrichVendor(
  vendor: VmVendor,
  opts?: { asOf?: string; rateToUsd?: number },
): VmVendorComputed {
  const asOf = opts?.asOf ?? new Date().toISOString().slice(0, 10);
  const monthly_usd = computeMonthlyUsd({
    pricing_model: vendor.pricing_model,
    billing_cadence: vendor.billing_cadence,
    invoice_amount: vendor.invoice_amount,
    seats_active: vendor.seats_active,
    unit_price: vendor.unit_price,
    rate_to_usd: opts?.rateToUsd ?? 1,
  });
  const days = daysToEnd(vendor.contract_end, asOf);
  return {
    ...vendor,
    monthly_usd,
    annual_usd: monthly_usd * 12,
    utilization_pct: computeUtilization(
      vendor.seats_active,
      vendor.seats_contracted,
    ),
    waste_monthly: computeWasteMonthly(vendor),
    days_to_end: days,
    renewal_stage: renewalAlertStage(days),
  };
}

export function scenarioGrowth(
  settings: VmSettings,
  kind: 'hc' | 'rev' | 'seat',
): number {
  const s = settings.scenario as Scenario;
  const map = {
    hc: {
      Bear: settings.hc_growth_bear,
      Base: settings.hc_growth_base,
      Bull: settings.hc_growth_bull,
    },
    rev: {
      Bear: settings.rev_growth_bear,
      Base: settings.rev_growth_base,
      Bull: settings.rev_growth_bull,
    },
    seat: {
      Bear: settings.seat_inflation_bear,
      Base: settings.seat_inflation_base,
      Bull: settings.seat_inflation_bull,
    },
  } as const;
  return map[kind][s];
}

export function fullyLoadedMonthly(input: {
  baseAnnual: number;
  commissionAnnual: number;
  fte: number;
  techLicMonthly: number;
  settings: Pick<
    VmSettings,
    | 'burden_pct'
    | 'benefits_monthly'
    | 'facilities_monthly'
    | 'mgmt_overhead_pct'
  >;
}): number {
  const fte = input.fte || 1;
  const baseMo = (input.baseAnnual / 12) * fte;
  const commMo = (input.commissionAnnual / 12) * fte;
  const burden = (baseMo + commMo) * input.settings.burden_pct;
  const benefits = input.settings.benefits_monthly * fte;
  const facilities = input.settings.facilities_monthly * fte;
  const mgmt = baseMo * input.settings.mgmt_overhead_pct;
  return (
    baseMo +
    commMo +
    burden +
    benefits +
    facilities +
    mgmt +
    input.techLicMonthly
  );
}

export function hireCostTimeline(input: {
  baseAnnual: number;
  commissionAnnual: number;
  fte: number;
  techLicMonthly: number;
  settings: VmSettings;
}): {
  day1: number;
  d30: number;
  d90: number;
  y1: number;
  y2: number;
  y3Cumulative: number;
  monthlyRunRate: number;
  oneTime: number;
} {
  const monthly = fullyLoadedMonthly(input);
  const recruiting = input.baseAnnual * input.settings.recruiting_pct;
  const oneTime =
    recruiting +
    input.settings.equipment_onetime +
    input.settings.training_90d;
  const seatInfl = scenarioGrowth(input.settings, 'seat');
  const y2 = monthly * 12 * (1 + seatInfl);
  const y3 = monthly * 12 * (1 + seatInfl) ** 2;
  const y1 = oneTime + monthly * 12;
  return {
    day1: input.settings.equipment_onetime + recruiting,
    d30: oneTime + monthly,
    d90: oneTime + monthly * 3,
    y1,
    y2,
    y3Cumulative: y1 + y2 + y3,
    monthlyRunRate: monthly,
    oneTime,
  };
}

export function chargebackPctSum(rule: {
  pct_tage: number;
  pct_r619: number;
  pct_shr: number;
  pct_inda: number;
}): number {
  return (
    Number(rule.pct_tage) +
    Number(rule.pct_r619) +
    Number(rule.pct_shr) +
    Number(rule.pct_inda)
  );
}

export function chargebackPctValid(rule: {
  method: string;
  pct_tage: number;
  pct_r619: number;
  pct_shr: number;
  pct_inda: number;
}): boolean {
  if (rule.method === 'Seats') return true;
  return Math.abs(chargebackPctSum(rule) - 1) < 0.0001;
}
