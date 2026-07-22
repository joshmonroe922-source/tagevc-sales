import { NextResponse } from 'next/server';
import { captureException } from '@/lib/observability';
import { runSnapshotPhase40Worker } from '@/lib/data/snapshot-retirement-phase40';
import { runSnapshotPhase48OpsWorker } from '@/lib/data/snapshot-retirement-phase48';
import { runSnapshotPhase49OpsWorker } from '@/lib/data/snapshot-retirement-phase49';
import { runSnapshotPhase50OpsTick } from '@/lib/data/snapshot-retirement-phase50';

async function run(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [phase40, phase48, phase49] = await Promise.all([
      runSnapshotPhase40Worker(),
      runSnapshotPhase48OpsWorker(),
      runSnapshotPhase49OpsWorker(),
    ]);
    const phase50 = await runSnapshotPhase50OpsTick();
    const ok = phase40.ok && phase48.ok && phase49.ok && phase50.ok;
    return NextResponse.json(
      { ok, phase40, phase48, phase49, phase50 },
      { status: ok ? 200 : 503 },
    );
  } catch (error) {
    captureException(error, { route: 'snapshot-retirement-phase40-worker' });
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Phase 40 worker failed',
      },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}

export async function POST(request: Request) {
  return run(request);
}
