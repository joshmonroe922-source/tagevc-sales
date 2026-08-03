import { sendPlatformEmail } from '@/lib/platform-email/send';

export type MtaSubmitInput = {
  entityId: string;
  to: string;
  replyTo: string;
  subject: string;
  html: string;
  idempotencyKey: string;
  userAccessToken?: string | null;
  sentByProfileId?: string | null;
  campaignId?: string | null;
  plane: 'owned_mta' | 'controlled_graph';
};

/** Orchestrator-shaped Postal / owned MTA adapter. */
export type OwnedMtaAdapter = {
  submit: (input: {
    idempotencyKey: string;
    entityId: string;
    from: { name: string; email: string };
    replyTo?: string | null;
    envelopeTo: string[];
    subject: string;
    html: string;
    headers?: Record<string, string>;
  }) => Promise<
    | { ok: true; providerMessageId: string }
    | { ok: false; error: string }
  >;
};

export function postalConfigured(): boolean {
  return Boolean(
    (process.env.ECC_POSTAL_API_URL || process.env.POSTAL_API_URL) &&
      (process.env.ECC_POSTAL_API_KEY || process.env.POSTAL_API_KEY),
  );
}

export function getOwnedMtaAdapter(): OwnedMtaAdapter {
  const base = (
    process.env.ECC_POSTAL_API_URL ||
    process.env.POSTAL_API_URL ||
    ''
  ).replace(/\/$/, '');
  const key =
    process.env.ECC_POSTAL_API_KEY || process.env.POSTAL_API_KEY || '';

  return {
    async submit(input) {
      if (!base || !key) {
        return {
          ok: false,
          error:
            'Postal not configured — set ECC_POSTAL_API_URL + ECC_POSTAL_API_KEY (or POSTAL_*)',
        };
      }
      const res = await fetch(`${base}/api/v1/send/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Server-API-Key': key,
        },
        body: JSON.stringify({
          to: input.envelopeTo,
          from: `${input.from.name} <${input.from.email}>`,
          reply_to: input.replyTo || undefined,
          subject: input.subject,
          html_body: input.html,
          tag: input.idempotencyKey,
          headers: input.headers
            ? Object.entries(input.headers).map(([name, value]) => ({
                name,
                value,
              }))
            : undefined,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        return { ok: false, error: `postal ${res.status}: ${text.slice(0, 200)}` };
      }
      const body = (await res.json().catch(() => ({}))) as {
        data?: { message_id?: string };
      };
      return {
        ok: true,
        providerMessageId: body.data?.message_id || input.idempotencyKey,
      };
    },
  };
}

export async function submitOwnedMta(input: MtaSubmitInput) {
  if (input.plane === 'owned_mta' && postalConfigured()) {
    const mta = getOwnedMtaAdapter();
    const result = await mta.submit({
      idempotencyKey: input.idempotencyKey,
      entityId: input.entityId,
      from: { name: 'Campaigns', email: `news@mail.${input.entityId.toLowerCase()}.local` },
      replyTo: input.replyTo,
      envelopeTo: [input.to],
      subject: input.subject,
      html: input.html,
    });
    if (!result.ok) return { ok: false as const, error: result.error };
    return {
      ok: true as const,
      provider: 'owned_mta' as const,
      providerMessageId: result.providerMessageId,
    };
  }
  if (!input.userAccessToken) {
    return {
      ok: false as const,
      error: 'userAccessToken required for controlled_graph bulk',
    };
  }
  const result = await sendPlatformEmail({
    channel: 'bulk',
    entityId: input.entityId,
    to: [input.to],
    subject: input.subject,
    bodyHtml: input.html,
    userAccessToken: input.userAccessToken,
    replyTo: input.replyTo,
    track: true,
    source: 'ecc_campaign',
    sentByProfileId: input.sentByProfileId,
    campaignId: input.campaignId,
    activityModule: 'shared_services',
    tags: {
      ecc: true,
      plane: 'controlled_graph',
      idempotency_key: input.idempotencyKey,
    },
  });
  if (!result.ok) return { ok: false as const, error: result.error };
  return {
    ok: true as const,
    provider: 'controlled_graph' as const,
    providerMessageId: result.messageId,
    trackingToken: result.trackingToken,
  };
}

export function resolveDeliveryPlane(input: {
  plane: string;
  sequenceType?: string;
  hasOwner?: boolean;
}) {
  if (
    input.plane === 'owned_mta' ||
    input.plane === 'graph' ||
    input.plane === 'controlled_graph'
  ) {
    return input.plane;
  }
  if (input.sequenceType === 'sequence' && input.hasOwner) return 'graph';
  return 'controlled_graph';
}
