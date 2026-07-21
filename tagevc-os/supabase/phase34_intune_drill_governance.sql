-- Phase 34: explicit Intune approval/leased polling and structured Stage 4e
-- drill evidence. Contains no snapshot rename or DROP capability.

alter table public.os_it_intune_actions
  add column if not exists approval_reason text,
  add column if not exists approval_expires_at timestamptz,
  add column if not exists dispatch_started_at timestamptz,
  add column if not exists last_polled_at timestamptz,
  add column if not exists poll_count integer not null default 0,
  add column if not exists provider_state text,
  add column if not exists verification_code text,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists row_version bigint not null default 0;

alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_action_status_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_action_status_check check (
    status in ('requested', 'approved', 'dispatching', 'submitted',
      'verifying', 'verified', 'failed', 'cancelled')
  );

drop index if exists public.os_it_intune_active_action_unique;
create unique index os_it_intune_active_action_unique
  on public.os_it_intune_actions (managed_device_id, action_type)
  where status in ('requested', 'approved', 'dispatching', 'submitted', 'verifying');
create index if not exists os_it_intune_lease_idx
  on public.os_it_intune_actions (lease_expires_at)
  where lease_token is not null;

alter table public.os_it_intune_action_events
  add column if not exists transition_key text,
  add column if not exists attempt_no integer,
  add column if not exists worker_id text,
  add column if not exists row_version bigint;
create unique index if not exists os_it_intune_transition_unique
  on public.os_it_intune_action_events (transition_key)
  where transition_key is not null;

drop policy if exists "os_it_intune_action_select"
  on public.os_it_intune_actions;
create policy "os_it_intune_action_select" on public.os_it_intune_actions
  for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_it_intune_event_select"
  on public.os_it_intune_action_events;
create policy "os_it_intune_event_select" on public.os_it_intune_action_events
  for select to authenticated using (
    exists (
      select 1 from public.os_it_intune_actions a
      where a.action_id = os_it_intune_action_events.action_id
        and (
          public.is_firm_wide_access()
          or (a.entity_id is not null and public.can_access_entity(a.entity_id))
        )
    )
  );

create or replace function public.approve_it_intune_action(
  p_action_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_now timestamptz := now();
begin
  if length(trim(p_reason)) < 5 then
    raise exception 'Approval reason must be at least 5 characters';
  end if;
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found then raise exception 'Intune action not found'; end if;
  if v_action.status <> 'requested' then
    raise exception 'Only requested actions can be approved';
  end if;
  update public.os_it_intune_actions set
    status = 'approved', approved_by = p_actor_id, approved_at = v_now,
    approval_reason = trim(p_reason),
    approval_expires_at = v_now + interval '24 hours',
    next_poll_at = v_now, row_version = row_version + 1,
    updated_at = v_now
  where action_id = p_action_id
  returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, actor_id, source, evidence,
    transition_key, row_version
  ) values (
    p_action_id, 'requested', 'approved', p_actor_id, 'operator',
    jsonb_build_object('reason', trim(p_reason),
      'expires_at', v_action.approval_expires_at),
    p_action_id::text || ':approved:' || v_action.row_version,
    v_action.row_version
  );
  return jsonb_build_object('action_id', p_action_id, 'status', 'approved');
end;
$$;

create or replace function public.claim_it_intune_actions(
  p_worker_id text,
  p_limit integer default 10,
  p_lease_seconds integer default 90
) returns setof public.os_it_intune_actions
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select action_id
    from public.os_it_intune_actions
    where status in ('approved', 'submitted', 'verifying', 'dispatching')
      and (next_poll_at is null or next_poll_at <= now())
      and (lease_expires_at is null or lease_expires_at < now())
      and (status <> 'approved' or approval_expires_at > now())
    order by coalesce(next_poll_at, approved_at, requested_at)
    for update skip locked
    limit least(greatest(p_limit, 1), 20)
  )
  update public.os_it_intune_actions a set
    status = case when a.status = 'approved' then 'dispatching'
                  else 'verifying' end,
    dispatch_started_at = case when a.status = 'approved'
                               then now() else a.dispatch_started_at end,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 30), 300)),
    worker_id = p_worker_id,
    row_version = a.row_version + 1,
    updated_at = now()
  from candidates c where a.action_id = c.action_id
  returning a.*;
end;
$$;

