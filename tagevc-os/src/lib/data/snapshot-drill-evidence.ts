import { createHash } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { EmptySnapshotDrillReport } from '@/lib/data/snapshot-drills';

export function snapshotConfigFingerprint(): string {
  const config = {
    retired_table: process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
    soft_renamed_at: process.env.SNAPSHOT_SOFT_RENAMED_AT?.trim() || null,
    write_cutover_mature:
      process.env.WRITE_CUTOVER_MATURE?.trim() || null,
    write_cutover_all: process.env.WRITE_CUTOVER_ALL?.trim() || null,
    read_cutover_all: process.env.READ_CUTOVER_ALL?.trim() || null,
    write_snapshots: process.env.WRITE_SNAPSHOTS?.trim() || null,
    write_domains:
      process.env.SNAPSHOT_WRITE_DOMAINS?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .sort() ?? [],
    skip_domains:
      process.env.SNAPSHOT_SKIP_DOMAINS?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .sort() ?? [],
    read_force: process.env.SNAPSHOT_READ_FORCE?.trim() || null,
    read_skip_domains:
      process.env.SNAPSHOT_READ_SKIP_DOMAINS?.split(',')
        .map((value) => value.trim())
        .filter(Boolean)
        .sort() ?? [],
  };
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

export async function persistSnapshotDrillEvidence(input: {
  report: EmptySnapshotDrillReport;
  source: 'cron' | 'admin';
  requestedBy?: string | null;
}): Promise<
  | {
      ok: true;
      drill_run_id: string;
      evidence_sha256: string;
      config_fingerprint: string;
    }
  | { ok: false; error: string }
> {
  const result = await persistSnapshotEvidenceCycle({
    ...input,
    observedAt: input.report.fetched_at,
    recordSoak: false,
  });
  return result.ok
    ? {
        ok: true,
        drill_run_id: result.drill_run_id,
        evidence_sha256: result.evidence_sha256,
        config_fingerprint: result.config_fingerprint,
      }
    : result;
}

export async function persistSnapshotEvidenceCycle(input: {
  report: EmptySnapshotDrillReport;
  source: 'cron' | 'admin';
  requestedBy?: string | null;
  observedAt: string;
  recordSoak: boolean;
  observation?: {
    healthy: boolean;
    issues: string[];
    stage: string;
    sync_failure_count: number;
    fk_orphan_total: number;
    stage4_ready: boolean;
    drill_summary: string;
  };
}): Promise<
  | {
      ok: true;
      drill_run_id: string;
      observation_id: string | null;
      epoch_id: string | null;
      epoch_status: string | null;
      evidence_sha256: string;
      config_fingerprint: string;
      replayed: boolean;
    }
  | { ok: false; error: string }
> {
  const sb = await createPersistClient();
  const configFingerprint = snapshotConfigFingerprint();
  const { data, error } = await sb.rpc('record_snapshot_evidence_cycle', {
    p_source: input.source,
    p_requested_by: input.requestedBy ?? null,
    p_observed_at: input.observedAt,
    p_retired_table_name:
      process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
    p_config_fingerprint: configFingerprint,
    p_code_revision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'local',
    p_report: input.report,
    p_observation:
      input.observation ?? {
        healthy: input.report.ok,
        issues: input.report.ok ? [] : [input.report.summary],
        stage: 'manual_drill',
        sync_failure_count: 0,
        fk_orphan_total: 0,
        stage4_ready: input.report.stage4_ready,
        drill_summary: input.report.summary,
      },
    p_record_soak: input.recordSoak,
  });
  if (error || !data) {
    return { ok: false, error: error?.message || 'Evidence RPC returned no data' };
  }
  const row = data as {
    drill_run_id: string;
    observation_id: string | null;
    epoch_id: string | null;
    epoch_status: string | null;
    evidence_sha256: string;
    replayed: boolean;
    input_matched?: boolean;
  };
  if (row.replayed && row.input_matched !== true) {
    return { ok: false, error: 'Snapshot evidence replay did not match input' };
  }
  return {
    ok: true,
    drill_run_id: row.drill_run_id,
    observation_id: row.observation_id,
    epoch_id: row.epoch_id,
    epoch_status: row.epoch_status,
    evidence_sha256: row.evidence_sha256,
    config_fingerprint: configFingerprint,
    replayed: Boolean(row.replayed),
  };
}
