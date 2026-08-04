/**
 * Verified First vendor client — fail-closed unless VERIFIED_FIRST_LIVE=1.
 * No fabricated clear results. Human confirm required before every live order.
 *
 * Auth (public VF docs + help center): HTTP Basic username/password against
 * api1 (prod) / api2 (staging). Not Bearer / not OAuth for the REST order API.
 */

import { isVerifiedFirstLive } from '@/lib/screening/types';

export type VendorOrderRequest = {
  packageCode: string;
  vendorPackageId?: string;
  subject: {
    firstName?: string;
    lastName?: string;
    fullName: string;
    email?: string;
    phone?: string;
  };
  consumerRef: Record<string, unknown>;
  idempotencyKey: string;
  /** Must be true — no silent sends. */
  humanConfirmed: boolean;
};

export type VendorOrderResult =
  | {
      ok: true;
      externalOrderId: string;
      rawStatus: string;
      live: boolean;
    }
  | { ok: false; error: string; code: string; live: boolean };

/** Prod host from VF Standard API Request Formats. Override with API_BASE. */
export const VERIFIED_FIRST_DEFAULT_API_BASE =
  'https://api1.verifiedfirst.com';

/** Staging/test host from the same VF docs. */
export const VERIFIED_FIRST_STAGING_API_BASE =
  'https://api2.verifiedfirst.com';

const ORDER_PATH = '/external/verified-first/order';

export type VerifiedFirstCredentials = {
  username: string;
  password: string;
};

/**
 * Resolve Basic Auth credentials.
 * Prefer VERIFIED_FIRST_API_USERNAME + VERIFIED_FIRST_API_PASSWORD.
 * Fallback: VERIFIED_FIRST_API_KEY as `username:password`, or as password
 * when USERNAME is also set (PR #4 env name compatibility).
 */
export function resolveVerifiedFirstCredentials(
  env: NodeJS.ProcessEnv = process.env,
): VerifiedFirstCredentials | null {
  const username = env.VERIFIED_FIRST_API_USERNAME?.trim() ?? '';
  const password = env.VERIFIED_FIRST_API_PASSWORD?.trim() ?? '';
  if (username && password) {
    return { username, password };
  }

  const key = env.VERIFIED_FIRST_API_KEY?.trim() ?? '';
  if (!key) return null;

  const colon = key.indexOf(':');
  if (colon > 0) {
    return {
      username: key.slice(0, colon),
      password: key.slice(colon + 1),
    };
  }

  if (username && key) {
    return { username, password: key };
  }

  return null;
}

export function verifiedFirstBasicAuthHeader(
  creds: VerifiedFirstCredentials,
): string {
  const token = Buffer.from(
    `${creds.username}:${creds.password}`,
    'utf8',
  ).toString('base64');
  return `Basic ${token}`;
}

export function verifiedFirstApiConfigured(): boolean {
  return resolveVerifiedFirstCredentials() !== null;
}

function splitName(subject: VendorOrderRequest['subject']): {
  first_name: string;
  last_name: string;
} {
  const first = subject.firstName?.trim();
  const last = subject.lastName?.trim();
  if (first || last) {
    return {
      first_name: first || '',
      last_name: last || '',
    };
  }
  const parts = subject.fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: '' };
  if (parts.length === 1) return { first_name: parts[0]!, last_name: '' };
  return {
    first_name: parts[0]!,
    last_name: parts.slice(1).join(' '),
  };
}

/**
 * Place a vendor order. When LIVE=0 (default), returns a blocked error —
 * spine order stays pending/ordered locally without claiming vendor clear.
 */
export async function placeVerifiedFirstOrder(
  input: VendorOrderRequest,
): Promise<VendorOrderResult> {
  if (!input.humanConfirmed) {
    return {
      ok: false,
      error: 'Human confirmation required before every Verified First order.',
      code: 'confirm_required',
      live: isVerifiedFirstLive(),
    };
  }

  if (!isVerifiedFirstLive()) {
    return {
      ok: false,
      error:
        'VERIFIED_FIRST_LIVE is not enabled (fail-closed). Order recorded as ready; vendor API not called.',
      code: 'live_disabled',
      live: false,
    };
  }

  const creds = resolveVerifiedFirstCredentials();
  if (!creds) {
    return {
      ok: false,
      error:
        'Verified First Basic Auth credentials missing while LIVE=1 (set VERIFIED_FIRST_API_USERNAME + VERIFIED_FIRST_API_PASSWORD).',
      code: 'missing_credentials',
      live: true,
    };
  }

  const base = (
    process.env.VERIFIED_FIRST_API_BASE?.trim() ||
    VERIFIED_FIRST_DEFAULT_API_BASE
  ).replace(/\/$/, '');

  const names = splitName(input.subject);
  const packageId = (input.vendorPackageId || input.packageCode || '').trim();

  try {
    const res = await fetch(`${base}${ORDER_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: verifiedFirstBasicAuthHeader(creds),
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        // Field names align with VF help-center / docs samples; Integrations
        // packet may require additional FCRA / subject fields before LIVE=1.
        package_id: packageId || undefined,
        package_name: input.packageCode || undefined,
        first_name: names.first_name || undefined,
        last_name: names.last_name || undefined,
        email: input.subject.email || undefined,
        phone: input.subject.phone || undefined,
        metadata: input.consumerRef,
        client_reference: input.idempotencyKey,
      }),
    });

    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      body = { raw: text.slice(0, 500) };
    }

    if (!res.ok) {
      return {
        ok: false,
        error: `Verified First API HTTP ${res.status}: ${text.slice(0, 200)}`,
        code: 'vendor_http_error',
        live: true,
      };
    }

    const nestedOrder =
      body.order && typeof body.order === 'object' && !Array.isArray(body.order)
        ? (body.order as Record<string, unknown>)
        : null;

    const externalOrderId = String(
      body.order_id ??
        body.id ??
        body.external_order_id ??
        nestedOrder?.order_id ??
        nestedOrder?.id ??
        '',
    ).trim();
    if (!externalOrderId) {
      return {
        ok: false,
        error: 'Vendor response missing order id.',
        code: 'vendor_missing_id',
        live: true,
      };
    }

    return {
      ok: true,
      externalOrderId,
      rawStatus: String(
        body.status ?? nestedOrder?.status ?? 'ordered',
      ),
      live: true,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Vendor request failed',
      code: 'vendor_network',
      live: true,
    };
  }
}
