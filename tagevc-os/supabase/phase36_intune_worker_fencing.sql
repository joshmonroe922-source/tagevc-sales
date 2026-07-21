-- Phase 36: one-at-a-time Intune leases, approval-expiry evidence, version
-- fencing, structured errors, and durable worker summaries.

alter table public.os_it_intune_actions
  add column if not exists lease_acquired_at timestamptz,
  add column if not exists approval_expired_at timestamptz,
  add column if not exists dispatch_authorized_at timestamptz,
  add column if not exists last_error_code text,
  add column if not exists last_error_class text,
  add column if not exists retry_child_action_id uuid
    references public.os_it_intune_actions(action_id),
  add column if not exists retried_by uuid,
  add column if not exists retried_at timestamptz,
  add column if not exists retry_reason text;
update public.os_it_intune_actions set
  lease_token = null, lease_acquired_at = null,
  lease_expires_at = null, worker_id = null
where lease_token is null or lease_expires_at is null
  or nullif(trim(worker_id),'') is null or lease_expires_at <= now();
update public.os_it_intune_actions set
  lease_acquired_at = coalesce(updated_at, now())
where lease_token is not null and lease_acquired_at is null;
alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_lease_shape_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_lease_shape_check check (
    (lease_token is null and lease_acquired_at is null
      and lease_expires_at is null and worker_id is null)
    or
    (lease_token is not null and lease_acquired_at is not null
      and lease_expires_at is not null and nullif(trim(worker_id),'') is not null)
  );
alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_error_class_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_error_class_check check (
    last_error_class is null or last_error_class in
      ('transient','ambiguous','permanent','platform')
  );
create index if not exists os_it_intune_approval_expiry_idx
  on public.os_it_intune_actions (approval_expires_at)
  where status = 'approved';

create table if not exists public.os_it_intune_worker_runs (
  worker_run_id uuid primary key default gen_random_uuid(),
  worker_id text not null,
  trigger_source text not null,
  status text not null default 'running',
  claimed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  lease_conflicts integer not null default 0,
  platform_error text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_it_intune_worker_status_check
    check (status in ('running','completed','partial','failed'))
);
alter table public.os_it_intune_worker_runs enable row level security;
drop policy if exists "os_it_intune_worker_run_select"
  on public.os_it_intune_worker_runs;
create policy "os_it_intune_worker_run_select"
  on public.os_it_intune_worker_runs for select to authenticated
  using (public.is_firm_wide_access());
grant select on public.os_it_intune_worker_runs to authenticated;

