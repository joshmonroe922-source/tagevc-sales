import { NextResponse } from 'next/server';
import {
  buildIesAuthorizeUrl,
  createIesOAuthState,
} from '@/lib/ies/oauth';
import { getIesConfig } from '@/lib/ies/config';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';
import { canAccessEntityId } from '@/lib/rbac/entity-scope';

export async function GET(request: Request) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    return NextResponse.json(
      { ok: false, error: gate.error },
      { status: 403 },
    );
  }

  const cfg = getIesConfig();
  if (!cfg.configured) {
    return NextResponse.json(
      {
        ok: false,
        error: `IES not configured. Missing: ${cfg.missing.join(', ')}`,
        missing: cfg.missing,
      },
      { status: 503 },
    );
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get('entity')?.trim() || null;
  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) {
    return NextResponse.json(
      { ok: false, error: 'Session required' },
      { status: 401 },
    );
  }

  if (
    entityId &&
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

  const state = await createIesOAuthState({
    entity_id: entityId,
    actor_id: ctx.profile.id,
    purpose: 'connect',
  });
  if (!state.ok) {
    return NextResponse.json(
      { ok: false, error: state.error },
      { status: 500 },
    );
  }

  const authorizeUrl = buildIesAuthorizeUrl(state.state);
  if (!authorizeUrl) {
    return NextResponse.json(
      { ok: false, error: 'Could not build Intuit authorize URL' },
      { status: 503 },
    );
  }

  return NextResponse.redirect(authorizeUrl);
}
