-- Phase 35: governed Intune match/cancel/retry and two-actor offline rollback
-- evidence. This migration contains no snapshot relation mutation capability.

alter table public.os_it_intune_actions
  add column if not exists local_asset_id text
    references public.os_it_hardware_assets(asset_id),
  add column if not exists matched_by uuid,
  add column if not exists matched_at timestamptz,
  add column if not exists match_snapshot jsonb,
  add column if not exists match_sha256 text,
  add column if not exists approval_match_sha256 text,
  add column if not exists retry_of_action_id uuid
    references public.os_it_intune_actions(action_id),
  add column if not exists retry_generation smallint not null default 0,
  add column if not exists cancelled_by uuid,
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists terminal_at timestamptz,
  add column if not exists failure_code text;
create unique index if not exists os_it_intune_retry_child_unique
  on public.os_it_intune_actions (retry_of_action_id)
  where retry_of_action_id is not null;
create unique index if not exists os_it_intune_active_asset_unique
  on public.os_it_intune_actions (local_asset_id, action_type)
  where local_asset_id is not null
    and status in ('requested','approved','dispatching','submitted','verifying');

create or replace function public.guard_it_intune_terminal_state()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.status in ('verified','failed','cancelled')
     and new.status is distinct from old.status then
    raise exception 'Terminal Intune actions are immutable; create a retry child';
  end if;
  if new.status in ('verified','failed','cancelled') and old.status <> new.status then
    new.terminal_at := coalesce(new.terminal_at, now());
  end if;
  if new.status = 'failed' then
    new.failure_code := coalesce(new.failure_code,
      new.verification_evidence->>'failure_code', new.verification_code);
  end if;
  return new;
end;
$$;
drop trigger if exists os_it_intune_terminal_guard
  on public.os_it_intune_actions;
create trigger os_it_intune_terminal_guard
before update on public.os_it_intune_actions
for each row execute function public.guard_it_intune_terminal_state();

