/**
 * PostgREST PGRST303 ("JWT issued at future") is a platform clock/cache bug.
 * Waiting only helps when PostgREST's clock is advancing. After a DB upgrade
 * the REST clock can stay stale, so user JWTs keep failing.
 *
 * Next-step fix: Auth (`/auth/v1`) still uses the user session. On PGRST303
 * for `/rest/v1` and `/storage/v1`, retry once with the long-lived service-role
 * key (old `iat`, so PostgREST accepts it). Never swap `/auth/v1`.
 */

const SKEW_PATTERN =
  /PGRST303|jwt issued at future|issued at future|clock skew/i;

const BY_SECONDS_PATTERN = /issued at future(?: by (\d+) seconds?)?/i;

/** Extra slack after `iat` for PostgREST threads with a stale clock. */
export const JWT_IAT_LEEWAY_MS = 2_000;
export const JWT_IAT_MAX_WAIT_MS = 15_000;
export const JWT_SKEW_RETRY_MAX_WAIT_MS = 45_000;
export const JWT_SKEW_MAX_ATTEMPTS = 6;

export function isJwtSkewMessage(message: string | undefined | null): boolean {
  if (!message) return false;
  return SKEW_PATTERN.test(message);
}

export function jwtSkewMitigationEnabled(): boolean {
  return (
    process.env.DISABLE_JWT_SKEW_MITIGATION !== '1' &&
    process.env.R619_DISABLE_JWT_SKEW_MITIGATION !== '1'
  );
}

export function parseIssuedAtFutureWaitMs(message: string): number {
  const match = message.match(BY_SECONDS_PATTERN);
  if (match?.[1] != null) {
    const seconds = Number(match[1]);
    if (Number.isFinite(seconds) && seconds >= 0) {
      const extra = seconds === 0 ? 0 : 1_000;
      return Math.min(JWT_SKEW_RETRY_MAX_WAIT_MS, seconds * 1000 + extra);
    }
  }
  return 8_000;
}

export function msUntilJwtIatReady(
  iatSeconds: number,
  nowMs: number = Date.now(),
  leewayMs: number = JWT_IAT_LEEWAY_MS,
  maxMs: number = JWT_IAT_MAX_WAIT_MS,
): number {
  const readyAt = iatSeconds * 1000 + leewayMs;
  return Math.min(maxMs, Math.max(0, readyAt - nowMs));
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isPostgrestDataUrl(url: string): boolean {
  return url.includes('/rest/v1/') || url.includes('/storage/v1/');
}

export function decodeJwtIat(authorization: string | null | undefined): number | null {
  if (!authorization) return null;
  const token = authorization.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return null;
  try {
    const payload = decodeJwtPayload(parts[1]);
    return typeof payload.iat === 'number' ? payload.iat : null;
  } catch {
    return null;
  }
}

function decodeJwtPayload(segment: string): { iat?: number } {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad =
    padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  const json = atob(padded + pad);
  return JSON.parse(json) as { iat?: number };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function authorizationFrom(
  input: RequestInfo | URL,
  init?: RequestInit,
): string | null {
  if (init?.headers) {
    const fromInit = new Headers(init.headers).get('Authorization');
    if (fromInit) return fromInit;
  }
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return input.headers.get('Authorization');
  }
  return null;
}

export function applyServiceRoleAuth(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  serviceKey: string,
): { input: RequestInfo | URL; init?: RequestInit } {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    const headers = new Headers(input.headers);
    headers.set('Authorization', `Bearer ${serviceKey}`);
    headers.set('apikey', serviceKey);
    return { input: new Request(input, { headers }), init };
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${serviceKey}`);
  headers.set('apikey', serviceKey);
  return { input, init: { ...init, headers } };
}

function serviceRoleKey(): string | undefined {
  if (typeof window !== 'undefined') return undefined;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  return key || undefined;
}

async function skewWaitFromResponse(res: Response): Promise<number | null> {
  const header = [
    res.headers.get('www-authenticate'),
    res.headers.get('proxy-status'),
  ]
    .filter(Boolean)
    .join('\n');
  let body = '';
  try {
    body = await res.clone().text();
  } catch {
    body = '';
  }
  const combined = `${body}\n${header}`;
  if (!isJwtSkewMessage(combined)) return null;
  return parseIssuedAtFutureWaitMs(combined);
}

const BACKOFF_MS = [0, 250, 1_000, 3_000, 8_000, 12_000];

/** Wrap fetch for Supabase clients — hold the same JWT, then service-role fallback. */
export function createPostgrestJwtSkewFetch(
  inner: typeof fetch = globalThis.fetch.bind(globalThis),
): typeof fetch {
  return async function postgrestJwtSkewFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    if (!jwtSkewMitigationEnabled()) {
      return inner(input, init);
    }

    const roleKey = serviceRoleKey();
    const iat = decodeJwtIat(authorizationFrom(input, init));
    // Service-role fallback is instant — don't stall first paint waiting on iat.
    if (iat != null && !roleKey) {
      const wait = msUntilJwtIatReady(iat);
      if (wait > 0) await sleep(wait);
    }

    let res = await inner(input, init);
    let skewWait = await skewWaitFromResponse(res);
    if (skewWait == null) return res;

    const url = requestUrl(input);
    if (roleKey && isPostgrestDataUrl(url)) {
      const swapped = applyServiceRoleAuth(input, init, roleKey);
      return inner(swapped.input, swapped.init);
    }

    for (let attempt = 1; attempt < JWT_SKEW_MAX_ATTEMPTS; attempt += 1) {
      const wait = Math.max(BACKOFF_MS[attempt] ?? 8_000, skewWait);
      await sleep(wait);
      res = await inner(input, init);
      skewWait = await skewWaitFromResponse(res);
      if (skewWait == null) return res;
    }

    return res;
  };
}