create or replace function public.expire_it_intune_actions_v2(
  p_limit integer default 100
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer := 0; v_action record;
begin
  for v_action in
    select action_id, row_version from public.os_it_intune_actions
    where status = 'approved' and approval_expires_at <= now()
    order by approval_expires_at for update skip locked
    limit least(greatest(p_limit,1),500)
  loop
    update public.os_it_intune_actions set
      status = case when attempt_count >= 3 then 'failed' else 'requested' end,
      approval_expired_at = now(), approved_by = null, approved_at = null,
      approval_reason = null, approval_expires_at = null,
      approval_match_sha256 = null, next_poll_at = null,
      terminal_at = case when attempt_count >= 3 then now() else terminal_at end,
      failure_code = case when attempt_count >= 3
        then 'dispatch_attempts_exhausted' else failure_code end,
      last_error_code = case when attempt_count >= 3
        then 'dispatch_attempts_exhausted' else 'approval_expired' end,
      last_error_class = case when attempt_count >= 3
        then 'permanent' else null end,
      row_version = row_version + 1, updated_at = now()
    where action_id = v_action.action_id;
    insert into public.os_it_intune_action_events (
      action_id, from_status, to_status, source, evidence,
      transition_key, row_version
    ) values (
      v_action.action_id, 'approved',
      case when (select status from public.os_it_intune_actions
        where action_id = v_action.action_id) = 'failed'
        then 'failed' else 'requested' end,
      'approval_expiry',
      jsonb_build_object('expired_at', now()),
      v_action.action_id::text || ':approval-expired:' ||
        (v_action.row_version + 1),
      v_action.row_version + 1
    ) on conflict (transition_key) do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_it_intune_action_v2(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns public.os_it_intune_actions
language plpgsql security definer set search_path = public
as $$
declare v_action public.os_it_intune_actions%rowtype; v_from text;
begin
  if nullif(trim(p_worker_id),'') is null then
    raise exception 'Worker ID is required';
  end if;
  select * into v_action from public.os_it_intune_actions
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
  for update skip locked limit 1;
  if not found then return null; end if;
  v_from := v_action.status;
  update public.os_it_intune_actions set
    status = case when v_from = 'approved' then 'dispatching'
      else 'verifying' end,
    dispatch_started_at = case when v_from = 'approved' then now()
      else dispatch_started_at end,
    dispatch_authorized_at = case when v_from = 'approved' then now()
      else dispatch_authorized_at end,
    lease_token = gen_random_uuid(), lease_acquired_at = now(),
    lease_expires_at = now() + make_interval(
      secs => least(greatest(p_lease_seconds,60),300)),
    worker_id = p_worker_id, row_version = row_version + 1, updated_at = now()
  where action_id = v_action.action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence,
    transition_key, worker_id, attempt_no, row_version
  ) values (
    v_action.action_id, v_from, v_action.status,
    case when v_from = 'dispatching' then 'lease_recovery' else 'worker_claim' end,
    jsonb_build_object('lease_expires_at', v_action.lease_expires_at,
      'ambiguous_prior_dispatch', v_from = 'dispatching'),
    v_action.action_id::text || ':claim:' || v_action.row_version,
    p_worker_id, v_action.attempt_count, v_action.row_version
  ) on conflict (transition_key) do nothing;
  return v_action;
end;
$$;

create or replace function public.finish_it_intune_action_v2(
  p_action_id uuid,
  p_lease_token uuid,
  p_worker_id text,
  p_expected_row_version bigint,
  p_status text,
  p_evidence jsonb,
  p_error text,
  p_verification_code text,
  p_graph_request_id text,
  p_error_code text,
  p_error_class text,
  p_retry_after_seconds integer default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_from text;
  v_now timestamptz := now();
begin
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.lease_token is distinct from p_lease_token
     or v_action.worker_id is distinct from p_worker_id
     or v_action.lease_expires_at is null or v_action.lease_expires_at <= v_now
     or v_action.row_version <> p_expected_row_version then
    raise exception 'Intune worker lease/version mismatch';
  end if;
  v_from := v_action.status;
  if not (
    (v_from = 'dispatching' and p_status in
      ('submitted','approved','verifying','verified','failed'))
    or (v_from = 'verifying' and p_status in ('verifying','verified','failed'))
  ) then
    raise exception 'Illegal Intune transition % -> %', v_from, p_status;
  end if;
  if v_from = 'dispatching' and p_status = 'approved'
     and coalesce((p_evidence->>'provider_post_started')::boolean, false) then
    raise exception 'A started provider POST cannot return to approved';
  end if;
  if p_error_class is not null and p_error_class not in
    ('transient','ambiguous','permanent','platform') then
    raise exception 'Invalid Intune error class';
  end if;
  update public.os_it_intune_actions set
    status = p_status,
    submitted_at = case when p_status = 'submitted'
      then coalesce(submitted_at, v_now) else submitted_at end,
    verified_at = case when p_status = 'verified' then v_now else verified_at end,
    next_poll_at = case
      when p_status = 'approved' then v_now + make_interval(
        secs => least(greatest(coalesce(p_retry_after_seconds,300),60),3600))
      when p_status in ('submitted','verifying') then
        v_now + make_interval(mins => least(60,
          greatest(2, power(2, least(poll_count,5))::integer)))
      else null end,
    poll_count = poll_count + case when v_from = 'verifying' then 1 else 0 end,
    attempt_count = attempt_count + case
      when v_from = 'dispatching'
        and coalesce((p_evidence->>'provider_post_started')::boolean, false)
      then 1 else 0 end,
    graph_request_id = coalesce(p_graph_request_id, graph_request_id),
    provider_state = coalesce(p_evidence->>'provider_state', provider_state),
    verification_code = coalesce(p_verification_code, verification_code),
    submission_evidence = case when v_from = 'dispatching'
      then coalesce(p_evidence,'{}'::jsonb) else submission_evidence end,
    verification_evidence = case when v_from = 'verifying'
      then coalesce(p_evidence,'{}'::jsonb) else verification_evidence end,
    last_error = left(p_error,500), last_error_code = left(p_error_code,100),
    last_error_class = p_error_class,
    failure_code = case when p_status = 'failed'
      then coalesce(p_error_code,p_verification_code,failure_code) else failure_code end,
    lease_token = null, lease_acquired_at = null, lease_expires_at = null,
    worker_id = null, row_version = row_version + 1, updated_at = v_now
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence,
    transition_key, worker_id, attempt_no, row_version
  ) values (
    p_action_id, v_from, p_status, 'worker',
    coalesce(p_evidence,'{}'::jsonb) || jsonb_build_object(
      'error_code', p_error_code, 'error_class', p_error_class),
    p_action_id::text || ':' || p_status || ':' || v_action.row_version,
    p_worker_id, v_action.attempt_count, v_action.row_version
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('action_id', p_action_id, 'status', p_status,
    'row_version', v_action.row_version);
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
  if p_actor_id is null or nullif(trim(p_reason),'') is null
     or length(trim(p_reason)) < 10 then
    raise exception 'Retry actor and a 10-character reason are required';
  end if;
  if not found or v_old.status not in ('failed','cancelled') then
    raise exception 'Action is not eligible for retry';
  end if;
  if v_old.retry_child_action_id is not null then
    return jsonb_build_object('action_id', v_old.retry_child_action_id,
      'status', 'requested', 'idempotent_replay', true);
  end if;
  if v_old.row_version <> p_expected_row_version or v_old.retry_generation >= 2 then
    raise exception 'Retry version changed or generation limit reached';
  end if;
  if v_old.status = 'failed' and coalesce(v_old.failure_code,'') not in (
    'provider_throttled','provider_5xx_ambiguous','provider_5xx',
    'transport_ambiguous','poll_timeout','provider_rejected'
  ) then
    raise exception 'Failure code requires correction or manual review before retry';
  end if;
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
  update public.os_it_intune_actions set
    retry_child_action_id = v_new.action_id, retried_by = p_actor_id,
    retried_at = now(), retry_reason = trim(p_reason),
    row_version = row_version + 1, updated_at = now()
  where action_id = v_old.action_id;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values
    (v_old.action_id, v_old.status, v_old.status, p_actor_id, 'retry_parent',
      jsonb_build_object('retry_child', v_new.action_id, 'reason', trim(p_reason)),
      v_old.action_id::text || ':retry-child:' || v_new.action_id::text,
      v_old.row_version + 1),
    (v_new.action_id, null, 'requested', p_actor_id, 'retry',
      jsonb_build_object('retry_of', v_old.action_id, 'reason', trim(p_reason)),
      v_new.action_id::text || ':requested:retry', 0)
  on conflict (transition_key) do nothing;
  return jsonb_build_object('action_id', v_new.action_id,
    'status', 'requested', 'retry_generation', v_new.retry_generation);
end;
$$;

revoke all on function public.expire_it_intune_actions_v2(integer)
  from public, authenticated;
revoke all on function public.claim_it_intune_action_v2(text,integer)
  from public, authenticated;
revoke all on function public.finish_it_intune_action_v2(uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer)
  from public, authenticated;
revoke execute on function public.claim_it_intune_actions(text,integer,integer)
  from service_role;
revoke execute on function public.finish_it_intune_action(uuid,uuid,text,jsonb,text,text,text)
  from service_role;
grant execute on function public.expire_it_intune_actions_v2(integer)
  to service_role;
grant execute on function public.claim_it_intune_action_v2(text,integer)
  to service_role;
grant execute on function public.finish_it_intune_action_v2(uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer)
  to service_role;
