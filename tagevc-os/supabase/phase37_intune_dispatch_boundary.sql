-- Phase 37: final authorization boundary immediately before Intune provider POST.

update public.os_it_intune_actions set
  status = 'verifying',
  last_error_code = 'phase37_existing_dispatch_ambiguous',
  last_error_class = 'ambiguous',
  lease_token = null, lease_acquired_at = null, lease_expires_at = null,
  worker_id = null, next_poll_at = now(), row_version = row_version + 1,
  updated_at = now()
where status = 'dispatching';
insert into public.os_it_intune_action_events (
  action_id,from_status,to_status,source,evidence,transition_key,row_version
)
select action_id,'dispatching','verifying','phase37_migration',
  jsonb_build_object('provider_outcome','ambiguous',
    'dispatch_authorization_evidence','legacy_phase36'),
  action_id::text||':phase37-legacy-dispatch:'||row_version,row_version
from public.os_it_intune_actions
where last_error_code='phase37_existing_dispatch_ambiguous'
on conflict do nothing;

alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_action_status_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_action_status_check check (
    status in ('requested','approved','preflighting','dispatch_authorized',
      'submitted','verifying','manual_review','verified','failed','cancelled')
  );
drop index if exists public.os_it_intune_active_action_unique;
create unique index os_it_intune_active_action_unique
  on public.os_it_intune_actions(managed_device_id, action_type)
  where status in ('requested','approved','preflighting','dispatch_authorized',
    'submitted','verifying','manual_review');
drop index if exists public.os_it_intune_active_asset_unique;
create unique index os_it_intune_active_asset_unique
  on public.os_it_intune_actions(local_asset_id,action_type)
  where local_asset_id is not null and status in (
    'requested','approved','preflighting','dispatch_authorized',
    'submitted','verifying','manual_review'
  );

create table if not exists public.os_it_intune_dispatch_attempts (
  dispatch_attempt_id uuid primary key default gen_random_uuid(),
  action_id uuid not null unique references public.os_it_intune_actions(action_id),
  authorization_request_id uuid not null unique,
  worker_id text not null,
  authorization_token uuid not null unique default gen_random_uuid(),
  action_row_version bigint not null,
  approval_match_sha256 text not null,
  asset_snapshot jsonb not null,
  asset_sha256 text not null,
  provider_preflight jsonb not null,
  provider_preflight_sha256 text not null,
  provider_observed_at timestamptz not null,
  provider_request_id text,
  authorized_at timestamptz not null default now(),
  outcome text,
  outcome_at timestamptz,
  graph_request_id text,
  error_code text,
  error_class text,
  constraint os_it_dispatch_hashes_check check (
    asset_sha256 ~ '^[0-9a-f]{64}$'
    and provider_preflight_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint os_it_dispatch_outcome_check check (
    outcome is null or outcome in
      ('accepted','ambiguous','rejected','verified','manual_review')
  )
);
alter table public.os_it_intune_dispatch_attempts enable row level security;
drop policy if exists "os_it_dispatch_attempt_select"
  on public.os_it_intune_dispatch_attempts;
create policy "os_it_dispatch_attempt_select"
  on public.os_it_intune_dispatch_attempts for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_actions a
    where a.action_id = os_it_intune_dispatch_attempts.action_id
      and (public.is_firm_wide_access()
        or (a.entity_id is not null and public.can_access_entity(a.entity_id)))
  ));
grant select (
  dispatch_attempt_id, action_id, authorization_request_id, worker_id,
  action_row_version, approval_match_sha256, asset_snapshot, asset_sha256,
  provider_preflight, provider_preflight_sha256, provider_observed_at,
  provider_request_id, authorized_at, outcome, outcome_at, graph_request_id,
  error_code, error_class
) on public.os_it_intune_dispatch_attempts to authenticated;

alter table public.os_it_intune_worker_runs
  add column if not exists preflighted integer not null default 0,
  add column if not exists authorized integer not null default 0,
  add column if not exists ambiguous integer not null default 0,
  add column if not exists recovered integer not null default 0;

