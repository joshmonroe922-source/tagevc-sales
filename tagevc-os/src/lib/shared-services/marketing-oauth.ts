/**
 * Marketing OAuth connect helpers (Phase 23).
 * LinkedIn + X when client credentials set; otherwise stub connect.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  canStoreOAuthTokens,
  encryptSecret,
} from '@/lib/shared-services/marketing-crypto';
import type { MarketingPlatform } from '@/lib/shared-services/marketing-types';

const OAUTH_PLATFORMS = ['linkedin', 'x'] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(p);
}

export function getOAuthConfig(platform: OAuthPlatform): {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
} {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    '';
  const origin = base
    ? base.startsWith('http')
      ? base.replace(/\/$/, '')
      : `https://${base.replace(/\/$/, '')}`
    : 'https://app.tagevc.com';
  const redirectUri = `${origin}/api/marketing/oauth/${platform}/callback`;

  if (platform === 'linkedin') {
    const clientId = process.env.LINKEDIN_CLIENT_ID?.trim() || null;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim() || null;
    return {
      configured: Boolean(clientId && clientSecret && canStoreOAuthTokens()),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  const clientId = process.env.X_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.X_CLIENT_SECRET?.trim() || null;
  return {
    configured: Boolean(clientId && clientSecret && canStoreOAuthTokens()),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function buildAuthorizeUrl(
  platform: OAuthPlatform,
  state: string,
): string | null {
  const cfg = getOAuthConfig(platform);
  if (!cfg.configured || !cfg.clientId || !cfg.redirectUri) return null;

  if (platform === 'linkedin') {
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set('scope', 'openid profile w_member_social');
    return u.toString();
  }

  const u = new URL('https://twitter.com/i/oauth2/authorize');
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('scope', 'tweet.read tweet.write users.read offline.access');
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', 'challenge');
  u.searchParams.set('code_challenge_method', 'plain');
  return u.toString();
}

export async function exchangeOAuthCode(
  platform: OAuthPlatform,
  code: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const cfg = getOAuthConfig(platform);
  if (!cfg.configured || !cfg.clientId || !cfg.clientSecret || !cfg.redirectUri) {
    return { ok: false, error: 'OAuth not configured' };
  }

  if (platform === 'linkedin') {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: cfg.redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const res = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error: json.error_description || `LinkedIn token HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  }

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    'base64',
  );
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
    code_verifier: 'challenge',
  });
  const res = await fetch('https://api.x.com/2/oauth2/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${basic}`,
    },
    body,
  });
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    error_description?: string;
  };
  if (!res.ok || !json.access_token) {
    return {
      ok: false,
      error: json.error_description || `X token HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function persistOAuthTokens(input: {
  account_id: string;
  platform: MarketingPlatform;
  entity_id?: string | null;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string[];
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accessCipher = encryptSecret(input.accessToken);
  if (!accessCipher) {
    return { ok: false, error: 'MARKETING_TOKEN_SECRET not configured' };
  }
  const refreshCipher = input.refreshToken
    ? encryptSecret(input.refreshToken)
    : null;

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
      : null;

    const { error } = await sb.from('os_marketing_oauth_tokens').upsert(
      {
        account_id: input.account_id,
        platform: input.platform,
        entity_id: input.entity_id ?? null,
        access_token_cipher: accessCipher,
        refresh_token_cipher: refreshCipher,
        token_expires_at: expiresAt,
        scopes: input.scopes ?? null,
        updated_at: now,
      },
      { onConflict: 'account_id' },
    );
    if (error) return { ok: false, error: error.message };

    await sb
      .from('os_marketing_social_accounts')
      .update({ status: 'connected', updated_at: now, last_synced_at: now })
      .eq('account_id', input.account_id);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'persist failed' };
  }
}

/** Mark account connected without OAuth (dev / platforms without credentials). */
export async function stubConnectAccount(
  accountId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const { error } = await sb
      .from('os_marketing_social_accounts')
      .update({
        status: 'connected',
        notes: 'Stub-connected (Phase 23) — posts use stub publisher until OAuth',
        updated_at: now,
        last_synced_at: now,
      })
      .eq('account_id', accountId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'stub connect failed' };
  }
}
