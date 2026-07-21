import { createHash } from 'crypto';
import { createPersistClient } from '@/lib/supabase/persist-client';
import type { EmptySnapshotDrillReport } from '@/lib/data/snapshot-drills';

const SNAPSHOT_EVIDENCE_CONTRACT_VERSION = 'phase38-v1';

function normalizedBoolean(value: string | undefined): boolean | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return null;
}

function normalizedList(value: string | undefined): string[] {
  return [
    ...new Set(
      (value ?? '')
        .split(',')
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean),
    ),
  ].sort();
}

function normalizedTimestamp(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : trimmed;
}

export function snapshotConfigFingerprint(): string {
  return createHash('sha256')
    .update(JSON.stringify(snapshotNormalizedConfig()))
    .digest('hex');
}

export function snapshotNormalizedConfig(): Record<string, unknown> {
  return {
    evidence_contract_version: SNAPSHOT_EVIDENCE_CONTRACT_VERSION,
    retired_table: process.env.SNAPSHOT_RETIRED_TABLE_NAME?.trim() || null,
    soft_renamed_at: normalizedTimestamp(process.env.SNAPSHOT_SOFT_RENAMED_AT),
    write_cutover_mature: normalizedBoolean(
      process.env.WRITE_CUTOVER_MATURE,
    ),
    write_cutover_all: normalizedBoolean(process.env.WRITE_CUTOVER_ALL),
    read_cutover_all: normalizedBoolean(process.env.READ_CUTOVER_ALL),
    write_snapshots: normalizedBoolean(process.env.WRITE_SNAPSHOTS),
    write_domains: normalizedList(process.env.SNAPSHOT_WRITE_DOMAINS),
    skip_domains: normalizedList(process.env.SNAPSHOT_SKIP_DOMAINS),
    read_force: normalizedBoolean(process.env.SNAPSHOT_READ_FORCE),
    read_skip_domains: normalizedList(process.env.SNAPSHOT_READ_SKIP_DOMAINS),
  };
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
  const normalizedConfig = snapshotNormalizedConfig();
  const configFingerprint = createHash('sha256')
    .update(JSON.stringify(normalizedConfig))
    .digest('hex');
  const requestedActor = {
    actor_id: input.requestedBy ?? null,
    actor_type: input.source === 'cron' ? 'cron' : 'user',
  };
  const observation =
    input.observation ?? {
      healthy: input.report.ok,
      issues: input.report.ok ? [] : [input.report.summary],
      stage: 'manual_drill',
      sync_failure_count: 0,
      fk_orphan_total: 0,
      stage4_ready: input.report.stage4_ready,
      drill_summary: input.report.summary,
    };
  const { data, error } = await sb.rpc('record_snapshot_evidence_cycle_v2', {
    p_source: input.source,
    p_requested_actor: requestedActor,
    p_observed_at: input.observedAt,
    p_normalized_config: normalizedConfig,
    p_contract_version: SNAPSHOT_EVIDENCE_CONTRACT_VERSION,
    p_code_revision: process.env.VERCEL_GIT_COMMIT_SHA?.trim() || 'local',
    p_report: input.report,
    p_observation: observation,
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
    ok?: boolean;
    replay_conflict?: boolean;
    error?: string;
  };
  if (row.ok === false) {
    return {
      ok: false,
      error: row.replay_conflict
        ? 'Snapshot evidence replay conflicted; both inputs were retained'
        : row.error || 'Snapshot evidence cycle failed',
    };
  }
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
