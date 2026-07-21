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
  var __tageLastSoakRun: SoakRunRecord | undefined;
}

export function recordSoakRun(run: SoakRunRecord) {
  globalThis.__tageLastSoakRun = run;
}

export function getLastSoakRun(): SoakRunRecord | null {
  return globalThis.__tageLastSoakRun ?? null;
}

/** Stage 4e soft-rename readiness. Destructive DROP controls remain separate. */
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
  snapshots_table_error?: string | null;
  retired_table_name?: string | null;
  retired_table_row_count?: number | null;
  latest_retirement_event?: {
    stage?: string;
    retired_table_name?: string;
    approved_by?: string;
    occurred_at?: string;
    detail?: string;
  } | null;
  soak_epoch?: {
    epoch_id: string;
    status: string;
    healthy_count: number;
    streak_started_at: string | null;
    last_observed_at: string | null;
    required_hours: number;
    max_gap_hours: number;
    reset_reason: string | null;
    config_fingerprint: string | null;
  } | null;
  rollback_rehearsal?: {
    status: string;
    epoch_id: string;
    valid_until: string | null;
    operator_id: string;
    reviewer_id: string | null;
    manifest_sha256: string;
  } | null;
  /** Days remaining until ≥90d retention from ARCHIVE_EXPORT_CONFIRMED_AT. */
  retention_days_remaining?: number | null;
  retention_confirmed?: boolean;
}): Stage4eChecklist {
  const exportOps = getArchiveExportOpsConfirmation();
  const dropGate = getSnapshotDropGate();
  const snapCount = input.snapshots_table_row_count;
  const softRenamedAt = process.env.SNAPSHOT_SOFT_RENAMED_AT?.trim() || null;
  const softRenameApprovalAt =
    process.env.SNAPSHOT_SOFT_RENAME_APPROVED_AT?.trim() || null;
  const softRenameApprovalBy =
    process.env.SNAPSHOT_SOFT_RENAME_APPROVED_BY?.trim() || null;
  const softRenameDate = softRenamedAt ? new Date(softRenamedAt) : null;
  const approvalDate = softRenameApprovalAt
    ? new Date(softRenameApprovalAt)
    : null;
  const softRenameDateValid = Boolean(
    softRenameDate && !Number.isNaN(softRenameDate.getTime()),
  );
  const retiredNameValid = Boolean(
    input.retired_table_name &&
      /^os_store_snapshots_retired_\d{8}$/.test(input.retired_table_name),
  );
  const writtenApprovalValid = Boolean(
    softRenameApprovalBy &&
      approvalDate &&
      !Number.isNaN(approvalDate.getTime()) &&
      softRenameDate &&
      approvalDate.getTime() <= softRenameDate.getTime(),
  );
  const retirementAuditValid = Boolean(
    input.latest_retirement_event?.occurred_at &&
      ['renamed', 'rename_verified'].includes(
        input.latest_retirement_event.stage ?? '',
      ) &&
      input.latest_retirement_event.retired_table_name ===
        input.retired_table_name &&
      input.latest_retirement_event.approved_by === softRenameApprovalBy &&
      approvalDate &&
      new Date(input.latest_retirement_event.occurred_at).getTime() >=
        approvalDate.getTime(),
  );
  const renameSoakDays = softRenameDateValid
    ? Math.floor(
        (Date.now() - (softRenameDate as Date).getTime()) / 86_400_000,
      )
    : 0;
  const renameSoakOk =
    softRenameDateValid &&
    retirementAuditValid &&
    input.soak_epoch?.status === 'qualified';
  const rollbackRehearsalValid = Boolean(
    input.rollback_rehearsal?.status === 'attested' &&
      input.rollback_rehearsal.epoch_id === input.soak_epoch?.epoch_id &&
      input.rollback_rehearsal.reviewer_id &&
      input.rollback_rehearsal.reviewer_id !==
        input.rollback_rehearsal.operator_id &&
      input.rollback_rehearsal.valid_until &&
      Date.parse(input.rollback_rehearsal.valid_until) > Date.now(),
  );
  const softRename = {
    env_set: Boolean(softRenamedAt),
    confirmed:
      softRenameDateValid &&
      retiredNameValid &&
      (input.retired_table_row_count ?? 0) > 0 &&
      writtenApprovalValid &&
      retirementAuditValid,
    detail: softRenamedAt
      ? `Rename ${softRenameDateValid ? 'dated' : 'has invalid date'} ${softRenamedAt} · retired table ${
          retiredNameValid
            ? `${input.retired_table_name} (${input.retired_table_row_count ?? 'unverified'} rows)`
            : 'name missing/invalid'
        } · written approval ${
          writtenApprovalValid
            ? `${softRenameApprovalBy} at ${softRenameApprovalAt}`
            : 'missing, invalid, or later than rename'
        } · audit ${retirementAuditValid ? 'correlated' : 'missing/mismatched'}`
      : 'Set SNAPSHOT_SOFT_RENAMED_AT + SNAPSHOT_RETIRED_TABLE_NAME only after approved offline rename',
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
      label: softRenamedAt
        ? 'Continuous healthy soft-rename soak qualified'
        : 'Recent soak run healthy',
      ok: softRenamedAt
        ? input.soak_epoch?.status === 'qualified'
        : Boolean(input.last_soak?.healthy),
      detail: softRenamedAt
        ? input.soak_epoch
          ? `${input.soak_epoch.status} · ${input.soak_epoch.healthy_count} observations · started ${input.soak_epoch.streak_started_at ?? 'pending'}${
              input.soak_epoch.reset_reason
                ? ` · reset: ${input.soak_epoch.reset_reason}`
                : ''
            }`
          : 'No durable soak epoch for the active retired relation'
        : input.last_soak
          ? `${input.last_soak.fetched_at} · ${input.last_soak.healthy ? 'healthy' : 'degraded'}`
          : 'No soak run yet — wait for cron or trigger soak-health',
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
      label: 'Snapshot relation state verified (no DROP)',
      ok: input.snapshots_table_error
        ? softRename.confirmed
        : snapCount != null && snapCount >= 0,
      detail:
        input.snapshots_table_error
          ? softRename.confirmed
            ? `Live name absent after correlated rename; retired table ${input.retired_table_name} has ${input.retired_table_row_count} rows`
            : `Unverified live table query error: ${input.snapshots_table_error}`
          : snapCount == null
          ? 'Row count unavailable'
          : `rows=${snapCount} — Phase 35 does not drop this table from the app. Use reviewed offline soft rename only`,
    },
    {
      id: 'soft_rename_path',
      label: 'Soft-rename path documented / confirmed (ops)',
      ok: softRename.confirmed,
      detail: softRename.detail,
    },
    {
      id: 'soft_rename_soak',
      label: 'Soft-rename soak window complete',
      ok: renameSoakOk,
      detail: softRenameDateValid
        ? `${renameSoakDays}d wall time · durable epoch ${
            input.soak_epoch?.status ?? 'missing'
          } · require ${input.soak_epoch?.required_hours ?? 168} healthy hours with ≤${
            input.soak_epoch?.max_gap_hours ?? 8
          }h gaps`
        : 'Rename not confirmed',
    },
    {
      id: 'retirement_audit',
      label: 'Durable retirement audit evidence',
      ok: retirementAuditValid,
      detail: input.latest_retirement_event?.occurred_at
        ? `${input.latest_retirement_event.stage ?? 'event'} · ${
            input.latest_retirement_event.retired_table_name ?? 'no table'
          } · ${input.latest_retirement_event.approved_by ?? 'unknown approver'}`
        : 'Record a correlated renamed/rename_verified event for the exact table and approver',
    },
    {
      id: 'rollback_rehearsal',
      label: 'Two-actor offline rollback rehearsal attested',
      ok: rollbackRehearsalValid,
      detail: input.rollback_rehearsal
        ? `${input.rollback_rehearsal.status} · operator ${input.rollback_rehearsal.operator_id} · reviewer ${
            input.rollback_rehearsal.reviewer_id ?? 'pending'
          } · manifest ${input.rollback_rehearsal.manifest_sha256.slice(0, 12)}… · valid until ${
            input.rollback_rehearsal.valid_until ?? 'pending'
          }`
        : 'No offline rehearsal evidence for the active epoch/configuration',
    },
  ];

  // Soft-rename readiness only. Legacy retention/DROP gates do not block rename.
  const ready = items
    .filter(
      (item) =>
        item.id !== 'retention_window' && item.id !== 'ops_approval',
    )
    .every((i) => i.ok);

  return { ready, items, drop_gate: dropGate };
}
