import { NextResponse } from 'next/server';
import { listSnapshotArchives } from '@/lib/data/snapshot-archive';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

/**
 * Stage 4d — export archive metadata (JSON) for offsite retention.
 * Does not drop tables. Full payload export available via ?include_payload=1
 * when using service role (large).
 */
export async function GET(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  let authorized = Boolean(secret && header === secret);

  if (!authorized) {
    const gate = await guardPermission('admin:users');
    if (gate.ok) authorized = true;
    else if (secret) {
      return NextResponse.json(
        { ok: false, error: 'Unauthorized' },
        { status: 401 },
      );
    } else {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: 403 },
      );
    }
  }

  try {
    const url = new URL(request.url);
    const limit = Math.min(
      Number(url.searchParams.get('limit') ?? 100) || 100,
      500,
    );
    const rows = await listSnapshotArchives(limit);
    if (rows === null) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Archive table unavailable — apply Phase 16 SQL',
        },
        { status: 503 },
      );
    }

    const exported_at = new Date().toISOString();
    const body = {
      ok: true,
      exported_at,
      retention_note:
        'Retain ≥90 days before Stage 4e. Table os_store_snapshots not dropped in Phase 19.',
      count: rows.length,
      archives: rows,
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="os_store_snapshot_archive_${exported_at.slice(0, 10)}.json"`,
      },
    });
  } catch (e) {
    captureException(e, { route: 'archive-export' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'export failed',
      },
      { status: 500 },
    );
  }
}
