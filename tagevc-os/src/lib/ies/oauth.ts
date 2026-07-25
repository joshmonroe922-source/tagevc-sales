/**
 * IES OAuth 2.0 (authorization code) — connect Intuit/QBO companies.
 * Read-path only; never writes books.
 */

import { createHash, randomBytes } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  getIesConfig,
  getIesEnvironment,
  IES_AUTH_URL,
  IES_SCOPE,
  IES_TOKEN_URL,
} from '@/lib/ies/config';
import {
  canStoreIesTokens,
  decryptIesSecret,
  encryptIesSecret,
} from '@/lib/ies/crypto';

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function buildIesAuthorizeUrl(state: string): string | null {
  const cfg = getIesConfig();
  if (!cfg.configured || !cfg.clientId) return null;
  const u = new URL(IES_AUTH_URL);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', IES_SCOPE);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('state', state);
  return u.toString();
}

export async function createIesOAuthState(input: {
  entity_id?: string | null;
  actor_id: string;
  purpose?: 'connect' | 'reconnect';
}): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  if (!getIesConfig().configured) {
    return {
      ok: false,
      error: `IES not configured (missing ${getIesConfig().missing.join(', ')})`,
    };
  }
  try {
    const state = randomBytes(32).toString('base64url');
    const sb = await createPersistClient();
    const { error } = await sb.from('os_ies_oauth_states').insert({
      state_hash: hashState(state),
      entity_id: input.entity_id ?? null,
      actor_id: input.actor_id,
      purpose: input.purpose ?? 'connect',
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

export async function consumeIesOAuthState(state: string): Promise<
  | {
      ok: true;
      entity_id: string | null;
      actor_id: string | null;
      purpose: 'connect' | 'reconnect';
    }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_ies_oauth_states')
      .update({ consumed_at: now })
      .eq('state_hash', hashState(state))
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('entity_id, actor_id, purpose')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'OAuth state expired or already used' };
    return {
      ok: true,
      entity_id: (data.entity_id as string) ?? null,
      actor_id: (data.actor_id as string) ?? null,
      purpose: data.purpose === 'reconnect' ? 'reconnect' : 'connect',
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'OAuth state validation failed',
    };
  }
}

export async function exchangeIesAuthCode(code: string): Promise<
  | {
      ok: true;
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }
  | { ok: false; error: string }
> {
  const cfg = getIesConfig();
  if (!cfg.configured || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'IES OAuth credentials missing' };
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    'base64',
  );
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: cfg.redirectUri,
  });
  try {
    const res = await fetch(IES_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error:
          json.error_description ||
          json.error ||
          `Intuit token HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Token exchange failed',
    };
  }
}

export async function refreshIesAccessToken(refreshToken: string): Promise<
  | {
      ok: true;
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }
  | { ok: false; error: string }
> {
  const cfg = getIesConfig();
  if (!cfg.configured || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'IES OAuth credentials missing' };
  }
  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString(
    'base64',
  );
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });
  try {
    const res = await fetch(IES_TOKEN_URL, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      error_description?: string;
      error?: string;
    };
    if (!res.ok || !json.access_token) {
      return {
        ok: false,
        error:
          json.error_description ||
          json.error ||
          `Intuit refresh HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresIn: json.expires_in,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Token refresh failed',
    };
  }
}

export async function persistIesTokens(input: {
  realm_id: string;
  company_name?: string | null;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  scopes?: string[];
  connected_by?: string | null;
  entity_id?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!canStoreIesTokens()) {
    return { ok: false, error: 'IES_TOKEN_SECRET not configured' };
  }
  const accessCipher = encryptIesSecret(input.accessToken);
  if (!accessCipher) return { ok: false, error: 'Token encrypt failed' };
  const refreshCipher = input.refreshToken
    ? encryptIesSecret(input.refreshToken)
    : null;

  try {
    const sb = await createPersistClient();
    const now = new Date().toISOString();
    const expiresAt = input.expiresIn
      ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
      : null;

    const { error } = await sb.from('os_ies_oauth_tokens').upsert(
      {
        realm_id: input.realm_id,
        company_name: input.company_name ?? null,
        access_token_cipher: accessCipher,
        refresh_token_cipher: refreshCipher,
        token_expires_at: expiresAt,
        scopes: input.scopes ?? [IES_SCOPE],
        environment: getIesEnvironment(),
        connected_by: input.connected_by ?? null,
        connected_at: now,
        refreshed_at: now,
        status: 'connected',
        last_error: null,
        updated_at: now,
      },
      { onConflict: 'realm_id' },
    );
    if (error) return { ok: false, error: error.message };

    if (input.entity_id) {
      await sb.from('os_ies_entity_map').upsert(
        {
          entity_id: input.entity_id,
          realm_id: input.realm_id,
          ies_company_name: input.company_name ?? null,
          is_active: true,
          mapped_at: now,
          mapped_by: input.connected_by ?? null,
          updated_at: now,
        },
        { onConflict: 'entity_id' },
      );
    }

    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Persist tokens failed',
    };
  }
}

export async function loadIesAccessToken(realmId: string): Promise<
  | { ok: true; accessToken: string; environment: 'sandbox' | 'production' }
  | { ok: false; error: string }
> {
  try {
    const sb = await createPersistClient();
    const { data, error } = await sb
      .from('os_ies_oauth_tokens')
      .select(
        'access_token_cipher, refresh_token_cipher, token_expires_at, environment, status',
      )
      .eq('realm_id', realmId)
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'No IES token for realm' };
    if (data.status === 'revoked') {
      return { ok: false, error: 'IES token revoked' };
    }

    const env =
      data.environment === 'production' ? 'production' : 'sandbox';
    let access = decryptIesSecret(String(data.access_token_cipher));
    if (!access) return { ok: false, error: 'Decrypt failed — check IES_TOKEN_SECRET' };

    const expiresAt = data.token_expires_at
      ? new Date(String(data.token_expires_at)).getTime()
      : 0;
    const needsRefresh = !expiresAt || expiresAt < Date.now() + 120_000;
    if (needsRefresh && data.refresh_token_cipher) {
      const refresh = decryptIesSecret(String(data.refresh_token_cipher));
      if (refresh) {
        const refreshed = await refreshIesAccessToken(refresh);
        if (refreshed.ok) {
          await persistIesTokens({
            realm_id: realmId,
            accessToken: refreshed.accessToken,
            refreshToken: refreshed.refreshToken ?? refresh,
            expiresIn: refreshed.expiresIn,
          });
          access = refreshed.accessToken;
        }
      }
    }

    return { ok: true, accessToken: access, environment: env };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Load token failed',
    };
  }
}

export async function listIesConnections(): Promise<
  Array<{
    realm_id: string;
    company_name: string | null;
    status: string;
    environment: string;
    token_expires_at: string | null;
    connected_at: string | null;
  }>
> {
  try {
    const sb = await createPersistClient();
    const { data } = await sb
      .from('os_ies_oauth_tokens')
      .select(
        'realm_id, company_name, status, environment, token_expires_at, connected_at',
      )
      .order('connected_at', { ascending: false });
    return (data ?? []).map((r) => ({
      realm_id: String(r.realm_id),
      company_name: (r.company_name as string) ?? null,
      status: String(r.status ?? 'unknown'),
      environment: String(r.environment ?? 'sandbox'),
      token_expires_at: (r.token_expires_at as string) ?? null,
      connected_at: (r.connected_at as string) ?? null,
    }));
  } catch {
    return [];
  }
}
