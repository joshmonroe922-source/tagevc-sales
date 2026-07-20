import { NextResponse } from 'next/server';
import { getNormalizationStatus } from '@/lib/data/normalization-status';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

/**
 * Soak / write-cutover diagnostics for Phase 14–16.
 * Auth: DIGEST_SECRET / CRON_SECRET header, or admin:users session.
 */
export async function GET(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  const secretOk = Boolean(secret && header === secret);

  if (!secretOk) {
    if (secret && header && header !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
    const gate = await guardPermission('admin:users');
    if (!gate.ok) {
      if (secret) {
        return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
      }
      return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    }
  }

  try {
    const status = await getNormalizationStatus();
    return NextResponse.json(status);
  } catch (e) {
    captureException(e, { route: 'normalization-status' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'status failed',
      },
      { status: 500 },
    );
  }
}
