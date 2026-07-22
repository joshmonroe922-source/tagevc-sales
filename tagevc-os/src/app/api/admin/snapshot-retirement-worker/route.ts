import { NextResponse } from 'next/server';
import { captureException } from '@/lib/observability';
import { runSnapshotPhase40Worker } from '@/lib/data/snapshot-retirement-phase40';

async function run(request: Request) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const result = await runSnapshotPhase40Worker();
    return NextResponse.json(result, { status: result.ok ? 200 : 503 });
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
