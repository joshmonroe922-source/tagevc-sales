-- Phase 36 read-only operational health guide.
-- This file performs no relation or payload mutation.

select status, count(*) as runs, min(queued_at) as oldest
from public.os_marketing_paid_sync_runs
where queued_at >= now() - interval '7 days'
group by status order by status;

select state, last_lookup_disposition, count(*) as intents,
  min(requested_at) as oldest
from public.os_docusign_send_intents
where requested_at >= now() - interval '30 days'
group by state, last_lookup_disposition
order by state, last_lookup_disposition;

select status, last_error_class, last_error_code, count(*) as actions
from public.os_it_intune_actions
where requested_at >= now() - interval '30 days'
group by status, last_error_class, last_error_code
order by status, last_error_class, last_error_code;

select drill_run_id, status, evidence_bundle_sha256, operator_id, reviewer_id,
  expires_at, valid_until, expired_at, expiry_reason,
  supersedes_drill_run_id, superseded_by_drill_run_id
from public.os_snapshot_rollback_rehearsals
order by created_at desc
limit 20;
