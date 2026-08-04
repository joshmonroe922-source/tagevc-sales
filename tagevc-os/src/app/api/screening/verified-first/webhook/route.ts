import { createHmac, timingSafeEqual } from 'crypto';
import { NextResponse } from 'next/server';

import { applyScreeningStatusUpdate } from '@/lib/screening/repo';
import { captureException } from '@/lib/observability';
import { normalizeVerifiedFirstWebhookBody } from '@/lib/screening/webhook-payload';

/**
 * Verified First status webhook.
 * Auth: header `x-verified-first-signature` (HMAC-SHA256 of raw body) OR
 * `x-tagevc-webhook-secret` === VERIFIED_FIRST_WEBHOOK_SECRET.
 * Accepts scaffold flat JSON or VF `status_update` post-backs.
 * Idempotent: same external_order_id + status re-apply is safe.
 */
function authorize(
  request: Request,
  rawBody: string,
): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.VERIFIED_FIRST_WEBHOOK_SECRET?.trim();
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      return { ok: false, status: 401, error: 'Webhook secret not configured' };
    }
    return { ok: true };
  }

  const shared = request.headers.get('x-tagevc-webhook-secret');
  if (shared && shared === secret) return { ok: true };

  const sig =
    request.headers.get('x-verified-first-signature') ||
    request.headers.get('x-signature');
  if (sig) {
    const computed = createHmac('sha256', secret).update(rawBody).digest('hex');
    try {
      const a = Buffer.from(computed);
      const b = Buffer.from(sig.trim());
      if (a.length === b.length && timingSafeEqual(a, b)) return { ok: true };
    } catch {
      /* fall through */
    }
  }

  return { ok: false, status: 401, error: 'Unauthorized' };
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const auth = authorize(request, rawBody);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const normalized = normalizeVerifiedFirstWebhookBody(body);
  if ('error' in normalized) {
    return NextResponse.json({ error: normalized.error }, { status: 400 });
  }

  const { externalOrderId, orderId, rawStatus, reportStoragePath } =
    normalized;

  try {
    const { order, error } = await applyScreeningStatusUpdate({
      orderId: orderId || undefined,
      externalOrderId: externalOrderId || undefined,
      rawStatus,
      reportStoragePath,
      persistClient: true,
    });
    if (error || !order) {
      return NextResponse.json(
        { error: error ?? 'Update failed' },
        { status: 404 },
      );
    }
    return NextResponse.json({
      ok: true,
      order_id: order.id,
      status: order.status,
    });
  } catch (e) {
    captureException(e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Webhook failed' },
      { status: 500 },
    );
  }
}
