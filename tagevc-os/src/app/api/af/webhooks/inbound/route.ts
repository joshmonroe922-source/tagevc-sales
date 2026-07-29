import { NextResponse } from 'next/server';
import {
  buildEnvelope,
  handleInboundOsEvent,
  type AfEventEnvelope,
} from '@/lib/af/bus/events';
import { INBOUND_EVENT_TYPES } from '@/lib/af/bus/openapi';

export const dynamic = 'force-dynamic';

/**
 * POST /api/af/webhooks/inbound
 * OS → Accounting. Idempotency-Key header = event_id (Spec - API Webhooks).
 */
export async function POST(request: Request) {
  let body: Partial<AfEventEnvelope>;
  try {
    body = (await request.json()) as Partial<AfEventEnvelope>;
  } catch {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Invalid JSON' } },
      { status: 400 },
    );
  }

  const idempotency =
    request.headers.get('Idempotency-Key')?.trim() || body.event_id;
  if (!idempotency) {
    return NextResponse.json(
      {
        error: {
          code: 'VALIDATION',
          message: 'Idempotency-Key header or event_id required',
        },
      },
      { status: 400 },
    );
  }
  if (!body.event_type) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'event_type required' } },
      { status: 400 },
    );
  }

  const known = (INBOUND_EVENT_TYPES as readonly string[]).includes(
    body.event_type,
  );
  const envelope = buildEnvelope({
    eventType: body.event_type,
    entityCode: body.entity_code ?? null,
    sourceSystem: body.source_system ?? 'os',
    payload: body.payload ?? {},
    eventId: idempotency,
    occurredAt: body.occurred_at,
  });

  const result = await handleInboundOsEvent(envelope);
  if (result.action === 'duplicate_ignored') {
    return NextResponse.json(
      { ok: true, duplicate: true, action: result.action },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    known_inbound: known,
    action: result.action,
    ref_id: result.refId,
    event_id: envelope.event_id,
  });
}
