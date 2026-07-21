-- Phase 37 read-only deployment checks.

select run_id, provider, status, contract_version, validation_status,
  error_class, retry_disposition, validation_evidence_sha256, updated_at
from public.os_marketing_paid_sync_runs
order by updated_at desc
limit 25;

select intent_id, operation_kind, state, row_version, resolution_disposition,
  resolution_evidence_sha256, updated_at
from public.os_docusign_send_intents
order by updated_at desc
limit 25;

select resolution_id, intent_id, decision, status, evidence_sha256,
  proposed_at, expires_at, reviewed_at
from public.os_docusign_manual_review_resolutions
order by proposed_at desc
limit 25;

select a.action_id, a.status, a.row_version, a.dispatch_authorized_at,
  d.dispatch_attempt_id, d.authorized_at, d.outcome,
  d.provider_preflight_sha256
from public.os_it_intune_actions a
left join public.os_it_intune_dispatch_attempts d using (action_id)
order by a.updated_at desc
limit 25;

select o.id as observation_id, o.drill_run_id, o.epoch_id, o.observed_at,
  o.continuity_status, o.evidence_sha256, r.status as drill_status,
  (select count(*) from public.os_snapshot_drill_checks c
    where c.drill_run_id=o.drill_run_id) as check_count
from public.os_snapshot_soak_observations o
left join public.os_snapshot_drill_runs r using (drill_run_id)
order by o.observed_at desc
limit 25;

select service, metric_key, entity_id, severity, observed_value, evaluated_at
from public.os_slo_evaluations
order by evaluated_at desc, service, metric_key
limit 100;

select alert_id, service, metric_key, entity_id, status, severity,
  first_breached_at, last_breached_at, resolved_at, occurrence_count
from public.os_slo_alerts
order by updated_at desc
limit 50;
