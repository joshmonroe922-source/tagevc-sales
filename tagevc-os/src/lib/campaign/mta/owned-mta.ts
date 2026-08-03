import { sendPlatformEmail } from '@/lib/platform-email/send';
export type MtaSubmitInput = {
  entityId: string; to: string; replyTo: string; subject: string; html: string;
  idempotencyKey: string; userAccessToken?: string | null; sentByProfileId?: string | null;
  campaignId?: string | null; plane: 'owned_mta' | 'controlled_graph';
};
export async function submitOwnedMta(input: MtaSubmitInput) {
  if (input.plane === 'owned_mta' && process.env.POSTAL_API_URL && process.env.POSTAL_API_KEY) {
    const res = await fetch(`${process.env.POSTAL_API_URL.replace(/\/$/, '')}/api/v1/send/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Server-API-Key': process.env.POSTAL_API_KEY },
      body: JSON.stringify({ to: [input.to], reply_to: input.replyTo, subject: input.subject, html_body: input.html, tag: input.idempotencyKey }),
    });
    if (!res.ok) return { ok: false as const, error: `postal ${res.status}` };
    const body = await res.json().catch(() => ({})) as { data?: { message_id?: string } };
    return { ok: true as const, provider: 'owned_mta' as const, providerMessageId: body.data?.message_id || input.idempotencyKey };
  }
  if (!input.userAccessToken) return { ok: false as const, error: 'userAccessToken required for controlled_graph bulk' };
  const result = await sendPlatformEmail({
    channel: 'bulk', entityId: input.entityId, to: [input.to], subject: input.subject, bodyHtml: input.html,
    userAccessToken: input.userAccessToken, replyTo: input.replyTo, track: true, source: 'ecc_campaign',
    sentByProfileId: input.sentByProfileId, campaignId: input.campaignId, activityModule: 'shared_services',
    tags: { ecc: true, plane: 'controlled_graph', idempotency_key: input.idempotencyKey },
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  return { ok: true as const, provider: 'controlled_graph' as const, providerMessageId: result.messageId, trackingToken: result.trackingToken };
}
export function resolveDeliveryPlane(input: { plane: string; sequenceType?: string; hasOwner?: boolean }) {
  if (input.plane === 'owned_mta' || input.plane === 'graph' || input.plane === 'controlled_graph') return input.plane;
  if (input.sequenceType === 'sequence' && input.hasOwner) return 'graph';
  return 'controlled_graph';
}
