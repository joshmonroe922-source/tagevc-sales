import { NextResponse } from 'next/server';
import {
  buildGustoAuthorizeUrl,
  createGustoOAuthState,
  getGustoOAuthConfig,
} from '@/lib/partners/gusto-oauth';
import { canonicalizeGustoEntityId } from '@/lib/partners/gusto-entity';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';
import { canAccessEntityId } from '@/lib/rbac/entity-scope';

export const runtime = 'nodejs';

/**
 * Start Gusto OAuth for an entity (default ENT-R619).
 * GET /api/partners/gusto/oauth?entity=ENT-R619
 */
export async function GET(request: Request) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: 403 },
    );
  }

  const cfg = getGustoOAuthConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: `Gusto OAuth not configured. Missing: ${cfg.missing.join(', ')}`,
        missing: cfg.missing,
        stage: cfg.stage,
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const entityRaw = url.searchParams.get('entity')?.trim() || 'ENT-R619';
  const entityId = canonicalizeGustoEntityId(entityRaw);
  if (!entityId) {
    return NextResponse.json(
      { ok: false, error: 'Unknown Gusto entity' },
      { status: 400 },
    );
  }

  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) {
    return NextResponse.json(
      { ok: false, error: 'Session required' },
      { status: 401 },
    );
  }

  if (
    !canAccessEntityId(
      ctx.profile.role,
      ctx.profile.entity_id,
      entityId,
    )
  ) {
    return NextResponse.json(
      { ok: false, error: 'Entity access denied' },
      { status: 403 },
    );
  }

  const state = await createGustoOAuthState({
    entity_id: entityId,
    actor_id: ctx.profile.id,
  });
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.error },
      { status: 500 },
    );
  }

  const authorizeUrl = buildGustoAuthorizeUrl(state.state);
  if (!authorizeUrl) {
    return NextResponse.json(
      { ok: false, error: 'Could not build Gusto authorize URL' },
      { status: 503 },
    );
  }

  return NextResponse.redirect(authorizeUrl);
}
