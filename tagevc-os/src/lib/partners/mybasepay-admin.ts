/**
 * MyBasePay interim admin bridge — session login against backoffice API.
 * Replace with official partner API (same partner_key=mybasepay) in October.
 * Never log passwords or JWTs.
 */

import {
  isMyBasePayLive,
  mybasepayApiBase,
  resolveMyBasePayEntity,
  type MyBasePayResolution,
} from '@/lib/partners/mybasepay-entity';

type AdapterResult =
  | {
      ok: true;
      dryRun: boolean;
      status: 'dry_run' | 'live_ok' | 'failed';
      message: string;
      externalRef?: string;
    }
  | {
      ok: false;
      error: string;
      dryRun?: boolean;
      status: 'dry_run' | 'live_ok' | 'failed';
    };

export type MyBasePayLoginResult =
  | {
      ok: true;
      status: number;
      /** Token present but never returned to callers outside this module. */
      hasToken: true;
      message: string;
    }
  | {
      ok: false;
      status: number | null;
      error: string;
      needsMfa?: boolean;
    };

export type MyBasePayWorkerType =
  | 'W2'
  | 'IC'
  | 'INTERNATIONAL_IC'
  | 'SC';

/** UI radio values observed on create-worker form. */
export const MYBASEPAY_WORKER_TYPE_IDS: Record<MyBasePayWorkerType, number> = {
  W2: 1,
  IC: 2,
  SC: 3,
  INTERNATIONAL_IC: 4,
};

export type MyBasePayCreateWorkerInput = {
  entityId: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  workerType?: MyBasePayWorkerType;
  country?: string;
  state?: string;
  city?: string;
  address?: string;
  zip?: string;
};

type SessionToken = { token: string; obtainedAt: number };

let cachedSession: SessionToken | null = null;

function adminEmail(): string | null {
  return process.env.MYBASEPAY_ADMIN_EMAIL?.trim() || null;
}

function adminPassword(): string | null {
  return process.env.MYBASEPAY_ADMIN_PASSWORD?.trim() || null;
}

/** Clear in-memory JWT (tests / logout). */
export function clearMyBasePaySessionCache(): void {
  cachedSession = null;
}

/**
 * Login smoke / session obtain via official backoffice account-service.
 * Fail-closed on MFA / CAPTCHA / non-200 — surfaces needsMfa for human.
 */
export async function mybasepayAdminLogin(opts?: {
  force?: boolean;
}): Promise<MyBasePayLoginResult> {
  const email = adminEmail();
  const password = adminPassword();
  if (!email || !password) {
    return {
      ok: false,
      status: null,
      error:
        'Missing MYBASEPAY_ADMIN_EMAIL / MYBASEPAY_ADMIN_PASSWORD (vault/env only).',
    };
  }

  if (!opts?.force && cachedSession?.token) {
    return {
      ok: true,
      status: 200,
      hasToken: true,
      message: 'MyBasePay admin session cache hit.',
    };
  }

  const url = `${mybasepayApiBase()}/account-service/user/login`;
  let res: Response;
  try {
    // SPA login payload: email + password + applicationType=Backoffice(2).
    // Omitting applicationType yields opaque 500 from account-service.
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Origin: 'https://backoffice.mybasepay.com',
        Referer: 'https://backoffice.mybasepay.com/login',
      },
      body: JSON.stringify({
        email,
        password,
        applicationType: 2, // Backoffice (Marketplace=1)
      }),
    });
  } catch {
    return {
      ok: false,
      status: null,
      error: 'MyBasePay login network failure.',
    };
  }

  if (res.status === 401 || res.status === 403) {
    return {
      ok: false,
      status: res.status,
      error: 'MyBasePay login rejected (check credentials).',
    };
  }

  // MFA / 2FA surfaces as dedicated endpoint in SPA; treat 428/422/custom carefully.
  if (res.status === 428 || res.status === 449) {
    return {
      ok: false,
      status: res.status,
      needsMfa: true,
      error: 'MyBasePay login requires MFA — NEED_HUMAN.',
    };
  }

  let body: unknown = null;
  const text = await res.text();
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }

  if (!res.ok) {
    const hint =
      body &&
      typeof body === 'object' &&
      body !== null &&
      'message' in body &&
      typeof (body as { message: unknown }).message === 'string'
        ? String((body as { message: string }).message).slice(0, 120)
        : `HTTP ${res.status}`;
    const needsMfa = /two.?factor|mfa|2fa|otp/i.test(hint);
    return {
      ok: false,
      status: res.status,
      needsMfa,
      error: needsMfa
        ? 'MyBasePay login requires MFA — NEED_HUMAN.'
        : `MyBasePay login failed (${hint}).`,
    };
  }

  const token = extractToken(body);
  const authCode = extractAuthCode(body);
  // SPA: when authCode is present, continue via login-two-factor-auth.
  if (authCode) {
    return {
      ok: false,
      status: res.status,
      needsMfa: true,
      error: 'MyBasePay login requires MFA — NEED_HUMAN.',
    };
  }
  if (!token) {
    if (
      body &&
      typeof body === 'object' &&
      body !== null &&
      ('requiresTwoFactor' in body ||
        'twoFactorRequired' in body ||
        'isTwoFactorEnabled' in body)
    ) {
      return {
        ok: false,
        status: res.status,
        needsMfa: true,
        error: 'MyBasePay login requires MFA — NEED_HUMAN.',
      };
    }
    return {
      ok: false,
      status: res.status,
      error: 'MyBasePay login response missing token.',
    };
  }

  cachedSession = { token, obtainedAt: Date.now() };
  return {
    ok: true,
    status: res.status,
    hasToken: true,
    message: 'MyBasePay admin login OK.',
  };
}

