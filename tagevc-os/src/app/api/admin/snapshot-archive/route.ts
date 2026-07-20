import { NextResponse } from 'next/server';
import {
  archiveStoreSnapshot,
  defaultArchiveCandidates,
  listSnapshotArchives,
} from '@/lib/data/snapshot-archive';
import { assertArchiveSafe } from '@/lib/data/snapshot-drills';
import {
  ALL_PIPELINE_SNAPSHOT_DOMAINS,
  shouldWriteSnapshot,
  type StoreCollection,
} from '@/lib/data/persist';
import { captureException } from '@/lib/observability';
import { guardPermission } from '@/lib/rbac/session';

function authorize(request: Request): Promise<
  | { ok: true; archivedBy: string | null }
  | { ok: false; status: number; error: string }
> {
  return (async () => {
    const secret =
      process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
    const header = request.headers.get('x-tagevc-digest-secret');
    if (secret && header === secret) {
      return { ok: true, archivedBy: null };
    }

    const gate = await guardPermission('admin:users');
    if (gate.ok) {
      return { ok: true, archivedBy: gate.profile.id };
    }

    if (secret) {
      return { ok: false, status: 401, error: 'Unauthorized' };
    }
    return { ok: false, status: 403, error: gate.error };
  })();
}

/** List recent archive rows. */
export async function GET(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  const rows = await listSnapshotArchives(50);
  return NextResponse.json({
    ok: true,
    archives: rows,
    archive_table_ready: rows !== null,
  });
}

/**
 * Soft-archive snapshot collections (copy → empty live payload).
 * Body: { collections?: string[], note?: string, only_cutover?: boolean }
 * Default: archive mature/all pipeline domains that currently skip snapshot writes.
 */
export async function POST(request: Request) {
  const auth = await authorize(request);
  if (!auth.ok) {
    return NextResponse.json(
      { ok: false, error: auth.error },
      { status: auth.status },
    );
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      collections?: string[];
      note?: string;
      only_cutover?: boolean;
    };

    const onlyCutover = body.only_cutover !== false;
    const requested = (body.collections?.length
      ? body.collections
      : defaultArchiveCandidates()) as string[];

    const targets = requested.filter((c) => {
      if (!ALL_PIPELINE_SNAPSHOT_DOMAINS.includes(c as StoreCollection)) {
        return false;
      }
      if (!onlyCutover) return true;
      return !shouldWriteSnapshot(c as StoreCollection).allow;
    });

    if (targets.length === 0) {
      return NextResponse.json({
        ok: false,
        error:
          'No eligible collections. Enable WRITE_CUTOVER_MATURE / WRITE_CUTOVER_ALL first, or pass only_cutover:false.',
        candidates: ALL_PIPELINE_SNAPSHOT_DOMAINS,
      });
    }

    const safety = await assertArchiveSafe(targets);
    if (!safety.ok) {
      return NextResponse.json(
        { ok: false, error: safety.error },
        { status: 409 },
      );
    }

    const results = [];
    for (const collection of targets) {
      results.push(
        await archiveStoreSnapshot(collection, {
          note: body.note ?? 'phase16 soft-archive',
          archivedBy: auth.archivedBy,
        }),
      );
    }

    return NextResponse.json({
      ok: results.every((r) => r.ok),
      results,
    });
  } catch (e) {
    captureException(e, { route: 'snapshot-archive' });
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'archive failed',
      },
      { status: 500 },
    );
  }
}
