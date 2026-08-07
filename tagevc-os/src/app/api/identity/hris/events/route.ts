import { NextResponse } from 'next/server';
import { publishHrisEvent } from '@/lib/identity/events';
import { processHrisOutbox } from '@/lib/identity/orchestrator';
import { drainIdentityWorkerJobs } from '@/lib/identity/workers/drain';
import type { HrisEventType } from '@/lib/identity/types';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request): Promise<
  | { ok: true; source: 'cron' | 'admin' }
  | { ok: false; status: number; error: string }
> {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  const bearerOk =
    Boolean(secret) && Boolean(bearer) && bearer === `Bearer ${secret}`;
  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true, source: 'admin' };
  if (secret) return { ok: false, status: 401, error: 'Unauthorized' };
  return { ok: false, status: 403, error: gate.error };
}

/** Publish HRIS lifecycle event onto Integration Layer outbox. */
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
    const eventType = String(body.event_type || '') as HrisEventType;
    const nestedEntity =
      body.payload && typeof body.payload === 'object'
        ? (body.payload as Record<string, unknown>).entity_id
        : undefined;
    const entityId = String(body.entity_id || nestedEntity || '');
    const payload =
      (body.payload as Record<string, unknown>) ||
      (body.body as Record<string, unknown>) ||
      body;

    if (!eventType.startsWith('hris.employee.')) {
      return NextResponse.json(
        { ok: false, error: 'event_type must be hris.employee.*' },
        { status: 400 },
      );
    }

    const published = await publishHrisEvent({
      event_type: eventType,
      entity_id: entityId,
      payload: {
        ...payload,
        entity_id: entityId || String(payload.entity_id || ''),
      },
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

    let orchestrated = null;
    let drained = null;
    if (body.process_now !== false) {
      orchestrated = await processHrisOutbox(5);
      drained = await drainIdentityWorkerJobs(15);
    }

    return NextResponse.json({
      ...published,
      ok: true as const,
      source: auth.source,
      money_auto_approve: false as const,
      orchestrated,
      drained,
    });
  } catch (e) {
    captureException(e, { route: 'identity/hris/events POST' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'publish failed' },
      { status: 500 },
    );
  }
}