create or replace function public.expire_it_intune_actions_v3(
  p_limit integer default 100
) returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer := 0; v_action record;
begin
  for v_action in
    select action_id, status, row_version from public.os_it_intune_actions
    where status in ('approved','preflighting')
      and approval_expires_at <= now()
    order by approval_expires_at for update skip locked
    limit least(greatest(p_limit,1),500)
  loop
    update public.os_it_intune_actions set
      status = case when attempt_count >= 3 then 'failed'
        else 'requested' end, approval_expired_at = now(),
      approved_by = null, approved_at = null, approval_reason = null,
      approval_expires_at = null, approval_match_sha256 = null,
      lease_token = null, lease_acquired_at = null, lease_expires_at = null,
      worker_id = null, next_poll_at = null,
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
      action_id, from_status, to_status, source, evidence, transition_key,
      row_version
    ) values (
      v_action.action_id, v_action.status,
      case when (select status from public.os_it_intune_actions
        where action_id=v_action.action_id)='failed'
        then 'failed' else 'requested' end, 'approval_expiry',
      jsonb_build_object('dispatch_authorized',false),
      v_action.action_id::text || ':approval-expired-v3:' ||
        (v_action.row_version + 1), v_action.row_version + 1
    ) on conflict do nothing;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.claim_it_intune_action_v3(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns public.os_it_intune_actions
language plpgsql security definer set search_path = public
as $$
declare v_action public.os_it_intune_actions%rowtype; v_from text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'Worker ID required'; end if;
  select * into v_action from public.os_it_intune_actions
  where status in ('approved','preflighting','dispatch_authorized',
    'submitted','verifying','manual_review')
    and (next_poll_at is null or next_poll_at <= now())
    and (lease_expires_at is null or lease_expires_at < now())
    and (status not in ('approved','preflighting') or (
      approval_expires_at > now() and local_asset_id is not null
      and approval_match_sha256 = match_sha256 and attempt_count < 3))
  order by coalesce(next_poll_at,approved_at,requested_at)
  for update skip locked limit 1;
  if not found then return null; end if;
  v_from := v_action.status;
  update public.os_it_intune_actions set
    status = case
      when v_from in ('approved','preflighting') then 'preflighting'
      else 'verifying' end,
    last_error_code = case when v_from = 'dispatch_authorized'
      then 'authorized_worker_recovered' else last_error_code end,
    last_error_class = case when v_from = 'dispatch_authorized'
      then 'ambiguous' else last_error_class end,
    next_poll_at = null, lease_token = gen_random_uuid(),
    lease_acquired_at = now(),
    lease_expires_at = now() + make_interval(
      secs => least(greatest(p_lease_seconds,60),300)),
    worker_id = p_worker_id, row_version = row_version + 1, updated_at = now()
  where action_id = v_action.action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence, transition_key,
    worker_id, attempt_no, row_version
  ) values (
    v_action.action_id, v_from, v_action.status,
    case when v_from = 'dispatch_authorized'
      then 'authorization_recovery' else 'worker_claim_v3' end,
    jsonb_build_object('phase',case when v_action.status = 'preflighting'
      then 'preflight' else 'verification' end,
      'authorization_recovered',v_from = 'dispatch_authorized'),
    v_action.action_id::text || ':claim-v3:' || v_action.row_version,
    p_worker_id, v_action.attempt_count, v_action.row_version
  ) on conflict do nothing;
  return v_action;
end;
$$;

