-- Phase 36: rollback rehearsal expiry, supersession, immutable bundle hashes,
-- and lifecycle evidence. No snapshot relation mutation is included.

alter table public.os_snapshot_rollback_rehearsals
  add column if not exists evidence_bundle_sha256 text,
  add column if not exists expired_at timestamptz,
  add column if not exists expiry_reason text,
  add column if not exists supersedes_drill_run_id uuid
    references public.os_snapshot_rollback_rehearsals(drill_run_id),
  add column if not exists superseded_by_drill_run_id uuid
    references public.os_snapshot_rollback_rehearsals(drill_run_id),
  add column if not exists superseded_at timestamptz,
  add column if not exists supersession_reason text;
create table if not exists public.os_snapshot_rollback_rehearsal_events (
  event_id uuid primary key default gen_random_uuid(),
  drill_run_id uuid not null
    references public.os_snapshot_rollback_rehearsals(drill_run_id),
  event_type text not null,
  from_status text,
  to_status text not null,
  actor_id uuid,
  reason text,
  evidence_bundle_sha256 text,
  row_version bigint not null,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_rehearsal_event_type_check check (
    event_type in ('operator_attested','reviewer_attested','rejected',
      'expired','superseded','epoch_invalidated')
  )
);
create index if not exists os_snapshot_rehearsal_event_timeline_idx
  on public.os_snapshot_rollback_rehearsal_events
    (drill_run_id, occurred_at desc);
alter table public.os_snapshot_rollback_rehearsal_events enable row level security;
drop policy if exists "os_snapshot_rehearsal_event_select"
  on public.os_snapshot_rollback_rehearsal_events;
create policy "os_snapshot_rehearsal_event_select"
  on public.os_snapshot_rollback_rehearsal_events for select to authenticated
  using (public.is_firm_wide_access());
grant select on public.os_snapshot_rollback_rehearsal_events to authenticated;

with ranked as (
  select drill_run_id,
    row_number() over (
      partition by epoch_id, retired_table_name, config_fingerprint
      order by created_at desc, drill_run_id desc
    ) as rank_no
  from public.os_snapshot_rollback_rehearsals
  where status = 'awaiting_review'
)
update public.os_snapshot_rollback_rehearsals r set
  status = 'expired', expired_at = now(),
  expiry_reason = 'duplicate_pending_migration',
  row_version = row_version + 1, updated_at = now()
from ranked where r.drill_run_id = ranked.drill_run_id
  and ranked.rank_no > 1;
update public.os_snapshot_drill_runs d set
  status = 'cancelled', completed_at = now()
from public.os_snapshot_rollback_rehearsals r
where d.drill_run_id = r.drill_run_id
  and r.expiry_reason = 'duplicate_pending_migration'
  and d.status = 'running';
insert into public.os_snapshot_rollback_rehearsal_events (
  drill_run_id, event_type, from_status, to_status, reason,
  evidence_bundle_sha256, row_version
)
select r.drill_run_id, 'expired', 'awaiting_review', 'expired',
  r.expiry_reason, r.evidence_bundle_sha256, r.row_version
from public.os_snapshot_rollback_rehearsals r
where r.expiry_reason = 'duplicate_pending_migration'
  and not exists (
    select 1 from public.os_snapshot_rollback_rehearsal_events e
    where e.drill_run_id = r.drill_run_id
      and e.event_type = 'expired'
      and e.reason = 'duplicate_pending_migration'
  );

with ranked as (
  select drill_run_id,
    first_value(drill_run_id) over (
      partition by epoch_id, retired_table_name, config_fingerprint
      order by reviewer_attested_at desc nulls last, created_at desc,
        drill_run_id desc
    ) as newest_id,
    row_number() over (
      partition by epoch_id, retired_table_name, config_fingerprint
      order by reviewer_attested_at desc nulls last, created_at desc,
        drill_run_id desc
    ) as rank_no
  from public.os_snapshot_rollback_rehearsals
  where status = 'attested'
)
update public.os_snapshot_rollback_rehearsals r set
  status = 'superseded', superseded_by_drill_run_id = ranked.newest_id,
  superseded_at = now(), supersession_reason = 'Phase 36 duplicate cleanup',
  row_version = row_version + 1, updated_at = now()
