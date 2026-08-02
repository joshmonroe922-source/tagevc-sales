/**
 * Bulk tracked send — Reply-To = user; From = user mailbox (delegated Graph).
 */

import { sendPlatformEmail } from '@/lib/platform-email/send';

export type BulkComposeRecipient = {
  email: string;
  name?: string;
  refType?: string;
  refId?: string;
};

export async function sendBulkTrackedEmail(input: {
  entityId: string;
  subject: string;
  bodyHtml?: string;
  bodyText?: string;
  recipients: BulkComposeRecipient[];
  userAccessToken: string;
  replyTo: string;
  sentByProfileId?: string | null;
  campaignId?: string | null;
}): Promise<{
  sent: number;
  failed: Array<{ email: string; error: string }>;
}> {
  const failed: Array<{ email: string; error: string }> = [];
  let sent = 0;

  for (const r of input.recipients) {
    const email = r.email.trim();
    if (!email.includes('@')) {
      failed.push({ email: r.email, error: 'invalid_email' });
      continue;
    }
    const result = await sendPlatformEmail({
      channel: 'bulk',
      entityId: input.entityId,
      to: [email],
      subject: input.subject,
      bodyHtml: input.bodyHtml,
      bodyText: input.bodyText,
      userAccessToken: input.userAccessToken,
      replyTo: input.replyTo,
      track: true,
      source: 'bulk',
      sentByProfileId: input.sentByProfileId ?? null,
      campaignId: input.campaignId ?? null,
      refType: r.refType ?? null,
      refId: r.refId ?? null,
      activityModule: 'shared_services',
      tags: { bulk: true, recipient_name: r.name || null },
    });
    if (result.ok) sent += 1;
    else failed.push({ email, error: result.error });
  }

  return { sent, failed };
}
