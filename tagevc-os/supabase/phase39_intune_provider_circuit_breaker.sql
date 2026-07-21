-- Phase 39: entity/provider-operation scoped Intune dispatch circuit breaker.
-- Depends on phases 36, 37, and 38, in that order.

create table if not exists public.os_it_intune_provider_breakers (
  breaker_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  entity_scope text not null,
  provider text not null default 'ms_graph',
  operation text not null default 'retire',
  state text not null default 'closed',
  opened_at timestamptz,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  cooldown_until timestamptz,
  failure_window_minutes integer not null default 15,
  minimum_samples integer not null default 3,
  failure_threshold integer not null default 3,
  failure_rate_threshold numeric(5,4) not null default 0.5000,
  reset_success_threshold integer not null default 3,
  canary_action_id uuid references public.os_it_intune_actions(action_id),
  canary_token uuid,
  canary_worker_id text,
  canary_acquired_at timestamptz,
  canary_expires_at timestamptz,
  canary_post_accepted_at timestamptz,
  opened_reason text,
  row_version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint os_it_intune_breaker_state_check
    check (state in ('closed','open','half_open')),
  constraint os_it_intune_breaker_scope_check
    check (entity_scope=coalesce(entity_id,'__firm__')
      and (entity_id is null or entity_id<>'__firm__')),
  constraint os_it_intune_breaker_threshold_check check (
    failure_window_minutes between 1 and 1440
    and minimum_samples between 1 and 100
    and failure_threshold between 1 and 100
    and failure_rate_threshold between 0 and 1
    and reset_success_threshold between 1 and 20
  ),
  constraint os_it_intune_breaker_canary_check check (
    (canary_action_id is null and canary_token is null
      and canary_worker_id is null and canary_acquired_at is null
      and canary_expires_at is null and canary_post_accepted_at is null)
    or
    (state='half_open' and canary_action_id is not null
      and canary_token is not null and nullif(trim(canary_worker_id),'') is not null
      and canary_acquired_at is not null and canary_expires_at is not null)
  )
);
alter table public.os_it_intune_provider_breakers
  add column if not exists canary_post_accepted_at timestamptz;
alter table public.os_it_intune_provider_breakers
  alter column failure_rate_threshold set default 0.5000;
update public.os_it_intune_provider_breakers
set failure_rate_threshold=0.5000
where failure_rate_threshold=0.6000;
alter table public.os_it_intune_provider_breakers
  drop constraint if exists os_it_intune_breaker_scope_check;
alter table public.os_it_intune_provider_breakers
  add constraint os_it_intune_breaker_scope_check check (
    entity_scope=coalesce(entity_id,'__firm__')
    and (entity_id is null or entity_id<>'__firm__')
  );
alter table public.os_it_intune_provider_breakers
  drop constraint if exists os_it_intune_breaker_canary_check;
alter table public.os_it_intune_provider_breakers
  add constraint os_it_intune_breaker_canary_check check (
    (canary_action_id is null and canary_token is null
      and canary_worker_id is null and canary_acquired_at is null
      and canary_expires_at is null and canary_post_accepted_at is null)
    or
    (state='half_open' and canary_action_id is not null
      and canary_token is not null and nullif(trim(canary_worker_id),'') is not null
      and canary_acquired_at is not null and canary_expires_at is not null)
  );
create unique index if not exists os_it_intune_provider_breaker_scope_uidx
  on public.os_it_intune_provider_breakers(entity_scope,provider,operation);

create table if not exists public.os_it_intune_provider_observations (
  observation_id uuid primary key default gen_random_uuid(),
  observation_key uuid not null,
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  action_id uuid not null references public.os_it_intune_actions(action_id),
  dispatch_attempt_id uuid
    references public.os_it_intune_dispatch_attempts(dispatch_attempt_id),
  entity_id text references public.entities(entity_id),
  worker_id text not null,
  request_kind text not null,
  outcome text not null,
  http_status integer,
  error_code text,
  graph_request_id text,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz not null default now(),
  constraint os_it_intune_provider_observation_kind_check
    check (request_kind in ('preflight_read','verification_read','dispatch_post')),
  constraint os_it_intune_provider_observation_outcome_check
    check (outcome in ('success','failure','ambiguous','ignored')),
  constraint os_it_intune_provider_observation_http_check
    check (http_status is null or http_status between 100 and 599)
);
alter table public.os_it_intune_provider_observations
  add column if not exists observation_key uuid;
drop trigger if exists os_it_intune_provider_observations_append_only
  on public.os_it_intune_provider_observations;
drop trigger if exists os_it_intune_provider_observations_no_truncate
  on public.os_it_intune_provider_observations;
update public.os_it_intune_provider_observations
set observation_key=gen_random_uuid() where observation_key is null;
alter table public.os_it_intune_provider_observations
  alter column observation_key set not null;
alter table public.os_it_intune_provider_observations
  drop constraint if exists os_it_intune_provider_observation_outcome_check;
update public.os_it_intune_provider_observations set outcome=case
  when http_status is null
    and error_code in ('provider_transport','transport_ambiguous')
    then case when request_kind='dispatch_post' then 'ambiguous' else 'failure' end
  when http_status in (408,425,429) or http_status>=500
    then case when request_kind='dispatch_post' then 'ambiguous' else 'failure' end
  when http_status between 200 and 299
    or (request_kind<>'dispatch_post' and http_status=404) then 'success'
  else 'ignored'
end;
alter table public.os_it_intune_provider_observations
  add constraint os_it_intune_provider_observation_outcome_check
    check (outcome in ('success','failure','ambiguous','ignored'));
