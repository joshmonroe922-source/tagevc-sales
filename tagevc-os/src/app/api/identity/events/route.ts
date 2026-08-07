import { NextResponse } from 'next/server';
import {
  IDENTITY_CONTRACT_VERSION,
  type HrisEventType,
} from '@/lib/identity/types';
import { publishHrisEvent } from '@/lib/identity/events';
import { processHrisOutbox } from '@/lib/identity/orchestrator';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin' | 'hris' }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET ||
    process.env.CRON_SECRET ||
    process.env.HRIS_EVENT_SECRET ||
    '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const hrisHeader = request.headers.get('x-tagevc-hris-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) && Boolean(bearer) && bearer === `Bearer ${secret}`;
  if (
    (secret && header === secret) ||
    (secret && hrisHeader === secret) ||
    bearerOk
  ) {
    return { ok: true, source: hrisHeader ? 'hris' : 'cron' };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true, source: 'admin' };
  if (secret) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: false, status: 403, error: gate.error };
}

/** HRIS → Integration Layer ingest (sheet 04). Technology never invents hire/term. */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? 'publish');

    if (action === 'drain') {
      const result = await processHrisOutbox(
        typeof body.limit === 'number' ? body.limit : 10,
      );
      return NextResponse.json({
        ok: true,
        contract_version: IDENTITY_CONTRACT_VERSION,
        ...result,
        source: auth.source,
      });
    }

    const eventType = String(body.event_type ?? '') as HrisEventType;
    const entityId = String(body.entity_id ?? '');
    const payload =
      (body.payload as Record<string, unknown>) ??
      (body.body as Record<string, unknown>) ??
      {};

    if (!eventType.startsWith('hris.employee.')) {
      return NextResponse.json(
        { ok: false, error: 'event_type must be hris.employee.*' },
        { status: 400 },
      );
    }

    const published = await publishHrisEvent({
      event_type: eventType,
      entity_id: entityId || String(payload.entity_id ?? ''),
      payload,
      event_id: typeof body.event_id === 'string' ? body.event_id : undefined,
      correlation_id:
        typeof body.correlation_id === 'string'
          ? body.correlation_id
          : undefined,
      idempotency_key:
        typeof body.idempotency_key === 'string'
          ? body.idempotency_key
          : undefined,
    });

    if (!published.ok) {
      return NextResponse.json(published, { status: 400 });
    }

    let drain: Awaited<ReturnType<typeof processHrisOutbox>> | null = null;
    if (body.auto_drain !== false) {
      drain = await processHrisOutbox(5);
    }

    return NextResponse.json({
      ...published,
      ok: true as const,
      contract_version: IDENTITY_CONTRACT_VERSION,
      drain,
      source: auth.source,
    });
  } catch (e) {
    captureException(e, { route: 'identity/events POST' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'events failed' },
      { status: 500 },
    );
  }
}
