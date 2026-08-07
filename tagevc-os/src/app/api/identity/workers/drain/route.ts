import { NextResponse } from 'next/server';
import { processHrisOutbox } from '@/lib/identity/orchestrator';
import { drainIdentityWorkerJobs } from '@/lib/identity/workers/drain';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

async function authorize(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const bearer = request.headers.get('authorization');
  if (
    (secret && header === secret) ||
    (secret && bearer === `Bearer ${secret}`)
  ) {
    return { ok: true as const, source: 'cron' as const };
  }
  const gate = await guardPermission('write:it_assets');
  if (gate.ok) return { ok: true as const, source: 'admin' as const };
  return { ok: false as const, status: secret ? 401 : 403, error: gate.error || 'Unauthorized' };
}

/** Cron/admin: process HRIS outbox + drain worker jobs. */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }
  try {
    const body = (await request.json().catch(() => ({}))) as {
      outbox_limit?: number;
      job_limit?: number;
    };
    const orchestrated = await processHrisOutbox(body.outbox_limit ?? 20);
    const drained = await drainIdentityWorkerJobs(body.job_limit ?? 25);
    return NextResponse.json({
      ok: true,
      source: auth.source,
      money_auto_approve: false as const,
      orchestrated,
      drained,
    });
  } catch (e) {
    captureException(e, { route: 'identity/workers/drain POST' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'drain failed' },
      { status: 500 },
    );
  }
}
