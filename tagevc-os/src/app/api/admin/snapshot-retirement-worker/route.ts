import { NextResponse } from 'next/server';
import { captureException } from '@/lib/observability';
import { runSnapshotPhase40Worker } from '@/lib/data/snapshot-retirement-phase40';
import { runSnapshotPhase44CanaryWorker } from '@/lib/data/snapshot-retirement-phase44';

async function run(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const [phase40, phase44] = await Promise.all([
      runSnapshotPhase40Worker(),
      runSnapshotPhase44CanaryWorker(),
    ]);
    const ok = phase40.ok && phase44.ok;
    return NextResponse.json(
      { ok, phase40, phase44 },
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
