/**
 * W-9 request + annual AP campaign seams (D05).
 */

import type { EntityCode } from '@/lib/af/types';

export type W9YearStatus =
  | 'outstanding'
  | 'requested'
  | 'received'
  | 'ai_exception'
  | 'complete'
  | 'waived';

export type W9CampaignRow = {
  apVendorId: string;
  vendorName: string;
  entityCode: EntityCode | 'MULTI';
  taxYear: number;
  status: W9YearStatus;
  email: string;
  lastReminderAt: string | null;
  reminderCount: number;
};

export function currentTaxYear(now = new Date()): number {
  return now.getFullYear();
}

/** Prefill email body for vendor W-9 request (button / bulk / reminder). */
export function buildW9RequestEmail(input: {
  vendorName: string;
  taxYear: number;
  entityLabel: string;
  replyToInbox: string;
}): { subject: string; body: string } {
  return {
    subject: `W-9 request for ${input.taxYear} — ${input.entityLabel}`,
    body: [
      `Hello ${input.vendorName},`,
      '',
      `Please send your completed IRS Form W-9 for tax year ${input.taxYear} so we can keep your vendor record current for ${input.entityLabel}.`,
      '',
      `Reply to this email with the PDF attached (or upload via the vendor portal if you have access).`,
      `Preferred return address: ${input.replyToInbox}`,
      '',
      'Thank you,',
      `${input.entityLabel} Accounts Payable`,
    ].join('\n'),
  };
}

/**
 * Lightweight AI review seam — checks filename / metadata year hints.
 * Full PDF OCR comes later; exceptions go to AP.
 */
export function reviewW9DocumentYear(input: {
  taxYear: number;
  fileName?: string | null;
  extractedTextHint?: string | null;
}): {
  ok: boolean;
  status: 'complete' | 'ai_exception';
  note: string;
} {
  const hay = `${input.fileName ?? ''} ${input.extractedTextHint ?? ''}`;
  const yearStr = String(input.taxYear);
  const otherYear = hay.match(/\b(20\d{2})\b/);
  if (hay.includes(yearStr)) {
    return {
      ok: true,
      status: 'complete',
      note: `AI seam: detected ${yearStr} in document metadata/name`,
    };
  }
  if (otherYear && otherYear[1] !== yearStr) {
    return {
      ok: false,
      status: 'ai_exception',
      note: `AI seam: document appears to reference ${otherYear[1]}, expected ${yearStr} — AP must confirm with vendor`,
    };
  }
  return {
    ok: false,
    status: 'ai_exception',
    note: `AI seam: could not confirm tax year ${yearStr} — AP review required`,
  };
}

export function filterOutstandingW9(
  rows: W9CampaignRow[],
): W9CampaignRow[] {
  return rows.filter((r) =>
    ['outstanding', 'requested', 'received', 'ai_exception'].includes(r.status),
  );
}

export const W9_REMINDER_CADENCE_DAYS = 7;
