/**
 * FICO-centric credit report text parser (myFICO / Experian / generic).
 * Extracts FICO 8/10, Auto, Bankcard + utilization/inquiries when present.
 * Fail-soft — never throws for missing fields.
 */

export type CreditBureau = 'equifax' | 'experian' | 'transunion' | 'tri_merge';

export type FicoScores = {
  fico_8?: number | null;
  fico_10?: number | null;
  fico_9?: number | null;
  fico_auto_8?: number | null;
  fico_auto_10?: number | null;
  fico_bankcard_8?: number | null;
  fico_bankcard_10?: number | null;
  equifax_fico_8?: number | null;
  experian_fico_8?: number | null;
  transunion_fico_8?: number | null;
  equifax_fico_10?: number | null;
  experian_fico_10?: number | null;
  transunion_fico_10?: number | null;
  other?: Record<string, number>;
};

export type CreditSummary = {
  utilization_pct?: number | null;
  open_accounts?: number | null;
  closed_accounts?: number | null;
  inquiries_12m?: number | null;
  inquiries_24m?: number | null;
  negative_items_count?: number | null;
  public_records?: number | null;
  collections?: number | null;
  oldest_account_age_months?: number | null;
  avg_account_age_months?: number | null;
};

export type ParsedTradeline = {
  creditor_name: string;
  account_type: string;
  balance: number | null;
  credit_limit: number | null;
  is_negative: boolean;
  is_collection: boolean;
  is_chargeoff: boolean;
  status: string;
};

export type ParseResult = {
  bureau: CreditBureau;
  source_guess: 'myfico' | 'experian' | 'equifax' | 'annualcreditreport' | 'other';
  report_date: string | null;
  scores: FicoScores;
  summary: CreditSummary;
  tradelines: ParsedTradeline[];
  inquiries: Array<{
    creditor_name: string;
    inquiry_date: string | null;
    inquiry_type: 'hard' | 'soft' | 'unknown';
  }>;
  parse_status: 'parsed' | 'partial' | 'failed';
  parse_errors: string[];
};

function scoreOk(n: number | null | undefined): n is number {
  return typeof n === 'number' && n >= 300 && n <= 850;
}

function pickScore(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(m[1]);
      if (scoreOk(n)) return n;
    }
  }
  return null;
}

function pickNum(text: string, patterns: RegExp[]): number | null {
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const n = Number(String(m[1]).replace(/,/g, ''));
      if (!Number.isNaN(n)) return n;
    }
  }
  return null;
}

/** Best-effort PDF string harvest without pdf.js. */
export function extractTextFromPdfBuffer(buf: Buffer | Uint8Array): string {
  const latin = Buffer.from(buf).toString('latin1');
  const parts: string[] = [];
  // Parenthesized PDF strings
  const re = /\((?:\\.|[^\\)]){2,200}\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(latin))) {
    const raw = m[0].slice(1, -1);
    const decoded = raw
      .replace(/\\n/g, ' ')
      .replace(/\\r/g, ' ')
      .replace(/\\t/g, ' ')
      .replace(/\\\(/g, '(')
      .replace(/\\\)/g, ')')
      .replace(/\\\\/g, '\\');
    if (/[A-Za-z0-9]/.test(decoded)) parts.push(decoded);
  }
  // Also keep readable ASCII runs
  const ascii = latin.replace(/[^\x20-\x7E\n\r]+/g, ' ');
  return `${parts.join(' ')}\n${ascii}`.slice(0, 500_000);
}

export function guessSource(text: string): ParseResult['source_guess'] {
  const t = text.toLowerCase();
  if (t.includes('myfico') || t.includes('my fico') || t.includes('fair isaac')) {
    return 'myfico';
  }
  if (t.includes('experian') && (t.includes('identityworks') || t.includes('creditworks') || t.includes('experian.com'))) {
    return 'experian';
  }
  if (t.includes('annualcreditreport')) return 'annualcreditreport';
  if (t.includes('equifax')) return 'equifax';
  if (t.includes('experian')) return 'experian';
  return 'other';
}

export function guessBureau(text: string): CreditBureau {
  const t = text.toLowerCase();
  const hasEq = /equifax/.test(t);
  const hasEx = /experian/.test(t);
  const hasTu = /transunion|trans union/.test(t);
  const count = [hasEq, hasEx, hasTu].filter(Boolean).length;
  if (count >= 2 || /3[\s-]?bureau|tri[\s-]?merge|all three/.test(t)) {
    return 'tri_merge';
  }
  if (hasEx && !hasEq && !hasTu) return 'experian';
  if (hasEq && !hasEx && !hasTu) return 'equifax';
  if (hasTu && !hasEq && !hasEx) return 'transunion';
  return 'tri_merge';
}

