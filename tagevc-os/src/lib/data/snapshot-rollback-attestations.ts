import { createPersistClient } from '@/lib/supabase/persist-client';

export type SnapshotRollbackRehearsal = {
  drill_run_id: string;
  epoch_id: string;
  retired_table_name: string;
  config_fingerprint: string;
  status: string;
  manifest_sha256: string;
  evidence_bundle_sha256: string | null;
  manifest: Record<string, unknown>;
  artifact_uri: string;
  artifact_sha256: string;
  procedure_sha256: string;
  operator_id: string;
  reviewer_id: string | null;
  operator_attested_at: string;
  reviewer_attested_at: string | null;
  expires_at: string;
  valid_until: string | null;
  expired_at: string | null;
  expiry_reason: string | null;
  supersedes_drill_run_id: string | null;
  superseded_by_drill_run_id: string | null;
  superseded_at: string | null;
  row_version: number;
};

export async function listSnapshotRollbackRehearsals(
  limit = 10,
  epochId?: string | null,
) {
  const sb = await createPersistClient();
  const { error: refreshError } = await sb.rpc(
    'refresh_snapshot_rollback_rehearsals',
    { p_epoch_id: epochId ?? null },
  );
  let query = sb
    .from('os_snapshot_rollback_rehearsals')
    .select(
      'drill_run_id, epoch_id, retired_table_name, config_fingerprint, status, manifest, manifest_sha256, evidence_bundle_sha256, artifact_uri, artifact_sha256, procedure_sha256, operator_id, reviewer_id, operator_attested_at, reviewer_attested_at, expires_at, valid_until, expired_at, expiry_reason, supersedes_drill_run_id, superseded_by_drill_run_id, superseded_at, row_version',
    )
    .order('created_at', { ascending: false });
  if (epochId) query = query.eq('epoch_id', epochId);
  const { data, error } = await query.limit(limit);
  return {
    rows: (data ?? []) as SnapshotRollbackRehearsal[],
    error: refreshError?.message || error?.message,
  };
}

export async function listSnapshotRollbackEvidence(drillRunIds: string[]) {
  if (drillRunIds.length === 0) return { attestations: [], events: [] };
  const sb = await createPersistClient();
  const [{ data: attestations }, { data: events }] = await Promise.all([
    sb
      .from('os_snapshot_rollback_attestations')
      .select(
        'attestation_id, drill_run_id, actor_id, actor_role, decision, statement, manifest_sha256, created_at',
      )
      .in('drill_run_id', drillRunIds)
      .order('created_at', { ascending: true }),
    sb
      .from('os_snapshot_rollback_rehearsal_events')
      .select(
        'event_id, drill_run_id, event_type, from_status, to_status, actor_id, reason, evidence_bundle_sha256, row_version, occurred_at',
      )
      .in('drill_run_id', drillRunIds)
      .order('occurred_at', { ascending: false }),
  ]);
  return { attestations: attestations ?? [], events: events ?? [] };
}

export async function createSnapshotRollbackRehearsal(input: {
  epoch_id: string;
  retired_table_name: string;
  config_fingerprint: string;
  manifest: Record<string, unknown>;
  artifact_uri: string;
  artifact_sha256: string;
  procedure_sha256: string;
  actor_id: string;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc('create_snapshot_rollback_rehearsal', {
    p_epoch_id: input.epoch_id,
    p_retired_table_name: input.retired_table_name,
    p_config_fingerprint: input.config_fingerprint,
    p_manifest: input.manifest,
    p_artifact_uri: input.artifact_uri,
    p_artifact_sha256: input.artifact_sha256,
    p_procedure_sha256: input.procedure_sha256,
    p_actor_id: input.actor_id,
  });
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, data };
}

export async function reviewSnapshotRollbackRehearsal(input: {
  drill_run_id: string;
  actor_id: string;
  manifest_sha256: string;
  evidence_bundle_sha256: string;
  decision: 'attest' | 'reject';
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'review_snapshot_rollback_rehearsal_v2',
    {
      p_drill_run_id: input.drill_run_id,
      p_actor_id: input.actor_id,
      p_manifest_sha256: input.manifest_sha256,
      p_evidence_bundle_sha256: input.evidence_bundle_sha256,
      p_decision: input.decision,
      p_statement: input.statement,
      p_expected_row_version: input.expected_row_version,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, data };
}
