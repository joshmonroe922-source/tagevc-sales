/**
 * Gusto partner OAuth (authorization code + refresh).
 * Stage-correct hosts: demo → api.gusto-demo.com / app.gusto-demo.com;
 * production → api.gusto.com / app.gusto.com (after Production Pre-Approval).
 * Keep GUSTO_LIVE=0 until resolve + smoke hire proven.
 */

import { createHash, createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import {
  canonicalizeGustoEntityId,
  type GustoEntityId,
} from '@/lib/partners/gusto-entity';

export type GustoAppStage = 'demo' | 'production';

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

export function getGustoAppStage(): GustoAppStage {
  const raw = (process.env.GUSTO_APP_STAGE || '').trim().toLowerCase();
  return raw === 'production' ? 'production' : 'demo';
}

export function gustoApiBase(stage: GustoAppStage = getGustoAppStage()): string {
  return stage === 'production'
    ? 'https://api.gusto.com'
    : 'https://api.gusto-demo.com';
}

export function gustoAuthorizeBase(
  stage: GustoAppStage = getGustoAppStage(),
): string {
  return stage === 'production'
    ? 'https://api.gusto.com'
    : 'https://api.gusto-demo.com';
}

export function gustoApiVersion(): string {
  return process.env.GUSTO_API_VERSION?.trim() || '2026-06-15';
}

export function getGustoOAuthConfig(): {
  configured: boolean;
  clientId: string | null;
  clientSecret: string | null;
  redirectUri: string;
  stage: GustoAppStage;
  vaultReady: boolean;
  missing: string[];
} {
  const clientId = process.env.GUSTO_CLIENT_ID?.trim() || null;
  const clientSecret = process.env.GUSTO_CLIENT_SECRET?.trim() || null;
  const vaultReady = Boolean(
    process.env.GUSTO_TOKEN_SECRET?.trim() &&
      (process.env.GUSTO_TOKEN_SECRET?.trim().length ?? 0) >= 16,
  );
  const redirectUri =
    process.env.GUSTO_REDIRECT_URI?.trim() ||
    `${appOrigin()}/api/partners/gusto/oauth/callback`;
  const missing: string[] = [];
  if (!clientId) missing.push('GUSTO_CLIENT_ID');
  if (!clientSecret) missing.push('GUSTO_CLIENT_SECRET');
  return {
    configured: Boolean(clientId && clientSecret),
    clientId,
    clientSecret,
    redirectUri,
    stage: getGustoAppStage(),
    vaultReady,
    missing,
  };
}

function vaultKey(): Buffer | null {
  const secret = process.env.GUSTO_TOKEN_SECRET?.trim();
  if (!secret || secret.length < 16) return null;
  return createHash('sha256').update(secret).digest();
}

export function encryptGustoSecret(plaintext: string): string | null {
  const key = vaultKey();
  if (!key) return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}`;
}

export function decryptGustoSecret(blob: string): string | null {
  const key = vaultKey();
  if (!key) return null;
  const parts = blob.split(':');
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, dataB64] = parts;
    const iv = Buffer.from(ivB64, 'base64');
    const tag = Buffer.from(tagB64, 'base64');
    const data = Buffer.from(dataB64, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString(
      'utf8',
    );
  } catch {
    return null;
  }
}

function hashState(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

export function buildGustoAuthorizeUrl(state: string): string | null {
  const cfg = getGustoOAuthConfig();
  if (!cfg.configured || !cfg.clientId) return null;
  const u = new URL(`${gustoAuthorizeBase(cfg.stage)}/oauth/authorize`);
  u.searchParams.set('client_id', cfg.clientId);
  u.searchParams.set('redirect_uri', cfg.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('state', state);
  return u.toString();
}

export async function createGustoOAuthState(input: {
  entity_id: GustoEntityId;
  actor_id: string;
}): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
  const cfg = getGustoOAuthConfig();
  if (!cfg.configured) {
    return {
      ok: false,
      error: `Gusto OAuth not configured (missing ${cfg.missing.join(', ')})`,
    };
  }
  try {
    const state = randomBytes(32).toString('base64url');
    const sb = await createPersistClient({ mode: 'service' });
    const { error } = await sb.from('os_gusto_oauth_states').insert({
      state_hash: hashState(state),
      entity_id: input.entity_id,
      actor_id: input.actor_id,
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) {
      // Table optional in early bootstrap — allow opaque state file fallback via cookie-less path
      if (/relation .*os_gusto_oauth_states/i.test(error.message)) {
        return { ok: true, state: `ephemeral:${input.entity_id}:${state}` };
      }
      return { ok: false, error: error.message };
    }
    return { ok: true, state };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'OAuth state creation failed',
    };
  }
}

export async function consumeGustoOAuthState(state: string): Promise<
  | { ok: true; entity_id: GustoEntityId; actor_id: string | null }
  | { ok: false; error: string }
> {
  if (state.startsWith('ephemeral:')) {
    const parts = state.split(':');
    const entity = canonicalizeGustoEntityId(parts[1] || '');
    if (!entity) return { ok: false, error: 'invalid ephemeral state entity' };
    return { ok: true, entity_id: entity, actor_id: null };
  }
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const now = new Date().toISOString();
    const { data, error } = await sb
      .from('os_gusto_oauth_states')
      .update({ consumed_at: now })
      .eq('state_hash', hashState(state))
      .is('consumed_at', null)
      .gt('expires_at', now)
      .select('entity_id, actor_id')
      .maybeSingle();
    if (error) return { ok: false, error: error.message };
    if (!data) return { ok: false, error: 'OAuth state expired or already used' };
    const entity = canonicalizeGustoEntityId(String(data.entity_id));
    if (!entity) return { ok: false, error: 'invalid entity on state' };
    return {
      ok: true,
      entity_id: entity,
      actor_id: data.actor_id ? String(data.actor_id) : null,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'OAuth state validation failed',
    };
  }
}

export async function exchangeGustoAuthCode(input: {
  code: string;
  redirectUri?: string;
}): Promise<
  | {
      ok: true;
      accessToken: string;
      refreshToken?: string;
      expiresIn?: number;
    }
  | { ok: false; error: string }
> {
  const cfg = getGustoOAuthConfig();
  if (!cfg.configured || !cfg.clientId || !cfg.clientSecret) {
    return { ok: false, error: 'Gusto OAuth credentials missing' };
  }
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: input.redirectUri || cfg.redirectUri,
    grant_type: 'authorization_code',
    code: input.code,
  });
  const res = await fetch(`${gustoApiBase(cfg.stage)}/oauth/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
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
        `token exchange failed (${res.status})`,
    };
  }
  return {
    ok: true,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresIn: json.expires_in,
  };
}

