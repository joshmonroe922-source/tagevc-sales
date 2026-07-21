import { getArchiveExportOpsConfirmation } from '@/lib/data/archive-export-state';
import { getSnapshotDropGate } from '@/lib/data/snapshot-drop-gate';

export type SoakRunRecord = {
  fetched_at: string;
  healthy: boolean;
  issues: string[];
  stage: string;
  sync_failure_count: number;
  fk_orphan_total: number;
  stage4_ready: boolean;
  drill_summary: string;
  source: 'cron' | 'admin' | 'manual';
};

declare global {
  // eslint-disable-next-line no-var
  var __tageLastSoakRun: SoakRunRecord | undefined;
}

export function recordSoakRun(run: SoakRunRecord) {
  globalThis.__tageLastSoakRun = run;
}

export function getLastSoakRun(): SoakRunRecord | null {
  return globalThis.__tageLastSoakRun ?? null;
}

/** Stage 4e DROP readiness — never auto-drops; ready = checklist + ops approval. */
export type Stage4eChecklist = {
  ready: boolean;
  items: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
  drop_gate: ReturnType<typeof getSnapshotDropGate>;
};

export function buildStage4eChecklist(input: {
  stage4_ready: boolean;
  sql_only_hydrate_active: boolean;
  fk_orphan_total: number;
  sync_failure_count: number;
  archive_table_ready: boolean;
  recent_archive_count: number;
  last_soak: SoakRunRecord | null;
  /** Live os_store_snapshots row count (≥0 = table present). */
  snapshots_table_row_count?: number | null;
  /** Days remaining until ≥90d retention from ARCHIVE_EXPORT_CONFIRMED_AT. */
  retention_days_remaining?: number | null;
  retention_confirmed?: boolean;
}): Stage4eChecklist {
  const exportOps = getArchiveExportOpsConfirmation();
  const dropGate = getSnapshotDropGate();
  const snapCount = input.snapshots_table_row_count;
  const softRenamedAt = process.env.SNAPSHOT_SOFT_RENAMED_AT?.trim() || null;
  const softRename = {
    env_set: Boolean(softRenamedAt),
    confirmed: Boolean(softRenamedAt),
    detail: softRenamedAt
      ? `Soft rename confirmed at ${softRenamedAt} — use phase30_stage4e_drop.sql for eventual DROP`
      : 'Set SNAPSHOT_SOFT_RENAMED_AT after offline rename to os_store_snapshots_retired_YYYYMMDD',
  };
  const retentionOk =
    Boolean(input.retention_confirmed) &&
    input.retention_days_remaining != null &&
    input.retention_days_remaining <= 0;
  const items = [
    {
      id: 'drills',
      label: 'Empty-snapshot drills pass',
      ok: input.stage4_ready,
      detail: input.stage4_ready ? 'All domains green' : 'Fix failed domains first',
    },
    {
      id: 'sql_only',
      label: 'SQL-only hydrate active (Stage 4b/4c)',
      ok: input.sql_only_hydrate_active,
      detail: input.sql_only_hydrate_active
        ? 'Payload load skipped for pipeline domains'
        : 'Enable write cutover / READ_CUTOVER_ALL',
    },
    {
      id: 'fk',
      label: 'FK orphans = 0',
      ok: input.fk_orphan_total === 0,
      detail: `orphans=${input.fk_orphan_total}`,
    },
    {
      id: 'sync',
      label: 'Normalized sync failures = 0',
      ok: input.sync_failure_count === 0,
      detail: `failures=${input.sync_failure_count}`,
    },
    {
      id: 'archive',
      label: 'Archive table ready + rows present',
      ok: input.archive_table_ready && input.recent_archive_count > 0,
      detail: input.archive_table_ready
        ? `recent=${input.recent_archive_count}`
        : 'Apply Phase 16 SQL',
    },
    {
      id: 'soak',
      label: 'Recent soak run healthy',
      ok: Boolean(input.last_soak?.healthy),
      detail: input.last_soak
        ? `${input.last_soak.fetched_at} · ${input.last_soak.healthy ? 'healthy' : 'degraded'}`
        : 'No soak run in this process yet — wait for cron or trigger soak-health',
    },
    {
      id: 'export',
      label: 'Offsite archive export retained (ops)',
      ok: exportOps.confirmed,
      detail: exportOps.detail,
    },
    {
      id: 'retention_window',
      label: '≥90-day retention window met',
      ok: retentionOk,
      detail:
        input.retention_days_remaining == null
          ? 'Confirm ARCHIVE_EXPORT_CONFIRMED_AT first'
          : input.retention_days_remaining > 0
            ? `${input.retention_days_remaining}d remaining before DROP eligibility`
            : 'Retention met — still need SNAPSHOT_DROP_APPROVED_*',
    },
    {
      id: 'ops_approval',
      label: 'Explicit DROP approval (env)',
      ok: dropGate.approved,
      detail: dropGate.detail,
    },
    {
      id: 'table_retained',
      label: 'os_store_snapshots still retained (no DROP)',
      ok: snapCount == null || snapCount >= 0,
      detail:
        snapCount == null
          ? 'Row count unavailable'
          : `rows=${snapCount} — Phase 30 does not drop this table from the app. Prefer soft rename via phase30_stage4e_drop.sql`,
    },
    {
      id: 'soft_rename_path',
      label: 'Soft-rename path documented / confirmed (ops)',
      ok: softRename.confirmed || softRename.env_set,
      detail: softRename.detail,
    },
  ];

  // Eligibility only — app never executes DROP even when ready=true
  const ready = items
    .filter((i) => i.id !== 'table_retained' && i.id !== 'soft_rename_path')
    .every((i) => i.ok);

  return { ready, items, drop_gate: dropGate };
}
