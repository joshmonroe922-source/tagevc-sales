import { NextResponse } from 'next/server';
import { captureException, captureMessage } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import {
  evaluateSharedServiceSlos,
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';
import { processSloGovernancePhase40, processSloGovernancePhase44, processSloGovernancePhase45, processSloGovernancePhase46, processSloGovernancePhase47, processSloGovernancePhase48 } from '@/lib/shared-services/slo-policy';
import { processSloGovernancePhase49 } from '@/lib/shared-services/slo-phase49';
import { processSloGovernancePhase50 } from '@/lib/shared-services/slo-phase50';
import { processSloGovernancePhase51 } from '@/lib/shared-services/slo-phase51';
import { processSloGovernancePhase52 } from '@/lib/shared-services/slo-phase52';

async function run(source: 'cron' | 'admin') {
  const worker = await startOperationalWorker({
    service: 'shared_services',
    workerName: 'slo-evaluate',
    triggerSource: source,
  });
  try {
    const result = await evaluateSharedServiceSlos();
    const governance = await processSloGovernancePhase40();
    const phase44 = await processSloGovernancePhase44();
    const phase45 = await processSloGovernancePhase45();
    const phase46 = await processSloGovernancePhase46();
    const phase47 = await processSloGovernancePhase47();
    const phase48 = await processSloGovernancePhase48();
    const phase49 = await processSloGovernancePhase49();
    const phase50 = await processSloGovernancePhase50();
    // Phase 51 is pull-only (self-serve trend charts reuse Phase 50 WoW
    // snapshots on demand) — this tick does no work of its own, it only
    // reports the still-pull-only contract for observability.
    const phase51 = await processSloGovernancePhase51();
    const phase52 = await processSloGovernancePhase52();
    for (const transition of result.transitions) {
      captureMessage(
        `Shared Services SLO ${transition.transition}: ${transition.service}/${transition.metric_key}`,
        transition.transition === 'resolved'
          ? 'info'
          : transition.severity === 'critical'
            ? 'error'
            : 'warning',
        {
          ...transition,
          policy_version: result.policy_version,
          alert_fingerprint: [
            'shared-services-slo',
            transition.service,
            transition.metric_key,
            transition.entity_id ?? 'firm',
          ],
        },
      );
    }
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: 'completed',
      claimed: result.evaluations,
      succeeded: result.evaluations,
      details: {
        transition_count: result.transitions.length,
        simulations_claimed: governance.claimed,
        simulations_completed: governance.completed,
        phase44_handoffs: phase44.handoffs,
        phase44_alerts: phase44.alerts,
        phase45_nightly: phase45.nightly,
        phase45_digest: phase45.digest,
        phase45_alerts: phase45.alerts,
        phase46_firm_wide: phase46.firmWide,
        phase46_publication: phase46.publication,
        phase46_ownership_alerts: phase46.ownershipAlerts,
        phase47_notifications: phase47.notifications,
        phase47_visibility: phase47.visibility,
        phase48_allowlist: phase48.allowlist,
        phase48_deliveries: phase48.deliveries,
        phase48_delivery_slo: phase48.deliverySlo,
        phase49_owner_digest_slo: phase49.ownerDigestSlo,
        phase50_owner_digest_wow_trend: phase50.ownerDigestWowTrend,
        phase50_full_push: phase50.full_push,
        phase51_full_push: phase51.full_push,
        phase52_full_push: phase52.full_push,
      },
    });
    return NextResponse.json({
      ok: true,
      policy_version: result.policy_version,
      evaluation_bucket: result.evaluation_bucket,
      evaluations: result.evaluations,
      transition_count: result.transitions.length,
      simulations: governance,
      phase44,
      phase45,
      phase46,
      phase47,
      phase48,
      phase49,
      phase50,
      phase51,
      phase52,
    });
  } catch (error) {
    captureException(error, { route: 'slo-evaluate' });
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: 'failed',
      failed: 1,
      errorCode: 'slo_evaluation_failed',
      errorDetail: error instanceof Error ? error.message : 'SLO evaluation failed',
    });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'SLO evaluation failed',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  return run('cron');
}

export async function POST() {
  const gate = await guardPermission('admin:users');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
  }
  return run('admin');
}
