import { NextResponse } from 'next/server';
import {
  exchangeOAuthCode,
  isOAuthPlatform,
  persistOAuthTokens,
} from '@/lib/shared-services/marketing-oauth';
import { createPersistClient } from '@/lib/supabase/persist-client';
import { captureException } from '@/lib/observability';

export async function GET(
  request: Request,
  ctx: { params: Promise<{ platform: string }> },
) {
  const { platform: raw } = await ctx.params;
  if (!isOAuthPlatform(raw)) {
    return NextResponse.json({ error: 'Unsupported platform' }, { status: 400 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  const app =
    process.env.NEXT_PUBLIC_APP_URL?.trim() || 'https://app.tagevc.com';
  const dest = new URL('/shared-services/marketing', app);

  if (err) {
    dest.searchParams.set('oauth', 'error');
    dest.searchParams.set('detail', err);
    return NextResponse.redirect(dest.toString());
  }

  if (!code || !state) {
    dest.searchParams.set('oauth', 'error');
    dest.searchParams.set('detail', 'missing_code');
    return NextResponse.redirect(dest.toString());
  }

  try {
    let accountId = '';
    try {
      const parsed = JSON.parse(
        Buffer.from(state, 'base64url').toString('utf8'),
      ) as { account_id?: string };
      accountId = parsed.account_id ?? '';
    } catch {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', 'bad_state');
      return NextResponse.redirect(dest.toString());
    }

    const token = await exchangeOAuthCode(raw, code);
    if (!token.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', token.error);
      return NextResponse.redirect(dest.toString());
    }

    const sb = await createPersistClient();
    const { data: acct } = await sb
      .from('os_marketing_social_accounts')
      .select('entity_id')
      .eq('account_id', accountId)
      .maybeSingle();

    const saved = await persistOAuthTokens({
      account_id: accountId,
      platform: raw,
      entity_id: (acct as { entity_id?: string } | null)?.entity_id ?? null,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
    });

    if (!saved.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', saved.error);
      return NextResponse.redirect(dest.toString());
    }

    dest.searchParams.set('oauth', 'connected');
    dest.searchParams.set('account_id', accountId);
    return NextResponse.redirect(dest.toString());
  } catch (e) {
    captureException(e, { route: 'marketing/oauth/callback' });
    dest.searchParams.set('oauth', 'error');
    dest.searchParams.set('detail', 'exception');
    return NextResponse.redirect(dest.toString());
  }
}