export function parseCreditReportText(input: {
  text: string;
  preferredSource?: ParseResult['source_guess'];
}): ParseResult {
  const text = input.text.replace(/\u0000/g, ' ');
  const errors: string[] = [];
  const source_guess = input.preferredSource ?? guessSource(text);
  const bureau = guessBureau(text);

  const scores: FicoScores = {
    fico_8: pickScore(text, [
      /fico\s*(?:score\s*)?8[:\s]+(\d{3})/i,
      /fico\s*®?\s*score\s*8[:\s]+(\d{3})/i,
      /score\s*8[:\s]+(\d{3})/i,
    ]),
    fico_10: pickScore(text, [
      /fico\s*(?:score\s*)?10(?:t)?[:\s]+(\d{3})/i,
      /fico\s*®?\s*score\s*10[:\s]+(\d{3})/i,
    ]),
    fico_9: pickScore(text, [/fico\s*(?:score\s*)?9[:\s]+(\d{3})/i]),
    fico_auto_8: pickScore(text, [
      /fico\s*auto\s*(?:score\s*)?8[:\s]+(\d{3})/i,
      /auto\s*(?:score\s*)?8[:\s]+(\d{3})/i,
    ]),
    fico_auto_10: pickScore(text, [
      /fico\s*auto\s*(?:score\s*)?10[:\s]+(\d{3})/i,
      /auto\s*(?:score\s*)?10[:\s]+(\d{3})/i,
    ]),
    fico_bankcard_8: pickScore(text, [
      /fico\s*bank\s*card\s*(?:score\s*)?8[:\s]+(\d{3})/i,
      /bankcard\s*(?:score\s*)?8[:\s]+(\d{3})/i,
    ]),
    fico_bankcard_10: pickScore(text, [
      /fico\s*bank\s*card\s*(?:score\s*)?10[:\s]+(\d{3})/i,
      /bankcard\s*(?:score\s*)?10[:\s]+(\d{3})/i,
    ]),
    equifax_fico_8: pickScore(text, [
      /equifax[\s\S]{0,80}?fico\s*(?:score\s*)?8[:\s]+(\d{3})/i,
      /equifax[:\s]+(\d{3})(?=[\s\S]{0,40}fico\s*8)/i,
    ]),
    experian_fico_8: pickScore(text, [
      /experian[\s\S]{0,80}?fico\s*(?:score\s*)?8[:\s]+(\d{3})/i,
    ]),
    transunion_fico_8: pickScore(text, [
      /trans\s*union[\s\S]{0,80}?fico\s*(?:score\s*)?8[:\s]+(\d{3})/i,
    ]),
    equifax_fico_10: pickScore(text, [
      /equifax[\s\S]{0,80}?fico\s*(?:score\s*)?10[:\s]+(\d{3})/i,
    ]),
    experian_fico_10: pickScore(text, [
      /experian[\s\S]{0,80}?fico\s*(?:score\s*)?10[:\s]+(\d{3})/i,
    ]),
    transunion_fico_10: pickScore(text, [
      /trans\s*union[\s\S]{0,80}?fico\s*(?:score\s*)?10[:\s]+(\d{3})/i,
    ]),
    other: {},
  };

  // Promote per-bureau into primary if primary missing
  if (!scores.fico_8) {
    scores.fico_8 =
      scores.experian_fico_8 ??
      scores.equifax_fico_8 ??
      scores.transunion_fico_8 ??
      null;
  }
  if (!scores.fico_10) {
    scores.fico_10 =
      scores.experian_fico_10 ??
      scores.equifax_fico_10 ??
      scores.transunion_fico_10 ??
      null;
  }

  const summary: CreditSummary = {
    utilization_pct: pickNum(text, [
      /credit\s*utilization[:\s]+(\d{1,3}(?:\.\d+)?)\s*%/i,
      /utilization[:\s]+(\d{1,3}(?:\.\d+)?)\s*%/i,
    ]),
    inquiries_12m: pickNum(text, [
      /inquir(?:y|ies)[^\d]{0,40}(\d{1,2})\s*(?:in\s*)?(?:the\s*)?(?:last\s*)?12/i,
      /hard\s*inquir(?:y|ies)[:\s]+(\d{1,2})/i,
    ]),
    inquiries_24m: pickNum(text, [
      /inquir(?:y|ies)[^\d]{0,40}(\d{1,2})\s*(?:in\s*)?(?:the\s*)?(?:last\s*)?24/i,
    ]),
    collections: pickNum(text, [/collections?[:\s]+(\d{1,2})/i]),
    public_records: pickNum(text, [/public\s*records?[:\s]+(\d{1,2})/i]),
    negative_items_count: pickNum(text, [
      /negative\s*(?:items?|accounts?)[:\s]+(\d{1,2})/i,
      /derogator(?:y|ies)[:\s]+(\d{1,2})/i,
    ]),
    open_accounts: pickNum(text, [/open\s*accounts?[:\s]+(\d{1,3})/i]),
    closed_accounts: pickNum(text, [/closed\s*accounts?[:\s]+(\d{1,3})/i]),
    oldest_account_age_months: pickNum(text, [
      /oldest\s*account[^\d]{0,20}(\d{1,3})\s*months?/i,
    ]),
    avg_account_age_months: pickNum(text, [
      /average\s*(?:account\s*)?age[^\d]{0,20}(\d{1,3})\s*months?/i,
    ]),
  };

  const reportDateMatch =
    /(?:report\s*date|as\s*of|pulled\s*on)[:\s]+(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}|\d{4}-\d{2}-\d{2})/i.exec(
      text,
    );
  let report_date: string | null = null;
  if (reportDateMatch) {
    const raw = reportDateMatch[1];
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) report_date = raw;
    else {
      const parts = raw.split(/[\/\-]/);
      if (parts.length === 3) {
        const [a, b, c] = parts;
        const year = c.length === 2 ? `20${c}` : c;
        const month = a.padStart(2, '0');
        const day = b.padStart(2, '0');
        report_date = `${year}-${month}-${day}`;
      }
    }
  }

  const tradelines: ParsedTradeline[] = [];
  const tlRe =
    /(?:creditor|account)[:\s]+([A-Za-z0-9 &.'-]{3,40})[\s\S]{0,120}?balance[:\s]+\$?([\d,]+)/gi;
  let tl: RegExpExecArray | null;
  let guard = 0;
  while ((tl = tlRe.exec(text)) && guard < 40) {
    guard += 1;
    const chunk = tl[0].toLowerCase();
    tradelines.push({
      creditor_name: tl[1].trim(),
      account_type: /revolving|card/.test(chunk)
        ? 'revolving'
        : /mortgage|auto|installment/.test(chunk)
          ? 'installment'
          : '',
      balance: Number(tl[2].replace(/,/g, '')),
      credit_limit: null,
      is_negative: /collection|charge[\s-]?off|late|derogatory/.test(chunk),
      is_collection: /collection/.test(chunk),
      is_chargeoff: /charge[\s-]?off/.test(chunk),
      status: '',
    });
  }

  const inquiries: ParseResult['inquiries'] = [];
  const inqRe =
    /(?:hard\s*)?inquir(?:y|ies)?[:\s]+([A-Za-z0-9 &.'-]{3,40})[^\n]{0,40}?(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})?/gi;
  let iq: RegExpExecArray | null;
  guard = 0;
  while ((iq = inqRe.exec(text)) && guard < 30) {
    guard += 1;
    inquiries.push({
      creditor_name: iq[1].trim(),
      inquiry_date: iq[2] ?? null,
      inquiry_type: /soft/i.test(iq[0]) ? 'soft' : 'hard',
    });
  }

  if (!scores.fico_8 && !scores.fico_10) {
    errors.push('No FICO 8 or FICO 10 score detected — check PDF text or paste summary');
  }

  const hasCore = Boolean(scores.fico_8 || scores.fico_10);
  const parse_status: ParseResult['parse_status'] = hasCore
    ? errors.length
      ? 'partial'
      : 'parsed'
    : 'failed';

  return {
    bureau,
    source_guess,
    report_date,
    scores,
    summary,
    tradelines,
    inquiries,
    parse_status,
    parse_errors: errors,
  };
}

export function daysSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.floor((Date.now() - t) / (24 * 60 * 60 * 1000));
}

export function isStale(
  pulledAt: string | null | undefined,
  thresholdDays = 45,
): boolean {
  const d = daysSince(pulledAt);
  return d !== null && d > thresholdDays;
}

export function primaryFico8(scores: FicoScores): number | null {
  return (
    scores.fico_8 ??
    scores.experian_fico_8 ??
    scores.equifax_fico_8 ??
    scores.transunion_fico_8 ??
    null
  );
}

export function primaryFico10(scores: FicoScores): number | null {
  return (
    scores.fico_10 ??
    scores.experian_fico_10 ??
    scores.equifax_fico_10 ??
    scores.transunion_fico_10 ??
    null
  );
}
