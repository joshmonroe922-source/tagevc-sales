/**
 * Send W-9 request via platform email orchestrator (system / shared w9 mailbox).
 */

import { sendPlatformEmail } from '@/lib/platform-email/send';
import { aliasAddressFor } from '@/lib/platform-email/m365-aliases';
import { buildW9RequestEmail } from '@/lib/af/ap/w9-campaign';
import type { EntityCode } from '@/lib/af/types';

const ENTITY_LABEL: Record<string, string> = {
  TAGE: 'Tage Venture Capital',
  R619: 'Recruit 619',
  SIGNENT: 'Signent HR',
  INDA: 'Instant NDA',
  MULTI: 'Tage Venture Capital',
};

function entityIdFromCode(code: EntityCode | 'MULTI' | string): string {
  switch (code) {
    case 'R619':
      return 'ENT-R619';
    case 'SIGNENT':
      return 'ENT-SIGNENT';
    case 'INDA':
      return 'ENT-INDA';
    default:
      return 'ENT-FIRM';
  }
}

export async function sendW9RequestEmail(input: {
  vendorName: string;
  vendorEmail: string;
  taxYear: number;
  entityCode: EntityCode | 'MULTI' | string;
  apVendorId?: string | null;
  sentByProfileId?: string | null;
}): Promise<{ ok: true; messageId: string } | { ok: false; error: string }> {
  const to = input.vendorEmail.trim();
  if (!to || !to.includes('@')) {
    return { ok: false, error: 'vendor email required' };
  }
  const entityId = entityIdFromCode(input.entityCode);
  const label =
    ENTITY_LABEL[input.entityCode] || ENTITY_LABEL.TAGE;
  const fromUpn = aliasAddressFor('w9');
  const mail = buildW9RequestEmail({
    vendorName: input.vendorName,
    taxYear: input.taxYear,
    entityLabel: label,
    replyToInbox: fromUpn,
  });

  const result = await sendPlatformEmail({
    channel: 'system',
    entityId,
    to: [to],
    subject: mail.subject,
    bodyText: mail.body,
    sharedRole: 'w9',
    fromAddress: fromUpn,
    track: true,
    source: 'w9',
    sentByProfileId: input.sentByProfileId ?? null,
    refType: 'ap_vendor',
    refId: input.apVendorId ?? null,
    activityModule: 'shared_services',
    tags: {
      workflow: 'w9_request',
      tax_year: input.taxYear,
      entity_code: input.entityCode,
    },
  });

  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true, messageId: result.messageId };
}
