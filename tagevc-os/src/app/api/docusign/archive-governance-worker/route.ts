import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import { runArchiveGovernanceWorker } from '@/lib/docusign/archive-governance';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';

type RunKind = 'legacy_backfill' | 'integrity_scan';
type ScanMode = 'sample' | 'full';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (
    secret &&
    request.headers.get('authorization') === `Bearer ${secret}`
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
    return NextResponse.json({ ok: false, error: auth.error }, { status: 403 });
  }
  const url = new URL(request.url);
  const kind: RunKind =
    url.searchParams.get('kind') === 'backfill'
      ? 'legacy_backfill'
      : 'integrity_scan';
  const mode: ScanMode =
    url.searchParams.get('mode') === 'full' ? 'full' : 'sample';
  const worker = await startOperationalWorker({
    service: 'docusign',
    workerName: `archive-${kind === 'legacy_backfill' ? 'backfill' : 'integrity'}`,
    triggerSource: auth.trigger,
    details: { run_kind: kind, scan_mode: mode, batch_limit: 5 },
  });
  const result = await runArchiveGovernanceWorker({
    runKind: kind,
    scanMode: mode,
    trigger: auth.trigger,
    requestedBy: auth.actor,
    workerId: worker.invocationId,
    limit: 5,
  });
  const leaseConflict = /busy|not due|lease/i.test(result.error ?? '');
  await finishOperationalWorker({
    workerRunId: worker.workerRunId,
    status: result.checkpointed
      ? 'partial'
      : result.ok
        ? 'completed'
        : result.claimed > 0
          ? 'partial'
          : 'failed',
    claimed: result.claimed,
    succeeded: result.succeeded,
    failed: result.unavailable + result.drift,
    leaseConflicts: leaseConflict ? 1 : 0,
    errorCode: result.error ? 'docusign_archive_governance_failed' : null,
    errorDetail: result.error ?? null,
    details: {
      archive_run_id: result.run_id ?? null,
      archive_status: result.status ?? null,
      unavailable: result.unavailable,
      drift: result.drift,
      quarantined: result.quarantined,
      checkpointed: result.checkpointed,
    },
  });
  return NextResponse.json(result, {
    status: result.ok || result.claimed > 0 ? 200 : 500,
  });
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
