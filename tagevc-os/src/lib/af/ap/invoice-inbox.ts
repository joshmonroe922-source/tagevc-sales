/**
 * Entity-specific AP invoice inbox seams (D05).
 * Josh creates DNS/mailboxes; we parse inbound webhooks only.
 */

import type { EntityCode } from '@/lib/af/types';

export type InvoiceInboxAlias = {
  entityCode: EntityCode;
  /** Suggested local-part / address — not provisioned by us */
  suggestedAddress: string;
  parseHint: string;
};

export const ENTITY_INVOICE_INBOXES: InvoiceInboxAlias[] = [
  {
    entityCode: 'TVC',
    suggestedAddress: 'ap+tvc@tagevc.com',
    parseHint: 'Plus-tag tvc → ENT-FIRM / TVC',
  },
  {
    entityCode: 'R619',
    suggestedAddress: 'ap+r619@tagevc.com',
    parseHint: 'Plus-tag r619 → ENT-R619',
  },
  {
    entityCode: 'SHR',
    suggestedAddress: 'ap+signent@tagevc.com',
    parseHint: 'Plus-tag signent → ENT-SIGNENT / SHR',
  },
  {
    entityCode: 'INDA',
    suggestedAddress: 'ap+inda@tagevc.com',
    parseHint: 'Plus-tag inda → ENT-INDA',
  },
];

const TAG_MAP: Record<string, EntityCode> = {
  tvc: 'TVC',
  firm: 'TVC',
  r619: 'R619',
  recruit: 'R619',
  signent: 'SHR',
  shr: 'SHR',
  inda: 'INDA',
};

/** Parse entity from inbound To: address (ap+{tag}@… or invoices@entity domain). */
export function resolveEntityFromInvoiceAddress(
  toAddress: string,
): EntityCode | null {
  const raw = toAddress.trim().toLowerCase();
  const plus = raw.match(/^[^@]*\+([a-z0-9]+)@/);
  if (plus?.[1] && TAG_MAP[plus[1]]) return TAG_MAP[plus[1]];

  if (raw.includes('@recruit619.')) return 'R619';
  if (raw.includes('@signenthr.')) return 'SHR';
  if (raw.includes('@instantnda.')) return 'INDA';
  if (raw.includes('@tagevc.')) return 'TVC';
  return null;
}

export function apInboundConfigured(): boolean {
  return Boolean(process.env.AP_INBOUND_WEBHOOK_SECRET?.trim());
}