from ranked where r.drill_run_id = ranked.drill_run_id
  and ranked.rank_no > 1;
insert into public.os_snapshot_rollback_rehearsal_events (
  drill_run_id, event_type, from_status, to_status, reason,
  evidence_bundle_sha256, row_version
)
select r.drill_run_id, 'superseded', 'attested', 'superseded',
  r.supersession_reason, r.evidence_bundle_sha256, r.row_version
from public.os_snapshot_rollback_rehearsals r
where r.supersession_reason = 'Phase 36 duplicate cleanup'
  and not exists (
    select 1 from public.os_snapshot_rollback_rehearsal_events e
    where e.drill_run_id = r.drill_run_id
      and e.event_type = 'superseded'
      and e.reason = 'Phase 36 duplicate cleanup'
  );

create unique index if not exists os_snapshot_one_pending_rehearsal
  on public.os_snapshot_rollback_rehearsals
    (epoch_id, retired_table_name, config_fingerprint)
  where status = 'awaiting_review';
create unique index if not exists os_snapshot_one_effective_rehearsal
  on public.os_snapshot_rollback_rehearsals
    (epoch_id, retired_table_name, config_fingerprint)
  where status = 'attested';

create or replace function public.refresh_snapshot_rollback_rehearsals(
  p_epoch_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_row record; v_expired integer := 0; v_invalidated integer := 0;
begin
  for v_row in
    select r.*, e.status as epoch_status,
      e.config_fingerprint as current_config
    from public.os_snapshot_rollback_rehearsals r
    join public.os_snapshot_soak_epochs e on e.epoch_id = r.epoch_id
    where (p_epoch_id is null or r.epoch_id = p_epoch_id)
      and r.status in ('awaiting_review','attested')
      and (
        (r.status = 'awaiting_review' and r.expires_at <= now())
        or (r.status = 'awaiting_review' and r.evidence_bundle_sha256 is null)
        or (r.status = 'attested' and r.valid_until <= now())
        or e.status <> 'qualified'
        or e.config_fingerprint is distinct from r.config_fingerprint
      )
    for update of r skip locked
  loop
    update public.os_snapshot_rollback_rehearsals set
      status = 'expired', expired_at = now(),
      expiry_reason = case
        when v_row.epoch_status <> 'qualified' then 'epoch_not_qualified'
        when v_row.current_config is distinct from v_row.config_fingerprint
          then 'configuration_changed'
        when v_row.evidence_bundle_sha256 is null then 'legacy_bundle_missing'
        else 'validity_elapsed' end,
      row_version = row_version + 1, updated_at = now()
    where drill_run_id = v_row.drill_run_id;
    if v_row.status = 'awaiting_review' then
      update public.os_snapshot_drill_runs set
        status = 'cancelled', completed_at = now()
      where drill_run_id = v_row.drill_run_id and status = 'running';
    end if;
    insert into public.os_snapshot_rollback_rehearsal_events (
      drill_run_id, event_type, from_status, to_status, reason,
      evidence_bundle_sha256, row_version
    ) values (
      v_row.drill_run_id,
      case when v_row.epoch_status <> 'qualified'
        or v_row.current_config is distinct from v_row.config_fingerprint
        then 'epoch_invalidated' else 'expired' end,
      v_row.status, 'expired',
      case
        when v_row.epoch_status <> 'qualified' then 'epoch_not_qualified'
        when v_row.current_config is distinct from v_row.config_fingerprint
          then 'configuration_changed'
        when v_row.evidence_bundle_sha256 is null then 'legacy_bundle_missing'
        else 'validity_elapsed' end,
      v_row.evidence_bundle_sha256, v_row.row_version + 1
    );
    if v_row.epoch_status <> 'qualified' then
      v_invalidated := v_invalidated + 1;
    else
      v_expired := v_expired + 1;
    end if;
  end loop;
  return jsonb_build_object('expired', v_expired,
    'invalidated', v_invalidated);
end;
$$;

create or replace function public.create_snapshot_rollback_rehearsal(
  p_epoch_id uuid,
  p_retired_table_name text,
  p_config_fingerprint text,
  p_manifest jsonb,
  p_artifact_uri text,
  p_artifact_sha256 text,
  p_procedure_sha256 text,
  p_actor_id uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_epoch record;
  v_run_id uuid := gen_random_uuid();
  v_manifest_sha text;
  v_bundle_sha text;
  v_supersedes uuid;
  v_existing public.os_snapshot_rollback_rehearsals%rowtype;
begin
  select epoch_id, retired_table_name, config_fingerprint, status into v_epoch
  from public.os_snapshot_soak_epochs where epoch_id = p_epoch_id for update;
  if not found or v_epoch.retired_table_name <> p_retired_table_name
     or v_epoch.config_fingerprint is distinct from p_config_fingerprint
     or v_epoch.status <> 'qualified' then
    raise exception 'Rollback rehearsal requires the current qualified epoch/config';
  end if;
  perform public.refresh_snapshot_rollback_rehearsals(p_epoch_id);
  if coalesce(p_manifest->>'manifest_version','') <> 'phase36-v1'
     or coalesce((p_manifest->>'production_relation_mutated')::boolean, true)
     or coalesce((p_manifest->>'production_access_disabled')::boolean, false) <> true
     or nullif(p_manifest->>'isolated_environment','') is null
     or coalesce(p_manifest->>'restore_validation_result','') <> 'passed'
     or coalesce(p_manifest->>'application_smoke_result','') <> 'passed'
     or coalesce(p_manifest->>'before_schema_sha256','') !~ '^[0-9a-f]{64}$'
     or coalesce(p_manifest->>'after_schema_sha256','') !~ '^[0-9a-f]{64}$'
     or nullif(p_manifest->>'code_revision','') is null then
    raise exception 'Phase 36 manifest governance checks failed';
  end if;
  if p_artifact_uri !~ '^(https://|s3://|gs://)'
     or p_artifact_sha256 !~ '^[0-9a-f]{64}$'
     or p_procedure_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Artifact/procedure evidence is invalid';
  end if;
  v_manifest_sha := encode(digest(p_manifest::text, 'sha256'), 'hex');
  v_bundle_sha := encode(digest(concat_ws('|', p_epoch_id::text,
    p_retired_table_name, p_config_fingerprint, v_manifest_sha,
    p_artifact_uri, p_artifact_sha256, p_procedure_sha256), 'sha256'), 'hex');
  select * into v_existing from public.os_snapshot_rollback_rehearsals
  where evidence_bundle_sha256 = v_bundle_sha
  order by created_at desc limit 1 for update;
  if found then
    return jsonb_build_object('drill_run_id', v_existing.drill_run_id,
      'manifest_sha256', v_existing.manifest_sha256,
      'evidence_bundle_sha256', v_existing.evidence_bundle_sha256,
      'status', v_existing.status, 'idempotent_replay', true);
  end if;
  if exists (
    select 1 from public.os_snapshot_rollback_rehearsals
    where epoch_id = p_epoch_id and retired_table_name = p_retired_table_name
      and config_fingerprint = p_config_fingerprint
      and status = 'awaiting_review'
  ) then
    raise exception 'A different rollback evidence bundle is already awaiting review';
  end if;
  select drill_run_id into v_supersedes
  from public.os_snapshot_rollback_rehearsals
  where epoch_id = p_epoch_id and retired_table_name = p_retired_table_name
    and config_fingerprint = p_config_fingerprint and status = 'attested'
  order by reviewer_attested_at desc limit 1;
  insert into public.os_snapshot_drill_runs (
    drill_run_id, idempotency_key, drill_type, trigger_source, status,
    epoch_id, retired_table_name, requested_by, config_fingerprint,
    code_revision, summary, evidence_sha256
  ) values (
    v_run_id, 'rollback-rehearsal-v2:' || v_bundle_sha,
    'offline_rollback_rehearsal', 'offline_attestation', 'running',
    p_epoch_id, p_retired_table_name, p_actor_id, p_config_fingerprint,
    p_manifest->>'code_revision',
    jsonb_build_object('artifact_uri', p_artifact_uri,
      'evidence_bundle_sha256', v_bundle_sha,
      'production_relation_mutated', false), v_bundle_sha
  );
  insert into public.os_snapshot_rollback_rehearsals (
    drill_run_id, epoch_id, retired_table_name, config_fingerprint, manifest,
    manifest_sha256, evidence_bundle_sha256, artifact_uri, artifact_sha256,
    procedure_sha256, operator_id, supersedes_drill_run_id
  ) values (
    v_run_id, p_epoch_id, p_retired_table_name, p_config_fingerprint, p_manifest,
    v_manifest_sha, v_bundle_sha, p_artifact_uri, p_artifact_sha256,
    p_procedure_sha256, p_actor_id, v_supersedes
  );
  insert into public.os_snapshot_drill_checks (
    drill_run_id, domain, check_name, ok, expected, observed
  ) values
    (v_run_id, 'rollback', 'isolated_environment', true,
      '{"required":true}'::jsonb,
      jsonb_build_object('value', p_manifest->>'isolated_environment')),
    (v_run_id, 'rollback', 'production_access_disabled', true,
      '{"value":true}'::jsonb,
      jsonb_build_object('value', p_manifest->'production_access_disabled')),
    (v_run_id, 'rollback', 'production_relation_untouched', true,
      '{"value":false}'::jsonb,
      jsonb_build_object('value', p_manifest->'production_relation_mutated')),
    (v_run_id, 'rollback', 'restore_validation_passed', true,
      '{"result":"passed"}'::jsonb,
      jsonb_build_object('result', p_manifest->>'restore_validation_result')),
    (v_run_id, 'rollback', 'application_smoke_passed', true,
      '{"result":"passed"}'::jsonb,
      jsonb_build_object('result', p_manifest->>'application_smoke_result'));
  insert into public.os_snapshot_rollback_attestations (
    drill_run_id, actor_id, actor_role, decision, manifest_sha256, statement
  ) values (
    v_run_id, p_actor_id, 'operator', 'attest', v_manifest_sha,
    'I attest this evidence describes an isolated offline rollback rehearsal and no production relation was mutated.'
  );
  insert into public.os_snapshot_rollback_rehearsal_events (
    drill_run_id, event_type, to_status, actor_id, reason,
    evidence_bundle_sha256, row_version
  ) values (
    v_run_id, 'operator_attested', 'awaiting_review', p_actor_id,
    'Operator submitted governed Phase 36 evidence', v_bundle_sha, 0
  );
  return jsonb_build_object('drill_run_id', v_run_id,
    'manifest_sha256', v_manifest_sha,
    'evidence_bundle_sha256', v_bundle_sha,
    'status', 'awaiting_review');
end;
$$;

create or replace function public.review_snapshot_rollback_rehearsal_v2(
  p_drill_run_id uuid,
  p_actor_id uuid,
  p_manifest_sha256 text,
  p_evidence_bundle_sha256 text,
  p_decision text,
  p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rehearsal public.os_snapshot_rollback_rehearsals%rowtype;
  v_epoch record;
  v_status text;
  v_epoch_id uuid;
begin
  select epoch_id into v_epoch_id
  from public.os_snapshot_rollback_rehearsals
  where drill_run_id = p_drill_run_id;
  if not found then raise exception 'Rollback rehearsal not found'; end if;
  select status, retired_table_name, config_fingerprint into v_epoch
  from public.os_snapshot_soak_epochs
  where epoch_id = v_epoch_id for update;
  select * into v_rehearsal from public.os_snapshot_rollback_rehearsals
  where drill_run_id = p_drill_run_id for update;
  if not found or v_rehearsal.status <> 'awaiting_review'
     or v_rehearsal.expires_at <= now()
     or v_rehearsal.operator_id = p_actor_id
     or v_rehearsal.manifest_sha256 <> p_manifest_sha256
     or v_rehearsal.evidence_bundle_sha256 is distinct from
       p_evidence_bundle_sha256
     or v_rehearsal.row_version <> p_expected_row_version then
    raise exception 'Rehearsal review actor, hash, version, or expiry mismatch';
  end if;
  if not found or v_epoch.status is null or v_epoch.status <> 'qualified'
     or v_epoch.retired_table_name <> v_rehearsal.retired_table_name
     or v_epoch.config_fingerprint is distinct from v_rehearsal.config_fingerprint then
    raise exception 'Epoch governance changed before review';
  end if;
  if p_decision not in ('attest','reject')
     or nullif(trim(p_statement),'') is null
     or length(trim(p_statement)) < 20 then
    raise exception 'Review decision and statement are required';
  end if;
  v_status := case when p_decision = 'attest' then 'attested' else 'rejected' end;
  if v_status = 'attested' and v_rehearsal.supersedes_drill_run_id is not null then
    update public.os_snapshot_rollback_rehearsals set
      status = 'superseded', superseded_by_drill_run_id = p_drill_run_id,
      superseded_at = now(), supersession_reason = 'New attested evidence bundle',
      row_version = row_version + 1, updated_at = now()
    where drill_run_id = v_rehearsal.supersedes_drill_run_id
      and status = 'attested';
    insert into public.os_snapshot_rollback_rehearsal_events (
      drill_run_id, event_type, from_status, to_status, actor_id, reason,
      evidence_bundle_sha256, row_version
    ) select drill_run_id, 'superseded', 'attested', 'superseded', p_actor_id,
      'New attested evidence bundle', evidence_bundle_sha256, row_version
    from public.os_snapshot_rollback_rehearsals
    where drill_run_id = v_rehearsal.supersedes_drill_run_id;
  end if;
  insert into public.os_snapshot_rollback_attestations (
    drill_run_id, actor_id, actor_role, decision, manifest_sha256, statement
  ) values (
    p_drill_run_id, p_actor_id, 'reviewer', p_decision,
    p_manifest_sha256, trim(p_statement)
  );
  update public.os_snapshot_rollback_rehearsals set
    status = v_status, reviewer_id = p_actor_id, reviewer_attested_at = now(),
    valid_until = case when v_status = 'attested' then now() + interval '90 days' end,
    row_version = row_version + 1, updated_at = now()
  where drill_run_id = p_drill_run_id;
  update public.os_snapshot_drill_runs set
    status = case when v_status = 'attested' then 'passed' else 'failed' end,
    completed_at = now()
  where drill_run_id = p_drill_run_id;
  insert into public.os_snapshot_rollback_rehearsal_events (
    drill_run_id, event_type, from_status, to_status, actor_id, reason,
    evidence_bundle_sha256, row_version
  ) values (
    p_drill_run_id,
    case when v_status = 'attested' then 'reviewer_attested' else 'rejected' end,
    'awaiting_review', v_status, p_actor_id, trim(p_statement),
    v_rehearsal.evidence_bundle_sha256, v_rehearsal.row_version + 1
  );
  return jsonb_build_object('drill_run_id', p_drill_run_id,
    'status', v_status, 'evidence_bundle_sha256',
    v_rehearsal.evidence_bundle_sha256);
end;
$$;

revoke all on function public.refresh_snapshot_rollback_rehearsals(uuid)
  from public, authenticated;
grant execute on function public.refresh_snapshot_rollback_rehearsals(uuid)
  to service_role;
revoke all on function public.review_snapshot_rollback_rehearsal(uuid,uuid,text,text,text,bigint)
  from public, authenticated, service_role;
revoke all on function public.review_snapshot_rollback_rehearsal_v2(uuid,uuid,text,text,text,text,bigint)
  from public, authenticated;
grant execute on function public.review_snapshot_rollback_rehearsal_v2(uuid,uuid,text,text,text,text,bigint)
  to service_role;