create unique index if not exists os_it_intune_provider_observation_key_uidx
  on public.os_it_intune_provider_observations(observation_key);
create unique index if not exists os_it_intune_provider_request_uidx
  on public.os_it_intune_provider_observations(
    breaker_id,request_kind,graph_request_id
  ) where graph_request_id is not null;
create index if not exists os_it_intune_provider_observation_sample_idx
  on public.os_it_intune_provider_observations(
    breaker_id,observed_at desc,observation_id desc
  );

create table if not exists public.os_it_intune_breaker_reset_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  entity_id text references public.entities(entity_id),
  status text not null default 'awaiting_review',
  proposed_by uuid not null,
  proposed_reason text not null,
  evidence jsonb not null,
  evidence_sha256 text not null,
  proposed_breaker_version bigint not null,
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '30 minutes'),
  reviewed_by uuid,
  reviewer_statement text,
  reviewer_evidence jsonb,
  reviewer_evidence_sha256 text,
  reviewed_at timestamptz,
  row_version bigint not null default 0,
  constraint os_it_intune_breaker_reset_status_check
    check (status in ('awaiting_review','approved','rejected','expired')),
  constraint os_it_intune_breaker_reset_actor_check
    check (reviewed_by is null or reviewed_by<>proposed_by),
  constraint os_it_intune_breaker_reset_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);
alter table public.os_it_intune_breaker_reset_proposals
  add column if not exists reviewer_evidence jsonb,
  add column if not exists reviewer_evidence_sha256 text;
alter table public.os_it_intune_breaker_reset_proposals
  drop constraint if exists os_it_intune_breaker_reviewer_hash_check;
alter table public.os_it_intune_breaker_reset_proposals
  add constraint os_it_intune_breaker_reviewer_hash_check check (
    reviewer_evidence_sha256 is null
    or reviewer_evidence_sha256~'^[0-9a-f]{64}$'
  );
create unique index if not exists os_it_intune_one_pending_breaker_reset
  on public.os_it_intune_breaker_reset_proposals(breaker_id)
  where status='awaiting_review';

create table if not exists public.os_it_intune_breaker_events (
  event_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  proposal_id uuid references public.os_it_intune_breaker_reset_proposals(proposal_id),
  entity_id text references public.entities(entity_id),
  event_type text not null,
  from_state text,
  to_state text not null,
  actor_id uuid,
  worker_id text,
  action_id uuid references public.os_it_intune_actions(action_id),
  reason text not null,
  evidence jsonb not null default '{}'::jsonb,
  breaker_version bigint not null,
  created_at timestamptz not null default now(),
  constraint os_it_intune_breaker_event_type_check check (
    event_type in ('opened','reset_proposed','reset_rejected','reset_expired',
      'half_opened','canary_acquired','canary_post_accepted',
      'canary_recovered','canary_succeeded',
      'canary_failed','closed')
  )
);
alter table public.os_it_intune_breaker_events
  drop constraint if exists os_it_intune_breaker_event_type_check;
alter table public.os_it_intune_breaker_events
  add constraint os_it_intune_breaker_event_type_check check (
    event_type in ('opened','reset_proposed','reset_rejected','reset_expired',
      'half_opened','canary_acquired','canary_post_accepted',
      'canary_recovered','canary_succeeded','canary_failed','closed')
  );

alter table public.os_it_intune_provider_breakers enable row level security;
alter table public.os_it_intune_provider_observations enable row level security;
alter table public.os_it_intune_breaker_reset_proposals enable row level security;
alter table public.os_it_intune_breaker_events enable row level security;
drop policy if exists "os_it_intune_breaker_select"
  on public.os_it_intune_provider_breakers;
create policy "os_it_intune_breaker_select"
  on public.os_it_intune_provider_breakers for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_it_intune_observation_select"
  on public.os_it_intune_provider_observations;
create policy "os_it_intune_observation_select"
  on public.os_it_intune_provider_observations for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_it_intune_breaker_reset_select"
  on public.os_it_intune_breaker_reset_proposals;
create policy "os_it_intune_breaker_reset_select"
  on public.os_it_intune_breaker_reset_proposals for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_it_intune_breaker_event_select"
  on public.os_it_intune_breaker_events;
create policy "os_it_intune_breaker_event_select"
  on public.os_it_intune_breaker_events for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_it_intune_provider_breakers,
  public.os_it_intune_provider_observations,
  public.os_it_intune_breaker_reset_proposals,
  public.os_it_intune_breaker_events to authenticated;
revoke insert,update,delete,truncate on public.os_it_intune_provider_breakers,
  public.os_it_intune_provider_observations,
  public.os_it_intune_breaker_reset_proposals,
  public.os_it_intune_breaker_events
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_breaker_event_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Intune breaker events are append-only';
end;
$$;
drop trigger if exists os_it_intune_breaker_events_append_only
  on public.os_it_intune_breaker_events;
create trigger os_it_intune_breaker_events_append_only
  before update or delete on public.os_it_intune_breaker_events
  for each row execute function public.prevent_it_intune_breaker_event_mutation();
drop trigger if exists os_it_intune_breaker_events_no_truncate
  on public.os_it_intune_breaker_events;
create trigger os_it_intune_breaker_events_no_truncate
  before truncate on public.os_it_intune_breaker_events
  for each statement execute function public.prevent_it_intune_breaker_event_mutation();
drop trigger if exists os_it_intune_provider_observations_append_only
  on public.os_it_intune_provider_observations;
create trigger os_it_intune_provider_observations_append_only
  before update or delete on public.os_it_intune_provider_observations
  for each row execute function public.prevent_it_intune_breaker_event_mutation();
