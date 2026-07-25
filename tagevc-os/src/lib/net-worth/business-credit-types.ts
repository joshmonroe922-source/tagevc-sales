/** Client-safe business credit bureau DTOs (no server imports). */

export type BusinessBureau = 'dnb' | 'experian_business' | 'equifax_business';

export const BUSINESS_BUREAUS: readonly BusinessBureau[] = [
  'dnb',
  'experian_business',
  'equifax_business',
] as const;

export const BUSINESS_BUREAU_LABELS: Record<BusinessBureau, string> = {
  dnb: 'Dun & Bradstreet',
  experian_business: 'Experian Business',
  equifax_business: 'Equifax Business',
};

export const BUSINESS_BUREAU_PORTALS: Record<BusinessBureau, string> = {
  dnb: 'https://www.dnb.com/duns-number/lookup.html',
  experian_business: 'https://www.experian.com/small-business/business-credit-reports',
  equifax_business: 'https://www.equifax.com/business/business-credit-reports-small-business/',
};

export type BusinessBureauIdentifiers = {
  duns?: string | null;
  experian_file_number?: string | null;
  equifax_id?: string | null;
  [key: string]: string | null | undefined;
};

export type BusinessBureauScores = {
  paydex?: number | null;
  delinquency_score?: number | null;
  failure_score?: number | null;
  intelliscore_plus?: number | null;
  financial_stability_risk?: number | null;
  business_credit_risk?: number | null;
  business_failure_score?: number | null;
  payment_index?: number | null;
  [key: string]: number | null | undefined;
};

export type BusinessBureauSummary = {
  payment_performance?: string | null;
  tradelines_count?: number | null;
  inquiries?: number | null;
  public_records?: number | null;
  risk_flags?: string[] | null;
  [key: string]: unknown;
};

export type BusinessBureauSnapshot = {
  id: string;
  entity_id: string;
  bureau: BusinessBureau;
  pulled_at: string;
  report_date: string | null;
  source: 'manual_upload' | 'guided_export' | 'manual_entry' | 'api_future';
  identifiers: BusinessBureauIdentifiers;
  scores: BusinessBureauScores;
  summary: BusinessBureauSummary;
  raw_storage_path: string | null;
  parse_status: string;
  parse_errors: string;
  days_old: number | null;
  stale: boolean;
};

export type BusinessBureauConnection = {
  id: string;
  entity_id: string;
  bureau: BusinessBureau;
  status: 'connected_guided' | 'stale' | 'disconnected';
  last_successful_pull_at: string | null;
  notes: string;
};

export type BusinessBureauCompany = {
  entity_id: string;
  company_name: string;
  byBureau: Partial<Record<BusinessBureau, BusinessBureauSnapshot | null>>;
  connections: BusinessBureauConnection[];
};

/** Primary score to feature on a bureau card. */
export function primaryBusinessScore(
  bureau: BusinessBureau,
  scores: BusinessBureauScores,
): { label: string; value: number | null } {
  if (bureau === 'dnb') {
    return { label: 'PAYDEX', value: scores.paydex ?? null };
  }
  if (bureau === 'experian_business') {
    return { label: 'Intelliscore Plus', value: scores.intelliscore_plus ?? null };
  }
  return {
    label: 'Business Credit Risk',
    value: scores.business_credit_risk ?? null,
  };
}

export function primaryBureauIdentifier(
  bureau: BusinessBureau,
  ids: BusinessBureauIdentifiers,
): { label: string; value: string | null } {
  if (bureau === 'dnb') return { label: 'D-U-N-S', value: ids.duns ?? null };
  if (bureau === 'experian_business') {
    return { label: 'Experian file #', value: ids.experian_file_number ?? null };
  }
  return { label: 'Equifax ID', value: ids.equifax_id ?? null };
}

export function bureauCardStatus(
  snapshot: BusinessBureauSnapshot | null | undefined,
): 'healthy' | 'attention' | 'no_data' {
  if (!snapshot) return 'no_data';
  if (
    snapshot.stale ||
    snapshot.parse_status === 'failed' ||
    (snapshot.summary.risk_flags?.length ?? 0) > 0 ||
    (snapshot.summary.public_records ?? 0) > 0
  ) {
    return 'attention';
  }
  return 'healthy';
}