create or replace function public.authorize_it_intune_dispatch_v3(
  p_action_id uuid,
  p_lease_token uuid,
  p_worker_id text,
  p_expected_row_version bigint,
  p_authorization_request_id uuid,
  p_provider_preflight jsonb,
  p_client_preflight_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_asset public.os_it_hardware_assets%rowtype;
  v_attempt public.os_it_intune_dispatch_attempts%rowtype;
  v_asset_json jsonb;
  v_asset_sha text;
  v_preflight_sha text;
  v_live_serial text;
  v_asset_serial text;
begin
  select * into v_attempt from public.os_it_intune_dispatch_attempts
  where authorization_request_id=p_authorization_request_id;
  if found then
    if v_attempt.action_id<>p_action_id then
      raise exception 'Authorization request ID belongs to another action';
    end if;
    select * into v_action from public.os_it_intune_actions
    where action_id=p_action_id;
    if v_action.status<>'dispatch_authorized'
       or v_action.worker_id is distinct from p_worker_id
       or v_action.lease_token is distinct from p_lease_token
       or v_action.lease_expires_at<=now() then
      raise exception 'Dispatch authorization replay is no longer active';
    end if;
    return jsonb_build_object('dispatch_attempt_id',v_attempt.dispatch_attempt_id,
      'authorization_token',v_attempt.authorization_token,
      'row_version',v_action.row_version,'idempotent_replay',true);
  end if;
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.status <> 'preflighting'
     or v_action.lease_token is distinct from p_lease_token
     or v_action.worker_id is distinct from p_worker_id
     or v_action.lease_expires_at <= now()
     or v_action.row_version <> p_expected_row_version
     or v_action.approval_expires_at <= now()
     or v_action.approval_match_sha256 is distinct from v_action.match_sha256 then
    raise exception 'Intune dispatch authorization fence rejected';
  end if;
  if exists (select 1 from public.os_it_intune_dispatch_attempts
    where action_id = p_action_id) then
    raise exception 'Intune action was already dispatch-authorized';
  end if;
  select * into v_asset from public.os_it_hardware_assets
  where asset_id = v_action.local_asset_id for update;
  v_live_serial := upper(regexp_replace(
    coalesce(p_provider_preflight->>'serial_number',''),
    '[^a-zA-Z0-9]','','g'));
  v_asset_serial := upper(regexp_replace(
    coalesce(v_asset.serial_number,''),'[^a-zA-Z0-9]','','g'));
  if not found or v_asset.status = 'retired'
     or v_asset.entity_id is distinct from v_action.entity_id
     or v_asset_serial = '' or v_asset_serial <> v_live_serial
     or v_live_serial <> coalesce(v_action.match_snapshot->>'normalized_serial','')
     or jsonb_typeof(p_provider_preflight) <> 'object'
     or p_provider_preflight->>'managed_device_id'
       is distinct from v_action.managed_device_id
     or coalesce((p_provider_preflight->>'http_status')::integer,0) <> 200
     or (p_provider_preflight->>'observed_at')::timestamptz
       < now() - interval '60 seconds'
     or (p_provider_preflight->>'observed_at')::timestamptz
       > now() + interval '2 minutes'
     or p_client_preflight_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Asset or provider identity changed before dispatch authorization';
  end if;
  v_asset_json := jsonb_build_object('asset_id',v_asset.asset_id,
    'entity_id',v_asset.entity_id,'status',v_asset.status,
    'normalized_serial',v_asset_serial,'model',v_asset.model);
  v_asset_sha := encode(digest(v_asset_json::text,'sha256'),'hex');
  v_preflight_sha := encode(digest(p_provider_preflight::text,'sha256'),'hex');
  insert into public.os_it_intune_dispatch_attempts (
    action_id, authorization_request_id, worker_id, action_row_version,
    approval_match_sha256, asset_snapshot, asset_sha256, provider_preflight,
    provider_preflight_sha256, provider_observed_at, provider_request_id
  ) values (
    p_action_id, p_authorization_request_id, p_worker_id, v_action.row_version,
    v_action.approval_match_sha256, v_asset_json, v_asset_sha,
    p_provider_preflight || jsonb_build_object(
      'client_preflight_sha256',p_client_preflight_sha256),
    v_preflight_sha, (p_provider_preflight->>'observed_at')::timestamptz,
    p_provider_preflight->>'provider_request_id'
  ) returning * into v_attempt;
  update public.os_it_intune_actions set
    status = 'dispatch_authorized', dispatch_started_at = now(),
    dispatch_authorized_at = now(), attempt_count = attempt_count + 1,
    row_version = row_version + 1, updated_at = now()
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence, transition_key,
    worker_id, attempt_no, row_version
  ) values (
    p_action_id, 'preflighting','dispatch_authorized',
    'dispatch_authorization_v3',
    jsonb_build_object('dispatch_attempt_id',v_attempt.dispatch_attempt_id,
      'provider_preflight_sha256',v_preflight_sha,
      'asset_sha256',v_asset_sha,'phase','authorize'),
    p_action_id::text || ':dispatch-authorized:' ||
      v_attempt.dispatch_attempt_id::text, p_worker_id,
    v_action.attempt_count, v_action.row_version
  );
  return jsonb_build_object('dispatch_attempt_id',v_attempt.dispatch_attempt_id,
    'authorization_token',v_attempt.authorization_token,
    'row_version',v_action.row_version,'idempotent_replay',false);
