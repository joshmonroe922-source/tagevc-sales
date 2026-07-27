/**
 * Verified First vendor client — fail-closed unless VERIFIED_FIRST_LIVE=1.
 * No fabricated clear results. Human confirm required before every live order.
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

export function verifiedFirstApiConfigured(): boolean {
  return Boolean(process.env.VERIFIED_FIRST_API_KEY?.trim());
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

  const apiKey = process.env.VERIFIED_FIRST_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      error: 'VERIFIED_FIRST_API_KEY missing while LIVE=1.',
      code: 'missing_api_key',
      live: true,
    };
  }

  const base =
    process.env.VERIFIED_FIRST_API_BASE?.trim() ||
    'https://api.verifiedfirst.com/v1';

  try {
    const res = await fetch(`${base.replace(/\/$/, '')}/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': input.idempotencyKey,
      },
      body: JSON.stringify({
        package_code: input.packageCode,
        vendor_package_id: input.vendorPackageId || undefined,
        subject: input.subject,
        metadata: input.consumerRef,
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

    const externalOrderId = String(
      body.id ?? body.order_id ?? body.external_order_id ?? '',
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
      rawStatus: String(body.status ?? 'ordered'),
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
