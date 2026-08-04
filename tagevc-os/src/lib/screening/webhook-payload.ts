/**
 * Normalize Verified First / Tage screening webhook bodies into spine fields.
 * Accepts scaffold flat payloads and VF standard post-back shapes.
 */

import { mapVendorStatusToSpine } from '@/lib/screening/types';

export type NormalizedVerifiedFirstWebhook =
  | {
      externalOrderId: string;
      orderId: string;
      rawStatus: string;
      reportStoragePath: string | null;
    }
  | { error: string };

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/**
 * Prefer adjudication when VF marks Complete but still needs review / adverse.
 * Returns a string `mapVendorStatusToSpine` understands.
 */
export function resolveVerifiedFirstRawStatus(
  status: string | null | undefined,
  adjudication: string | null | undefined,
): string {
  const adj = (adjudication ?? '').trim();
  if (adj) {
    const mapped = mapVendorStatusToSpine(adj);
    if (mapped === 'review') return 'needs_review';
    if (mapped === 'failed') return 'adverse';
    if (mapped === 'clear') return 'clear';
  }
  return (status ?? '').trim();
}

export function normalizeVerifiedFirstWebhookBody(
  body: Record<string, unknown>,
): NormalizedVerifiedFirstWebhook {
  const statusUpdate = asRecord(body.status_update);
  const nested = statusUpdate ?? {};

  const externalOrderId = String(
    body.external_order_id ??
      body.order_id ??
      body.id ??
      nested.order_id ??
      nested.order_number ??
      '',
  ).trim();

  const orderId = String(
    body.spine_order_id ?? body.orderId ?? '',
  ).trim();

  const rawStatus = resolveVerifiedFirstRawStatus(
    String(body.status ?? body.raw_status ?? nested.status ?? ''),
    String(body.adjudication ?? nested.adjudication ?? ''),
  );

  if ((!externalOrderId && !orderId) || !rawStatus) {
    return {
      error: 'external_order_id (or spine_order_id) and status required',
    };
  }

  const reportStoragePath = body.report_path
    ? String(body.report_path)
    : nested.url
      ? String(nested.url)
      : body.report_url
        ? String(body.report_url)
        : null;

  return {
    externalOrderId,
    orderId,
    rawStatus,
    reportStoragePath,
  };
}

/** @deprecated Prefer normalizeVerifiedFirstWebhookBody */
export const normalizeScreeningWebhookBody = normalizeVerifiedFirstWebhookBody;