export async function fetchGustoTokenCompanies(accessToken: string): Promise<
  | { ok: true; companies: Array<{ uuid: string; name: string | null }> }
  | { ok: false; error: string }
> {
  const stage = getGustoAppStage();
  // Prefer /v1/companies — /v1/me is absent on newer API versions (e.g. 2026-06-15).
  const res = await fetch(`${gustoApiBase(stage)}/v1/companies`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'X-Gusto-API-Version': gustoApiVersion(),
    },
  });
  const json = (await res.json().catch(() => null)) as
    | Array<{ uuid?: string; name?: string; trade_name?: string }>
    | { error?: string; errors?: Array<{ message?: string }> }
    | null;
  if (!res.ok) {
    const errObj = json && !Array.isArray(json) ? json : null;
    return {
      ok: false,
      error:
        errObj?.errors?.[0]?.message ||
        errObj?.error ||
        `companies lookup failed (${res.status})`,
    };
  }
  const list = Array.isArray(json) ? json : [];
  const companies = list
    .map((row) => ({
      uuid: (row.uuid || '').trim(),
      name: row.name || row.trade_name || null,
    }))
    .filter((c) => Boolean(c.uuid));
  return { ok: true, companies };
}

export async function persistGustoTokens(input: {
  entity_id: GustoEntityId;
  company_uuid: string;
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  connected_by?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const accessCipher = encryptGustoSecret(input.accessToken);
  const refreshCipher = input.refreshToken
    ? encryptGustoSecret(input.refreshToken)
    : null;
  if (!accessCipher) {
    return {
      ok: false,
      error: 'GUSTO_TOKEN_SECRET missing — vault unavailable (env bootstrap only)',
    };
  }
  const stage = getGustoAppStage();
  const expiresAt =
    typeof input.expiresIn === 'number'
      ? new Date(Date.now() + input.expiresIn * 1000).toISOString()
      : null;
  try {
    const sb = await createPersistClient({ mode: 'service' });
    const row = {
      entity_id: input.entity_id,
      company_uuid: input.company_uuid,
      access_token_cipher: accessCipher,
      refresh_token_cipher: refreshCipher,
      token_expires_at: expiresAt,
      environment: stage === 'production' ? 'production' : 'sandbox',
      status: 'connected',
      connected_by: input.connected_by || null,
      connected_at: new Date().toISOString(),
      last_error: null,
      updated_at: new Date().toISOString(),
    };
    const { error } = await sb.from('os_gusto_oauth_tokens').upsert(row, {
      onConflict: 'entity_id',
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'vault persist failed',
    };
  }
}