drop trigger if exists os_it_intune_provider_observations_no_truncate
  on public.os_it_intune_provider_observations;
create trigger os_it_intune_provider_observations_no_truncate
  before truncate on public.os_it_intune_provider_observations
  for each statement execute function public.prevent_it_intune_breaker_event_mutation();

create or replace function public.ensure_it_intune_provider_breaker(
  p_entity_id text
) returns public.os_it_intune_provider_breakers
language plpgsql security definer set search_path=public as $$
declare v_breaker public.os_it_intune_provider_breakers%rowtype;
begin
  insert into public.os_it_intune_provider_breakers(entity_id,entity_scope)
  values (p_entity_id,coalesce(p_entity_id,'__firm__'))
  on conflict (entity_scope,provider,operation) do nothing;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where entity_scope=coalesce(p_entity_id,'__firm__')
    and provider='ms_graph' and operation='retire'
  for update;
  return v_breaker;
end;
$$;

create or replace function public.recover_it_intune_breaker_canary(
  p_breaker_id uuid
) returns boolean
language plpgsql security definer set search_path=public as $$
declare v_breaker public.os_it_intune_provider_breakers%rowtype;
begin
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=p_breaker_id for update;
  if not found or v_breaker.state<>'half_open'
     or v_breaker.canary_expires_at is null
     or v_breaker.canary_expires_at>now() then return false; end if;
  update public.os_it_intune_provider_breakers set
    state='open',opened_at=now(),cooldown_until=now()+interval '15 minutes',
    opened_reason='Half-open canary lease expired with unknown provider outcome',
    canary_action_id=null,canary_token=null,canary_worker_id=null,
    canary_acquired_at=null,canary_expires_at=null,
    canary_post_accepted_at=null,
    row_version=row_version+1,updated_at=now()
  where breaker_id=p_breaker_id;
  insert into public.os_it_intune_breaker_events(
    breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
    reason,evidence,breaker_version
  ) values (
    v_breaker.breaker_id,v_breaker.entity_id,'canary_recovered','half_open',
    'open',v_breaker.canary_worker_id,v_breaker.canary_action_id,
    'Stale canary quarantined; governed reset required before another POST',
    jsonb_build_object('expired_at',v_breaker.canary_expires_at),
    v_breaker.row_version+1
  );
  return true;
end;
$$;

create or replace function public.recover_stale_it_intune_breaker_canaries()
returns integer
language plpgsql security definer set search_path=public as $$
declare v_breaker record; v_count integer:=0;
begin
  for v_breaker in
    select breaker_id from public.os_it_intune_provider_breakers
    where state='half_open' and canary_expires_at<=now()
    order by canary_expires_at
    for update skip locked
  loop
    if public.recover_it_intune_breaker_canary(v_breaker.breaker_id) then
      v_count:=v_count+1;
    end if;
  end loop;
  return v_count;
end;
$$;

