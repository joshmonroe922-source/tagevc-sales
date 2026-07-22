import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import {
  mapCampaignParam,
  runArchiveCampaignTick,
  runFirstQuarterlyGatedOps,
} from '@/lib/docusign/archive-campaigns';
import { runArchiveGovernanceWorker } from '@/lib/docusign/archive-governance';
import { runArchivePhase44OpsTick } from '@/lib/docusign/archive-phase44';
import { runArchivePhase45OpsTick } from '@/lib/docusign/archive-phase45';
import { runArchivePhase46OpsTick } from '@/lib/docusign/archive-phase46';
import { runArchivePhase47OpsTick } from '@/lib/docusign/archive-phase47';
import { runArchivePhase48OpsTick } from '@/lib/docusign/archive-phase48';
import { runArchivePhase49OpsTick } from '@/lib/docusign/archive-phase49';
import { runArchivePhase50OpsTick } from '@/lib/docusign/archive-phase50';
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
    const firstQuarterlyMeta = useFirstQuarterlyPath
      ? (
          result as Awaited<
            ReturnType<typeof runFirstQuarterlyGatedOps>
          >
        ).firstQuarterly
      : undefined;
    const phase44 = await runArchivePhase44OpsTick();
    const phase45 = await runArchivePhase45OpsTick();
    const phase46 = await runArchivePhase46OpsTick();
    const phase47 = await runArchivePhase47OpsTick();
    const phase48 = await runArchivePhase48OpsTick();
    const phase49 = await runArchivePhase49OpsTick();
    const phase50 = await runArchivePhase50OpsTick();
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
        phase44_ops_ok: phase44.ok,
        phase44_alerts_recorded: phase44.ok ? phase44.alertsRecorded : null,
        phase44_ops_error: phase44.ok ? null : phase44.error,
        phase45_ops_ok: phase45.ok,
        phase45_alerts_recorded: phase45.ok ? phase45.alertsRecorded : null,
        phase45_gate_steps_recorded: phase45.ok
          ? phase45.gateStepsRecorded
          : null,
        phase45_ops_error: phase45.ok ? null : phase45.error,
        phase46_ops_ok: phase46.ok,
        phase46_alerts_recorded: phase46.ok ? phase46.alertsRecorded : null,
        phase46_completion_status: phase46.ok
          ? phase46.completionStatus
          : null,
        phase46_ops_error: phase46.ok ? null : phase46.error,
        phase47_ops_ok: phase47.ok,
        phase47_alerts_recorded: phase47.ok ? phase47.alertsRecorded : null,
        phase47_run_status: phase47.ok ? phase47.runStatus : null,
        phase47_drift_performance: phase47.ok
          ? phase47.driftPerformance
          : null,
        phase47_ops_error: phase47.ok ? null : phase47.error,
        phase48_ops_ok: phase48.ok,
        phase48_alerts_recorded: phase48.ok ? phase48.alertsRecorded : null,
        phase48_schedule_status: phase48.ok ? phase48.scheduleStatus : null,
        phase48_run_status: phase48.ok ? phase48.runStatus : null,
        phase48_drift_performance: phase48.ok
          ? phase48.driftPerformance
          : null,
        phase48_ops_error: phase48.ok ? null : phase48.error,
        phase49_ops_ok: phase49.ok,
        phase49_cadence_slo_severity: phase49.ok
          ? phase49.cadenceSeverity
          : null,
        phase49_proposal_status: phase49.ok ? phase49.proposalStatus : null,
        phase49_alerts_recorded: phase49.ok ? phase49.alertsRecorded : null,
        phase49_ops_error: phase49.ok ? null : phase49.error,
        phase50_ops_ok: phase50.ok,
        phase50_cadence_trend_direction: phase50.ok
          ? phase50.trendDirection
          : null,
        phase50_recurring_process_health: phase50.ok
          ? phase50.recurringProcessHealth
          : null,
        phase50_reminders_sent: phase50.ok ? phase50.remindersSent : null,
        phase50_alerts_recorded: phase50.ok ? phase50.alertsRecorded : null,
        phase50_ops_error: phase50.ok ? null : phase50.error,
      },
    });
    return NextResponse.json(
      {
        ...result,
        phase44,
        phase45,
        phase46,
        phase47,
        phase48,
        phase49,
        phase50,
      },
      {
        status: result.ok || noop || (result.governance?.claimed ?? 0) > 0
          ? 200
          : 500,
      },
    );
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
  const phase44 = await runArchivePhase44OpsTick();
  const phase45 = await runArchivePhase45OpsTick();
  const phase46 = await runArchivePhase46OpsTick();
  const phase47 = await runArchivePhase47OpsTick();
  const phase48 = await runArchivePhase48OpsTick();
  const phase49 = await runArchivePhase49OpsTick();
  const phase50 = await runArchivePhase50OpsTick();
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
      phase44_ops_ok: phase44.ok,
      phase44_alerts_recorded: phase44.ok ? phase44.alertsRecorded : null,
      phase44_ops_error: phase44.ok ? null : phase44.error,
      phase45_ops_ok: phase45.ok,
      phase45_alerts_recorded: phase45.ok ? phase45.alertsRecorded : null,
      phase45_gate_steps_recorded: phase45.ok
        ? phase45.gateStepsRecorded
        : null,
      phase45_ops_error: phase45.ok ? null : phase45.error,
      phase46_ops_ok: phase46.ok,
      phase46_alerts_recorded: phase46.ok ? phase46.alertsRecorded : null,
      phase46_completion_status: phase46.ok
        ? phase46.completionStatus
        : null,
      phase46_ops_error: phase46.ok ? null : phase46.error,
      phase47_ops_ok: phase47.ok,
      phase47_alerts_recorded: phase47.ok ? phase47.alertsRecorded : null,
      phase47_run_status: phase47.ok ? phase47.runStatus : null,
      phase47_drift_performance: phase47.ok
        ? phase47.driftPerformance
        : null,
      phase47_ops_error: phase47.ok ? null : phase47.error,
      phase48_ops_ok: phase48.ok,
      phase48_alerts_recorded: phase48.ok ? phase48.alertsRecorded : null,
      phase48_schedule_status: phase48.ok ? phase48.scheduleStatus : null,
      phase48_run_status: phase48.ok ? phase48.runStatus : null,
      phase48_drift_performance: phase48.ok
        ? phase48.driftPerformance
        : null,
      phase48_ops_error: phase48.ok ? null : phase48.error,
      phase49_ops_ok: phase49.ok,
      phase49_cadence_slo_severity: phase49.ok
        ? phase49.cadenceSeverity
        : null,
      phase49_proposal_status: phase49.ok ? phase49.proposalStatus : null,
      phase49_alerts_recorded: phase49.ok ? phase49.alertsRecorded : null,
      phase49_ops_error: phase49.ok ? null : phase49.error,
      phase50_ops_ok: phase50.ok,
      phase50_cadence_trend_direction: phase50.ok
        ? phase50.trendDirection
        : null,
      phase50_recurring_process_health: phase50.ok
        ? phase50.recurringProcessHealth
        : null,
      phase50_reminders_sent: phase50.ok ? phase50.remindersSent : null,
      phase50_alerts_recorded: phase50.ok ? phase50.alertsRecorded : null,
      phase50_ops_error: phase50.ok ? null : phase50.error,
    },
  });
  return NextResponse.json(
    {
      ...result,
      phase44,
      phase45,
      phase46,
      phase47,
      phase48,
      phase49,
      phase50,
    },
    {
      status: result.ok || result.claimed > 0 ? 200 : 500,
    },
  );
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
