/**
 * POST { entity_id } — inherit partner spine + marketing presence +
 * Vendor Management (Phase 90) for an entity.
 * Returns honest status: scaffold ≠ live-ready.
 */

import { NextResponse } from 'next/server';
import { provisionPartnerSpineForEntity } from '@/lib/partners/entity-provision';
import { getSessionContext } from '@/lib/rbac/session';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  const secret = process.env.TAGE_PARTNER_PROVISION_SECRET?.trim();
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let authorized = Boolean(secret && bearer && bearer === secret);

  if (!authorized) {
    const ctx = await getSessionContext();
    if (
      ctx &&
      isFirmWideAccess(
        ctx.profile.role,
        ctx.profile.entity_id,
        ctx.activeEntityOs,
      )
    ) {
      authorized = true;
    }
  }

  if (!authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as {
    entity_id?: string;
  } | null;
  const entityId = body?.entity_id?.trim();
  if (!entityId) {
    return NextResponse.json({ error: 'entity_id required' }, { status: 400 });
  }

  const result = await provisionPartnerSpineForEntity(entityId);
  const http =
    result.status === 'failed' ? 502 : result.ok ? 200 : 202; // 202 Accepted = partial scaffold
  return NextResponse.json(result, { status: http });
}
