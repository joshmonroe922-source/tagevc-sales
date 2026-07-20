import { NextResponse } from 'next/server';
import {
  getMasterDataHydrateError,
  getMasterDataSource,
} from '@/lib/data/master-data';
import {
  getNormalizedSyncStats,
  preferNormalizedTables,
} from '@/lib/data/normalized/sync';
import { createPersistClient } from '@/lib/supabase/persist-client';

/**
 * Soak / cutover diagnostics for Phase 14.
 * Auth: optional CRON_SECRET / DIGEST_SECRET via `x-tagevc-digest-secret`.
 * When no secret is configured, endpoint is open (local/dev only — set a secret in prod).
 */
export async function GET(request: Request) {
  const secret =
    process.env.DIGEST_SECRET || process.env.CRON_SECRET || '';
  if (secret) {
    const header = request.headers.get('x-tagevc-digest-secret');
    if (header !== secret) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }
  }

  try {
    const supabase = await createPersistClient();

    let counts: Record<string, number> = {};
    const { data: viewRows, error: viewError } = await supabase
      .from('os_normalization_counts')
      .select('domain, row_count');

    if (!viewError && viewRows) {
      for (const row of viewRows) {
        counts[String(row.domain)] = Number(row.row_count);
      }
    } else {
      // Fallback if Phase 14 SQL not applied yet
      const tables = [
        'entities',
        'portfolio_companies',
        'entity_month_pnl',
        'os_leads',
        'os_tickets',
        'os_deals',
        'os_documents',
        'os_ic_reviews',
        'os_ma_targets',
        'os_re_deals',
        'os_store_snapshots',
      ] as const;
      for (const table of tables) {
        const { count, error } = await supabase
          .from(table)
          .select('*', { count: 'exact', head: true });
        counts[table] = error ? -1 : (count ?? 0);
      }
    }

    const { data: snapshots } = await supabase
      .from('os_store_snapshots')
      .select('collection, updated_at, version');

    return NextResponse.json({
      ok: true,
      prefer_normalized_tables: preferNormalizedTables(),
      master_data_source: getMasterDataSource(),
      master_data_hydrate_error: getMasterDataHydrateError(),
      sync_stats: getNormalizedSyncStats(),
      row_counts: counts,
      snapshots: (snapshots ?? []).map((s) => ({
        collection: s.collection,
        updated_at: s.updated_at,
        version: s.version,
      })),
      cutover_hints: {
        stage: preferNormalizedTables()
          ? 'read_cutover_forced'
          : 'soak_prefer_sql_when_nonempty',
        next:
          'Set USE_NORMALIZED_TABLES=1 after row counts look healthy; keep dual-write until exit criteria in docs/OS_SNAPSHOT_RETIREMENT.md',
      },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'status failed',
      },
      { status: 500 },
    );
  }
}
