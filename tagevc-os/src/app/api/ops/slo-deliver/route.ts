import { NextResponse } from 'next/server';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';
import { deliverSloAlerts } from '@/lib/shared-services/slo-delivery';
import {
  finishOperationalWorker,
  startOperationalWorker,
} from '@/lib/shared-services/operational-health';

async function run(source: 'cron' | 'admin') {
  const worker = await startOperationalWorker({
    service: 'shared_services',
    workerName: 'slo-delivery',
    triggerSource: source,
  });
  try {
    const result = await deliverSloAlerts();
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: result.failed || result.routeTestsFailed ? 'partial' : 'completed',
      claimed: result.claimed,
      succeeded: result.delivered,
      failed: result.failed,
      details: {
        route_test_claimed: result.routeTestsClaimed,
        route_test_delivered: result.routeTestsDelivered,
        route_test_failed: result.routeTestsFailed,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    captureException(error, { route: 'slo-deliver' });
    await finishOperationalWorker({
      workerRunId: worker.workerRunId,
      status: 'failed',
      failed: 1,
      errorCode: 'slo_delivery_failed',
      errorDetail: error instanceof Error ? error.message : 'Delivery failed',
    });
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : 'Delivery failed' },
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
