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

/** Dialpad signs webhook bodies as HS256 JWT when a secret is configured. */
function verifyHs256Jwt(token: string, secret: string): boolean {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, sigB64] = parts;
  try {
    const headerJson = Buffer.from(headerB64, 'base64url').toString('utf8');
    const header = JSON.parse(headerJson) as { alg?: string };
    if (header.alg && header.alg !== 'HS256') return false;
    const expected = createHmac('sha256', secret)
      .update(`${headerB64}.${payloadB64}`)
      .digest('base64url');
    const a = Buffer.from(sigB64);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function decodeHs256JwtPayload(
  token: string,
): Record<string, unknown> | null {
  const parts = token.trim().split('.');
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(json) as unknown;
    return payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
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
  // Dialpad event subscriptions POST a JWT body (no custom signature header).
  if (secretEnv === 'DIALPAD_WEBHOOK_SECRET' && verifyHs256Jwt(body, secret)) {
    return true;
  }
  return false;
}

const SECRET_ENV: Partial<Record<PartnerKey, string>> = {
  dialpad: 'DIALPAD_WEBHOOK_SECRET',
  mybasepay: 'MYBASEPAY_WEBHOOK_SECRET',
  gusto: 'GUSTO_WEBHOOK_SECRET',
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
  if (
    key === 'dialpad' &&
    secretEnv &&
    process.env[secretEnv]?.trim() &&
    verifyHs256Jwt(bodyText, process.env[secretEnv]!.trim())
  ) {
    payload = decodeHs256JwtPayload(bodyText) ?? {
      raw: bodyText.slice(0, 2000),
    };
  } else {
    try {
      payload = bodyText ? (JSON.parse(bodyText) as Record<string, unknown>) : {};
    } catch {
      payload = { raw: bodyText.slice(0, 2000) };
    }
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

  if (key === 'dialpad' && !entityId) {
    const target =
      payload.target && typeof payload.target === 'object'
        ? (payload.target as Record<string, unknown>)
        : null;
    const officeId = target?.office_id ?? payload.office_id;
    const office = officeId != null ? String(officeId) : '';
    // Office bindings: ENT-R619 = 5109894981558272 (see docs/DIALPAD_MULTI_ENTITY.md)
    if (office === '5109894981558272') entityId = 'ENT-R619';
    else if (office === '5312888585003008') entityId = 'ENT-FIRM';
    else if (office === '4968987070242816') entityId = 'ENT-SIGNENT';
    else if (office === '5633477826781184') entityId = 'ENT-INDA';
  }

  const externalId =
    typeof payload.id === 'string'
      ? payload.id
      : typeof payload.call_id === 'string'
        ? payload.call_id
        : typeof payload.call_id === 'number'
          ? String(payload.call_id)
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

  let dialpadFanout: {
    attempted: boolean;
    ok?: boolean;
    status?: number;
    reason?: string;
    error?: string;
  } | null = null;

  if (key === 'dialpad') {
    const { fanoutDialpadToRecruit619 } = await import(
      '@/lib/partners/dialpad-fanout'
    );
    const result = await fanoutDialpadToRecruit619(payload);
    dialpadFanout =
      result.attempted === false
        ? { attempted: false, reason: result.reason }
        : {
            attempted: true,
            ok: result.ok,
            status: result.status,
            error: result.error,
          };
  }

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
      : key === 'dialpad'
        ? {
            fanout_r619: dialpadFanout,
            note:
              'Event recorded. R619 hybrid CRM ingest via portal fan-out when DIALPAD_LIVE=1.',
          }
        : {
            note: 'Event recorded. Live handlers wire when *_LIVE=1 and vendor credentials are set.',
          }),
  });
}
