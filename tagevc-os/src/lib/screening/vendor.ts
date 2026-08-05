/**
 * Verified First vendor client — fail-closed unless VERIFIED_FIRST_LIVE=1.
 * No fabricated clear results. Human confirm required before every live order.
 *
 * Auth (public VF docs + Client Resource Center): HTTP Basic
 * (username + password), NOT Bearer API key / OAuth.
 * Default base: https://api1.verifiedfirst.com/external/verified-first
 * (staging: https://api2.verifiedfirst.com/external/verified-first).
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
  /** Optional VF account UUID when ordering for a sub-account. */
  accountId?: string;
};

export type VendorOrderResult =
  | {
      ok: true;
      externalOrderId: string;
      rawStatus: string;
      live: boolean;
    }
  | { ok: false; error: string; code: string; live: boolean };

export type VerifiedFirstCredentials = {
  username: string;
  password: string;
};

/** Production API root (path prefix includes /external/verified-first). */
export const VERIFIED_FIRST_DEFAULT_API_BASE =
  'https://api1.verifiedfirst.com/external/verified-first';

/** Staging/test API root per VF Client Resource Center. */
export const VERIFIED_FIRST_STAGING_API_BASE =
  'https://api2.verifiedfirst.com/external/verified-first';

/**
 * Resolve Basic Auth credentials.
 * Prefer VERIFIED_FIRST_API_USERNAME + VERIFIED_FIRST_API_PASSWORD.
 * Falls back to VERIFIED_FIRST_API_KEY as `username:password` (legacy env name).
 */
export function resolveVerifiedFirstCredentials(): VerifiedFirstCredentials | null {
  const username = process.env.VERIFIED_FIRST_API_USERNAME?.trim() ?? '';
  const password = process.env.VERIFIED_FIRST_API_PASSWORD?.trim() ?? '';
  if (username && password) {
    return { username, password };
  }

  const legacy = process.env.VERIFIED_FIRST_API_KEY?.trim() ?? '';
  if (legacy.includes(':')) {
    const idx = legacy.indexOf(':');
    const u = legacy.slice(0, idx).trim();
    const p = legacy.slice(idx + 1);
    if (u && p) return { username: u, password: p };
  }

  return null;
}

export function verifiedFirstApiConfigured(): boolean {
  return resolveVerifiedFirstCredentials() !== null;
}

function basicAuthHeader(creds: VerifiedFirstCredentials): string {
  const token = Buffer.from(
    `${creds.username}:${creds.password}`,
    'utf8',
  ).toString('base64');
  return `Basic ${token}`;
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: 'Unknown', lastName: 'Subject' };
  if (parts.length === 1) return { firstName: parts[0]!, lastName: 'Subject' };
  return {
    firstName: parts[0]!,
    lastName: parts.slice(1).join(' '),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** Extract order id from VF create-order response envelope. */
export function extractVerifiedFirstOrderId(
  body: Record<string, unknown>,
): string {
  const nested = asRecord(body.order);
  return String(
    nested?.order_id ??
      nested?.id ??
      body.order_id ??
      body.id ??
      body.external_order_id ??
      '',
  ).trim();
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

  const packageId = String(input.vendorPackageId ?? '').trim();
  if (!packageId) {
    return {
      ok: false,
      error:
        'vendor_package_id required for live Verified First orders (map os_screening_packages.vendor_package_id).',
      code: 'missing_package_id',
      live: true,
    };
  }

  const base =
    process.env.VERIFIED_FIRST_API_BASE?.trim() ||
    VERIFIED_FIRST_DEFAULT_API_BASE;

  const names = {
    firstName:
      input.subject.firstName?.trim() ||
      splitFullName(input.subject.fullName).firstName,
    lastName:
      input.subject.lastName?.trim() ||
      splitFullName(input.subject.fullName).lastName,
  };

  const partnerIds: string[] = [];
  if (input.idempotencyKey) partnerIds.push(input.idempotencyKey);
  const refId = input.consumerRef.application_id ?? input.consumerRef.hris_run_id;
  if (refId != null && String(refId).trim()) {
    partnerIds.push(String(refId).trim());
  }

  const accountId =
    input.accountId?.trim() ||
    String(input.consumerRef.vf_account_id ?? '').trim() ||
    undefined;

  // Default app_invitation — spine usually lacks SSN/DOB for instant orders.
  const searchType =
    String(process.env.VERIFIED_FIRST_SEARCH_TYPE?.trim() || 'app_invitation') ||
    'app_invitation';

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/order`, {
      method: 'POST',
      headers: {
        Authorization: basicAuthHeader(creds),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        order: {
          search_type: searchType,
          package_id: packageId,
          ...(accountId ? { account_id: accountId } : {}),
          first_name: names.firstName,
          last_name: names.lastName,
          ...(input.subject.email?.trim()
            ? { email: input.subject.email.trim() }
            : {}),
          ...(input.subject.phone?.trim()
            ? { phone: input.subject.phone.trim() }
            : {}),
          ...(partnerIds.length
            ? { partner_applicant_ids: [...new Set(partnerIds)] }
            : {}),
          // Local spine package code for support reconciliation (ignored if VF rejects unknown fields).
          partner_package_code: input.packageCode,
          partner_metadata: input.consumerRef,
        },
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

    const externalOrderId = extractVerifiedFirstOrderId(body);
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
        asRecord(body.order)?.status ?? body.status ?? 'ordered',
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
