/**
 * DocuSign JWT grant (impersonation) — Phase 21.
 * Uses Node crypto (RS256); no extra deps.
 */

import { createSign } from 'crypto';
import { getDocuSignConfig, type DocuSignConfig } from './config';

type TokenCache = { accessToken: string; expiresAtMs: number };
let tokenCache: TokenCache | null = null;

function base64url(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function buildJwtAssertion(cfg: DocuSignConfig): string {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = base64url(
    JSON.stringify({
      iss: cfg.integrationKey,
      sub: cfg.userId,
      aud: cfg.oauthHost,
      iat: now,
      exp: now + 3600,
      scope: 'signature impersonation',
    }),
  );
  const data = `${header}.${body}`;
  const signer = createSign('RSA-SHA256');
  signer.update(data);
  signer.end();
  const signature = base64url(signer.sign(cfg.privateKey));
  return `${data}.${signature}`;
}

export async function getDocuSignAccessToken(
  cfg?: DocuSignConfig,
): Promise<string> {
  const config = cfg ?? getDocuSignConfig();
  if (!config) {
    throw new Error('DocuSign is not configured (missing JWT env vars)');
  }

  const skewMs = 60_000;
  if (tokenCache && tokenCache.expiresAtMs > Date.now() + skewMs) {
    return tokenCache.accessToken;
  }

  const assertion = buildJwtAssertion(config);
  const url = `https://${config.oauthHost}/oauth/token`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  const json = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };

  if (!res.ok || !json.access_token) {
    const detail =
      json.error_description || json.error || `HTTP ${res.status}`;
    throw new Error(`DocuSign JWT token failed: ${detail}`);
  }

  const expiresIn = typeof json.expires_in === 'number' ? json.expires_in : 3600;
  tokenCache = {
    accessToken: json.access_token,
    expiresAtMs: Date.now() + expiresIn * 1000,
  };
  return json.access_token;
}

/** Test-only / ops: clear cached token after key rotation. */
export function clearDocuSignTokenCache(): void {
  tokenCache = null;
}