create or replace function public.match_it_intune_action(
  p_action_id uuid,
  p_asset_id text,
  p_actor_id uuid,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_asset record;
  v_provider_serial text;
  v_asset_serial text;
  v_snapshot jsonb;
  v_hash text;
  v_duplicate_count integer;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.status <> 'requested'
     or v_action.row_version <> p_expected_row_version then
    raise exception 'Intune action state/version mismatch';
  end if;
  select asset_id, entity_id, serial_number, model, status into v_asset
  from public.os_it_hardware_assets where asset_id = p_asset_id;
  if not found or lower(coalesce(v_asset.status,'')) = 'retired'
     or v_asset.entity_id is distinct from v_action.entity_id then
    raise exception 'Asset is not eligible or entity does not match';
  end if;
  v_provider_serial := upper(regexp_replace(
    coalesce(v_action.request_metadata->>'serial_number',''), '[^A-Za-z0-9]', '', 'g'));
  v_asset_serial := upper(regexp_replace(coalesce(v_asset.serial_number,''),
    '[^A-Za-z0-9]', '', 'g'));
  if v_provider_serial = '' or v_provider_serial <> v_asset_serial then
    raise exception 'Provider and local asset serials do not match';
  end if;
  select count(*) into v_duplicate_count from public.os_it_hardware_assets
  where upper(regexp_replace(coalesce(serial_number,''), '[^A-Za-z0-9]', '', 'g'))
    = v_asset_serial;
  if v_duplicate_count <> 1 then
    raise exception 'Local serial is not unique; correct inventory before matching';
  end if;
  v_snapshot := jsonb_build_object(
    'action_id', v_action.action_id,
    'managed_device_id', v_action.managed_device_id,
    'asset_id', v_asset.asset_id,
    'normalized_serial', v_asset_serial,
    'device_name', v_action.request_metadata->>'device_name',
    'provider_model', v_action.request_metadata->>'model',
    'asset_model', v_asset.model,
    'entity_id', v_action.entity_id,
    'matched_by', p_actor_id,
    'matched_at', now()
  );
  v_hash := encode(digest(v_snapshot::text, 'sha256'), 'hex');
  update public.os_it_intune_actions set
    local_asset_id = p_asset_id, matched_by = p_actor_id, matched_at = now(),
    match_snapshot = v_snapshot, match_sha256 = v_hash,
    approved_by = null, approved_at = null, approval_reason = null,
    approval_expires_at = null, approval_match_sha256 = null,
    row_version = row_version + 1, updated_at = now()
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values (
    p_action_id, 'requested', 'requested', p_actor_id, 'asset_match',
    jsonb_build_object('asset_id', p_asset_id, 'match_sha256', v_hash),
    p_action_id::text || ':matched:' || v_action.row_version, v_action.row_version
  );
  return jsonb_build_object('action_id', p_action_id,
    'match_sha256', v_hash, 'row_version', v_action.row_version);
end;
$$;

create or replace function public.approve_it_intune_action_v2(
  p_action_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_expected_row_version bigint,
  p_expected_match_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_action public.os_it_intune_actions%rowtype;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.status <> 'requested'
     or v_action.row_version <> p_expected_row_version
     or v_action.local_asset_id is null
     or v_action.match_sha256 is distinct from p_expected_match_sha256 then
    raise exception 'Intune approval state, version, or asset match changed';
  end if;
  if length(trim(p_reason)) < 5 then raise exception 'Approval reason too short'; end if;
  update public.os_it_intune_actions set
    status = 'approved', approved_by = p_actor_id, approved_at = now(),
    approval_reason = trim(p_reason), approval_expires_at = now() + interval '1 hour',
    approval_match_sha256 = match_sha256, next_poll_at = now(),
    row_version = row_version + 1, updated_at = now()
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values (
    p_action_id, 'requested', 'approved', p_actor_id, 'operator',
    jsonb_build_object('reason', trim(p_reason),
      'asset_id', v_action.local_asset_id,
      'match_sha256', v_action.match_sha256,
      'expires_at', v_action.approval_expires_at),
    p_action_id::text || ':approved:' || v_action.row_version, v_action.row_version
  );
  return jsonb_build_object('action_id', p_action_id,
    'status', 'approved', 'row_version', v_action.row_version);
end;
$$;

create or replace function public.cancel_it_intune_action(
  p_action_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_action public.os_it_intune_actions%rowtype; v_from text;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.status not in ('requested','approved')
     or v_action.row_version <> p_expected_row_version then
    raise exception 'Only current requested/approved actions can be cancelled';
  end if;
  if length(trim(p_reason)) < 5 then raise exception 'Cancellation reason too short'; end if;
  v_from := v_action.status;
  update public.os_it_intune_actions set
    status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(),
    cancel_reason = trim(p_reason), terminal_at = now(),
    lease_token = null, lease_expires_at = null, worker_id = null,
    next_poll_at = null, row_version = row_version + 1, updated_at = now()
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values (
    p_action_id, v_from, 'cancelled', p_actor_id, 'operator',
    jsonb_build_object('reason', trim(p_reason)),
    p_action_id::text || ':cancelled:' || v_action.row_version, v_action.row_version
  );
  return jsonb_build_object('action_id', p_action_id, 'status', 'cancelled');
end;
$$;

create or replace function public.retry_it_intune_action(
  p_action_id uuid,
  p_actor_id uuid,
  p_reason text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_old public.os_it_intune_actions%rowtype;
  v_new public.os_it_intune_actions%rowtype;
  v_root uuid;
begin
  select * into v_old from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_old.status not in ('failed','cancelled')
     or v_old.row_version <> p_expected_row_version
     or v_old.retry_generation >= 2 then
    raise exception 'Action is not eligible for retry';
  end if;
  if length(trim(p_reason)) < 10 then raise exception 'Retry reason too short'; end if;
  v_root := coalesce(v_old.retry_of_action_id, v_old.action_id);
  insert into public.os_it_intune_actions (
    idempotency_key, run_id, item_id, managed_device_id, user_id, entity_id,
    action_type, status, requested_by, request_metadata,
    retry_of_action_id, retry_generation
  ) values (
    'retry:' || v_root || ':' || (v_old.retry_generation + 1),
    v_old.run_id, v_old.item_id, v_old.managed_device_id, v_old.user_id,
    v_old.entity_id, v_old.action_type, 'requested', p_actor_id,
    v_old.request_metadata || jsonb_build_object(
      'retry_reason', trim(p_reason), 'retry_parent', v_old.action_id),
    v_old.action_id, v_old.retry_generation + 1
  ) returning * into v_new;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values (
    v_new.action_id, null, 'requested', p_actor_id, 'retry',
    jsonb_build_object('retry_of', v_old.action_id, 'reason', trim(p_reason)),
    v_new.action_id::text || ':requested:retry', 0
  );
  return jsonb_build_object('action_id', v_new.action_id,
    'status', 'requested', 'retry_generation', v_new.retry_generation);
end;
$$;

-- Replace the Phase 34 claim with match/approval-expiry enforcement.
create or replace function public.claim_it_intune_actions(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 90
) returns setof public.os_it_intune_actions
language plpgsql security definer set search_path = public
as $$
begin
  update public.os_it_intune_actions set
    status = 'requested', approved_by = null, approved_at = null,
    approval_reason = null, approval_expires_at = null,
    approval_match_sha256 = null, next_poll_at = null,
    row_version = row_version + 1, updated_at = now()
  where status = 'approved' and approval_expires_at <= now();
  return query
  with candidates as (
    select action_id from public.os_it_intune_actions
    where status in ('approved','submitted','verifying','dispatching')
      and (next_poll_at is null or next_poll_at <= now())
      and (lease_expires_at is null or lease_expires_at < now())
      and (
        status <> 'approved'
        or (
          approval_expires_at > now()
          and local_asset_id is not null
          and approval_match_sha256 = match_sha256
          and attempt_count < 3
        )
      )
    order by coalesce(next_poll_at, approved_at, requested_at)
    for update skip locked
    limit least(greatest(p_limit,1),20)
  )
  update public.os_it_intune_actions a set
    status = case when a.status = 'approved' then 'dispatching' else 'verifying' end,
    dispatch_started_at = case when a.status = 'approved' then now()
      else a.dispatch_started_at end,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds,30),300)),
    worker_id = p_worker_id, row_version = a.row_version + 1, updated_at = now()
  from candidates c where a.action_id = c.action_id returning a.*;
end;
$$;

create table if not exists public.os_snapshot_rollback_rehearsals (
  drill_run_id uuid primary key references public.os_snapshot_drill_runs(drill_run_id),
  epoch_id uuid not null references public.os_snapshot_soak_epochs(epoch_id),
  retired_table_name text not null,
  config_fingerprint text not null,
  status text not null default 'awaiting_review',
  manifest jsonb not null,
  manifest_sha256 text not null,
  artifact_uri text not null,
  artifact_sha256 text not null,
  procedure_sha256 text not null,
  operator_id uuid not null,
  reviewer_id uuid,
  operator_attested_at timestamptz not null default now(),
  reviewer_attested_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  valid_until timestamptz,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_snapshot_rehearsal_status_check check (
    status in ('awaiting_review','attested','rejected','expired','superseded')
  ),
  constraint os_snapshot_rehearsal_table_check check (
    retired_table_name ~ '^os_store_snapshots_retired_[0-9]{8}$'
  ),
  constraint os_snapshot_rehearsal_hash_check check (
    manifest_sha256 ~ '^[0-9a-f]{64}$'
    and artifact_sha256 ~ '^[0-9a-f]{64}$'
    and procedure_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint os_snapshot_rehearsal_actor_check check (
    reviewer_id is null or reviewer_id <> operator_id
  )
);
create unique index if not exists os_snapshot_rehearsal_artifact_unique
  on public.os_snapshot_rollback_rehearsals (epoch_id, artifact_sha256);

create table if not exists public.os_snapshot_rollback_attestations (
  attestation_id uuid primary key default gen_random_uuid(),
  drill_run_id uuid not null references public.os_snapshot_rollback_rehearsals(drill_run_id),
  actor_id uuid not null,
  actor_role text not null check (actor_role in ('operator','reviewer')),
  decision text not null check (decision in ('attest','reject')),
  manifest_sha256 text not null,
  statement text not null,
  created_at timestamptz not null default now(),
  unique (drill_run_id, actor_role),
  unique (drill_run_id, actor_id)
);

alter table public.os_snapshot_rollback_rehearsals enable row level security;
alter table public.os_snapshot_rollback_attestations enable row level security;
create policy "os_snapshot_rehearsal_select"
  on public.os_snapshot_rollback_rehearsals for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_snapshot_rehearsal_attestation_select"
  on public.os_snapshot_rollback_attestations for select to authenticated
  using (public.is_firm_wide_access());
grant select on public.os_snapshot_rollback_rehearsals,
  public.os_snapshot_rollback_attestations to authenticated;

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
begin
  select epoch_id, retired_table_name, config_fingerprint, status into v_epoch
  from public.os_snapshot_soak_epochs where epoch_id = p_epoch_id for update;
  if not found or v_epoch.retired_table_name <> p_retired_table_name
     or v_epoch.config_fingerprint is distinct from p_config_fingerprint
     or v_epoch.status not in ('active','qualified') then
    raise exception 'Rollback rehearsal epoch/config mismatch';
  end if;
  if coalesce((p_manifest->>'production_relation_mutated')::boolean, true)
     or coalesce(p_manifest->>'restore_validation_result','') <> 'passed'
     or coalesce(p_manifest->>'application_smoke_result','') <> 'passed' then
    raise exception 'Manifest must prove isolated successful rehearsal without production mutation';
  end if;
  if p_artifact_uri !~ '^(https://|s3://|gs://)' then
    raise exception 'Artifact URI must use an approved external scheme';
  end if;
  v_manifest_sha := encode(digest(p_manifest::text, 'sha256'), 'hex');
  insert into public.os_snapshot_drill_runs (
    drill_run_id, idempotency_key, drill_type, trigger_source, status,
    epoch_id, retired_table_name, requested_by, config_fingerprint,
    code_revision, summary, evidence_sha256
  ) values (
    v_run_id, 'rollback-rehearsal:' || v_manifest_sha,
    'offline_rollback_rehearsal', 'offline_attestation', 'running',
    p_epoch_id, p_retired_table_name, p_actor_id, p_config_fingerprint,
    p_manifest->>'code_revision',
    jsonb_build_object('artifact_uri', p_artifact_uri,
      'production_relation_mutated', false), v_manifest_sha
  );
  insert into public.os_snapshot_rollback_rehearsals (
    drill_run_id, epoch_id, retired_table_name, config_fingerprint, manifest,
    manifest_sha256, artifact_uri, artifact_sha256, procedure_sha256, operator_id
  ) values (
    v_run_id, p_epoch_id, p_retired_table_name, p_config_fingerprint, p_manifest,
    v_manifest_sha, p_artifact_uri, p_artifact_sha256, p_procedure_sha256, p_actor_id
  );
  insert into public.os_snapshot_drill_checks (
    drill_run_id, domain, check_name, ok, expected, observed
  ) values
    (v_run_id, 'rollback', 'production_relation_untouched', true,
      '{"production_relation_mutated":false}'::jsonb,
      jsonb_build_object('production_relation_mutated',
        p_manifest->'production_relation_mutated')),
    (v_run_id, 'rollback', 'restore_validation_passed', true,
      '{"result":"passed"}'::jsonb,
      jsonb_build_object('result', p_manifest->>'restore_validation_result')),
    (v_run_id, 'rollback', 'application_smoke_passed', true,
      '{"result":"passed"}'::jsonb,
      jsonb_build_object('result', p_manifest->>'application_smoke_result')),
    (v_run_id, 'rollback', 'artifact_hashed', length(p_artifact_sha256) = 64,
      '{"sha256_length":64}'::jsonb,
      jsonb_build_object('sha256_length', length(p_artifact_sha256)));
  insert into public.os_snapshot_rollback_attestations (
    drill_run_id, actor_id, actor_role, decision, manifest_sha256, statement
  ) values (
    v_run_id, p_actor_id, 'operator', 'attest', v_manifest_sha,
    'I attest this evidence describes an isolated offline rollback rehearsal and no production relation was mutated.'
  );
  return jsonb_build_object('drill_run_id', v_run_id,
    'manifest_sha256', v_manifest_sha, 'status', 'awaiting_review');
end;
$$;

create or replace function public.review_snapshot_rollback_rehearsal(
  p_drill_run_id uuid,
  p_actor_id uuid,
  p_manifest_sha256 text,
  p_decision text,
  p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_rehearsal public.os_snapshot_rollback_rehearsals%rowtype; v_status text;
begin
  select * into v_rehearsal from public.os_snapshot_rollback_rehearsals
  where drill_run_id = p_drill_run_id for update;
  if not found or v_rehearsal.status <> 'awaiting_review'
     or v_rehearsal.expires_at <= now()
     or v_rehearsal.operator_id = p_actor_id
     or v_rehearsal.manifest_sha256 <> p_manifest_sha256
     or v_rehearsal.row_version <> p_expected_row_version then
    raise exception 'Rehearsal review actor, hash, version, or expiry mismatch';
  end if;
  if p_decision not in ('attest','reject') or length(trim(p_statement)) < 20 then
    raise exception 'Review decision and statement are required';
  end if;
  v_status := case when p_decision = 'attest' then 'attested' else 'rejected' end;
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
  return jsonb_build_object('drill_run_id', p_drill_run_id, 'status', v_status);
end;
$$;

revoke all on function public.match_it_intune_action(uuid,text,uuid,bigint)
  from public, authenticated;
revoke execute on function public.approve_it_intune_action(uuid,uuid,text)
  from service_role;
revoke all on function public.approve_it_intune_action_v2(uuid,uuid,text,bigint,text)
  from public, authenticated;
revoke all on function public.cancel_it_intune_action(uuid,uuid,text,bigint)
  from public, authenticated;
revoke all on function public.retry_it_intune_action(uuid,uuid,text,bigint)
  from public, authenticated;
revoke all on function public.create_snapshot_rollback_rehearsal(uuid,text,text,jsonb,text,text,text,uuid)
  from public, authenticated;
revoke all on function public.review_snapshot_rollback_rehearsal(uuid,uuid,text,text,text,bigint)
  from public, authenticated;
grant execute on function public.match_it_intune_action(uuid,text,uuid,bigint)
  to service_role;
grant execute on function public.approve_it_intune_action_v2(uuid,uuid,text,bigint,text)
  to service_role;
grant execute on function public.cancel_it_intune_action(uuid,uuid,text,bigint)
  to service_role;
grant execute on function public.retry_it_intune_action(uuid,uuid,text,bigint)
  to service_role;
grant execute on function public.create_snapshot_rollback_rehearsal(uuid,text,text,jsonb,text,text,text,uuid)
  to service_role;
grant execute on function public.review_snapshot_rollback_rehearsal(uuid,uuid,text,text,text,bigint)
  to service_role;
