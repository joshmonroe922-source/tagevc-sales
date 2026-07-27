/**
 * Lightweight rules: map bureau signals → risk_band + suggested_terms.
 * No fake scores — only uses values present on the check.
 * Suggested terms are DRAFT guidance; DUR remains commercial default.
 */

import type {
  AccountCreditRiskBand,
  SuggestedPaymentTerms,
} from '@/lib/account-credit/types';
import { DEFAULT_PAYMENT_TERMS_POSTURE } from '@/lib/account-credit/types';

export type BureauScoreBag = {
  paydex?: number | null;
  intelliscore_plus?: number | null;
  business_credit_risk?: number | null;
  payment_index?: number | null;
  risk_flags?: string[] | null;
  public_records?: number | null;
  thin_file?: boolean | null;
};

/** Tunable thresholds (documented in OS_ACCOUNT_CREDIT_CHECK.md). */
export const ACCOUNT_CREDIT_THRESHOLDS = {
  /** D&B PAYDEX ≥ this → supportive of lower risk */
  paydexLowMin: 70,
  paydexMediumMin: 50,
  /** Experian Intelliscore Plus */
  intelliscoreLowMin: 60,
  intelliscoreMediumMin: 40,
  /** Equifax Business Credit Risk — lower is better in 101–992 scale */
  equifaxLowMax: 400,
  equifaxMediumMax: 600,
} as const;

function bandRank(b: AccountCreditRiskBand): number {
  if (b === 'high') return 3;
  if (b === 'medium') return 2;
  if (b === 'low') return 1;
  return 2; // unknown treated cautiously
}

function worst(
  a: AccountCreditRiskBand | null,
  b: AccountCreditRiskBand,
): AccountCreditRiskBand {
  if (!a) return b;
  return bandRank(b) >= bandRank(a) ? b : a;
}

export function riskBandFromBureauBag(
  bag: BureauScoreBag,
): { risk_band: AccountCreditRiskBand; thin_file: boolean } {
  if (bag.thin_file) {
    return { risk_band: 'high', thin_file: true };
  }

  const flags = bag.risk_flags ?? [];
  const publicRecords = bag.public_records ?? 0;
  if (
    flags.some((f) =>
      /bankrupt|lien|judgmen|collection/i.test(f),
    ) ||
    publicRecords > 0
  ) {
    return { risk_band: 'high', thin_file: false };
  }

  let band: AccountCreditRiskBand | null = null;
  let anySignal = false;

  if (typeof bag.paydex === 'number') {
    anySignal = true;
    if (bag.paydex >= ACCOUNT_CREDIT_THRESHOLDS.paydexLowMin) {
      band = worst(band, 'low');
    } else if (bag.paydex >= ACCOUNT_CREDIT_THRESHOLDS.paydexMediumMin) {
      band = worst(band, 'medium');
    } else {
      band = worst(band, 'high');
    }
  }

  if (typeof bag.intelliscore_plus === 'number') {
    anySignal = true;
    if (bag.intelliscore_plus >= ACCOUNT_CREDIT_THRESHOLDS.intelliscoreLowMin) {
      band = worst(band, 'low');
    } else if (
      bag.intelliscore_plus >= ACCOUNT_CREDIT_THRESHOLDS.intelliscoreMediumMin
    ) {
      band = worst(band, 'medium');
    } else {
      band = worst(band, 'high');
    }
  }

  if (typeof bag.business_credit_risk === 'number') {
    anySignal = true;
    // Lower Equifax BCR = better
    if (bag.business_credit_risk <= ACCOUNT_CREDIT_THRESHOLDS.equifaxLowMax) {
      band = worst(band, 'low');
    } else if (
      bag.business_credit_risk <= ACCOUNT_CREDIT_THRESHOLDS.equifaxMediumMax
    ) {
      band = worst(band, 'medium');
    } else {
      band = worst(band, 'high');
    }
  }

  if (typeof bag.payment_index === 'number') {
    anySignal = true;
    if (bag.payment_index >= 70) band = worst(band, 'low');
    else if (bag.payment_index >= 50) band = worst(band, 'medium');
    else band = worst(band, 'high');
  }

  if (!anySignal) {
    return { risk_band: 'unknown', thin_file: true };
  }

  return { risk_band: band ?? 'unknown', thin_file: false };
}

/**
 * Suggested negotiation ceiling — NOT auto-applied.
 * Always remind operators that DUR is the starting posture.
 */
export function suggestTermsFromRisk(
  risk: AccountCreditRiskBand,
  opts?: { thinFile?: boolean },
): {
  suggested_terms: SuggestedPaymentTerms;
  starting_posture: SuggestedPaymentTerms;
  notes: string;
} {
  const starting_posture = DEFAULT_PAYMENT_TERMS_POSTURE;
  if (opts?.thinFile || risk === 'high' || risk === 'unknown') {
    return {
      suggested_terms: risk === 'high' ? 'prepaid' : 'due_upon_receipt',
      starting_posture,
      notes:
        'Stay on Due Upon Receipt or prepaid. Do not extend NET until file quality improves and a manager explicitly overrides.',
    };
  }
  if (risk === 'medium') {
    return {
      suggested_terms: 'net_15',
      starting_posture,
      notes:
        'Negotiation ceiling NET 15 if needed — still open at Due Upon Receipt. Manager must set final terms.',
    };
  }
  // low
  return {
    suggested_terms: 'net_30',
    starting_posture,
    notes:
      'May allow NET 30 as negotiation ceiling. Still start at Due Upon Receipt; human sets final terms (DRAFT only).',
  };
}

export function mergeBureauBags(
  scores: Record<string, unknown>,
  summary: Record<string, unknown>,
): BureauScoreBag {
  return {
    paydex: num(scores.paydex),
    intelliscore_plus: num(scores.intelliscore_plus),
    business_credit_risk: num(scores.business_credit_risk),
    payment_index: num(scores.payment_index),
    risk_flags: Array.isArray(summary.risk_flags)
      ? (summary.risk_flags as string[])
      : null,
    public_records: num(summary.public_records),
    thin_file: summary.thin_file === true,
  };
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return null;
}