drop function if exists public.record_it_intune_provider_observation(
  uuid,text,text,text,integer,text,text,uuid,jsonb
);
create or replace function public.record_it_intune_provider_observation(
  p_action_id uuid,
  p_worker_id text,
  p_observation_key uuid,
  p_request_kind text,
  p_http_status integer,
  p_error_code text,
  p_graph_request_id text,
  p_dispatch_attempt_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_attempt public.os_it_intune_dispatch_attempts%rowtype;
  v_existing public.os_it_intune_provider_observations%rowtype;
  v_outcome text;
  v_total integer; v_failed integer;
  v_dispatch_total integer; v_dispatch_failed integer;
  v_read_total integer; v_read_failed integer;
  v_open_mode text;
begin
  if p_observation_key is null then
    raise exception 'Observation key is required';
  end if;
  perform pg_advisory_xact_lock(
    hashtextextended(p_observation_key::text,0)
  );
  select * into v_existing
  from public.os_it_intune_provider_observations
  where observation_key=p_observation_key;
  if found then
    if v_existing.action_id is distinct from p_action_id
       or v_existing.worker_id is distinct from p_worker_id
       or v_existing.request_kind is distinct from p_request_kind then
      raise exception 'Observation key belongs to another provider request';
    end if;
    return jsonb_build_object('observation_id',v_existing.observation_id,
      'breaker_id',v_existing.breaker_id,'outcome',v_existing.outcome,
      'idempotent_replay',true);
  end if;
  select * into v_action from public.os_it_intune_actions
  where action_id=p_action_id;
  if not found or p_observation_key is null
     or nullif(trim(p_worker_id),'') is null
     or v_action.worker_id is distinct from p_worker_id
     or v_action.lease_expires_at is null or v_action.lease_expires_at<=now()
     or p_request_kind not in
       ('preflight_read','verification_read','dispatch_post') then
    raise exception 'Invalid Intune provider observation';
  end if;
  if (p_request_kind='preflight_read' and v_action.status<>'preflighting')
     or (p_request_kind='verification_read' and v_action.status<>'verifying')
     or (p_request_kind='dispatch_post'
       and v_action.status<>'dispatch_authorized') then
    raise exception 'Provider observation does not match worker action phase';
  end if;
  if p_request_kind='dispatch_post' then
    select * into v_attempt from public.os_it_intune_dispatch_attempts
    where dispatch_attempt_id=p_dispatch_attempt_id
      and action_id=p_action_id and worker_id=p_worker_id;
    if not found then
      raise exception 'Dispatch observation is not bound to its authorization';
    end if;
  elsif p_dispatch_attempt_id is not null then
    raise exception 'Read observation cannot claim a dispatch attempt';
  end if;
  -- Derive the outage signal in the database. Authentication/client failures
  -- remain visible but cannot open or heal a provider-outage circuit.
  if p_http_status is null then
    if p_error_code not in ('provider_transport','transport_ambiguous') then
      raise exception 'Status-less observation requires a transport error';
    end if;
    v_outcome:=case when p_request_kind='dispatch_post'
      then 'ambiguous' else 'failure' end;
  elsif p_http_status in (408,425,429) or p_http_status>=500 then
    v_outcome:=case when p_request_kind='dispatch_post'
      then 'ambiguous' else 'failure' end;
  elsif p_http_status between 200 and 299
     or (p_request_kind<>'dispatch_post' and p_http_status=404) then
    v_outcome:='success';
  else
    v_outcome:='ignored';
  end if;
  v_breaker:=public.ensure_it_intune_provider_breaker(v_action.entity_id);
  perform public.recover_it_intune_breaker_canary(v_breaker.breaker_id);
  insert into public.os_it_intune_provider_observations(
    observation_key,breaker_id,action_id,dispatch_attempt_id,entity_id,
    worker_id,request_kind,
    outcome,http_status,error_code,graph_request_id,evidence
  ) values (
    p_observation_key,v_breaker.breaker_id,p_action_id,p_dispatch_attempt_id,
    v_action.entity_id,p_worker_id,p_request_kind,v_outcome,p_http_status,
    left(p_error_code,100),nullif(trim(p_graph_request_id),''),
    coalesce(p_evidence,'{}'::jsonb)
  );
  update public.os_it_intune_provider_breakers set
    last_success_at=case when v_outcome='success' then now() else last_success_at end,
    last_failure_at=case when v_outcome in ('failure','ambiguous')
      then now() else last_failure_at end,
    updated_at=now()
  where breaker_id=v_breaker.breaker_id returning * into v_breaker;
  select count(*),count(*) filter(where outcome in ('failure','ambiguous'))
    into v_total,v_failed
  from (
    select outcome from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id
      and observed_at>=now()-make_interval(mins=>v_breaker.failure_window_minutes)
      and outcome<>'ignored'
    order by observed_at desc,observation_id desc limit 20
  ) sample;
  select count(*),count(*) filter(where outcome in ('failure','ambiguous'))
    into v_dispatch_total,v_dispatch_failed
  from (
    select outcome from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id and request_kind='dispatch_post'
      and observed_at>=now()-make_interval(mins=>v_breaker.failure_window_minutes)
      and outcome<>'ignored'
    order by observed_at desc,observation_id desc limit 10
  ) sample;
  select count(*),count(*) filter(where outcome='failure')
    into v_read_total,v_read_failed
  from (
    select outcome from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id
      and request_kind in ('preflight_read','verification_read')
      and observed_at>=now()-make_interval(mins=>v_breaker.failure_window_minutes)
      and outcome<>'ignored'
    order by observed_at desc,observation_id desc limit 20
  ) sample;
  if v_dispatch_total>=v_breaker.minimum_samples
     and v_dispatch_failed>=v_breaker.failure_threshold
     and v_dispatch_failed::numeric/v_dispatch_total
       >=v_breaker.failure_rate_threshold then
    v_open_mode:='dispatch_post';
  elsif v_read_total>=v_breaker.minimum_samples
     and v_read_failed>=v_breaker.failure_threshold
     and v_read_failed::numeric/v_read_total
       >=v_breaker.failure_rate_threshold then
    v_open_mode:='provider_read';
  end if;
  if v_breaker.state='closed'
     and v_open_mode is not null then
    update public.os_it_intune_provider_breakers set
      state='open',opened_at=now(),cooldown_until=now()+interval '15 minutes',
      opened_reason=case when v_open_mode='dispatch_post'
        then format('%s/%s durable dispatch outcomes failed',
          v_dispatch_failed,v_dispatch_total)
        else format('%s/%s durable read outcomes failed',
          v_read_failed,v_read_total) end,
      canary_action_id=null,canary_token=null,canary_worker_id=null,
      canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'opened','closed','open',
      p_worker_id,p_action_id,v_breaker.opened_reason,
      jsonb_build_object('mode',v_open_mode,
        'sample_size',case when v_open_mode='dispatch_post'
          then v_dispatch_total else v_read_total end,
        'failures',case when v_open_mode='dispatch_post'
          then v_dispatch_failed else v_read_failed end,
        'window_minutes',v_breaker.failure_window_minutes),
      v_breaker.row_version
    );
  end if;
  return jsonb_build_object('breaker_id',v_breaker.breaker_id,
    'state',v_breaker.state,'outcome',v_outcome,
    'sample_size',v_total,'failures',v_failed,
    'dispatch_sample_size',v_dispatch_total,
    'dispatch_failures',v_dispatch_failed,
    'read_sample_size',v_read_total,'read_failures',v_read_failed,
    'idempotent_replay',false);
end;
$$;

