import {
  getMasterDataHydrateError,
  getMasterDataSource,
} from '@/lib/data/master-data';
import {
  getNormalizedSyncStats,
  preferNormalizedTables,
} from '@/lib/data/normalized/sync';
import {
  ALL_PIPELINE_SNAPSHOT_DOMAINS,
  getSnapshotWriteConfig,
  getSnapshotWriteStats,
  MATURE_SNAPSHOT_DOMAINS,
  shouldWriteSnapshot,
  type StoreCollection,
} from '@/lib/data/persist';
import { listSnapshotArchives } from '@/lib/data/snapshot-archive';
import { isSentryConfigured } from '@/lib/observability';
import { createPersistClient } from '@/lib/supabase/persist-client';

export type NormalizationStatus = {
  ok: true;
  prefer_normalized_tables: boolean;
  master_data_source: string;
  master_data_hydrate_error: string | null;
  sentry_configured: boolean;
  write_cutover: ReturnType<typeof getSnapshotWriteConfig> & {
    snapshot_write_gates: Record<string, { allow: boolean; reason: string }>;
    snapshot_write_stats: ReturnType<typeof getSnapshotWriteStats>;
    mature_cutover_active: boolean;
    all_pipeline_cutover_active: boolean;
    handoffs_table_ready: boolean;
    audits_tables_ready: boolean;
    archive_table_ready: boolean;
    archive_ready_collections: string[];
  };
  sync_stats: ReturnType<typeof getNormalizedSyncStats>;
  sync_failure_count: number;
  row_counts: Record<string, number>;
  snapshots: Array<{
    collection: string;
    updated_at: string;
    version: number;
    payload_empty?: boolean;
  }>;
  recent_archives: Array<{
    id: string;
    collection: string;
    archived_at: string;
    note: string | null;
  }> | null;
  fk_integrity: Array<{ check_name: string; orphan_count: number }> | null;
  fk_orphan_total: number;
  sync_failures: Array<{
    key: string;
    fail: number;
    lastError: string | null;
    lastFailAt: string | null;
  }>;
  fetched_at: string;
  cutover_hints: {
    stage:
      | 'soak'
      | 'read_cutover'
      | 'write_cutover_partial'
      | 'write_cutover';
    next: string;
  };
};

export async function getNormalizationStatus(): Promise<NormalizationStatus> {
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
      'os_store_snapshot_archive',
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
    .select('collection, updated_at, version, payload');

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
  const syncFailures = Object.entries(syncStats)
    .filter(([, s]) => s.fail > 0)
    .map(([key, s]) => ({
      key,
      fail: s.fail,
      lastError: s.lastError,
      lastFailAt: s.lastFailAt,
    }));

  let fkIntegrity: Array<{ check_name: string; orphan_count: number }> | null =
    null;
  const { data: fkRows, error: fkError } = await supabase
    .from('os_fk_integrity')
    .select('check_name, orphan_count');
  if (!fkError && fkRows) {
    fkIntegrity = fkRows.map((r) => ({
      check_name: String(r.check_name),
      orphan_count: Number(r.orphan_count ?? 0),
    }));
  }
  const fkOrphanTotal = (fkIntegrity ?? []).reduce(
    (sum, r) => sum + r.orphan_count,
    0,
  );

  const handoffsReady = (counts.os_handoffs ?? -1) >= 0;
  const auditsReady =
    (counts.os_ic_audits ?? -1) >= 0 &&
    (counts.os_ticket_audits ?? -1) >= 0 &&
    (counts.os_doc_audits ?? -1) >= 0;
  const archiveReady = (counts.os_store_snapshot_archive ?? -1) >= 0;

  const matureCutoverActive = MATURE_SNAPSHOT_DOMAINS.every(
    (d) => !shouldWriteSnapshot(d).allow,
  );
  const allPipelineCutoverActive = ALL_PIPELINE_SNAPSHOT_DOMAINS.every(
    (d) => !shouldWriteSnapshot(d).allow,
  );

  const archiveReadyCollections = ALL_PIPELINE_SNAPSHOT_DOMAINS.filter(
    (d) => !shouldWriteSnapshot(d).allow,
  );

  let stage: NormalizationStatus['cutover_hints']['stage'] = 'soak';
  if (allPipelineCutoverActive || !writeConfig.write_snapshots_enabled) {
    stage = 'write_cutover';
  } else if (
    matureCutoverActive ||
    writeConfig.snapshot_skip_domains.length > 0 ||
    writeConfig.write_cutover_all
  ) {
    stage = 'write_cutover_partial';
  } else if (preferNormalizedTables()) {
    stage = 'read_cutover';
  }

  const archives = await listSnapshotArchives(10);

  const snapshotRows = (snapshots ?? []).map((s) => {
    const payload = s.payload as unknown;
    const empty =
      payload == null ||
      (typeof payload === 'object' &&
        !Array.isArray(payload) &&
        Object.keys(payload as object).length === 0);
    return {
      collection: String(s.collection),
      updated_at: String(s.updated_at),
      version: Number(s.version ?? 1),
      payload_empty: empty,
    };
  });

  return {
    ok: true,
    prefer_normalized_tables: preferNormalizedTables(),
    master_data_source: getMasterDataSource(),
    master_data_hydrate_error: getMasterDataHydrateError(),
    sentry_configured: isSentryConfigured(),
    write_cutover: {
      ...writeConfig,
      snapshot_write_gates,
      snapshot_write_stats: writeStats,
      mature_cutover_active: matureCutoverActive,
      all_pipeline_cutover_active: allPipelineCutoverActive,
      handoffs_table_ready: handoffsReady,
      audits_tables_ready: auditsReady,
      archive_table_ready: archiveReady,
      archive_ready_collections: archiveReadyCollections,
    },
    sync_stats: syncStats,
    sync_failure_count: syncFailures.length,
    sync_failures: syncFailures,
    fk_integrity: fkIntegrity,
    fk_orphan_total: fkOrphanTotal,
    fetched_at: new Date().toISOString(),
    row_counts: counts,
    snapshots: snapshotRows,
    recent_archives:
      archives?.map((a) => ({
        id: String(a.id),
        collection: String(a.collection),
        archived_at: String(a.archived_at),
        note: (a.note as string | null) ?? null,
      })) ?? null,
    cutover_hints: {
      stage,
      next:
        stage === 'soak'
          ? 'Set WRITE_CUTOVER_MATURE=1 on Vercel after sync_failure_count is 0, then soft-archive via POST /api/admin/snapshot-archive'
          : stage === 'write_cutover_partial'
            ? 'Extend with WRITE_CUTOVER_ALL=1 (includes MA/RE), monitor skips, then archive cut-over collections'
            : stage === 'read_cutover'
              ? 'Enable WRITE_CUTOVER_MATURE=1 when handoffs/audits tables are ready'
              : fkOrphanTotal > 0
                ? 'Write cutover active — apply phase17_validate_fks.sql to clear FK orphans'
                : 'Write cutover healthy — apply phase17_entity_rls.sql for subsidiary scope; Stage 4 drop later',
    },
  };
}
