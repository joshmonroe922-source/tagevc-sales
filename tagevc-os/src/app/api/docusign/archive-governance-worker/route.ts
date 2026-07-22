import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import {
  mapCampaignParam,
  runArchiveCampaignTick,
  runFirstQuarterlyGatedOps,
} from '@/lib/docusign/archive-campaigns';
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
  const campaignKind = mapCampaignParam(url.searchParams.get('campaign'));
  const firstQuarterly =
    url.searchParams.get('first_quarterly') === '1' ||
    url.searchParams.get('phase') === '43';
  const kind: RunKind =
    url.searchParams.get('kind') === 'backfill'
      ? 'legacy_backfill'
      : 'integrity_scan';
  const mode: ScanMode =
    url.searchParams.get('mode') === 'full' ? 'full' : 'sample';
  const force = url.searchParams.get('force') === '1';

  if (campaignKind || firstQuarterly) {
    const resolvedKind = campaignKind ?? 'quarterly_full_integrity';
    const useFirstQuarterlyPath =
      firstQuarterly || resolvedKind === 'quarterly_full_integrity';
    const worker = await startOperationalWorker({
      service: 'docusign',
      workerName: `archive-campaign-${resolvedKind === 'quarterly_full_integrity' ? 'quarterly' : 'backfill'}`,
      triggerSource: auth.trigger,
      details: {
        campaign_kind: resolvedKind,
        scan_mode: mode,
        force,
        batch_limit: 5,
        first_quarterly_ops: useFirstQuarterlyPath,
      },
    });
    const result = useFirstQuarterlyPath
      ? await runFirstQuarterlyGatedOps({
          trigger: auth.trigger,
          requestedBy: auth.actor,
          workerId: worker.invocationId,
          force,
          limit: 5,
          acknowledgeRunbook: auth.trigger === 'manual',
        })
      : await runArchiveCampaignTick({
          campaignKind: resolvedKind,
          trigger: auth.trigger,
          requestedBy: auth.actor,
          workerId: worker.invocationId,
          force,
          limit: 5,
        });
    const noop =
      result.disposition === 'not_due' ||
      result.disposition === 'gated' ||
      result.disposition === 'already_complete';
    const leaseConflict = result.disposition === 'busy';
    const firstQuarterlyMeta =
      'firstQuarterly' in result ? result.firstQuarterly : undefined;
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: noop
        ? 'completed'
        : result.governance?.checkpointed
          ? 'partial'
          : result.ok
            ? 'completed'
            : result.governance && result.governance.claimed > 0
              ? 'partial'
              : 'failed',
      claimed: result.governance?.claimed ?? 0,
      succeeded: result.governance?.succeeded ?? 0,
      failed:
        (result.governance?.unavailable ?? 0) + (result.governance?.drift ?? 0),
      leaseConflicts: leaseConflict ? 1 : 0,
      errorCode:
        result.ok || noop
          ? null
          : 'docusign_archive_campaign_failed',
      errorDetail: result.error ?? null,
      details: {
        campaign_id: result.campaignId ?? null,
        campaign_disposition: result.disposition,
        campaign_status: result.status ?? null,
        progress_pct: result.progressPct ?? null,
        gate_reason: result.gateReason ?? null,
        remaining_unhashed: result.remainingUnhashed ?? null,
        quarantine_backlog: result.quarantineBacklog ?? null,
        ops_milestone_kind: result.opsMilestone?.eventKind ?? null,
        ops_milestone_disposition: result.opsMilestone?.disposition ?? null,
        ops_first_quarterly:
          result.opsMilestone?.firstQuarterlyMilestone ?? false,
        first_quarterly_unlocked:
          firstQuarterlyMeta?.gates.quarterly_unlocked ?? null,
        first_quarterly_cta_eligible: firstQuarterlyMeta?.ctaEligible ?? null,
        first_quarterly_runbook_unlock:
          firstQuarterlyMeta?.runbookUnlock?.disposition ?? null,
        first_quarterly_runbook_completed:
          firstQuarterlyMeta?.runbookCompleted?.disposition ?? null,
        archive_run_id: result.governance?.run_id ?? null,
        archive_status: result.governance?.status ?? null,
        checkpointed: result.governance?.checkpointed ?? false,
      },
    });
    return NextResponse.json(result, {
      status: result.ok || noop || (result.governance?.claimed ?? 0) > 0
        ? 200
        : 500,
    });
  }

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