end;
$$;

create or replace function public.finish_it_intune_action_v3(
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
  p_retry_after_seconds integer,
  p_dispatch_attempt_id uuid default null,
  p_authorization_token uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_attempt public.os_it_intune_dispatch_attempts%rowtype;
  v_from text;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id = p_action_id for update;
  if not found or v_action.lease_token is distinct from p_lease_token
     or v_action.worker_id is distinct from p_worker_id
     or v_action.lease_expires_at <= now()
     or v_action.row_version <> p_expected_row_version then
    raise exception 'Intune worker lease/version mismatch';
  end if;
  v_from := v_action.status;
  if v_from = 'dispatch_authorized' then
    select * into v_attempt from public.os_it_intune_dispatch_attempts
    where dispatch_attempt_id = p_dispatch_attempt_id
      and action_id = p_action_id for update;
    if not found or v_attempt.authorization_token is distinct from
      p_authorization_token or p_status not in ('submitted','verifying','failed') then
      raise exception 'Intune dispatch-attempt authorization mismatch';
    end if;
  elsif v_from = 'preflighting' then
    if p_status not in ('approved','verified','failed') then
      raise exception 'Illegal preflight finish state';
    end if;
  elsif v_from = 'verifying' then
    if p_status not in ('verifying','verified','failed','manual_review') then
      raise exception 'Illegal verification finish state';
    end if;
  else raise exception 'Action is not worker-finishable'; end if;
  if v_from='verifying' then
    select * into v_attempt from public.os_it_intune_dispatch_attempts
    where action_id=p_action_id for update;
  end if;
  update public.os_it_intune_actions set
    status = p_status,
    submitted_at = case when p_status = 'submitted'
      then coalesce(submitted_at,now()) else submitted_at end,
    verified_at = case when p_status = 'verified' then now() else verified_at end,
    next_poll_at = case
      when p_status = 'approved' then now() + make_interval(
        secs => least(greatest(coalesce(p_retry_after_seconds,300),60),3600))
      when p_status in ('submitted','verifying') then now() + interval '2 minutes'
      when p_status = 'manual_review' then now() + interval '1 hour'
      else null end,
    poll_count = poll_count + case when v_from = 'verifying' then 1 else 0 end,
    graph_request_id = coalesce(p_graph_request_id,graph_request_id),
    provider_state = coalesce(p_evidence->>'provider_state',provider_state),
    verification_code = coalesce(p_verification_code,verification_code),
    submission_evidence = case when v_from = 'dispatch_authorized'
      then p_evidence else submission_evidence end,
    verification_evidence = case when v_from = 'verifying'
      then p_evidence else verification_evidence end,
    last_error = left(p_error,500), last_error_code = left(p_error_code,100),
    last_error_class = p_error_class,
    failure_code = case when p_status in ('failed','manual_review')
      then coalesce(p_error_code,p_verification_code,failure_code)
      else failure_code end,
    terminal_at = case when p_status in ('failed','manual_review','verified')
      then now() else terminal_at end,
    lease_token = null, lease_acquired_at = null, lease_expires_at = null,
    worker_id = null, row_version = row_version + 1, updated_at = now()
  where action_id = p_action_id returning * into v_action;
  if v_attempt.dispatch_attempt_id is not null then
    update public.os_it_intune_dispatch_attempts set
      outcome = case when p_status = 'submitted' then 'accepted'
        when p_status = 'verifying' then 'ambiguous'
        when p_status = 'verified' then 'verified'
        when p_status = 'manual_review' then 'manual_review' else 'rejected' end,
      outcome_at = now(), graph_request_id = p_graph_request_id,
      error_code = p_error_code, error_class = p_error_class
    where dispatch_attempt_id = v_attempt.dispatch_attempt_id;
  end if;
  insert into public.os_it_intune_action_events (
    action_id, from_status, to_status, source, evidence, transition_key,
    worker_id, attempt_no, row_version
  ) values (
    p_action_id, v_from, p_status, 'worker_v3',
    coalesce(p_evidence,'{}') || jsonb_build_object(
      'phase',case when v_from = 'preflighting' then 'preflight'
        when v_from = 'dispatch_authorized' then 'dispatch' else 'verification' end,
      'dispatch_attempt_id',p_dispatch_attempt_id,
      'error_code',p_error_code,'error_class',p_error_class),
    p_action_id::text || ':finish-v3:' || v_action.row_version,
    p_worker_id,v_action.attempt_count,v_action.row_version
  ) on conflict do nothing;
  return jsonb_build_object('action_id',p_action_id,'status',p_status,
    'row_version',v_action.row_version);
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
  if not found or v_action.status not in ('requested','approved','preflighting')
     or v_action.row_version <> p_expected_row_version
     or length(trim(coalesce(p_reason,''))) < 5 then
    raise exception 'Only current pre-authorization actions can be cancelled';
  end if;
  v_from := v_action.status;
  update public.os_it_intune_actions set
    status = 'cancelled', cancelled_by = p_actor_id, cancelled_at = now(),
    cancel_reason = trim(p_reason), terminal_at = now(),
    lease_token = null, lease_acquired_at = null, lease_expires_at = null,
    worker_id = null, next_poll_at = null, row_version = row_version + 1,
    updated_at = now()
  where action_id = p_action_id returning * into v_action;
  insert into public.os_it_intune_action_events (
    action_id,from_status,to_status,actor_id,source,evidence,transition_key,
    row_version
  ) values (
    p_action_id,v_from,'cancelled',p_actor_id,'operator',
    jsonb_build_object('reason',trim(p_reason),'before_dispatch_authorization',true),
    p_action_id::text || ':cancelled:' || v_action.row_version,
    v_action.row_version
  );
  return jsonb_build_object('action_id',p_action_id,'status','cancelled');
end;
$$;

revoke execute on function public.claim_it_intune_action_v2(text,integer)
  from service_role;
revoke execute on function public.finish_it_intune_action_v2(uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer)
  from service_role;
revoke all on function public.expire_it_intune_actions_v3(integer)
  from public,authenticated;
revoke all on function public.claim_it_intune_action_v3(text,integer)
  from public,authenticated;
revoke all on function public.authorize_it_intune_dispatch_v3(uuid,uuid,text,bigint,uuid,jsonb,text)
  from public,authenticated;
revoke all on function public.finish_it_intune_action_v3(uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer,uuid,uuid)
  from public,authenticated;
grant execute on function public.expire_it_intune_actions_v3(integer)
  to service_role;
grant execute on function public.claim_it_intune_action_v3(text,integer)
  to service_role;
grant execute on function public.authorize_it_intune_dispatch_v3(uuid,uuid,text,bigint,uuid,jsonb,text)
  to service_role;
grant execute on function public.finish_it_intune_action_v3(uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer,uuid,uuid)
  to service_role;
