import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { reconcileDocuSignEnvelopes } from '@/lib/docusign/reconciliation-repo';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET || process.env.DIGEST_SECRET || '';
  if (
    secret &&
    (request.headers.get('authorization') === `Bearer ${secret}` ||
      request.headers.get('x-tagevc-digest-secret') === secret)
  ) {
    return { ok: true as const, trigger: 'cron' as const, actor: null };
  }
  const gate = await guardPermission('action:docusign_reconcile');
  return gate.ok
    ? {
        ok: true as const,
        trigger: 'manual' as const,
        actor: gate.profile.id,
      }
    : { ok: false as const, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }
  const worker = await startOperationalWorker({
    service: 'docusign',
    workerName: 'reconciliation-worker',
    triggerSource: auth.trigger,
    details: { page_limit: 3, page_size: 100 },
  });
  try {
    const result = await reconcileDocuSignEnvelopes({
      trigger: auth.trigger,
      requestedBy: auth.actor,
      days: 30,
      maxPages: 3,
      workerId: worker.invocationId,
    });
    const leaseConflict = /busy|not due|lease/i.test(result.error ?? '');
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: !result.ok
        ? 'failed'
        : result.completed
          ? 'completed'
          : 'partial',
      claimed: result.pages,
      succeeded: result.ok ? result.pages : 0,
      failed: result.ok ? 0 : 1,
      leaseConflicts: leaseConflict ? 1 : 0,
      errorCode: result.ok ? null : 'docusign_reconciliation_failed',
      errorDetail: result.error ?? null,
      details: {
        reconciliation_run_id: result.run_id ?? null,
        checkpoint: result.checkpoint ?? null,
        completed: result.completed ?? false,
        seen: result.seen,
        matched: result.matched,
        unmapped: result.unmapped,
        manual_review: result.manual_review,
      },
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  } catch (caught) {
    const message =
      caught instanceof Error ? caught.message : 'Reconciliation worker failed';
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: 'failed',
      failed: 1,
      errorCode: 'docusign_reconciliation_threw',
      errorDetail: message,
    });
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
