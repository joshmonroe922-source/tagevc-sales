import { NextResponse } from 'next/server';
import {
  consumeIesOAuthState,
  exchangeIesAuthCode,
  persistIesTokens,
} from '@/lib/ies/oauth';
import { getIesEnvironment } from '@/lib/ies/config';
import { fetchCompanyInfo } from '@/lib/ies/qbo-client';

function financeRedirect(query: Record<string, string>): NextResponse {
  const u = new URL('https://app.tagevc.com/shared-services/finance');
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      const base = new URL(process.env.NEXT_PUBLIC_APP_URL);
      u.protocol = base.protocol;
      u.host = base.host;
    } catch {
      /* keep default */
    }
  }
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return NextResponse.redirect(u);
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const realmId = url.searchParams.get('realmId');
  const error = url.searchParams.get('error');

  if (error) {
    return financeRedirect({
      ies: 'error',
      reason: error.slice(0, 80),
    });
  }

  if (!code || !state || !realmId) {
    return financeRedirect({
      ies: 'error',
      reason: 'missing_code_state_or_realm',
    });
  }

  const consumed = await consumeIesOAuthState(state);
  if (!consumed.ok) {
    return financeRedirect({ ies: 'error', reason: 'invalid_state' });
  }

  const tokens = await exchangeIesAuthCode(code);
  if (!tokens.ok) {
    return financeRedirect({
      ies: 'error',
      reason: 'token_exchange_failed',
    });
  }

  let companyName: string | null = null;
  const info = await fetchCompanyInfo(
    realmId,
    tokens.accessToken,
    getIesEnvironment(),
  );
  if (info.ok) companyName = info.name;

  const saved = await persistIesTokens({
    realm_id: realmId,
    company_name: companyName,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    connected_by: consumed.actor_id,
    entity_id: consumed.entity_id,
  });

  if (!saved.ok) {
    return financeRedirect({ ies: 'error', reason: 'persist_failed' });
  }

  const q: Record<string, string> = {
    ies: 'connected',
    realm: realmId,
  };
  if (consumed.entity_id) q.entity = consumed.entity_id;
  return financeRedirect(q);
}
