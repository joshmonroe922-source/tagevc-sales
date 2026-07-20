/**
 * OAuth token refresh for LinkedIn, X, and Meta (Phase 24).
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  canStoreOAuthTokens,
  decryptSecret,
  encryptSecret,
} from '@/lib/shared-services/marketing-crypto';
import {
  getOAuthConfig,
  type OAuthPlatform,
} from '@/lib/shared-services/marketing-oauth';

export type RefreshResult =
  | { ok: true; account_id: string; refreshed: boolean }
  | { ok: false; account_id: string; error: string };

const SKEW_MS = 5 * 60 * 1000;

async function refreshLinkedIn(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const cfg = getOAuthConfig('linkedin');
  if (!cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'LinkedIn OAuth not configured' };
  }
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
      error: json.error_description || `LinkedIn refresh HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

async function refreshX(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const cfg = getOAuthConfig('x');
  if (!cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'X OAuth not configured' };
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    'base64',
  );
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
      error: json.error_description || `X refresh HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

async function refreshMeta(
  refreshToken: string,
): Promise<
  | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number }
  | { ok: false; error: string }
> {
  const clientId = process.env.META_APP_ID?.trim();
  const clientSecret = process.env.META_APP_SECRET?.trim();
  if (!clientId || !clientSecret) {
    return { ok: false, error: 'Meta OAuth not configured' };
  }
  // Long-lived exchange / refresh via fb_exchange_token
  const u = new URL('https://graph.facebook.com/v19.0/oauth/access_token');
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_id', clientId);
  u.searchParams.set('client_secret', clientSecret);
  u.searchParams.set('fb_exchange_token', refreshToken);
  const res = await fetch(u.toString());
  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message?: string };
  };
  if (!res.ok || !json.access_token) {
    return {
      ok: false,
      error: json.error?.message || `Meta refresh HTTP ${res.status}`,
    };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.access_token,
    expiresIn: json.expires_in,
  };
}

/**
 * Ensure access token is fresh; refresh when expired or within skew window.
 * Returns decrypted access token or null.
 */
export async function ensureFreshAccessToken(
  accountId: string,
): Promise<{ token: string | null; refreshed: boolean; error?: string }> {
  if (!canStoreOAuthTokens()) {
    return { token: null, refreshed: false, error: 'Token vault not configured' };
  }

  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_marketing_oauth_tokens')
      .select('*')
      .eq('account_id', accountId)
      .maybeSingle();
    if (error || !data) {
      return { token: null, refreshed: false, error: error?.message ?? 'No token' };
    }

    const row = data as Record<string, unknown>;
    const platform = String(row.platform) as OAuthPlatform | 'facebook' | 'instagram';
    const access = decryptSecret(String(row.access_token_cipher));
    if (!access) {
      return { token: null, refreshed: false, error: 'Decrypt failed' };
    }

    const expiresAt = row.token_expires_at
      ? new Date(String(row.token_expires_at)).getTime()
      : null;
    const needsRefresh =
      expiresAt != null && expiresAt - SKEW_MS <= Date.now();

    if (!needsRefresh) {
      return { token: access, refreshed: false };
    }

    const refreshCipher = row.refresh_token_cipher
      ? String(row.refresh_token_cipher)
      : null;
    if (!refreshCipher) {
      return {
        token: access,
        refreshed: false,
        error: 'Token expired and no refresh_token',
      };
    }
    const refreshPlain = decryptSecret(refreshCipher);
    if (!refreshPlain) {
      return { token: null, refreshed: false, error: 'Refresh decrypt failed' };
    }

    let result:
      | { ok: true; accessToken: string; refreshToken?: string; expiresIn?: number }
      | { ok: false; error: string };

    if (platform === 'linkedin') result = await refreshLinkedIn(refreshPlain);
    else if (platform === 'x') result = await refreshX(refreshPlain);
    else if (platform === 'facebook' || platform === 'instagram') {
      result = await refreshMeta(refreshPlain);
    } else {
      return { token: access, refreshed: false, error: `No refresh for ${platform}` };
    }

    const attempts = Number(row.refresh_attempts ?? 0) + 1;
    const now = new Date().toISOString();

    if (!result.ok) {
      await sb
        .from('os_marketing_oauth_tokens')
        .update({
          refresh_error: result.error,
          refresh_attempts: attempts,
          updated_at: now,
        })
        .eq('account_id', accountId);
      await sb
        .from('os_marketing_social_accounts')
        .update({ status: 'error', updated_at: now, notes: result.error })
        .eq('account_id', accountId);
      return { token: null, refreshed: false, error: result.error };
    }

    const accessCipher = encryptSecret(result.accessToken);
    const newRefreshCipher = result.refreshToken
      ? encryptSecret(result.refreshToken)
      : refreshCipher;
    if (!accessCipher) {
      return { token: null, refreshed: false, error: 'Encrypt failed' };
    }

    const newExpires = result.expiresIn
      ? new Date(Date.now() + result.expiresIn * 1000).toISOString()
      : null;

    await sb
      .from('os_marketing_oauth_tokens')
      .update({
        access_token_cipher: accessCipher,
        refresh_token_cipher: newRefreshCipher,
        token_expires_at: newExpires,
        last_refreshed_at: now,
        refresh_error: null,
        refresh_attempts: attempts,
        updated_at: now,
      })
      .eq('account_id', accountId);

    return { token: result.accessToken, refreshed: true };
  } catch (e) {
    return {
      token: null,
      refreshed: false,
      error: e instanceof Error ? e.message : 'refresh failed',
    };
  }
}

/** Cron/admin: refresh all tokens that expire within the next hour. */
export async function refreshExpiringTokens(limit = 20): Promise<{
  results: RefreshResult[];
}> {
  const sb = await createPersistClient();
  const horizon = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const { data } = await sb
    .from('os_marketing_oauth_tokens')
    .select('account_id')
    .not('refresh_token_cipher', 'is', null)
    .lte('token_expires_at', horizon)
    .limit(limit);

  const results: RefreshResult[] = [];
  for (const row of data ?? []) {
    const accountId = String((row as { account_id: string }).account_id);
    const res = await ensureFreshAccessToken(accountId);
    if (res.error && !res.token) {
      results.push({ ok: false, account_id: accountId, error: res.error });
    } else {
      results.push({
        ok: true,
        account_id: accountId,
        refreshed: res.refreshed,
      });
    }
  }
  return { results };
}