create or replace function public.claim_it_intune_action_v4(
  p_worker_id text,p_lease_seconds integer default 120
) returns public.os_it_intune_actions
language plpgsql security definer set search_path=public as $$
declare v_action public.os_it_intune_actions%rowtype; v_from text;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'Worker ID required'; end if;
  select a.* into v_action from public.os_it_intune_actions a
  where a.status in ('approved','preflighting','dispatch_authorized',
      'submitted','verifying')
    and (a.next_poll_at is null or a.next_poll_at<=now())
    and (a.lease_expires_at is null or a.lease_expires_at<now())
    and (
      a.status not in ('approved','preflighting')
      or (
        a.approval_expires_at>now() and a.local_asset_id is not null
        and a.approval_match_sha256=a.match_sha256 and a.attempt_count<3
      )
    )
  order by case when a.status in ('submitted','verifying','dispatch_authorized')
      then 0 else 1 end,coalesce(a.next_poll_at,a.approved_at,a.requested_at)
  for update of a skip locked limit 1;
  if not found then return null; end if;
  v_from:=v_action.status;
  update public.os_it_intune_actions set
    status=case when v_from in ('approved','preflighting')
      then 'preflighting' else 'verifying' end,
    last_error_code=case when v_from='dispatch_authorized'
      then 'authorized_worker_recovered' else last_error_code end,
    last_error_class=case when v_from='dispatch_authorized'
      then 'ambiguous' else last_error_class end,
    next_poll_at=null,lease_token=gen_random_uuid(),lease_acquired_at=now(),
    lease_expires_at=now()+make_interval(
      secs=>least(greatest(p_lease_seconds,60),300)),
    worker_id=p_worker_id,row_version=row_version+1,updated_at=now()
  where action_id=v_action.action_id returning * into v_action;
  insert into public.os_it_intune_action_events(
    action_id,from_status,to_status,source,evidence,transition_key,
    worker_id,attempt_no,row_version
  ) values (
    v_action.action_id,v_from,v_action.status,
    case when v_from='dispatch_authorized'
      then 'authorization_recovery' else 'worker_claim_v4' end,
    jsonb_build_object('phase',case when v_action.status='preflighting'
      then 'preflight' else 'verification' end,
      'authorization_recovered',v_from='dispatch_authorized'),
    v_action.action_id::text||':claim-v4:'||v_action.row_version,
    p_worker_id,v_action.attempt_count,v_action.row_version
  ) on conflict do nothing;
  return v_action;
end;
$$;

create or replace function public.authorize_it_intune_dispatch_v4(
  p_action_id uuid,p_lease_token uuid,p_worker_id text,
  p_expected_row_version bigint,p_authorization_request_id uuid,
  p_provider_preflight jsonb,p_client_preflight_sha256 text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_authorized jsonb; v_canary uuid;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id=p_action_id;
  if not found then raise exception 'Intune action not found'; end if;
  v_breaker:=public.ensure_it_intune_provider_breaker(v_action.entity_id);
  perform public.recover_it_intune_breaker_canary(v_breaker.breaker_id);
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=v_breaker.breaker_id for update;
  if v_breaker.state='open' then
    raise exception 'Intune provider circuit is open; POST authorization blocked';
  end if;
  if v_breaker.state='half_open' and v_breaker.canary_action_id is not null
     and (v_breaker.canary_action_id is distinct from p_action_id
       or v_breaker.canary_worker_id is distinct from p_worker_id) then
    raise exception 'Intune provider circuit already has a fenced canary';
  end if;
  v_authorized:=public.authorize_it_intune_dispatch_v3(
    p_action_id,p_lease_token,p_worker_id,p_expected_row_version,
    p_authorization_request_id,p_provider_preflight,p_client_preflight_sha256
  );
  if v_breaker.state='half_open' and v_breaker.canary_action_id is null then
    v_canary:=gen_random_uuid();
    update public.os_it_intune_provider_breakers set
      canary_action_id=p_action_id,canary_token=v_canary,
      canary_worker_id=p_worker_id,canary_acquired_at=now(),
      canary_expires_at=now()+interval '5 minutes',
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_acquired','half_open',
      'half_open',p_worker_id,p_action_id,'Single dispatch canary fenced',
      jsonb_build_object('expires_at',v_breaker.canary_expires_at),
      v_breaker.row_version
    );
  elsif v_breaker.state='half_open' then
    v_canary:=v_breaker.canary_token;
  end if;
  return v_authorized||jsonb_build_object(
    'breaker_id',v_breaker.breaker_id,'breaker_state',v_breaker.state,
    'canary_token',v_canary);
end;
$$;

