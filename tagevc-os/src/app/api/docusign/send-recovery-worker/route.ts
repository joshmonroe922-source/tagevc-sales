import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { recoverDocuSignSendIntents } from '@/lib/docusign/send-intents-repo';
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
    return true;
  }
  const gate = await guardPermission('write:documents');
  return gate.ok;
}

async function run(request: Request) {
  if (!(await authorize(request))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }
  const worker = await startOperationalWorker({
    service: 'docusign',
    workerName: 'send-recovery-worker',
    triggerSource: request.headers.get('authorization') ? 'cron' : 'manual',
  });
  const result = await recoverDocuSignSendIntents(20);
  const failed = 'error' in result ? 1 : 0;
  await finishOperationalWorker({
    workerRunId: worker.workerRunId,
    status: failed ? 'failed' : result.quarantined > 0 ? 'partial' : 'completed',
    claimed: result.claimed,
    succeeded: result.recovered,
    failed,
    errorCode: failed ? 'docusign_recovery_failed' : null,
    errorDetail: 'error' in result ? result.error : null,
    details: {
      deferred: result.deferred,
      quarantined: result.quarantined,
    },
  });
  return NextResponse.json(result, { status: 'error' in result ? 500 : 200 });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
