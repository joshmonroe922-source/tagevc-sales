-- Phase 34 Stage 4e operations guide (read-only).
-- This file intentionally contains no relation mutation statement.
--
-- Preconditions for any separately reviewed offline soft-rename rehearsal:
--   1. Latest os_snapshot_retirement_events row for the configured retired
--      relation is rename_verified and matches the approved operator/window.
--   2. Latest os_snapshot_drill_runs row is passed, has the active
--      config_fingerprint, and all linked checks are true.
--   3. The active os_snapshot_soak_epochs row is qualified after at least
--      168 hours and 21 distinct cron buckets.
--   4. Manual observations are retained but qualification_eligible=false.
--   5. A rollback rehearsal and artifact hash are reviewed offline.
--
-- Evidence inspection:
select
  status,
  retired_table_name,
  config_fingerprint,
  streak_started_at,
  last_observed_at,
  healthy_count,
  qualified_at,
  reset_reason
from public.os_snapshot_soak_epochs
order by created_at desc
limit 10;

select
  drill_run_id,
  trigger_source,
  status,
  retired_table_name,
  config_fingerprint,
  code_revision,
  evidence_sha256,
  completed_at
from public.os_snapshot_drill_runs
order by started_at desc
limit 20;

select
  observation_bucket,
  qualification_eligible,
  continuity_status,
  drill_run_id,
  evidence_sha256,
  observed_at
from public.os_snapshot_soak_observations
order by observed_at desc
limit 40;
