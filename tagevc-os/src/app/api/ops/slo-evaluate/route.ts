import { NextResponse } from 'next/server';
import { captureException, captureMessage } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import {
  evaluateSharedServiceSlos,
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';
import { processSloGovernancePhase40, processSloGovernancePhase44, processSloGovernancePhase45 } from '@/lib/shared-services/slo-policy';

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
