/**
 * Lightweight business credit report parser (D&B / Experian Business /
 * Equifax Business). Best-effort extraction of identifiers, primary scores,
 * and a high-level summary. Fail-soft — never throws for missing fields.
 * No fabricated scores: only values found in the text are stored.
 */

import { extractTextFromPdfBuffer } from '@/lib/net-worth/credit-parse';
import type {
  BusinessBureau,
  BusinessBureauIdentifiers,
  BusinessBureauScores,
  BusinessBureauSummary,
} from '@/lib/net-worth/business-credit-types';

export type BusinessParseResult = {
  bureau: BusinessBureau;
  report_date: string | null;
  identifiers: BusinessBureauIdentifiers;
  scores: BusinessBureauScores;
  summary: BusinessBureauSummary;
  parse_status: 'parsed' | 'partial' | 'failed';
  parse_errors: string[];
};

export { extractTextFromPdfBuffer };

function pickNum(
  text: string,
  patterns: RegExp[],
  range?: [number, number],
): number | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (Number.isNaN(n)) continue;
      if (range && (n < range[0] || n > range[1])) continue;
      return n;
    }
  }
  return null;
}

function pickStr(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) return m[1].trim();
  }
  return null;
}

export function guessBusinessBureau(text: string): BusinessBureau {
  const t = text.toLowerCase();
  const dnb =
    /dun\s*&?\s*bradstreet|d&b|paydex|d-u-n-s|duns\s*number/.test(t);
  const experian =
    /experian/.test(t) && /intelliscore|business/.test(t);
  const equifax = /equifax/.test(t) && /business/.test(t);
  if (dnb) return 'dnb';
  if (experian && !equifax) return 'experian_business';
  if (equifax && !experian) return 'equifax_business';
  if (experian) return 'experian_business';
  if (equifax) return 'equifax_business';
  return 'dnb';
}

function parseReportDate(text: string): string | null {
  const m =
    /(?:report\s*date|as\s*of|generated\s*on|report\s*created)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );
  if (!m) return null;
  const raw = m[1];
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parts = raw.split(/[\/\-]/);
  if (parts.length !== 3) return null;
  const [a, b, c] = parts;
  const year = c.length === 2 ? `20${c}` : c;
  return `${year}-${a.padStart(2, '0')}-${b.padStart(2, '0')}`;
}

export function parseBusinessCreditReportText(input: {
  text: string;
  preferredBureau?: BusinessBureau;
}): BusinessParseResult {
  const text = input.text.replace(/\u0000/g, ' ');
  const errors: string[] = [];
  const bureau = input.preferredBureau ?? guessBusinessBureau(text);

  const identifiers: BusinessBureauIdentifiers = {
    duns: pickStr(text, [
      /d[\s-]*u[\s-]*n[\s-]*s(?:\s*number)?[:#\s]+(\d{2}-?\d{3}-?\d{4}|\d{9})/i,
      /duns[:#\s]+(\d{2}-?\d{3}-?\d{4}|\d{9})/i,
    ]),
    experian_file_number: pickStr(text, [
      /(?:experian\s*)?(?:business\s*)?(?:file|bin)\s*(?:number|#)[:\s]+([A-Z0-9-]{5,20})/i,
    ]),
    equifax_id: pickStr(text, [
      /equifax\s*(?:business\s*)?(?:id|identifier|number)[:#\s]+([A-Z0-9-]{5,20})/i,
    ]),
  };
  if (identifiers.duns) {
    identifiers.duns = identifiers.duns.replace(/-/g, '');
  }

  const scores: BusinessBureauScores = {
    // D&B
    paydex: pickNum(text, [/paydex(?:\s*score)?[:\s]+(\d{1,3})/i], [1, 100]),
    delinquency_score: pickNum(
      text,
      [/delinquency\s*(?:predictor\s*)?score[:\s]+(\d{3,4})/i],
      [101, 999],
    ),
    failure_score: pickNum(
      text,
      [/(?:d&b\s*)?failure\s*score[:\s]+(\d{3,4})/i],
      [1001, 1875],
    ),
    // Experian Business
    intelliscore_plus: pickNum(
      text,
      [
        /intelliscore(?:\s*plus)?(?:\s*v?\d)?[:\s]+(\d{1,3})/i,
        /business\s*credit\s*score[:\s]+(\d{1,3})\b/i,
      ],
      [1, 100],
    ),
    financial_stability_risk: pickNum(
      text,
      [/financial\s*stability\s*risk(?:\s*(?:score|rating))?[:\s]+(\d{1,3})/i],
      [1, 100],
    ),
    // Equifax Business
    business_credit_risk: pickNum(
      text,
      [
        /(?:business\s*)?credit\s*risk\s*score[:\s]+(\d{3})/i,
        /business\s*delinquency\s*score[:\s]+(\d{3})/i,
      ],
      [101, 992],
    ),
    business_failure_score: pickNum(
      text,
      [/business\s*failure\s*score[:\s]+(\d{4})/i],
      [1000, 1880],
    ),
    payment_index: pickNum(
      text,
      [/payment\s*index[:\s]+(\d{1,3})/i],
      [0, 100],
    ),
  };

  const riskFlags: string[] = [];
  if (/judgmen?t/i.test(text)) riskFlags.push('judgment_mentioned');
  if (/lien/i.test(text)) riskFlags.push('lien_mentioned');
  if (/bankruptc/i.test(text)) riskFlags.push('bankruptcy_mentioned');
  if (/collection/i.test(text)) riskFlags.push('collection_mentioned');

  const summary: BusinessBureauSummary = {
    payment_performance: pickStr(text, [
      /payment\s*(?:performance|trend|behavior)[:\s]+([A-Za-z ][A-Za-z /-]{2,40})/i,
    ]),
    tradelines_count: pickNum(text, [
      /trade(?:lines?| experiences?| accounts?)[^\d]{0,20}(\d{1,3})/i,
      /number\s*of\s*trade(?:lines?)?[:\s]+(\d{1,3})/i,
    ]),
    inquiries: pickNum(text, [/inquir(?:y|ies)[^\d]{0,20}(\d{1,3})/i]),
    public_records: pickNum(text, [/public\s*records?[^\d]{0,20}(\d{1,3})/i]),
    risk_flags: riskFlags,
  };

  const report_date = parseReportDate(text);

  const hasAnyScore = Object.values(scores).some(
    (v) => typeof v === 'number',
  );
  const hasAnyId = Boolean(
    identifiers.duns || identifiers.experian_file_number || identifiers.equifax_id,
  );
  if (!hasAnyScore) {
    errors.push(
      'No business score detected (PAYDEX / Intelliscore Plus / Equifax risk) — use manual entry to record key values',
    );
  }

  const parse_status: BusinessParseResult['parse_status'] =
    hasAnyScore || hasAnyId ? (errors.length ? 'partial' : 'parsed') : 'failed';

  return {
    bureau,
    report_date,
    identifiers,
    scores,
    summary,
    parse_status,
    parse_errors: errors,
  };
}
