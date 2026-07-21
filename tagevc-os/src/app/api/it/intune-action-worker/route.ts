import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { processIntuneActions } from '@/lib/shared-services/it-intune-worker';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';

async function authorize(request: Request, cronOnly = false) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || '';
  if (
    secret &&
    (request.headers.get('authorization') === `Bearer ${secret}` ||
      request.headers.get('x-tagevc-digest-secret') === secret)
  ) {
    return true;
  }
  if (cronOnly) return false;
  const gate = await guardPermission('action:intune_retire');
  return gate.ok;
}

async function run(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return runAuthorized('manual');
}

async function runAuthorized(source: 'cron' | 'manual') {
  const worker = await startOperationalWorker({
    service: 'intune',
    workerName: 'intune-action-worker',
    triggerSource: source,
  });
  const result = await processIntuneActions();
  const failed = result.processed.filter((item) =>
    ['failed', 'lease_error'].includes(item.status),
  ).length;
  await finishOperationalWorker({
    workerRunId: worker.workerRunId,
    status: result.ok ? 'completed' : result.claimed ? 'partial' : 'failed',
    claimed: result.claimed,
    succeeded: result.processed.length - failed,
    failed,
    leaseConflicts: result.processed.filter(
      (item) => item.status === 'lease_error',
    ).length,
    errorCode: result.error ? 'intune_worker_failed' : null,
    errorDetail: result.error ?? null,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: Request) {
  if (!(await authorize(request, true))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  return runAuthorized('cron');
}

export async function POST(request: Request) {
  return run(request);
}
