import { NextResponse } from 'next/server';
import { runIesSync } from '@/lib/ies/sync';
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
    Boolean(secret) &&
    Boolean(bearer) &&
    bearer === `Bearer ${secret}`;

  if ((secret && header === secret) || bearerOk) {
    return { ok: true, source: 'cron' };
  }
  if (request.headers.get('x-vercel-cron') === '1' && !secret) {
    return { ok: true, source: 'cron' };
  }

  const gate = await guardPermission('write:shared_services');
  if (gate.ok) return { ok: true, source: 'admin' };

  if (secret) {
    return { ok: false, status: 401, error: 'Unauthorized' };
  }
  return { ok: false, status: 403, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const url = new URL(request.url);
  const entityId = url.searchParams.get('entity')?.trim() || null;
  const result = await runIesSync({
    trigger: auth.source === 'cron' ? 'cron' : 'manual',
    entity_id: entityId,
  });

  try {
    const { writeAuditEvent } = await import('@/lib/audit/write');
    await writeAuditEvent({
      action: 'finance_sync',
      title: `IES sync · ${result.status}`,
      object_type: 'ies_sync',
      object_id: result.run_id,
      metadata: {
        attempted: result.attempted,
        succeeded: result.succeeded,
        failed: result.failed,
        message: result.message,
      },
    });
  } catch {
    /* ignore */
  }

  return NextResponse.json(result, {
    status: result.status === 'failed' ? 502 : 200,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