function extractAuthCode(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const raw = o.authCode ?? o.AuthCode;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === 'null' || trimmed.toLowerCase() === 'none') {
    return null;
  }
  return trimmed;
}

function extractToken(body: unknown): string | null {
  if (!body) return null;
  if (typeof body === 'string' && body.trim().length > 20) return body.trim();
  if (typeof body !== 'object' || body === null) return null;
  const o = body as Record<string, unknown>;
  for (const key of [
    'token',
    'accessToken',
    'access_token',
    'jwt',
    'jwtToken',
    'JwtToken',
  ]) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  // Nested data / result shapes
  for (const nest of ['data', 'result', 'payload']) {
    const inner = o[nest];
    if (inner && typeof inner === 'object') {
      const t = extractToken(inner);
      if (t) return t;
    }
  }
  return null;
}

async function authHeaders(): Promise<
  | { ok: true; headers: Record<string, string> }
  | { ok: false; login: MyBasePayLoginResult }
> {
  const login = await mybasepayAdminLogin();
  if (!login.ok || !cachedSession?.token) {
    return {
      ok: false,
      login: login.ok
        ? {
            ok: false,
            status: login.status,
            error: 'MyBasePay session missing after login.',
          }
        : login,
    };
  }
  const token = cachedSession.token;
  // SPA interceptor uses lowercase "bearer ".
  const auth = token.toLowerCase().startsWith('bearer ')
    ? token
    : `bearer ${token}`;
  return {
    ok: true,
    headers: {
      Authorization: auth,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
  };
}

/** Capability check used by smoke: list page 0 of workers (read-only). */
export async function mybasepayListWorkersPage(opts?: {
  pageNumber?: number;
}): Promise<
  | { ok: true; status: number; countHint: number | null }
  | { ok: false; error: string; status?: number; needsMfa?: boolean }
> {
  const auth = await authHeaders();
  if (!auth.ok) {
    return {
      ok: false,
      error: auth.login.ok ? 'login failed' : auth.login.error,
      status: auth.login.ok ? undefined : (auth.login.status ?? undefined),
      needsMfa: auth.login.ok ? undefined : auth.login.needsMfa,
    };
  }
  const page = opts?.pageNumber ?? 0;
  const url = `${mybasepayApiBase()}/backoffice/workers/paged?pageNumber=${page}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: auth.headers });
  } catch {
    return { ok: false, error: 'MyBasePay workers list network failure.' };
  }
  if (!res.ok) {
    await res.arrayBuffer();
    return {
      ok: false,
      status: res.status,
      error: `MyBasePay workers list failed HTTP ${res.status}.`,
    };
  }
  const text = await res.text();
  let countHint: number | null = null;
  try {
    const json = text ? JSON.parse(text) : null;
    if (Array.isArray(json)) countHint = json.length;
    else if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      if (Array.isArray(o.items)) countHint = o.items.length;
      else if (Array.isArray(o.data)) countHint = o.data.length;
      else if (typeof o.totalCount === 'number') countHint = o.totalCount;
      else if (typeof o.total === 'number') countHint = o.total;
    }
  } catch {
    countHint = null;
  }
  return { ok: true, status: res.status, countHint };
}

/**
 * Create contractor/worker — gated by MYBASEPAY_LIVE=1.
 * Dry-run documents payload without calling create.
 */
export async function mybasepayCreateWorker(
  input: MyBasePayCreateWorkerInput,
): Promise<AdapterResult> {
  const resolved = await resolveMyBasePayEntity(input.entityId);
  if (!resolved.allowed || !resolved.entityId) {
    return {
      ok: false,
      status: 'failed',
      error: `MyBasePay refuse — entity ${input.entityId} not allow-listed (ENT-R619 only).`,
    };
  }
  if (!resolved.credentialsReady) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message:
        'MyBasePay create worker stub — set MYBASEPAY_ADMIN_* (interim) or MYBASEPAY_API_KEY.',
    };
  }
  if (!isMyBasePayLive()) {
    return {
      ok: true,
      dryRun: true,
      status: 'dry_run',
      message: `MyBasePay create worker dry-run for ${resolved.entityId} (${resolved.source}) — MYBASEPAY_LIVE≠1. Would POST /backoffice/workers type=${input.workerType ?? 'IC'}.`,
      externalRef: resolved.externalAccountId ?? undefined,
    };
  }

  const auth = await authHeaders();
  if (!auth.ok) {
    return {
      ok: false,
      status: 'failed',
      dryRun: false,
      error: auth.login.ok ? 'session missing' : auth.login.error,
    };
  }

  const workerType = input.workerType ?? 'IC';
  const payload = {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email: input.email.trim(),
    phoneNumber: input.phone.trim(),
    workerTypeId: MYBASEPAY_WORKER_TYPE_IDS[workerType],
    country: input.country ?? 'United States',
    state: input.state,
    city: input.city,
    address: input.address,
    zip: input.zip,
  };

  // Live path reserved — still refuse automated production creates until Josh
  // explicitly enables a safe test create. LIVE alone is not enough.
  if (process.env.MYBASEPAY_ALLOW_CREATE?.trim() !== '1') {
    return {
      ok: false,
      status: 'failed',
      dryRun: false,
      error:
        'MyBasePay LIVE but MYBASEPAY_ALLOW_CREATE≠1 — refusing worker create (fail-closed).',
    };
  }

  const url = `${mybasepayApiBase()}/backoffice/workers`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: auth.headers,
      body: JSON.stringify(payload),
    });
  } catch {
    return {
      ok: false,
      status: 'failed',
      error: 'MyBasePay create worker network failure.',
    };
  }

  if (!res.ok) {
    await res.arrayBuffer();
    return {
      ok: false,
      status: 'failed',
      error: `MyBasePay create worker failed HTTP ${res.status}.`,
    };
  }

  const text = await res.text();
  let externalRef: string | undefined;
  try {
    const json = text ? JSON.parse(text) : null;
    if (json && typeof json === 'object') {
      const o = json as Record<string, unknown>;
      for (const k of ['id', 'workerId', 'key', 'workerKey']) {
        if (typeof o[k] === 'string' || typeof o[k] === 'number') {
          externalRef = String(o[k]);
          break;
        }
      }
    }
  } catch {
    /* ignore */
  }

  return {
    ok: true,
    dryRun: false,
    status: 'live_ok',
    message: `MyBasePay worker created for ${resolved.entityId}.`,
    externalRef,
  };
}

export async function describeMyBasePayBridge(
  entityId: string,
): Promise<{ resolution: MyBasePayResolution; live: boolean }> {
  return {
    resolution: await resolveMyBasePayEntity(entityId),
    live: isMyBasePayLive(),
  };
}
