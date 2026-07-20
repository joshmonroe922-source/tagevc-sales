import { NextResponse } from 'next/server';
import {
  getMasterDataHydrateError,
  getMasterDataSource,
} from '@/lib/data/master-data';
import {
  getNormalizedSyncStats,
  preferNormalizedTables,
} from '@/lib/data/normalized/sync';
import {
  getSnapshotWriteConfig,
  getSnapshotWriteStats,
  MATURE_SNAPSHOT_DOMAINS,
  shouldWriteSnapshot,
  type StoreCollection,
} from '@/lib/data/persist';
import { createPersistClient } from '@/lib/supabase/persist-client';

/**
 * Soak / write-cutover diagnostics for Phase 14–15.
 * Auth: optional CRON_SECRET / DIGEST_SECRET via `x-tagevc-digest-secret`.
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
    const writeConfig = getSnapshotWriteConfig();
    const writeStats = getSnapshotWriteStats();

    const counts: Record<string, number> = {};
    const { data: viewRows, error: viewError } = await supabase
      .from('os_normalization_counts')
      .select('domain, row_count');

    if (!viewError && viewRows) {
      for (const row of viewRows) {
        counts[String(row.domain)] = Number(row.row_count);
      }
    } else {
      const tables = [
        'entities',
        'portfolio_companies',
        'os_leads',
        'os_tickets',
        'os_deals',
        'os_documents',
        'os_handoffs',
        'os_ic_audits',
        'os_ticket_audits',
        'os_doc_audits',
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

    const domains: StoreCollection[] = [
      'deal_flow',
      'tickets',
      'documents',
      'ma',
      're',
    ];
    const snapshot_write_gates = Object.fromEntries(
      domains.map((d) => [d, shouldWriteSnapshot(d)]),
    );

    const syncStats = getNormalizedSyncStats();
    const syncFailures = Object.entries(syncStats).filter(
      ([, s]) => s.fail > 0,
    );

    const handoffsReady = (counts.os_handoffs ?? -1) >= 0;
    const auditsReady =
      (counts.os_ic_audits ?? -1) >= 0 &&
      (counts.os_ticket_audits ?? -1) >= 0 &&
      (counts.os_doc_audits ?? -1) >= 0;

    const matureCutoverActive = MATURE_SNAPSHOT_DOMAINS.every(
      (d) => !shouldWriteSnapshot(d).allow,
    );

    let stage:
      | 'soak'
      | 'read_cutover'
      | 'write_cutover_partial'
      | 'write_cutover' = 'soak';
    if (matureCutoverActive && !writeConfig.write_snapshots_enabled) {
      stage = 'write_cutover';
    } else if (matureCutoverActive || writeConfig.snapshot_skip_domains.length > 0) {
      stage = 'write_cutover_partial';
    } else if (preferNormalizedTables()) {
      stage = 'read_cutover';
    }

    return NextResponse.json({
      ok: true,
      prefer_normalized_tables: preferNormalizedTables(),
      master_data_source: getMasterDataSource(),
      master_data_hydrate_error: getMasterDataHydrateError(),
      write_cutover: {
        ...writeConfig,
        snapshot_write_gates,
        snapshot_write_stats: writeStats,
        mature_cutover_active: matureCutoverActive,
        handoffs_table_ready: handoffsReady,
        audits_tables_ready: auditsReady,
      },
      sync_stats: syncStats,
      sync_failure_count: syncFailures.length,
      row_counts: counts,
      snapshots: (snapshots ?? []).map((s) => ({
        collection: s.collection,
        updated_at: s.updated_at,
        version: s.version,
      })),
      cutover_hints: {
        stage,
        next:
          stage === 'soak'
            ? 'Apply phase15 SQL, then set WRITE_CUTOVER_MATURE=1 (or SNAPSHOT_SKIP_DOMAINS=deal_flow,tickets,documents) after sync_stats are clean'
            : stage === 'write_cutover_partial'
              ? 'Monitor snapshot_write_stats.skips; keep MA/RE dual-write until ready; then WRITE_SNAPSHOTS=0'
              : stage === 'read_cutover'
                ? 'Read cutover forced; enable WRITE_CUTOVER_MATURE when handoffs/audits hydrated'
                : 'Write cutover active — retain snapshot backups before Stage 4 drop',
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