create or replace function public.finish_it_intune_action(
  p_action_id uuid,
  p_lease_token uuid,
  p_status text,
  p_evidence jsonb,
  p_error text default null,
  p_verification_code text default null,
  p_graph_request_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_from text;
  v_now timestamptz := now();
begin
  if p_status not in ('approved', 'submitted', 'verifying', 'verified', 'failed') then
    raise exception 'Invalid worker transition status';
  end if;
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.lease_token is distinct from p_lease_token then
    raise exception 'Intune action lease mismatch';
  end if;
  v_from := v_action.status;
  update public.os_it_intune_actions set
    status = p_status,
    graph_request_id = coalesce(p_graph_request_id, graph_request_id),
    submission_evidence = case when p_status = 'submitted'
      then coalesce(p_evidence, '{}'::jsonb) else submission_evidence end,
    verification_evidence = case when p_status in ('verifying','verified','failed')
      then coalesce(p_evidence, '{}'::jsonb) else verification_evidence end,
    submitted_at = case when p_status = 'submitted'
      then coalesce(submitted_at, v_now) else submitted_at end,
    verified_at = case when p_status = 'verified' then v_now else verified_at end,
    last_polled_at = case when p_status in ('verifying','verified','failed')
      then v_now else last_polled_at end,
    poll_count = poll_count + case when p_status in ('verifying','verified','failed')
      then 1 else 0 end,
    attempt_count = attempt_count + case when v_from = 'dispatching' then 1 else 0 end,
    provider_state = p_evidence->>'provider_state',
    verification_code = p_verification_code,
    last_error = p_error,
    next_poll_at = case when p_status in ('submitted','verifying')
      then v_now + interval '15 minutes'
      when p_status = 'approved' then v_now + interval '5 minutes'
      else null end,
    lease_token = null, lease_expires_at = null, worker_id = null,
    row_version = row_version + 1, updated_at = v_now
  where action_id = p_action_id
  returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence, transition_key,
    attempt_no, worker_id, row_version
  ) values (
    p_action_id, v_from, p_status, 'worker', coalesce(p_evidence, '{}'::jsonb),
    p_action_id::text || ':' || p_status || ':' || v_action.row_version,
    v_action.attempt_count, current_setting('application_name', true),
    v_action.row_version
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('action_id', p_action_id, 'status', p_status);
end;
$$;

revoke all on function public.approve_it_intune_action(uuid, uuid, text)
  from public, authenticated;
revoke all on function public.claim_it_intune_actions(text, integer, integer)
  from public, authenticated;
revoke all on function public.finish_it_intune_action(uuid, uuid, text, jsonb, text, text, text)
  from public, authenticated;
grant execute on function public.approve_it_intune_action(uuid, uuid, text)
  to service_role;
grant execute on function public.claim_it_intune_actions(text, integer, integer)
  to service_role;
grant execute on function public.finish_it_intune_action(uuid, uuid, text, jsonb, text, text, text)
  to service_role;

alter table public.os_snapshot_soak_observations
  add column if not exists observation_key text,
  add column if not exists observation_bucket timestamptz,
  add column if not exists qualification_eligible boolean not null default false,
  add column if not exists drill_run_id uuid,
  add column if not exists config_fingerprint text,
  add column if not exists code_revision text,
  add column if not exists evidence_sha256 text;
alter table public.os_snapshot_soak_epochs
  add column if not exists config_fingerprint text;
create unique index if not exists os_snapshot_observation_key_unique
  on public.os_snapshot_soak_observations (observation_key)
  where observation_key is not null;
create unique index if not exists os_snapshot_active_epoch_unique
  on public.os_snapshot_soak_epochs (retired_table_name)
  where status in ('active', 'qualified');

create table if not exists public.os_snapshot_drill_runs (
  drill_run_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  drill_type text not null default 'readiness',
  trigger_source text not null,
  status text not null,
  epoch_id uuid references public.os_snapshot_soak_epochs(epoch_id),
  retired_table_name text,
  requested_by uuid,
  config_fingerprint text not null,
  code_revision text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  summary jsonb not null default '{}'::jsonb,
  evidence_sha256 text,
  constraint os_snapshot_drill_type_check check (
    drill_type in ('readiness', 'retired_relation_read', 'offline_rollback_rehearsal')
  ),
  constraint os_snapshot_drill_source_check check (
    trigger_source in ('cron', 'admin', 'offline_attestation')
  ),
  constraint os_snapshot_drill_status_check check (
    status in ('running', 'passed', 'failed', 'error', 'cancelled')
  )
);
alter table public.os_snapshot_soak_epochs
  add column if not exists latest_drill_run_id uuid
    references public.os_snapshot_drill_runs(drill_run_id);

create table if not exists public.os_snapshot_drill_checks (
  drill_run_id uuid not null references public.os_snapshot_drill_runs(drill_run_id)
    on delete cascade,
  domain text not null,
  check_name text not null,
  ok boolean not null,
  expected jsonb not null default '{}'::jsonb,
  observed jsonb not null default '{}'::jsonb,
  checked_at timestamptz not null default now(),
  primary key (drill_run_id, domain, check_name)
);

alter table public.os_snapshot_drill_runs enable row level security;
alter table public.os_snapshot_drill_checks enable row level security;
drop policy if exists "os_snapshot_drill_run_select"
  on public.os_snapshot_drill_runs;
create policy "os_snapshot_drill_run_select" on public.os_snapshot_drill_runs
  for select to authenticated using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_drill_check_select"
  on public.os_snapshot_drill_checks;
create policy "os_snapshot_drill_check_select" on public.os_snapshot_drill_checks
  for select to authenticated using (public.is_firm_wide_access());
grant select on public.os_snapshot_drill_runs,
  public.os_snapshot_drill_checks to authenticated;
