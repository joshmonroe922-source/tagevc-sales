/**
 * credit_ledger helpers — every paid provider call must record spend.
 * Safe for worker (relative imports only from callers).
 */

export type CreditLedgerInsert = {
  org_id: string;
  provider: string;
  units: number;
  usd_estimate: number;
  job_id?: string | null;
  meta?: Record<string, unknown>;
};

export type CreditMonthSpendRow = {
  usd_estimate: number | null;
};

/** Sum usd_estimate for org in current UTC month. */
export function sumMonthSpendUsd(
  rows: CreditMonthSpendRow[],
): number {
  return rows.reduce((n, r) => n + Number(r.usd_estimate || 0), 0);
}

export function monthStartIso(now = new Date()): string {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
}

export const PROVIDER_COST_USD: Record<string, number> = {
  apollo_company: 0.05,
  apollo_people: 0.08,
  pdl_person: 0.03,
  hunter_email: 0.02,
  zerobounce: 0.008,
};
