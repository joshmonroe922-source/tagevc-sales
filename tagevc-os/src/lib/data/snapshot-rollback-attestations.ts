import { createPersistClient } from '@/lib/supabase/persist-client';

export type SnapshotRollbackRehearsal = {
  drill_run_id: string;
  epoch_id: string;
  retired_table_name: string;
  config_fingerprint: string;
  status: string;
  manifest_sha256: string;
  artifact_uri: string;
  artifact_sha256: string;
  procedure_sha256: string;
  operator_id: string;
  reviewer_id: string | null;
  operator_attested_at: string;
  reviewer_attested_at: string | null;
  expires_at: string;
  valid_until: string | null;
  row_version: number;
};

export async function listSnapshotRollbackRehearsals(limit = 10) {
  const sb = await createPersistClient();
  const { data } = await sb
    .from('os_snapshot_rollback_rehearsals')
    .select(
      'drill_run_id, epoch_id, retired_table_name, config_fingerprint, status, manifest_sha256, artifact_uri, artifact_sha256, procedure_sha256, operator_id, reviewer_id, operator_attested_at, reviewer_attested_at, expires_at, valid_until, row_version',
    )
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as SnapshotRollbackRehearsal[];
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
  decision: 'attest' | 'reject';
  statement: string;
  expected_row_version: number;
}) {
  const sb = await createPersistClient();
  const { data, error } = await sb.rpc(
    'review_snapshot_rollback_rehearsal',
    {
      p_drill_run_id: input.drill_run_id,
      p_actor_id: input.actor_id,
      p_manifest_sha256: input.manifest_sha256,
      p_decision: input.decision,
      p_statement: input.statement,
      p_expected_row_version: input.expected_row_version,
    },
  );
  return error
    ? { ok: false as const, error: error.message }
    : { ok: true as const, data };
}
