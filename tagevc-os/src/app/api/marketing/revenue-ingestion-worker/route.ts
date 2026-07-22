import { NextResponse } from 'next/server';
import { guardPermission } from '@/lib/rbac/session';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';
import { processMarketingRevenuePulls } from '@/lib/shared-services/marketing-revenue-worker';

async function authorize(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (secret && request.headers.get('authorization') === `Bearer ${secret}`) {
    return { ok: true as const, source: 'cron' as const };
  }
  const gate = await guardPermission('write:marketing');
  return gate.ok
    ? { ok: true as const, source: 'manual' as const }
    : { ok: false as const, error: gate.error };
}

async function run(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: 403 });
  }
  const worker = await startOperationalWorker({
    service: 'marketing',
    workerName: 'revenue-ingestion-worker',
    triggerSource: auth.source,
  });
  try {
    const result = await processMarketingRevenuePulls(2);
    const ok = result.failed === 0;
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: ok ? 'completed' : 'partial',
      claimed: result.claimed,
      succeeded: result.completed,
      failed: result.failed,
      errorCode: ok ? null : 'revenue_ingestion_failure',
      errorDetail: ok ? null : result.details.join('; '),
      details: {
        contract: 'phase50-v1',
        bounded_pages: 10,
        bounded_records: 500,
        production_slo_ticks: true,
        critical_ops_alerts: true,
        correction_validation: true,
        attribution_conflicts: true,
        reconciliation_snapshots: true,
        webhook_delivery_slos: true,
        correction_workflow_monitoring: true,
        auto_reject_promotion_gates: true,
        webhook_reliability_trends: true,
        rule_performance_snapshots: true,
        cohort_promotion_gates: true,
        attribution_conflict_closures: true,
        conflict_aging_visibility: true,
        cohort_autopilot: true,
        conflict_cohort_archives: true,
        cohort_performance_snapshots: true,
        autopilot_dry_run_dashboards: true,
        cohort_promotion_audit_exports: true,
        dual_approved_promotion_from_dry_run: true,
        cohort_readiness_visibility: true,
      },
    });
    return NextResponse.json({ ok, result }, { status: ok ? 200 : 500 });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Revenue worker failed';
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: 'failed',
      claimed: 0,
      succeeded: 0,
      failed: 1,
      errorCode: 'revenue_worker_failure',
      errorDetail: message,
      details: { contract: 'phase48-v1' },
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