create or replace function public.finish_it_intune_action_v4(
  p_action_id uuid,p_lease_token uuid,p_worker_id text,
  p_expected_row_version bigint,p_status text,p_evidence jsonb,p_error text,
  p_verification_code text,p_graph_request_id text,p_error_code text,
  p_error_class text,p_retry_after_seconds integer,
  p_dispatch_attempt_id uuid default null,p_authorization_token uuid default null,
  p_canary_token uuid default null
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_result jsonb;
  v_from text;
  v_preflight_success integer;
  v_post_success integer;
  v_verify_success integer;
begin
  select * into v_action from public.os_it_intune_actions
  where action_id=p_action_id;
  if not found then raise exception 'Intune action not found'; end if;
  v_from:=v_action.status;
  v_breaker:=public.ensure_it_intune_provider_breaker(v_action.entity_id);
  if v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and v_from='dispatch_authorized' and (
       p_canary_token is null
       or v_breaker.canary_token is distinct from p_canary_token
       or v_breaker.canary_worker_id is distinct from p_worker_id
       or v_breaker.canary_expires_at<=now()
     ) then raise exception 'Intune canary lease/token mismatch'; end if;
  if p_canary_token is not null and (
       v_breaker.state<>'half_open'
       or v_breaker.canary_action_id is distinct from p_action_id
       or v_breaker.canary_token is distinct from p_canary_token
     ) then raise exception 'Intune canary lease/token mismatch'; end if;
  v_result:=public.finish_it_intune_action_v3(
    p_action_id,p_lease_token,p_worker_id,p_expected_row_version,p_status,
    p_evidence,p_error,p_verification_code,p_graph_request_id,p_error_code,
    p_error_class,p_retry_after_seconds,p_dispatch_attempt_id,p_authorization_token
  );
  if v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and v_from='dispatch_authorized' and p_status='submitted' then
    select count(*) into v_post_success
    from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id and action_id=p_action_id
      and dispatch_attempt_id=p_dispatch_attempt_id
      and request_kind='dispatch_post' and outcome='success'
      and observed_at>=v_breaker.canary_acquired_at;
    if v_post_success<>1 then
      raise exception 'Canary acceptance lacks one durable dispatch observation';
    end if;
    update public.os_it_intune_provider_breakers set
      canary_post_accepted_at=now(),
      canary_expires_at=now()+interval '30 minutes',
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_post_accepted',
      'half_open','half_open',p_worker_id,p_action_id,
      'Canary POST accepted; independent verification still required',
      jsonb_build_object('dispatch_attempt_id',p_dispatch_attempt_id,
        'graph_request_id',p_graph_request_id),v_breaker.row_version
    );
  elsif v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and v_from='dispatch_authorized' then
    update public.os_it_intune_provider_breakers set
      state='open',opened_at=now(),cooldown_until=now()+interval '15 minutes',
      opened_reason=coalesce(p_error_code,'canary_outcome_ambiguous'),
      canary_action_id=null,canary_token=null,canary_worker_id=null,
      canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_failed',
      'half_open','open',p_worker_id,p_action_id,
      'Canary provider POST was not conclusively accepted',
      jsonb_build_object('status',p_status,'error_code',p_error_code),
      v_breaker.row_version
    );
  elsif v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and v_from='verifying' and p_status='verifying'
     and p_error_code in (
       'provider_throttled','provider_5xx','provider_transport',
       'transport_ambiguous'
     ) then
    update public.os_it_intune_provider_breakers set
      state='open',opened_at=now(),cooldown_until=now()+interval '15 minutes',
      opened_reason=p_error_code,
      canary_action_id=null,canary_token=null,canary_worker_id=null,
      canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_failed',
      'half_open','open',p_worker_id,p_action_id,
      'Canary verification encountered a provider outage signal',
      jsonb_build_object('status',p_status,'error_code',p_error_code),
      v_breaker.row_version
    );
  elsif v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and p_status='verified' then
    select
      count(*) filter(where request_kind='preflight_read' and outcome='success'),
      count(*) filter(where request_kind='dispatch_post' and outcome='success'),
      count(*) filter(where request_kind='verification_read'
        and outcome='success'
        and observed_at>=v_breaker.canary_post_accepted_at)
    into v_preflight_success,v_post_success,v_verify_success
    from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id and action_id=p_action_id
      and observed_at>=v_breaker.canary_acquired_at-interval '2 minutes';
    if v_breaker.canary_post_accepted_at is null
       or v_preflight_success<1 or v_post_success<>1 or v_verify_success<1 then
      raise exception 'Canary close requires preflight, POST, and independent verification observations';
    end if;
    update public.os_it_intune_provider_breakers set
      state='closed',opened_at=null,cooldown_until=null,opened_reason=null,
      canary_action_id=null,canary_token=null,canary_worker_id=null,
      canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_succeeded',
      'half_open','closed',p_worker_id,p_action_id,
      'Canary closed after preflight, accepted POST, and verified provider state',
      jsonb_build_object('preflight_observations',v_preflight_success,
        'dispatch_observations',v_post_success,
        'verification_observations',v_verify_success),v_breaker.row_version
    );
  elsif v_breaker.state='half_open'
     and v_breaker.canary_action_id=p_action_id
     and p_status in ('failed','manual_review') then
    update public.os_it_intune_provider_breakers set
      state='open',opened_at=now(),cooldown_until=now()+interval '15 minutes',
      opened_reason=coalesce(p_error_code,p_verification_code,
        'canary_verification_failed'),
      canary_action_id=null,canary_token=null,canary_worker_id=null,
      canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
    insert into public.os_it_intune_breaker_events(
      breaker_id,entity_id,event_type,from_state,to_state,worker_id,action_id,
      reason,evidence,breaker_version
    ) values (
      v_breaker.breaker_id,v_breaker.entity_id,'canary_failed',
      'half_open','open',p_worker_id,p_action_id,
      'Canary verification failed or entered quarantine',
      jsonb_build_object('status',p_status,'error_code',p_error_code),
      v_breaker.row_version
    );
  end if;
  return v_result||jsonb_build_object('breaker_state',v_breaker.state);
end;
$$;

create or replace function public.expire_it_intune_breaker_reset_proposals()
returns integer
language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  with expired as (
    update public.os_it_intune_breaker_reset_proposals set
      status='expired',row_version=row_version+1
    where status='awaiting_review' and expires_at<=now()
    returning *
  ), events as (
    insert into public.os_it_intune_breaker_events(
      breaker_id,proposal_id,entity_id,event_type,from_state,to_state,actor_id,
      reason,evidence,breaker_version
    )
    select e.breaker_id,e.proposal_id,e.entity_id,'reset_expired','open','open',
      e.proposed_by,'Breaker reset proposal expired',e.evidence,
      b.row_version
    from expired e join public.os_it_intune_provider_breakers b
      on b.breaker_id=e.breaker_id returning 1
  ) select count(*) into v_count from events;
  return v_count;
end;
$$;

