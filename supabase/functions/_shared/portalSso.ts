/**
 * Short-lived HMAC JWT for Tage portal → TalentDesk SSO.
 * Shared secret: TALENTDESK_SSO_SECRET (portal) === PORTAL_SSO_SECRET (TalentDesk).
 *
 * Email identity: portal login may be @tagevc.com while TalentDesk is @recruit619.com.
 * mapPortalEmailToTalentDesk() remaps by local-part (and optional TALENTDESK_EMAIL_MAP).
 */

const encoder = new TextEncoder();

export const PORTAL_SSO_ISS = 'tagevc-portal';
export const PORTAL_SSO_AUD = 'talentdesk';
/** Default token lifetime (~60s). */
export const PORTAL_SSO_TTL_SECONDS = 60;

/** Domains whose local-part maps to the same address @recruit619.com. */
const DEFAULT_TAGE_MAP_DOMAINS = ['tagevc.com'];

function parseCsvLower(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Explicit overrides: `a@x.com=b@y.com,c@z.com=d@w.com`
 * (comma-separated email=email pairs).
 */
export function parseTalentDeskEmailMap(
  raw: string | undefined,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const pair of parseCsvLower(raw)) {
    const eq = pair.indexOf('=');
    if (eq <= 0) continue;
    const from = pair.slice(0, eq).trim();
    const to = pair.slice(eq + 1).trim();
    if (from.includes('@') && to.includes('@')) {
      map.set(from, to);
    }
  }
  return map;
}

/**
 * Map a portal identity email to the TalentDesk User.email to mint in the JWT.
 * - Explicit TALENTDESK_EMAIL_MAP override wins
 * - Already @recruit619.com → unchanged
 * - @tagevc.com (and TALENTDESK_MAP_DOMAINS) → same local-part @recruit619.com
 */
export function mapPortalEmailToTalentDesk(
  email: string,
  opts?: {
    emailMapRaw?: string;
    mapDomainsRaw?: string;
  },
): string {
  const normalized = email.trim().toLowerCase();
  if (!normalized.includes('@')) return normalized;

  const explicit = parseTalentDeskEmailMap(
    opts?.emailMapRaw ?? Deno.env.get('TALENTDESK_EMAIL_MAP'),
  );
  const override = explicit.get(normalized);
  if (override) return override;

  if (normalized.endsWith('@recruit619.com')) return normalized;

  const at = normalized.lastIndexOf('@');
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (!local) return normalized;

  const mapDomains = parseCsvLower(
    opts?.mapDomainsRaw ?? Deno.env.get('TALENTDESK_MAP_DOMAINS'),
  );
  const domains =
    mapDomains.length > 0 ? mapDomains : DEFAULT_TAGE_MAP_DOMAINS;
  if (domains.includes(domain)) {
    return `${local}@recruit619.com`;
  }

  return normalized;
}

/** Mirror TalentDesk allowlist after mapping: @recruit619.com + AUTH_ALLOWLIST. */
export function isTalentDeskSsoEmailAllowed(
  portalEmail: string,
  talentDeskEmail: string,
  allowlistRaw?: string,
): boolean {
  const portal = portalEmail.trim().toLowerCase();
  const td = talentDeskEmail.trim().toLowerCase();
  if (td.endsWith('@recruit619.com')) return true;
  if (portal.endsWith('@recruit619.com')) return true;

  const extra = parseCsvLower(
    allowlistRaw ?? Deno.env.get('AUTH_ALLOWLIST'),
  );
  return extra.includes(td) || extra.includes(portal);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function stringToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

async function hmacSha256(
  secret: string,
  data: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  return new Uint8Array(sig);
}

export type PortalSsoClaims = {
  email: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  jti: string;
};

export async function signPortalSsoToken(
  email: string,
  secret: string,
  ttlSeconds = PORTAL_SSO_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: PortalSsoClaims = {
    email: email.trim().toLowerCase(),
    iss: PORTAL_SSO_ISS,
    aud: PORTAL_SSO_AUD,
    iat: now,
    exp: now + ttlSeconds,
    jti: crypto.randomUUID(),
  };

  const header = stringToBase64Url(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' }),
  );
  const body = stringToBase64Url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;
  const signature = bytesToBase64Url(await hmacSha256(secret, signingInput));
  return `${signingInput}.${signature}`;
}

export function normalizeTalentDeskNextPath(next: unknown): string {
  if (typeof next !== 'string' || !next.startsWith('/') || next.startsWith('//')) {
    return '/placement';
  }
  // Block protocol-relative / open-redirect style paths
  if (next.includes('://') || next.includes('\\')) {
    return '/placement';
  }
  return next.slice(0, 200);
}
