/**
 * Marketing OAuth connect helpers (Phases 23–29).
 * LinkedIn, X, Meta, YouTube, TikTok when credentials set; else stub.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { createHash, randomBytes } from 'crypto';
import {
  canStoreOAuthTokens,
  encryptSecret,
} from '@/lib/shared-services/marketing-crypto';
import type { MarketingPlatform } from '@/lib/shared-services/marketing-types';

export const OAUTH_PLATFORMS = [
  'linkedin',
  'x',
  'facebook',
  'instagram',
  'youtube',
  'tiktok',
] as const;
export type OAuthPlatform = (typeof OAUTH_PLATFORMS)[number];
export type MarketingConnectionPurpose = 'publisher' | 'paid_ads';

export function isOAuthPlatform(p: string): p is OAuthPlatform {
  return (OAUTH_PLATFORMS as readonly string[]).includes(p);
}

function appOrigin(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.VERCEL_URL?.trim() ||
    '';
  if (!base) return 'https://app.tagevc.com';
  return base.startsWith('http')
    ? base.replace(/\/$/, '')
    : `https://${base.replace(/\/$/, '')}`;
}

export function getOAuthConfig(platform: OAuthPlatform): {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string | null;
} {
  const redirectUri = `${appOrigin()}/api/marketing/oauth/${platform}/callback`;
  const vault = canStoreOAuthTokens();

  if (platform === 'linkedin') {
    const clientId = process.env.LINKEDIN_CLIENT_ID?.trim() || null;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET?.trim() || null;
    return {
      configured: Boolean(clientId && clientSecret && vault),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  if (platform === 'x') {
    const clientId = process.env.X_CLIENT_ID?.trim() || null;
    const clientSecret = process.env.X_CLIENT_SECRET?.trim() || null;
    return {
      configured: Boolean(clientId && clientSecret && vault),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  if (platform === 'facebook' || platform === 'instagram') {
    const clientId = process.env.META_APP_ID?.trim() || null;
    const clientSecret = process.env.META_APP_SECRET?.trim() || null;
    return {
      configured: Boolean(clientId && clientSecret && vault),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  if (platform === 'tiktok') {
    const clientId = process.env.TIKTOK_CLIENT_KEY?.trim() || null;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim() || null;
    return {
      configured: Boolean(clientId && clientSecret && vault),
      clientId,
      clientSecret,
      redirectUri,
    };
  }

  // youtube via Google
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET?.trim() || null;
  return {
    configured: Boolean(clientId && clientSecret && vault),
    clientId,
    clientSecret,
    redirectUri,
  };
}

export function buildAuthorizeUrl(
  platform: OAuthPlatform,
  state: string,
  purpose: MarketingConnectionPurpose = 'publisher',
): string | null {
  const cfg = getOAuthConfig(platform);
  if (!cfg.configured || !cfg.clientId || !cfg.redirectUri) return null;

  if (platform === 'linkedin') {
    const u = new URL('https://www.linkedin.com/oauth/v2/authorization');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('state', state);
    const scopes = ['openid', 'profile', 'w_member_social'];
    if (
      purpose === 'paid_ads' ||
      process.env.LINKEDIN_ADS_API === '1' ||
      process.env.LINKEDIN_ADS_API === 'true'
    ) {
      scopes.push('r_ads_reporting', 'r_ads');
    }
    u.searchParams.set('scope', scopes.join(' '));
    return u.toString();
  }

  if (platform === 'x') {
    const u = new URL('https://twitter.com/i/oauth2/authorize');
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set(
      'scope',
      'tweet.read tweet.write users.read offline.access',
    );
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', 'challenge');
    u.searchParams.set('code_challenge_method', 'plain');
    return u.toString();
  }

  if (platform === 'facebook' || platform === 'instagram') {
    const version = process.env.META_API_VERSION?.trim() || 'v25.0';
    const u = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('state', state);
    u.searchParams.set(
      'scope',
      purpose === 'paid_ads'
        ? 'ads_read,public_profile'
        : platform === 'instagram'
        ? 'instagram_basic,pages_show_list,pages_read_engagement'
        : 'pages_manage_posts,pages_read_engagement,public_profile',
    );
    return u.toString();
  }

  if (platform === 'tiktok') {
    const u = new URL('https://www.tiktok.com/v2/auth/authorize/');
    u.searchParams.set('client_key', cfg.clientId);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('scope', 'user.info.basic,video.list,video.upload,video.publish');
    u.searchParams.set('state', state);
    return u.toString();
  }

  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set(
    'scope',
    'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
  );
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

  if (platform === 'x') {
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

  if (platform === 'facebook' || platform === 'instagram') {
    const version = process.env.META_API_VERSION?.trim() || 'v25.0';
    const u = new URL(
      `https://graph.facebook.com/${version}/oauth/access_token`,
    );
    u.searchParams.set('client_id', cfg.clientId);
    u.searchParams.set('client_secret', cfg.clientSecret);
    u.searchParams.set('redirect_uri', cfg.redirectUri);
    u.searchParams.set('code', code);
    const res = await fetch(u.toString());
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: { message?: string };
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error: json.error?.message || `Meta token HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: json.access_token,
      expiresIn: json.expires_in,
    };
  }

  if (platform === 'tiktok') {
    const body = new URLSearchParams({
      client_key: cfg.clientId,
      client_secret: cfg.clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: cfg.redirectUri,
    });
    const res = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
      data?: {
        access_token?: string;
        refresh_token?: string;
        expires_in?: number;
      };
    };
    const access =
      json.access_token || json.data?.access_token || null;
    if (!res.ok || !access) {
      return {
        ok: false,
        error:
          json.error_description ||
          json.error ||
          `TikTok token HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: access,
      refreshToken: json.refresh_token || json.data?.refresh_token,
      expiresIn: json.expires_in ?? json.data?.expires_in,
    };
  }

  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: 'authorization_code',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
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
      error: json.error_description || `Google token HTTP ${res.status}`,
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
  externalAccountId?: string | null;
  currency?: string | null;
  timezone?: string | null;
  capabilities?: Record<string, unknown>;
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
      .update({
        status: 'connected',
        external_account_id: input.externalAccountId ?? undefined,
        currency: input.currency ?? null,
        timezone: input.timezone ?? null,
        capabilities: input.capabilities ?? {},
        verified_at: now,
        updated_at: now,
        last_synced_at: now,
      })
      .eq('account_id', input.account_id);

    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'persist failed' };
  }
}

function hashOAuthState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export async function createOAuthState(input: {
  account_id: string;
  platform: OAuthPlatform;
  purpose: MarketingConnectionPurpose;
  entity_id?: string | null;
  actor_id: string;
}): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  try {
    const state = randomBytes(32).toString('base64url');
    const sb = await createPersistClient();
    const { error } = await sb.from('os_marketing_oauth_states').insert({
      state_hash: hashOAuthState(state),
      account_id: input.account_id,
      platform: input.platform,
      purpose: input.purpose,
      entity_id: input.entity_id ?? null,
      actor_id: input.actor_id,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, state };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'OAuth state creation failed',
    };
  }
}

export async function consumeOAuthState(
  state: string,
  platform: OAuthPlatform,
): Promise<
  | {
      ok: true;
      account_id: string;
      entity_id: string | null;
      actor_id: string;
      purpose: MarketingConnectionPurpose;
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_marketing_oauth_states')
      .update({ consumed_at: now })
      .eq('state_hash', hashOAuthState(state))
      .eq('platform', platform)
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('account_id, entity_id, actor_id, purpose')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'OAuth state expired or already used' };
    return {
      ok: true,
      account_id: String(data.account_id),
      entity_id: (data.entity_id as string) ?? null,
      actor_id: String(data.actor_id),
      purpose:
        data.purpose === 'paid_ads' ? 'paid_ads' : 'publisher',
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'OAuth state validation failed',
    };
  }
}

export async function verifyOAuthConnection(input: {
  platform: OAuthPlatform;
  purpose: MarketingConnectionPurpose;
  accessToken: string;
  requestedExternalId?: string | null;
}): Promise<
  | {
      ok: true;
      externalAccountId: string | null;
      currency: string | null;
      timezone: string | null;
      capabilities: Record<string, unknown>;
    }
  | { ok: false; error: string }
> {
  if (input.purpose !== 'paid_ads') {
    return {
      ok: true,
      externalAccountId: input.requestedExternalId ?? null,
      currency: null,
      timezone: null,
      capabilities: { purpose: 'publisher', identity_verified: true },
    };
  }
  const requested = input.requestedExternalId?.trim();
  if (!requested) {
    return { ok: false, error: 'Paid OAuth connection is missing account ID' };
  }
  try {
    if (input.platform === 'facebook') {
      const version = process.env.META_API_VERSION?.trim() || 'v25.0';
      const res = await fetch(
        `https://graph.facebook.com/${version}/me/adaccounts?fields=id,name,currency,timezone_name&limit=100`,
        { headers: { Authorization: `Bearer ${input.accessToken}` } },
      );
      const json = (await res.json().catch(() => ({}))) as {
        data?: Array<{
          id?: string;
          name?: string;
          currency?: string;
          timezone_name?: string;
        }>;
        error?: { message?: string };
      };
      if (!res.ok) {
        return {
          ok: false,
          error: json.error?.message || `Meta ad accounts HTTP ${res.status}`,
        };
      }
      const normalized = requested.startsWith('act_')
        ? requested
        : `act_${requested}`;
      const account = json.data?.find((row) => row.id === normalized);
      if (!account) {
        return {
          ok: false,
          error: 'Requested Meta ad account is not accessible to this OAuth user',
        };
      }
      return {
        ok: true,
        externalAccountId: normalized,
        currency: account.currency ?? null,
        timezone: account.timezone_name ?? null,
        capabilities: {
          purpose: 'paid_ads',
          identity_verified: true,
          provider_name: account.name ?? null,
          reporting: true,
        },
      };
    }
    if (input.platform === 'linkedin') {
      const res = await fetch(
        'https://api.linkedin.com/rest/adAccounts?q=search&count=100',
        {
          headers: {
            Authorization: `Bearer ${input.accessToken}`,
            'LinkedIn-Version':
              process.env.LINKEDIN_API_VERSION?.trim() || '202607',
            'X-Restli-Protocol-Version': '2.0.0',
          },
        },
      );
      const json = (await res.json().catch(() => ({}))) as {
        elements?: Array<{
          id?: number | string;
          name?: string;
          currency?: string;
        }>;
        message?: string;
      };
      if (!res.ok) {
        return {
          ok: false,
          error: json.message || `LinkedIn ad accounts HTTP ${res.status}`,
        };
      }
      const requestedNumber = requested.match(/(\d+)$/)?.[1] ?? requested;
      const account = json.elements?.find(
        (row) => String(row.id ?? '') === requestedNumber,
      );
      if (!account) {
        return {
          ok: false,
          error:
            'Requested LinkedIn ad account is not accessible to this OAuth user',
        };
      }
      return {
        ok: true,
        externalAccountId: String(account.id),
        currency: account.currency ?? null,
        timezone: null,
        capabilities: {
          purpose: 'paid_ads',
          identity_verified: true,
          provider_name: account.name ?? null,
          reporting: true,
        },
      };
    }
    return {
      ok: false,
      error: `Paid OAuth is not supported for ${input.platform}`,
    };
  } catch (e) {
    return {
      ok: false,
      error:
        e instanceof Error ? e.message : 'Provider account verification failed',
    };
  }
}

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
        notes:
          'Stub-connected — posts use stub publisher until OAuth credentials are set',
        updated_at: now,
        last_synced_at: now,
      })
      .eq('account_id', accountId);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'stub connect failed',
    };
  }
}

export function oauthPlatformStatus(): Record<
  OAuthPlatform,
  { configured: boolean }
> {
  return {
    linkedin: { configured: getOAuthConfig('linkedin').configured },
    x: { configured: getOAuthConfig('x').configured },
    facebook: { configured: getOAuthConfig('facebook').configured },
    instagram: { configured: getOAuthConfig('instagram').configured },
    youtube: { configured: getOAuthConfig('youtube').configured },
    tiktok: { configured: getOAuthConfig('tiktok').configured },
  };
}
