import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  createOAuthState,
  isOAuthPlatform,
  stubConnectAccount,
} from '@/lib/shared-services/marketing-oauth';
import { guardPermission } from '@/lib/rbac/session';
import {
  canAccessEntityId,
  entityScopeDeniedMessage,
} from '@/lib/rbac/entity-scope';
import { createPersistClient } from '@/lib/supabase/persist-client';

/**
 * Start OAuth for LinkedIn/X, or stub-connect when credentials missing.
 * Query: account_id=MSA-…
 */
export async function GET(
  request: Request,
  ctx: { params: Promise<{ platform: string }> },
) {
  const gate = await guardPermission('write:marketing');
  if (!gate.ok) {
    return NextResponse.json({ error: gate.error }, { status: 403 });
  }

  const { platform: raw } = await ctx.params;
  if (!isOAuthPlatform(raw)) {
    return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
  }

  const url = new URL(request.url);
  const accountId = url.searchParams.get('account_id')?.trim();
  if (!accountId) {
    return NextResponse.json({ error: 'account_id required' }, { status: 400 });
  }

  const sb = await createPersistClient();
  const { data: account, error: accountError } = await sb
    .from('os_marketing_social_accounts')
    .select('account_id, entity_id, platform, account_type')
    .eq('account_id', accountId)
    .maybeSingle();
  if (accountError || !account) {
    return NextResponse.json(
      { error: accountError?.message || 'Account not found' },
      { status: 404 },
    );
  }
  if (account.platform !== raw) {
    return NextResponse.json(
      { error: 'Account platform does not match OAuth route' },
      { status: 400 },
    );
  }
  const entityId = (account.entity_id as string) ?? null;
  if (
    !canAccessEntityId(
      gate.profile.role,
      gate.profile.entity_id,
      entityId,
    )
  ) {
    return NextResponse.json(
      { error: entityScopeDeniedMessage(entityId || 'firm-wide') },
      { status: 403 },
    );
  }
  const purpose =
    account.account_type === 'paid_ads' ? 'paid_ads' : 'publisher';
  const stateResult = await createOAuthState({
    account_id: accountId,
    platform: raw,
    purpose,
    entity_id: entityId,
    actor_id: gate.profile.id,
  });
  if (!stateResult.ok) {
    return NextResponse.json({ error: stateResult.error }, { status: 500 });
  }

  const authorize = buildAuthorizeUrl(raw, stateResult.state, purpose);
  if (authorize) {
    return NextResponse.redirect(authorize);
  }

  const allowStub =
    process.env.MARKETING_ALLOW_STUB_OAUTH === '1' ||
    process.env.MARKETING_ALLOW_STUB_OAUTH === 'true';
  if (!allowStub) {
    return NextResponse.json(
      { error: 'OAuth app is not configured for this platform' },
      { status: 503 },
    );
  }
  // Explicit development/demo stub path only.
  const stub = await stubConnectAccount(accountId);
  if (!stub.ok) {
    return NextResponse.json({ error: stub.error }, { status: 500 });
  }

  const app =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.tagevc.com';
  const dest = new URL('/shared-services/marketing', app);
  dest.searchParams.set('oauth', 'stub');
  dest.searchParams.set('account_id', accountId);
  return NextResponse.redirect(dest.toString());
}
