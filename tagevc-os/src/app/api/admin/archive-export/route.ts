import { NextResponse } from 'next/server';
import {
  confirmArchiveExportOffsite,
  getArchiveExportOpsConfirmation,
  recordArchiveExport,
} from '@/lib/data/archive-export-state';
import { listSnapshotArchives } from '@/lib/data/snapshot-archive';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

/**
 * Stage 4d — export archive metadata (JSON) for offsite retention.
 * Does not drop tables. Retention target: ≥90 days before Stage 4e.
 * After storing offsite, set ARCHIVE_EXPORT_CONFIRMED_AT on Vercel.
 */
export async function GET(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  const header = request.headers.get('x-tagevc-digest-secret');
  let authorized = Boolean(secret && header === secret);
  let source: 'admin' | 'secret' = 'admin';

  if (!authorized) {
    const gate = await guardPermission('admin:users');
    if (gate.ok) {
      authorized = true;
      source = 'admin';
    } else if (secret) {
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
  } else {
    source = 'secret';
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
    recordArchiveExport({
      exported_at,
      count: rows.length,
      source,
    });

    const ops = getArchiveExportOpsConfirmation();
    const body = {
      ok: true,
      exported_at,
      retention_days_target: 90,
      retention_note:
        'Retain ≥90 days before Stage 4e DROP. Table os_store_snapshots is not dropped in Phase 22. After offsite store, POST confirm or set ARCHIVE_EXPORT_CONFIRMED_AT.',
      ops_confirmation: ops,
      count: rows.length,
      archives: rows,
    };

    return new NextResponse(JSON.stringify(body, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="os_store_snapshot_archive_${exported_at.slice(0, 10)}.json"`,
        'X-Tagevc-Retention-Days': '90',
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

/** Mark offsite retention confirmed (in-process; prefer ARCHIVE_EXPORT_CONFIRMED_AT for durable). */
export async function POST(request: Request) {
  const gate = await guardPermission('admin:users');
  if (!gate.ok) {
    return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      note?: string;
    };
    const confirmed = confirmArchiveExportOffsite({ note: body.note ?? null });
    return NextResponse.json({
      ok: true,
      confirmed,
      ops_confirmation: getArchiveExportOpsConfirmation(),
      durable_hint:
        'Also set ARCHIVE_EXPORT_CONFIRMED_AT on Vercel so confirmation survives deploys',
    });
  } catch (e) {
    captureException(e, { route: 'archive-export-confirm' });
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'confirm failed' },
      { status: 500 },
    );
  }
}
