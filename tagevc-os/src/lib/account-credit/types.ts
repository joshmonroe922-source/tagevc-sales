/**
 * Account credit / payment-worthiness — client-safe types + policy constants.
 * Counterparty checks (other companies), not self-entity Phase 73/75 monitoring.
 */

export type AccountCreditRefType =
  | 'recruit_account'
  | 'instantnda_customer'
  | 'signent_client'
  | 'tage_counterparty';

export type AccountCreditStatus =
  | 'requested'
  | 'in_progress'
  | 'completed'
  | 'thin_file'
  | 'failed'
  | 'waived';

export type AccountCreditRiskBand = 'low' | 'medium' | 'high' | 'unknown';

export type SuggestedPaymentTerms =
  | 'due_upon_receipt'
  | 'prepaid'
  | 'net_15'
  | 'net_30'
  | 'net_45'
  | 'custom';

export type AccountCreditBureau =
  | 'dnb'
  | 'experian_business'
  | 'equifax_business';

export const ACCOUNT_CREDIT_BUREAUS: readonly AccountCreditBureau[] = [
  'dnb',
  'experian_business',
  'equifax_business',
] as const;

export const DEFAULT_PAYMENT_TERMS_POSTURE: SuggestedPaymentTerms =
  'due_upon_receipt';

/** Persistent UI / docs copy — never auto-apply terms. */
export const DUR_POLICY_COPY =
  'Default remains Due Upon Receipt until a manager/finance explicitly changes terms.';

export const ACCOUNT_CREDIT_NET_PROMPT =
  'Account requested open terms — consider running credit check before moving off Due Upon Receipt.';

export const ACCOUNT_CREDIT_PAID_BUREAU_HELP =
  'Bureau reports on other companies are typically paid (pay-per-report or subscription). Export/download from D&B, Experian Business, or Equifax Business, then upload here. No headless login and no stored bureau passwords.';

export type AccountCreditCheck = {
  id: string;
  entity_id: string;
  account_ref_type: AccountCreditRefType;
  account_ref_id: string;
  account_display_name: string;
  account_identifiers: Record<string, unknown>;
  status: AccountCreditStatus;
  bureaus_requested: AccountCreditBureau[];
  risk_band: AccountCreditRiskBand | null;
  scores: Record<string, unknown>;
  summary: Record<string, unknown>;
  suggested_terms: SuggestedPaymentTerms | null;
  suggested_credit_limit: number | null;
  recommendation_notes: string;
  raw_storage_paths: Record<string, string>;
  source: 'manual_upload' | 'guided_export' | 'api_future';
  requested_by: string | null;
  requested_at: string;
  completed_at: string | null;
  waiver_reason: string | null;
  waived_by: string | null;
  waived_at: string | null;
  created_at: string;
  updated_at: string;
};

export const RISK_BAND_LABELS: Record<AccountCreditRiskBand | 'thin_file', string> =
  {
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    unknown: 'Unknown',
    thin_file: 'Thin file',
  };

export const TERMS_LABELS: Record<SuggestedPaymentTerms, string> = {
  due_upon_receipt: 'Due Upon Receipt',
  prepaid: 'Prepaid',
  net_15: 'NET 15',
  net_30: 'NET 30',
  net_45: 'NET 45',
  custom: 'Custom',
};

/** Feature flag scaffold — Instant NDA UI stays dark unless explicitly enabled. */
export function isIndaAccountCreditCheckEnabled(): boolean {
  return process.env.INDA_ACCOUNT_CREDIT_CHECK_ENABLED === '1';
}

/** Recruit / Tage manager+ roles that may run a check (app-layer mirror of SQL). */
export const ACCOUNT_CREDIT_RUN_ROLES = [
  'visionary',
  'admin',
  'partner',
  'coo',
  'sub_lead',
  'service_lead',
  'counsel_ops',
] as const;

export function canRunAccountCreditCheck(role: string | null | undefined): boolean {
  if (!role) return false;
  return (ACCOUNT_CREDIT_RUN_ROLES as readonly string[]).includes(role);
}
