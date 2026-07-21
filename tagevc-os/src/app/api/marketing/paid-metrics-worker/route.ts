import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import {
  processPaidMetricRuns,
} from '@/lib/shared-services/marketing-paid-backfill';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET || '';
  if (
    secret &&
    request.headers.get('authorization') === `Bearer ${secret}`
  ) {
    return { ok: true as const, source: 'cron' as const, actor: null };
  }
  const gate = await guardPermission('write:marketing');
  return gate.ok
    ? { ok: true as const, source: 'manual' as const, actor: gate.profile.id }
    : { ok: false as const, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }
  const worker = await startOperationalWorker({
    service: 'marketing',
    workerName: 'paid-metrics-worker',
    triggerSource: auth.source,
  });
  const process = await processPaidMetricRuns(1);
  const ok = process.failed === 0;
  await finishOperationalWorker({
    workerRunId: worker.workerRunId,
    status: ok ? 'completed' : 'partial',
    claimed: process.claimed,
    succeeded: process.completed,
    failed: process.failed,
    errorCode: ok ? null : 'paid_sync_failure',
    errorDetail: ok ? null : process.details.join('; '),
    details: { superseded: process.superseded },
  });
  return NextResponse.json({ ok, process }, { status: ok ? 200 : 500 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
