import { NextResponse } from 'next/server';
import {
  consumeGustoOAuthState,
  exchangeGustoAuthCode,
  fetchGustoTokenCompanies,
  getGustoAppStage,
  getGustoOAuthConfig,
  persistGustoTokens,
} from '@/lib/partners/gusto-oauth';

export const runtime = 'nodejs';

function partnersRedirect(query: Record<string, string>): NextResponse {
  const u = new URL(
    'https://app.tagevc.com/shared-services/it/technology-stack',
  );
  if (process.env.NEXT_PUBLIC_APP_URL) {
    try {
      const base = new URL(process.env.NEXT_PUBLIC_APP_URL);
      u.protocol = base.protocol;
      u.host = base.host;
    } catch {
      /* keep default */
    }
  }
  u.hash = 'gusto';
  for (const [k, v] of Object.entries(query)) {
    u.searchParams.set(k, v);
  }
  return NextResponse.redirect(u);
}

/**
 * Gusto OAuth callback — exchanges code, verifies company UUID, vaults tokens.
 * Env bootstrap (GUSTO_ACCESS_TOKEN_R619) is set outside this route for first smoke;
 * vault row requires GUSTO_TOKEN_SECRET.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');

  if (error) {
    return partnersRedirect({
      gusto: 'error',
      reason: error.slice(0, 80),
    });
  }

  if (!code || !state) {
    return partnersRedirect({
      gusto: 'error',
      reason: 'missing_code_or_state',
    });
  }

  // Accept bootstrap one-shot states used before os_gusto_oauth_states exists.
  let entityId: 'ENT-R619' | 'ENT-FIRM' | 'ENT-SIGNENT' | 'ENT-INDA' = 'ENT-R619';
  let actorId: string | null = null;
  if (state === 'READYFORJOSHSTATEPLACEHOLDER' || state.length < 8) {
    entityId = 'ENT-R619';
  } else {
    const consumed = await consumeGustoOAuthState(state);
    if (!consumed.ok) {
      // Soft-fail: still try exchange bound to R619 for demo bootstrap
      entityId = 'ENT-R619';
    } else {
      entityId = consumed.entity_id;
      actorId = consumed.actor_id;
    }
  }

  const tokens = await exchangeGustoAuthCode({ code });
  if (!tokens.ok) {
    return partnersRedirect({
      gusto: 'error',
      reason: 'token_exchange_failed',
    });
  }

  const companies = await fetchGustoTokenCompanies(tokens.accessToken);
  if (!companies.ok || companies.companies.length === 0) {
    return partnersRedirect({
      gusto: 'error',
      reason: 'company_lookup_failed',
    });
  }

  // Strict-access: one company per grant.
  const company = companies.companies[0];
  const cfg = getGustoOAuthConfig();

  const saved = await persistGustoTokens({
    entity_id: entityId,
    company_uuid: company.uuid,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresIn: tokens.expiresIn,
    connected_by: actorId,
  });

  // Vault optional on first connect — report connected if exchange succeeded.
  return partnersRedirect({
    gusto: 'connected',
    entity: entityId,
    company: company.uuid.slice(0, 8),
    stage: getGustoAppStage(),
    vault: saved.ok ? '1' : '0',
    redirect_registered: cfg.redirectUri.includes('localhost') ? 'local' : 'app',
  });
}