create or replace function public.propose_it_intune_breaker_reset(
  p_breaker_id uuid,p_actor_id uuid,p_reason text,p_evidence jsonb,
  p_expected_breaker_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_proposal public.os_it_intune_breaker_reset_proposals%rowtype;
  v_successes integer; v_hash text; v_bound jsonb; v_recovery jsonb;
begin
  perform public.expire_it_intune_breaker_reset_proposals();
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=p_breaker_id for update;
  if not found or v_breaker.state<>'open'
     or v_breaker.row_version<>p_expected_breaker_version
     or v_breaker.cooldown_until>now()
     or length(trim(coalesce(p_reason,'')))<20
     or jsonb_typeof(p_evidence)<>'object'
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Breaker reset actor, state, cooldown, reason, or version denied';
  end if;
  select count(*) filter(where outcome='success'),
    jsonb_agg(jsonb_build_object(
      'observation_id',observation_id,'request_kind',request_kind,
      'outcome',outcome,'http_status',http_status,'observed_at',observed_at
    ) order by observed_at desc,observation_id desc)
  into v_successes,v_recovery from (
    select observation_id,request_kind,outcome,http_status,observed_at
    from public.os_it_intune_provider_observations
    where breaker_id=p_breaker_id
      and request_kind in ('preflight_read','verification_read')
      and outcome<>'ignored'
      and observed_at>=greatest(v_breaker.opened_at,now()-interval '30 minutes')
    order by observed_at desc,observation_id desc
    limit v_breaker.reset_success_threshold
  ) s;
  if v_successes<v_breaker.reset_success_threshold then
    raise exception 'Insufficient durable read-only recovery observations';
  end if;
  v_bound:=jsonb_build_object('breaker_id',p_breaker_id,
    'breaker_version',v_breaker.row_version,'successes',v_successes,
    'recovery_observations',coalesce(v_recovery,'[]'::jsonb),
    'operator_evidence',p_evidence);
  v_hash:=encode(digest(v_bound::text,'sha256'),'hex');
  insert into public.os_it_intune_breaker_reset_proposals(
    breaker_id,entity_id,proposed_by,proposed_reason,evidence,evidence_sha256,
    proposed_breaker_version
  ) values (
    p_breaker_id,v_breaker.entity_id,p_actor_id,trim(p_reason),v_bound,v_hash,
    v_breaker.row_version
  ) returning * into v_proposal;
  insert into public.os_it_intune_breaker_events(
    breaker_id,proposal_id,entity_id,event_type,from_state,to_state,actor_id,
    reason,evidence,breaker_version
  ) values (
    p_breaker_id,v_proposal.proposal_id,v_breaker.entity_id,'reset_proposed',
    'open','open',p_actor_id,trim(p_reason),
    jsonb_build_object('evidence_sha256',v_hash,'successes',v_successes),
    v_breaker.row_version
  );
  return jsonb_build_object('proposal_id',v_proposal.proposal_id,
    'status','awaiting_review','evidence_sha256',v_hash);
end;
$$;

create or replace function public.review_it_intune_breaker_reset(
  p_proposal_id uuid,p_actor_id uuid,p_decision text,p_statement text,
  p_expected_proposal_version bigint,p_expected_breaker_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_breaker_reset_proposals%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_successes integer; v_fresh_successes integer;
  v_reviewer_evidence jsonb; v_reviewer_hash text;
begin
  perform public.expire_it_intune_breaker_reset_proposals();
  select * into v_proposal from public.os_it_intune_breaker_reset_proposals
  where proposal_id=p_proposal_id for update;
  if not found then raise exception 'Breaker reset proposal not found'; end if;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=v_proposal.breaker_id for update;
  if v_proposal.status='approved' and p_decision='approve'
     and v_proposal.reviewed_by=p_actor_id then
    return jsonb_build_object('proposal_id',p_proposal_id,
      'status','approved','breaker_state',v_breaker.state,
      'idempotent_replay',true);
  end if;
  if v_proposal.status='rejected' and p_decision='reject'
     and v_proposal.reviewed_by=p_actor_id then
    return jsonb_build_object('proposal_id',p_proposal_id,
      'status','rejected','breaker_state',v_breaker.state,
      'idempotent_replay',true);
  end if;
  if v_proposal.status<>'awaiting_review' or v_proposal.expires_at<=now()
     or v_proposal.proposed_by=p_actor_id
     or v_proposal.row_version<>p_expected_proposal_version
     or v_breaker.state<>'open'
     or v_breaker.row_version<>p_expected_breaker_version
     or v_breaker.cooldown_until>now()
     or p_decision not in ('approve','reject')
     or length(trim(coalesce(p_statement,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Independent breaker reset review denied or stale';
  end if;
  select count(*) filter(where outcome='success') into v_successes from (
    select outcome from public.os_it_intune_provider_observations
    where breaker_id=v_breaker.breaker_id
      and request_kind in ('preflight_read','verification_read')
      and outcome<>'ignored'
      and observed_at>=now()-interval '30 minutes'
    order by observed_at desc,observation_id desc
    limit v_breaker.reset_success_threshold
  ) s;
  if p_decision='approve' and v_successes<v_breaker.reset_success_threshold then
    raise exception 'Recovery threshold regressed before review';
  end if;
  select count(*),jsonb_agg(jsonb_build_object(
      'observation_id',observation_id,'request_kind',request_kind,
      'http_status',http_status,'observed_at',observed_at
    ) order by observed_at desc,observation_id desc)
  into v_fresh_successes,v_reviewer_evidence
  from public.os_it_intune_provider_observations
  where breaker_id=v_breaker.breaker_id
    and request_kind in ('preflight_read','verification_read')
    and outcome='success' and observed_at>=v_proposal.proposed_at;
  if p_decision='approve' and v_fresh_successes<1 then
    raise exception 'Independent review requires fresh post-proposal recovery evidence';
  end if;
  v_reviewer_evidence:=jsonb_build_object(
    'proposal_evidence_sha256',v_proposal.evidence_sha256,
    'fresh_observations',coalesce(v_reviewer_evidence,'[]'::jsonb)
  );
  v_reviewer_hash:=encode(digest(v_reviewer_evidence::text,'sha256'),'hex');
  update public.os_it_intune_breaker_reset_proposals set
    status=case when p_decision='approve' then 'approved' else 'rejected' end,
    reviewed_by=p_actor_id,reviewer_statement=trim(p_statement),
    reviewer_evidence=v_reviewer_evidence,
    reviewer_evidence_sha256=v_reviewer_hash,
    reviewed_at=now(),row_version=row_version+1
  where proposal_id=p_proposal_id;
  if p_decision='approve' then
    update public.os_it_intune_provider_breakers set
      state='half_open',canary_action_id=null,canary_token=null,
      canary_worker_id=null,canary_acquired_at=null,canary_expires_at=null,
      canary_post_accepted_at=null,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id returning * into v_breaker;
  end if;
  insert into public.os_it_intune_breaker_events(
    breaker_id,proposal_id,entity_id,event_type,from_state,to_state,actor_id,
    reason,evidence,breaker_version
  ) values (
    v_breaker.breaker_id,p_proposal_id,v_breaker.entity_id,
    case when p_decision='approve' then 'half_opened' else 'reset_rejected' end,
    'open',case when p_decision='approve' then 'half_open' else 'open' end,
    p_actor_id,trim(p_statement),
    jsonb_build_object('evidence_sha256',v_proposal.evidence_sha256,
      'reviewer_evidence_sha256',v_reviewer_hash,
      'recovery_successes',v_successes,
      'fresh_recovery_successes',v_fresh_successes),v_breaker.row_version
  );
  return jsonb_build_object('proposal_id',p_proposal_id,
    'status',case when p_decision='approve' then 'approved' else 'rejected' end,
    'breaker_state',v_breaker.state);
end;
$$;

create or replace view public.os_it_intune_breaker_health
with (security_invoker=true) as
select b.breaker_id,b.entity_id,b.provider,b.operation,b.state,b.opened_at,
  b.cooldown_until,b.last_failure_at,b.last_success_at,b.opened_reason,
  b.canary_action_id,b.canary_expires_at,b.row_version,
  extract(epoch from (now()-coalesce(b.opened_at,b.updated_at)))/60.0
    as state_age_minutes,
  case when b.state='closed' then 0 else
    (select count(*) from public.os_it_intune_actions a
      where coalesce(a.entity_id,'__firm__')=b.entity_scope
        and a.status in ('approved','preflighting'))
  end
    as blocked_action_count,
  (select count(*) from public.os_it_intune_provider_observations o
    where o.breaker_id=b.breaker_id and o.observed_at>=
      now()-make_interval(mins=>b.failure_window_minutes)
      and o.outcome<>'ignored') as sample_count,
  (select count(*) from public.os_it_intune_provider_observations o
    where o.breaker_id=b.breaker_id and o.observed_at>=
      now()-make_interval(mins=>b.failure_window_minutes)
      and o.outcome in ('failure','ambiguous')) as failure_count,
  b.canary_post_accepted_at
from public.os_it_intune_provider_breakers b
;
grant select on public.os_it_intune_breaker_health to authenticated;

revoke all on function public.claim_it_intune_action_v3(text,integer)
  from public,authenticated,service_role;
revoke all on function public.authorize_it_intune_dispatch_v3(
  uuid,uuid,text,bigint,uuid,jsonb,text) from public,authenticated,service_role;
revoke all on function public.finish_it_intune_action_v3(
  uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer,uuid,uuid)
  from public,authenticated,service_role;
revoke all on function public.ensure_it_intune_provider_breaker(text)
  from public,authenticated,service_role;
revoke all on function public.recover_it_intune_breaker_canary(uuid)
  from public,authenticated,service_role;
revoke all on function public.recover_stale_it_intune_breaker_canaries()
  from public,authenticated,service_role;
revoke all on function public.record_it_intune_provider_observation(
  uuid,text,uuid,text,integer,text,text,uuid,jsonb)
  from public,authenticated,service_role;
revoke all on function public.claim_it_intune_action_v4(text,integer)
  from public,authenticated;
revoke all on function public.authorize_it_intune_dispatch_v4(
  uuid,uuid,text,bigint,uuid,jsonb,text) from public,authenticated;
revoke all on function public.finish_it_intune_action_v4(
  uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer,uuid,uuid,uuid)
  from public,authenticated;
revoke all on function public.expire_it_intune_breaker_reset_proposals()
  from public,authenticated;
revoke all on function public.propose_it_intune_breaker_reset(
  uuid,uuid,text,jsonb,bigint) from public,authenticated;
revoke all on function public.review_it_intune_breaker_reset(
  uuid,uuid,text,text,bigint,bigint) from public,authenticated;
grant execute on function
  public.recover_stale_it_intune_breaker_canaries(),
  public.record_it_intune_provider_observation(
    uuid,text,uuid,text,integer,text,text,uuid,jsonb),
  public.claim_it_intune_action_v4(text,integer),
  public.authorize_it_intune_dispatch_v4(
    uuid,uuid,text,bigint,uuid,jsonb,text),
  public.finish_it_intune_action_v4(
    uuid,uuid,text,bigint,text,jsonb,text,text,text,text,text,integer,uuid,uuid,uuid),
  public.expire_it_intune_breaker_reset_proposals(),
  public.propose_it_intune_breaker_reset(uuid,uuid,text,jsonb,bigint),
  public.review_it_intune_breaker_reset(uuid,uuid,text,text,bigint,bigint)
  to service_role;
