import { NextResponse } from 'next/server';
import {
  buildAuthorizeUrl,
  isOAuthPlatform,
  stubConnectAccount,
} from '@/lib/shared-services/marketing-oauth';
import { guardPermission } from '@/lib/rbac/session';

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

  const state = Buffer.from(
    JSON.stringify({ account_id: accountId, platform: raw, t: Date.now() }),
  ).toString('base64url');

  const authorize = buildAuthorizeUrl(raw, state);
  if (authorize) {
    return NextResponse.redirect(authorize);
  }

  // Stub path when OAuth apps not configured
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
