import { NextResponse } from 'next/server';
import {
  exchangeOAuthCode,
  consumeOAuthState,
  isOAuthPlatform,
  persistOAuthTokens,
  verifyOAuthConnection,
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
    const stateResult = await consumeOAuthState(state, raw);
    if (!stateResult.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', stateResult.error);
      return NextResponse.redirect(dest.toString());
    }
    const accountId = stateResult.account_id;

    const token = await exchangeOAuthCode(raw, code);
    if (!token.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', token.error);
      return NextResponse.redirect(dest.toString());
    }

    const sb = await createPersistClient();
    const { data: acct } = await sb
      .from('os_marketing_social_accounts')
      .select('entity_id, platform, account_type, external_account_id')
      .eq('account_id', accountId)
      .maybeSingle();
    if (
      !acct ||
      acct.platform !== raw ||
      (acct.account_type === 'paid_ads' ? 'paid_ads' : 'publisher') !==
        stateResult.purpose ||
      ((acct.entity_id as string) ?? null) !== stateResult.entity_id
    ) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', 'account_binding_changed');
      return NextResponse.redirect(dest.toString());
    }
    const verified =
      stateResult.purpose === 'paid_ads'
        ? {
            ok: true as const,
            externalAccountId: null,
            currency: null,
            timezone: null,
            capabilities: {
              purpose: 'paid_ads',
              grant_verified: true,
              account_selection_required: true,
            },
          }
        : await verifyOAuthConnection({
            platform: raw,
            purpose: stateResult.purpose,
            accessToken: token.accessToken,
            requestedExternalId:
              (acct.external_account_id as string | null) ?? null,
          });
    if (!verified.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', verified.error);
      return NextResponse.redirect(dest.toString());
    }

    const saved = await persistOAuthTokens({
      account_id: accountId,
      platform: raw,
      entity_id: stateResult.entity_id,
      accessToken: token.accessToken,
      refreshToken: token.refreshToken,
      expiresIn: token.expiresIn,
      externalAccountId: verified.externalAccountId,
      currency: verified.currency,
      timezone: verified.timezone,
      capabilities: {
        ...verified.capabilities,
        purpose: stateResult.purpose,
        connected_by: stateResult.actor_id,
        provider: raw,
      },
      markConnected: stateResult.purpose !== 'paid_ads',
    });

    if (!saved.ok) {
      dest.searchParams.set('oauth', 'error');
      dest.searchParams.set('detail', saved.error);
      return NextResponse.redirect(dest.toString());
    }

    dest.searchParams.set(
      'oauth',
      stateResult.purpose === 'paid_ads'
        ? 'select_account'
        : 'connected',
    );
    dest.searchParams.set('account_id', accountId);
    return NextResponse.redirect(dest.toString());
  } catch (e) {
    captureException(e, { route: 'marketing/oauth/callback' });
    dest.searchParams.set('oauth', 'error');
    dest.searchParams.set('detail', 'exception');
    return NextResponse.redirect(dest.toString());
  }
}
