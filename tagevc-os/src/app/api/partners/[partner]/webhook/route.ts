/**
 * Generic partner webhook intake — records os_partner_events.
 * Fail-closed: unknown partners 404; signature checks when secrets present.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { PARTNER_CATALOG, type PartnerKey } from '@/lib/partners/catalog';
import { recordPartnerEvent } from '@/lib/partners/repo';

export const runtime = 'nodejs';

function partnerKeys(): Set<string> {
  return new Set(PARTNER_CATALOG.map((p) => p.key));
}

function verifySharedSecret(
  req: Request,
  body: string,
  secretEnv: string,
): boolean {
  const secret = process.env[secretEnv]?.trim();
  if (!secret) return true; // scaffold: accept when secret not set (local)
  const header =
    req.headers.get('x-tagevc-webhook-secret') ||
    req.headers.get('x-partner-signature') ||
    '';
  if (header === secret) return true;
  if (header.startsWith('sha256=')) {
    const expected = createHmac('sha256', secret).update(body).digest('hex');
    const got = header.slice('sha256='.length);
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(got));
    } catch {
      return false;
    }
  }
  return false;
}

const SECRET_ENV: Partial<Record<PartnerKey, string>> = {
  dialpad: 'DIALPAD_WEBHOOK_SECRET',
  mybasepay: 'MYBASEPAY_WEBHOOK_SECRET',
  gusto: 'GUSTO_WEBHOOK_SECRET',
  appcast: 'APPCAST_WEBHOOK_SECRET',
  verified_first: 'VERIFIED_FIRST_WEBHOOK_SECRET',
};

export async function POST(
  req: Request,
  ctx: { params: Promise<{ partner: string }> },
) {
  const { partner } = await ctx.params;
  const key = partner.trim().toLowerCase();
  if (!partnerKeys().has(key)) {
    return NextResponse.json({ error: 'Unknown partner' }, { status: 404 });
  }

  // Verified First has a dedicated route — redirect callers.
  if (key === 'verified_first') {
    return NextResponse.json(
      {
        error: 'Use /api/screening/verified-first/webhook',
      },
      { status: 308 },
    );
  }
  if (key === 'docusign') {
    return NextResponse.json(
      { error: 'Use /api/docusign/connect' },
      { status: 308 },
    );
  }

  const bodyText = await req.text();
  const secretEnv = SECRET_ENV[key as PartnerKey];
  if (secretEnv && !verifySharedSecret(req, bodyText, secretEnv)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
  } catch {
    payload = { raw: bodyText.slice(0, 2000) };
  }

  let entityId =
    typeof payload.entity_id === 'string' ? payload.entity_id : null;
  let gustoCompanyUuid: string | null = null;

  if (key === 'gusto' && !entityId) {
    const {
      extractGustoCompanyUuidFromPayload,
      resolveEntityIdFromGustoCompanyUuid,
    } = await import('@/lib/partners/gusto-entity');
    gustoCompanyUuid = extractGustoCompanyUuidFromPayload(payload);
    if (gustoCompanyUuid) {
      entityId = await resolveEntityIdFromGustoCompanyUuid(gustoCompanyUuid);
    }
  }

  const externalId =
    typeof payload.id === 'string'
      ? payload.id
      : typeof payload.external_id === 'string'
        ? payload.external_id
        : null;

  await recordPartnerEvent({
    partner_key: key as PartnerKey,
    entity_id: entityId,
    kind: 'webhook',
    status: 'received',
    external_id: externalId,
    payload: {
      ...payload,
      ...(gustoCompanyUuid
        ? { _resolved_gusto_company_uuid: gustoCompanyUuid }
        : {}),
      ...(key === 'gusto' && gustoCompanyUuid && !entityId
        ? { _gusto_entity_unmapped: true }
        : {}),
    },
  });

  return NextResponse.json({
    ok: true,
    partner: key,
    entity_id: entityId,
    ...(key === 'gusto'
      ? {
          company_uuid: gustoCompanyUuid,
          note: entityId
            ? 'Event recorded with entity mapped from Gusto company UUID.'
            : gustoCompanyUuid
              ? 'Event recorded; company UUID not bound to an OS entity (ignored for routing).'
              : 'Event recorded. Live handlers wire when GUSTO_LIVE=1 and per-entity credentials are set.',
        }
      : {
          note: 'Event recorded. Live handlers wire when *_LIVE=1 and vendor credentials are set.',
        }),
  });
}
