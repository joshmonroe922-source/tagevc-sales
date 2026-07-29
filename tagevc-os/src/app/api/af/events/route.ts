import { NextResponse } from 'next/server';
import {
  buildEnvelope,
  listAfEvents,
  publishAfEvent,
  type AfEventEnvelope,
} from '@/lib/af/bus/events';
import { getSessionContext } from '@/lib/rbac/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Unauthorized' } },
      { status: 401 },
    );
  }
  const { searchParams } = new URL(request.url);
  const limit = Math.min(
    200,
    Math.max(1, Number(searchParams.get('limit') ?? 40) || 40),
  );
  const events = await listAfEvents(limit);
  return NextResponse.json({ events });
}

export async function POST(request: Request) {
  const ctx = await getSessionContext();
  if (!ctx) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'Unauthorized' } },
      { status: 401 },
    );
  }
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
  if (!body.event_type) {
    return NextResponse.json(
      { error: { code: 'VALIDATION', message: 'event_type required' } },
      { status: 400 },
    );
  }
  const envelope = buildEnvelope({
    eventType: body.event_type,
    entityCode: body.entity_code ?? null,
    sourceSystem: body.source_system ?? 'af',
    payload: body.payload ?? {},
    eventId: idempotency,
    occurredAt: body.occurred_at,
  });
  const result = await publishAfEvent({
    envelope,
    direction: 'internal',
  });
  return NextResponse.json({
    ok: true,
    duplicate: Boolean(result.duplicate),
    event_id: envelope.event_id,
  });
}
