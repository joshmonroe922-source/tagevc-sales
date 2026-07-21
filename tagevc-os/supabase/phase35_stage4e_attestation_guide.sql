-- Phase 35 Stage 4e evidence review guide.
-- Read-only. This file performs no snapshot relation mutation.

select
  r.drill_run_id,
  r.retired_table_name,
  r.status,
  r.manifest_sha256,
  r.artifact_uri,
  r.artifact_sha256,
  r.procedure_sha256,
  r.operator_id,
  r.reviewer_id,
  r.operator_attested_at,
  r.reviewer_attested_at,
  r.valid_until,
  r.config_fingerprint,
  e.status as epoch_status
from public.os_snapshot_rollback_rehearsals r
join public.os_snapshot_soak_epochs e on e.epoch_id = r.epoch_id
order by r.created_at desc
limit 20;

select
  drill_run_id,
  actor_id,
  actor_role,
  decision,
  manifest_sha256,
  statement,
  created_at
from public.os_snapshot_rollback_attestations
order by created_at desc
limit 40;
