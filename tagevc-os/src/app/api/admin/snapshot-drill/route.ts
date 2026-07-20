import { NextResponse } from 'next/server';
import { runEmptySnapshotDrills } from '@/lib/data/snapshot-drills';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

function authorize(request: Request): Promise<
  | { ok: true }
  | { ok: false; status: number; error: string }
> {
  return (async () => {
    const secret =
      process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
    const header = request.headers.get('x-tagevc-digest-secret');
    if (secret && header === secret) {
      return { ok: true };
    }

    const gate = await guardPermission('admin:users');
    if (gate.ok) return { ok: true };

    if (secret) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: false, status: 403, error: gate.error };
  })();
}

/** Run empty-snapshot drills (read-only). */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const report = await runEmptySnapshotDrills();
    return NextResponse.json(report);
  } catch (e) {
    captureException(e, { route: 'snapshot-drill' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'drill failed',
      },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return GET(request);
}
