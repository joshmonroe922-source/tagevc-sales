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

/** Stage 4e DROP readiness — informational only; never auto-drops. */
export type Stage4eChecklist = {
  ready: boolean;
  items: Array<{ id: string; label: string; ok: boolean; detail?: string }>;
};

export function buildStage4eChecklist(input: {
  stage4_ready: boolean;
  sql_only_hydrate_active: boolean;
  fk_orphan_total: number;
  sync_failure_count: number;
  archive_table_ready: boolean;
  recent_archive_count: number;
  last_soak: SoakRunRecord | null;
}): Stage4eChecklist {
  const items = [
    {
      id: 'drills',
      label: 'Empty-snapshot drills pass',
      ok: input.stage4_ready,
      detail: input.stage4_ready ? 'All domains green' : 'Fix failed domains first',
    },
    {
      id: 'sql_only',
      label: 'SQL-only hydrate active (Stage 4b)',
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
      label: 'Sync failures = 0',
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
      ok: false,
      detail: 'Manual — download /api/admin/archive-export and store ≥90 days',
    },
  ];

  // Never claim DROP-ready: export is always ops-manual
  const ready = false;

  return { ready, items };
}
