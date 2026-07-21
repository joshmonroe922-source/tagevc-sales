-- Phase 38: two-actor, evidence-bound governance for ambiguous Intune retire.
-- manual_review is a quarantine: workers cannot claim or redispatch it.

alter table public.os_it_intune_actions
  add column if not exists manual_review_started_at timestamptz,
  add column if not exists ambiguity_resolution_id uuid,
  add column if not exists ambiguity_resolved_at timestamptz,
  add column if not exists ambiguity_resolved_by uuid,
  add column if not exists ambiguity_disposition text,
  add column if not exists ambiguity_evidence_sha256 text;

alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_ambiguity_disposition_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_ambiguity_disposition_check check (
    ambiguity_disposition is null or ambiguity_disposition in
      ('confirmed_retired','closed_unresolved','retry_child_created')
  );

update public.os_it_intune_actions set
  manual_review_started_at = coalesce(manual_review_started_at,terminal_at,updated_at),
  next_poll_at = null,
  lease_token = null,
  lease_acquired_at = null,
  lease_expires_at = null,
  worker_id = null,
  row_version = row_version + 1,
  updated_at = now()
where status = 'manual_review' and (
  manual_review_started_at is null
  or next_poll_at is not null
  or lease_token is not null
  or lease_acquired_at is not null
  or lease_expires_at is not null
  or worker_id is not null
);

alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_manual_review_quarantine_check;
alter table public.os_it_intune_actions
  add constraint os_it_intune_manual_review_quarantine_check check (
    status <> 'manual_review' or (
      manual_review_started_at is not null
      and next_poll_at is null
      and lease_token is null
      and lease_acquired_at is null
      and lease_expires_at is null
      and worker_id is null
    )
  );

create or replace function public.enforce_it_intune_manual_review_quarantine()
returns trigger language plpgsql set search_path = public
as $$
begin
  if new.status = 'manual_review' then
    new.manual_review_started_at :=
      coalesce(new.manual_review_started_at,now());
    new.next_poll_at := null;
    new.lease_token := null;
    new.lease_acquired_at := null;
    new.lease_expires_at := null;
    new.worker_id := null;
  end if;
  return new;
end;
$$;
drop trigger if exists os_it_intune_manual_review_quarantine
  on public.os_it_intune_actions;
create trigger os_it_intune_manual_review_quarantine
  before insert or update on public.os_it_intune_actions
  for each row execute function
    public.enforce_it_intune_manual_review_quarantine();

create table if not exists public.os_it_intune_ambiguity_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.os_it_intune_actions(action_id),
  entity_id text references public.entities(entity_id),
  decision text not null,
  status text not null default 'awaiting_review',
  provider_evidence jsonb not null,
  evidence_sha256 text not null,
  provider_http_status integer not null,
  provider_request_id text not null,
  provider_state text,
  proposed_action_version bigint not null,
  proposed_by uuid not null,
  proposed_reason text not null,
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  reviewed_by uuid,
  reviewer_statement text,
  reviewer_provider_evidence jsonb,
  reviewer_evidence_sha256 text,
  reviewer_provider_request_id text,
  reviewed_at timestamptz,
  retry_child_action_id uuid references public.os_it_intune_actions(action_id),
  row_version bigint not null default 0,
  constraint os_it_intune_ambiguity_decision_check check (
    decision in ('confirm_retired','close_unresolved','create_retry_child')
  ),
  constraint os_it_intune_ambiguity_status_check check (
    status in ('awaiting_review','approved','rejected','expired')
  ),
  constraint os_it_intune_ambiguity_hash_check check (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
    and (reviewer_evidence_sha256 is null
      or reviewer_evidence_sha256 ~ '^[0-9a-f]{64}$')
  ),
  constraint os_it_intune_ambiguity_actor_check check (
    reviewed_by is null or reviewed_by <> proposed_by
  )
);
alter table public.os_it_intune_ambiguity_resolutions
  add column if not exists dispatch_attempt_id uuid
    references public.os_it_intune_dispatch_attempts(dispatch_attempt_id),
  add column if not exists approval_match_sha256 text,
  add column if not exists asset_sha256 text,
  add column if not exists provider_preflight_sha256 text,
  add column if not exists evidence_semantic_sha256 text,
  add column if not exists reviewer_evidence_semantic_sha256 text;
alter table public.os_it_intune_ambiguity_resolutions
  drop constraint if exists os_it_intune_ambiguity_bound_hashes_check;
alter table public.os_it_intune_ambiguity_resolutions
  add constraint os_it_intune_ambiguity_bound_hashes_check check (
    (approval_match_sha256 is null
      or approval_match_sha256 ~ '^[0-9a-f]{64}$')
    and (asset_sha256 is null or asset_sha256 ~ '^[0-9a-f]{64}$')
    and (provider_preflight_sha256 is null
      or provider_preflight_sha256 ~ '^[0-9a-f]{64}$')
    and (evidence_semantic_sha256 is null
      or evidence_semantic_sha256 ~ '^[0-9a-f]{64}$')
    and (reviewer_evidence_semantic_sha256 is null
      or reviewer_evidence_semantic_sha256 ~ '^[0-9a-f]{64}$')
  );
create unique index if not exists os_it_intune_one_pending_ambiguity
  on public.os_it_intune_ambiguity_resolutions(action_id)
  where status = 'awaiting_review';
create index if not exists os_it_intune_ambiguity_entity_idx
  on public.os_it_intune_ambiguity_resolutions(entity_id,proposed_at desc);

create table if not exists public.os_it_intune_ambiguity_events (
  event_id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null
    references public.os_it_intune_ambiguity_resolutions(resolution_id),
  action_id uuid not null references public.os_it_intune_actions(action_id),
  entity_id text references public.entities(entity_id),
  event_type text not null,
  actor_id uuid not null,
  from_status text,
  to_status text not null,
  evidence_sha256 text not null,
  action_version bigint not null,
  resolution_version bigint not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint os_it_intune_ambiguity_event_type_check check (
    event_type in ('proposal_created','proposal_expired','review_rejected',
      'confirmed_retired','closed_unresolved','retry_child_created')
  )
);
alter table public.os_it_intune_actions
  drop constraint if exists os_it_intune_ambiguity_resolution_fk;
alter table public.os_it_intune_actions
  add constraint os_it_intune_ambiguity_resolution_fk
  foreign key (ambiguity_resolution_id)
  references public.os_it_intune_ambiguity_resolutions(resolution_id);

alter table public.os_it_intune_ambiguity_resolutions enable row level security;
alter table public.os_it_intune_ambiguity_events enable row level security;
drop policy if exists "os_it_intune_ambiguity_resolution_select"
  on public.os_it_intune_ambiguity_resolutions;
drop policy if exists "os_it_intune_ambiguity_event_select"
  on public.os_it_intune_ambiguity_events;
create policy "os_it_intune_ambiguity_resolution_select"
  on public.os_it_intune_ambiguity_resolutions for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_it_intune_ambiguity_event_select"
  on public.os_it_intune_ambiguity_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
revoke select on public.os_it_intune_ambiguity_resolutions
  from authenticated;
grant select (
  resolution_id,action_id,entity_id,decision,status,evidence_sha256,
  provider_http_status,provider_request_id,provider_state,
  dispatch_attempt_id,approval_match_sha256,asset_sha256,
  provider_preflight_sha256,evidence_semantic_sha256,
  reviewer_evidence_semantic_sha256,
  proposed_action_version,proposed_by,proposed_reason,proposed_at,expires_at,
  reviewed_by,reviewer_statement,reviewer_evidence_sha256,
  reviewer_provider_request_id,reviewed_at,retry_child_action_id,row_version
) on public.os_it_intune_ambiguity_resolutions to authenticated;
grant select on public.os_it_intune_ambiguity_events to authenticated;
revoke insert,update,delete,truncate
  on public.os_it_intune_ambiguity_resolutions,
    public.os_it_intune_ambiguity_events
  from public,authenticated;

create or replace function public.normalize_it_intune_serial(p_value text)
returns text language sql immutable strict
set search_path = public
as $$
  select upper(regexp_replace(p_value,'[^a-zA-Z0-9]','','g'));
$$;

create or replace function public.it_intune_manual_review_actor_allowed(
  p_actor_id uuid,
  p_entity_id text
) returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles
  where id=p_actor_id and active;
  if not found then return false; end if;
  -- Phase 38 grants this permission only to these explicitly firm-wide roles.
  if v_profile.role in ('visionary','admin','coo') then return true; end if;
  -- No scoped role is currently allowed. Keep cross-entity denial explicit so
  -- adding a scoped role cannot accidentally inherit firm-wide access.
  if p_entity_id is null
     or v_profile.entity_id is distinct from p_entity_id then
    return false;
  end if;
  return false;
end;
$$;

create or replace function public.it_intune_evidence_semantic(
  p_evidence jsonb
) returns jsonb
language sql immutable set search_path = public
as $$
  select jsonb_build_object(
    'http_status',coalesce((p_evidence->>'http_status')::integer,0),
    'managed_device_id',p_evidence->>'managed_device_id',
    'provider_body',jsonb_build_object(
      'id',p_evidence->'provider_body'->>'id',
      'normalized_serial',public.normalize_it_intune_serial(
        coalesce(p_evidence->'provider_body'->>'serialNumber','')),
      'management_state',lower(coalesce(
        p_evidence->'provider_body'->>'managementState',''))
    ),
    'audit_http_status',
      coalesce((p_evidence->>'audit_http_status')::integer,0),
    'retirement_audit',jsonb_build_object(
      'id',p_evidence->'retirement_audit'->>'id',
      'resource_id',p_evidence->'retirement_audit'->>'resource_id',
      'display_name',p_evidence->'retirement_audit'->>'display_name',
      'activity_datetime',
        p_evidence->'retirement_audit'->>'activity_datetime',
      'activity_result',
        lower(coalesce(p_evidence->'retirement_audit'->>'activity_result',''))
    )
  );
$$;

create or replace function public.prevent_it_intune_ambiguity_event_mutation()
returns trigger language plpgsql set search_path = public
as $$
begin
  raise exception 'Intune ambiguity events are append-only';
end;
$$;
drop trigger if exists os_it_intune_ambiguity_events_append_only
  on public.os_it_intune_ambiguity_events;
create trigger os_it_intune_ambiguity_events_append_only
  before update or delete on public.os_it_intune_ambiguity_events
  for each row execute function
    public.prevent_it_intune_ambiguity_event_mutation();
drop trigger if exists os_it_intune_ambiguity_events_no_truncate
  on public.os_it_intune_ambiguity_events;
create trigger os_it_intune_ambiguity_events_no_truncate
  before truncate on public.os_it_intune_ambiguity_events
  for each statement execute function
    public.prevent_it_intune_ambiguity_event_mutation();

create or replace function public.protect_it_intune_ambiguity_action_events()
returns trigger language plpgsql set search_path = public
as $$
begin
  if old.source in (
    'ambiguity_proposal','ambiguity_resolution','ambiguity_retry'
  ) then
    raise exception 'Intune ambiguity action events are append-only';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists os_it_intune_ambiguity_action_events_append_only
  on public.os_it_intune_action_events;
create trigger os_it_intune_ambiguity_action_events_append_only
  before update or delete on public.os_it_intune_action_events
  for each row execute function
    public.protect_it_intune_ambiguity_action_events();
revoke insert,update,delete,truncate
  on public.os_it_intune_action_events from public,authenticated;

create or replace function public.guard_it_intune_ambiguity_action_insert()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_resolution_id uuid;
begin
  if new.retry_of_action_id is null then
    if exists (
      select 1 from public.os_it_intune_actions prior
      join public.os_it_intune_dispatch_attempts attempt
        on attempt.action_id=prior.action_id
      where prior.managed_device_id=new.managed_device_id
        and prior.action_type=new.action_type
    ) then
      raise exception 'A dispatched Intune tombstone blocks new root actions';
    end if;
    return new;
  end if;
  if exists (
    select 1 from public.os_it_intune_dispatch_attempts
    where action_id=new.retry_of_action_id
  ) then
    begin
      v_resolution_id := nullif(current_setting(
        'tagevc.intune_ambiguity_resolution_id',true),'')::uuid;
    exception when others then
      v_resolution_id := null;
    end;
    if v_resolution_id is null or not exists (
      select 1 from public.os_it_intune_ambiguity_resolutions resolution
      where resolution.resolution_id=v_resolution_id
        and resolution.action_id=new.retry_of_action_id
        and resolution.decision='create_retry_child'
        and resolution.status='awaiting_review'
    ) then
      raise exception 'Dispatched Intune retry requires approved review RPC';
    end if;
    if new.status<>'requested' or new.local_asset_id is not null
       or new.matched_by is not null or new.matched_at is not null
       or new.match_snapshot is not null or new.match_sha256 is not null
       or new.approved_by is not null or new.approved_at is not null
       or new.approval_match_sha256 is not null
       or new.approval_expires_at is not null then
      raise exception 'Ambiguity retry child must require fresh match and approval';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists os_it_intune_ambiguity_action_insert_guard
  on public.os_it_intune_actions;
create trigger os_it_intune_ambiguity_action_insert_guard
  before insert on public.os_it_intune_actions
  for each row execute function public.guard_it_intune_ambiguity_action_insert();

create or replace function public.expire_it_intune_ambiguity_resolutions()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with expired as (
    update public.os_it_intune_ambiguity_resolutions set
      status='expired',row_version=row_version+1
    where status='awaiting_review' and expires_at<=now()
    returning *
  ), events as (
    insert into public.os_it_intune_ambiguity_events (
      resolution_id,action_id,entity_id,event_type,actor_id,from_status,
      to_status,evidence_sha256,action_version,resolution_version,reason
    )
    select resolution_id,action_id,entity_id,'proposal_expired',proposed_by,
      'awaiting_review','expired',evidence_sha256,proposed_action_version,
      row_version,'Intune ambiguity proposal expired before independent review'
    from expired returning 1
  )
  select count(*) into v_count from events;
  return v_count;
end;
$$;

create or replace function public.propose_it_intune_ambiguity_resolution(
  p_action_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_provider_evidence jsonb,
  p_reason text,
  p_expected_action_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_action public.os_it_intune_actions%rowtype;
  v_attempt public.os_it_intune_dispatch_attempts%rowtype;
  v_resolution public.os_it_intune_ambiguity_resolutions%rowtype;
  v_hash text;
  v_semantic jsonb;
  v_semantic_hash text;
  v_bound_evidence jsonb;
  v_http integer;
  v_state text;
  v_provider_serial text;
  v_asset_serial text;
  v_preflight_serial text;
begin
  perform public.expire_it_intune_ambiguity_resolutions();
  select * into v_action from public.os_it_intune_actions
  where action_id=p_action_id for update;
  if not found or v_action.status<>'manual_review'
     or v_action.row_version<>p_expected_action_version then
    raise exception 'Intune action state or version changed';
  end if;
  if not public.it_intune_manual_review_actor_allowed(
    p_actor_id,v_action.entity_id
  ) then raise exception 'Intune manual-review permission or entity denied'; end if;
  select * into v_attempt from public.os_it_intune_dispatch_attempts
  where action_id=v_action.action_id for update;
  if not found then
    raise exception 'Intune ambiguity review requires a dispatch attempt';
  end if;
  begin
    v_http := (p_provider_evidence->>'http_status')::integer;
  exception when others then
    raise exception 'Intune Graph evidence HTTP status is invalid';
  end;
  v_state := lower(coalesce(
    p_provider_evidence->'provider_body'->>'managementState',''));
  v_provider_serial := public.normalize_it_intune_serial(coalesce(
    p_provider_evidence->'provider_body'->>'serialNumber',''));
  v_asset_serial := public.normalize_it_intune_serial(coalesce(
    v_attempt.asset_snapshot->>'normalized_serial',''));
  v_preflight_serial := public.normalize_it_intune_serial(coalesce(
    v_attempt.provider_preflight->>'serial_number',''));
  if p_decision not in
       ('confirm_retired','close_unresolved','create_retry_child')
     or length(trim(coalesce(p_reason,'')))<20
     or p_provider_evidence->>'evidence_version'<>'phase38-v1'
     or p_provider_evidence->>'managed_device_id'<>v_action.managed_device_id
     or nullif(trim(p_provider_evidence->>'graph_request_id'),'') is null
     or (p_provider_evidence->>'observed_at')::timestamptz
       not between now()-interval '10 minutes' and now()+interval '2 minutes'
     or v_http not between 100 and 599
     or (p_provider_evidence->'provider_body'->>'id' is not null
       and p_provider_evidence->'provider_body'->>'id'
         <> v_action.managed_device_id) then
    raise exception 'Fresh Intune Graph evidence is invalid';
  end if;
  -- A missing managedDevice can be deletion, replication lag, scope loss, or
  -- tenant drift. It never proves the destructive action completed.
  if p_decision='confirm_retired' and not (
       (v_http=200
         and p_provider_evidence->'provider_body'->>'id'
           =v_action.managed_device_id
         and v_state='retired'
         and v_provider_serial<>'' and v_provider_serial=v_asset_serial
         and v_provider_serial=v_preflight_serial)
       or
       (coalesce((p_provider_evidence->>'audit_http_status')::integer,0)=200
         and nullif(p_provider_evidence->'retirement_audit'->>'id','') is not null
         and lower(coalesce(
           p_provider_evidence->'retirement_audit'->>'activity_result',''))
           = 'success'
         and p_provider_evidence->'retirement_audit'->>'resource_id'
           = v_action.managed_device_id
         and p_provider_evidence->'retirement_audit'->>'display_name'
           ilike '%retire%'
         and (p_provider_evidence->'retirement_audit'->>'activity_datetime')::timestamptz
           between v_action.dispatch_authorized_at
             and now()+interval '2 minutes')
     ) then
    raise exception '404 alone is insufficient; exact retired state or successful bound audit is required';
  end if;
  if p_decision='create_retry_child' and (
       v_action.retry_generation>=2
       or v_action.dispatch_authorized_at is null
       or v_action.dispatch_authorized_at>now()-interval '24 hours'
       or v_http<>200
       or p_provider_evidence->'provider_body'->>'id'
         <>v_action.managed_device_id
       or v_provider_serial='' or v_provider_serial<>v_asset_serial
       or v_provider_serial<>v_preflight_serial
       or v_state not in ('managed','retirefailed','retirecanceled')
     ) then
    raise exception 'Retry requires 24h quarantine and exact non-retired identity evidence';
  end if;
  v_semantic := public.it_intune_evidence_semantic(p_provider_evidence);
  if p_decision='create_retry_child' then
    v_semantic := v_semantic-'audit_http_status'-'retirement_audit';
  elsif p_decision='confirm_retired' then
    if v_http=200 and v_state='retired' then
      v_semantic := jsonb_build_object('mode','current_retired',
        'http_status',v_http,'managed_device_id',v_action.managed_device_id,
        'provider_body',v_semantic->'provider_body');
    else
      v_semantic := jsonb_build_object('mode','successful_retire_audit',
        'managed_device_id',v_action.managed_device_id,
        'audit_http_status',v_semantic->'audit_http_status',
        'retirement_audit',v_semantic->'retirement_audit');
    end if;
  end if;
  v_semantic := jsonb_build_object(
    'dispatch_attempt_id',v_attempt.dispatch_attempt_id,
    'evidence',v_semantic
  );
  v_semantic_hash := encode(digest(v_semantic::text,'sha256'),'hex');
  v_bound_evidence := jsonb_build_object(
    'action_id',v_action.action_id,
    'action_version',v_action.row_version,
    'dispatch_attempt_id',v_attempt.dispatch_attempt_id,
    'approval_match_sha256',v_attempt.approval_match_sha256,
    'asset_sha256',v_attempt.asset_sha256,
    'provider_preflight_sha256',v_attempt.provider_preflight_sha256,
    'managed_device_id',v_action.managed_device_id,
    'provider_evidence',p_provider_evidence
  );
  v_hash := encode(digest(v_bound_evidence::text,'sha256'),'hex');
  insert into public.os_it_intune_ambiguity_resolutions (
    action_id,entity_id,decision,provider_evidence,evidence_sha256,
    provider_http_status,provider_request_id,provider_state,
    dispatch_attempt_id,approval_match_sha256,asset_sha256,
    provider_preflight_sha256,evidence_semantic_sha256,
    proposed_action_version,proposed_by,proposed_reason
  ) values (
    v_action.action_id,v_action.entity_id,p_decision,p_provider_evidence,v_hash,
    v_http,p_provider_evidence->>'graph_request_id',nullif(v_state,''),
    v_attempt.dispatch_attempt_id,v_attempt.approval_match_sha256,
    v_attempt.asset_sha256,v_attempt.provider_preflight_sha256,v_semantic_hash,
    v_action.row_version,p_actor_id,trim(p_reason)
  ) returning * into v_resolution;
  update public.os_it_intune_actions set
    row_version=row_version+1,updated_at=now()
  where action_id=v_action.action_id;
  insert into public.os_it_intune_ambiguity_events (
    resolution_id,action_id,entity_id,event_type,actor_id,from_status,
    to_status,evidence_sha256,action_version,resolution_version,reason
  ) values (
    v_resolution.resolution_id,v_action.action_id,v_action.entity_id,
    'proposal_created',p_actor_id,null,'awaiting_review',v_hash,
    v_action.row_version+1,0,trim(p_reason)
  );
  insert into public.os_it_intune_action_events (
    action_id,from_status,to_status,actor_id,source,evidence,
    transition_key,row_version
  ) values (
    v_action.action_id,'manual_review','manual_review',p_actor_id,
    'ambiguity_proposal',
    jsonb_build_object('resolution_id',v_resolution.resolution_id,
      'decision',p_decision,'evidence_sha256',v_hash),
    v_action.action_id::text||':ambiguity-proposal:'||
      v_resolution.resolution_id::text,v_action.row_version+1
  );
  return jsonb_build_object('resolution_id',v_resolution.resolution_id,
    'status','awaiting_review','evidence_sha256',v_hash,
    'action_version',v_action.row_version+1);
end;
$$;

create or replace function public.review_it_intune_ambiguity_resolution(
  p_resolution_id uuid,
  p_actor_id uuid,
  p_review_decision text,
  p_provider_evidence jsonb,
  p_statement text,
  p_expected_resolution_version bigint,
  p_expected_action_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_resolution public.os_it_intune_ambiguity_resolutions%rowtype;
  v_action public.os_it_intune_actions%rowtype;
  v_attempt public.os_it_intune_dispatch_attempts%rowtype;
  v_child public.os_it_intune_actions%rowtype;
  v_hash text;
  v_semantic jsonb;
  v_semantic_hash text;
  v_bound_evidence jsonb;
  v_http integer;
  v_state text;
  v_provider_serial text;
  v_asset_serial text;
  v_preflight_serial text;
  v_event text;
  v_to text;
begin
  perform public.expire_it_intune_ambiguity_resolutions();
  select * into v_resolution
  from public.os_it_intune_ambiguity_resolutions
  where resolution_id=p_resolution_id for update;
  if not found then raise exception 'Intune ambiguity proposal not found'; end if;
  select * into v_action from public.os_it_intune_actions
  where action_id=v_resolution.action_id for update;
  if not public.it_intune_manual_review_actor_allowed(
    p_actor_id,v_action.entity_id
  ) then raise exception 'Intune manual-review permission or entity denied'; end if;
  if v_resolution.status='approved' and p_review_decision='approve' then
    if v_resolution.decision='create_retry_child'
       and (v_resolution.retry_child_action_id is null
         or v_action.retry_child_action_id
           is distinct from v_resolution.retry_child_action_id) then
      raise exception 'Approved retry resolution has inconsistent child lineage';
    end if;
    return jsonb_build_object('resolution_id',p_resolution_id,
      'status','approved','action_status',v_action.status,
      'retry_child_action_id',v_resolution.retry_child_action_id,
      'idempotent_replay',true);
  end if;
  if v_resolution.status<>'awaiting_review'
     or v_resolution.expires_at<=now()
     or v_resolution.proposed_by=p_actor_id
     or v_resolution.row_version<>p_expected_resolution_version
     or v_action.status<>'manual_review'
     or v_action.row_version<>p_expected_action_version
     or p_review_decision not in ('approve','reject')
     or length(trim(coalesce(p_statement,'')))<20 then
    raise exception 'Review actor, state, version, expiry, or statement changed';
  end if;
  select * into v_attempt from public.os_it_intune_dispatch_attempts
  where dispatch_attempt_id=v_resolution.dispatch_attempt_id
    and action_id=v_action.action_id for update;
  if not found
     or v_attempt.approval_match_sha256
       is distinct from v_resolution.approval_match_sha256
     or v_attempt.asset_sha256 is distinct from v_resolution.asset_sha256
     or v_attempt.provider_preflight_sha256
       is distinct from v_resolution.provider_preflight_sha256 then
    raise exception 'Dispatch-attempt evidence binding changed';
  end if;
  begin
    v_http := (p_provider_evidence->>'http_status')::integer;
  exception when others then
    raise exception 'Intune Graph review evidence HTTP status is invalid';
  end;
  v_state := lower(coalesce(
    p_provider_evidence->'provider_body'->>'managementState',''));
  v_provider_serial := public.normalize_it_intune_serial(coalesce(
    p_provider_evidence->'provider_body'->>'serialNumber',''));
  v_asset_serial := public.normalize_it_intune_serial(coalesce(
    v_attempt.asset_snapshot->>'normalized_serial',''));
  v_preflight_serial := public.normalize_it_intune_serial(coalesce(
    v_attempt.provider_preflight->>'serial_number',''));
  if p_provider_evidence->>'evidence_version'<>'phase38-v1'
     or p_provider_evidence->>'managed_device_id'<>v_action.managed_device_id
     or nullif(trim(p_provider_evidence->>'graph_request_id'),'') is null
     or p_provider_evidence->>'graph_request_id'
       =v_resolution.provider_request_id
     or nullif(trim(p_provider_evidence->>'audit_graph_request_id'),'') is null
     or p_provider_evidence->>'audit_graph_request_id'
       =v_resolution.provider_evidence->>'audit_graph_request_id'
     or (p_provider_evidence->>'observed_at')::timestamptz
       not between greatest(v_resolution.proposed_at,now()-interval '10 minutes')
         and now()+interval '2 minutes'
     or v_http not between 100 and 599
     or (p_provider_evidence->'provider_body'->>'id' is not null
       and p_provider_evidence->'provider_body'->>'id'
         <>v_action.managed_device_id) then
    raise exception 'Independent fresh Intune Graph review evidence is invalid';
  end if;
  v_semantic := public.it_intune_evidence_semantic(p_provider_evidence);
  if v_resolution.decision='create_retry_child' then
    v_semantic := v_semantic-'audit_http_status'-'retirement_audit';
  elsif v_resolution.decision='confirm_retired' then
    if v_http=200 and v_state='retired' then
      v_semantic := jsonb_build_object('mode','current_retired',
        'http_status',v_http,'managed_device_id',v_action.managed_device_id,
        'provider_body',v_semantic->'provider_body');
    else
      v_semantic := jsonb_build_object('mode','successful_retire_audit',
        'managed_device_id',v_action.managed_device_id,
        'audit_http_status',v_semantic->'audit_http_status',
        'retirement_audit',v_semantic->'retirement_audit');
    end if;
  end if;
  v_semantic := jsonb_build_object(
    'dispatch_attempt_id',v_attempt.dispatch_attempt_id,
    'evidence',v_semantic
  );
  v_semantic_hash := encode(digest(v_semantic::text,'sha256'),'hex');
  if p_review_decision='approve'
     and v_resolution.decision='confirm_retired' and (
       v_semantic_hash
         is distinct from v_resolution.evidence_semantic_sha256
       or not (
         (v_http=200
           and p_provider_evidence->'provider_body'->>'id'
             =v_action.managed_device_id
           and v_state='retired'
           and v_provider_serial<>'' and v_provider_serial=v_asset_serial
           and v_provider_serial=v_preflight_serial)
         or
         (coalesce((p_provider_evidence->>'audit_http_status')::integer,0)=200
           and nullif(p_provider_evidence->'retirement_audit'->>'id','')
             is not null
           and lower(coalesce(
             p_provider_evidence->'retirement_audit'->>'activity_result',''))
             ='success'
           and p_provider_evidence->'retirement_audit'->>'resource_id'
             =v_action.managed_device_id
           and p_provider_evidence->'retirement_audit'->>'display_name'
             ilike '%retire%'
           and (p_provider_evidence->'retirement_audit'->>'activity_datetime')::timestamptz
             between v_action.dispatch_authorized_at
               and now()+interval '2 minutes')
       )
     ) then
    raise exception 'Retirement evidence must match the same exact bound observation';
  end if;
  if p_review_decision='approve'
     and v_resolution.decision='create_retry_child' and (
       v_semantic_hash
         is distinct from v_resolution.evidence_semantic_sha256
       or v_action.dispatch_authorized_at is null
       or v_action.dispatch_authorized_at>now()-interval '24 hours'
       or v_http<>200
       or v_resolution.provider_http_status<>200
       or p_provider_evidence->'provider_body'->>'id'
         <>v_action.managed_device_id
       or v_provider_serial='' or v_provider_serial<>v_asset_serial
       or v_provider_serial<>v_preflight_serial
       or v_state not in ('managed','retirefailed','retirecanceled')
     ) then
    raise exception 'Retry review evidence must exactly match safe non-retired identity';
  end if;
  v_bound_evidence := jsonb_build_object(
    'action_id',v_action.action_id,
    'action_version',v_action.row_version,
    'dispatch_attempt_id',v_attempt.dispatch_attempt_id,
    'approval_match_sha256',v_attempt.approval_match_sha256,
    'asset_sha256',v_attempt.asset_sha256,
    'provider_preflight_sha256',v_attempt.provider_preflight_sha256,
    'managed_device_id',v_action.managed_device_id,
    'provider_evidence',p_provider_evidence
  );
  v_hash := encode(digest(v_bound_evidence::text,'sha256'),'hex');
  if p_review_decision='reject' then
    update public.os_it_intune_ambiguity_resolutions set
      status='rejected',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),
      reviewer_provider_evidence=p_provider_evidence,
      reviewer_evidence_sha256=v_hash,
      reviewer_evidence_semantic_sha256=v_semantic_hash,
      reviewer_provider_request_id=p_provider_evidence->>'graph_request_id',
      reviewed_at=now(),row_version=row_version+1
    where resolution_id=p_resolution_id;
    update public.os_it_intune_actions set
      row_version=row_version+1,updated_at=now()
    where action_id=v_action.action_id;
    v_event := 'review_rejected';
    v_to := 'manual_review';
  elsif v_resolution.decision='confirm_retired' then
    update public.os_it_intune_actions set
      status='verified',verified_at=now(),terminal_at=now(),
      provider_state='retired',verification_code='manual_confirmed_retired',
      ambiguity_resolution_id=p_resolution_id,ambiguity_resolved_at=now(),
      ambiguity_resolved_by=p_actor_id,
      ambiguity_disposition='confirmed_retired',
      ambiguity_evidence_sha256=v_hash,
      next_poll_at=null,lease_token=null,lease_acquired_at=null,
      lease_expires_at=null,worker_id=null,row_version=row_version+1,
      updated_at=now()
    where action_id=v_action.action_id;
    v_event := 'confirmed_retired'; v_to := 'verified';
  elsif v_resolution.decision='close_unresolved' then
    update public.os_it_intune_actions set
      status='failed',terminal_at=now(),
      failure_code='ambiguity_closed_unresolved',
      verification_code='manual_closed_unresolved',
      ambiguity_resolution_id=p_resolution_id,ambiguity_resolved_at=now(),
      ambiguity_resolved_by=p_actor_id,
      ambiguity_disposition='closed_unresolved',
      ambiguity_evidence_sha256=v_hash,
      next_poll_at=null,lease_token=null,lease_acquired_at=null,
      lease_expires_at=null,worker_id=null,row_version=row_version+1,
      updated_at=now()
    where action_id=v_action.action_id;
    v_event := 'closed_unresolved'; v_to := 'failed';
  else
    if v_action.retry_child_action_id is not null
       or v_action.retry_generation>=2 then
      raise exception 'Retry child already exists or generation limit reached';
    end if;
    -- Release the active-action tombstone before inserting the fresh child.
    -- The transaction rolls this projection back if child creation fails.
    perform set_config('tagevc.intune_ambiguity_resolution_id',
      p_resolution_id::text,true);
    update public.os_it_intune_actions set
      status='failed',terminal_at=now(),
      failure_code='ambiguity_retry_child_created',
      retried_by=p_actor_id,retried_at=now(),retry_reason=trim(p_statement),
      ambiguity_resolution_id=p_resolution_id,ambiguity_resolved_at=now(),
      ambiguity_resolved_by=p_actor_id,
      ambiguity_disposition='retry_child_created',
      ambiguity_evidence_sha256=v_hash,
      next_poll_at=null,lease_token=null,lease_acquired_at=null,
      lease_expires_at=null,worker_id=null,row_version=row_version+1,
      updated_at=now()
    where action_id=v_action.action_id;
    insert into public.os_it_intune_actions (
      idempotency_key,run_id,item_id,managed_device_id,user_id,entity_id,
      action_type,status,requested_by,request_metadata,
      retry_of_action_id,retry_generation
    ) values (
      'ambiguity-retry:'||p_resolution_id::text,
      v_action.run_id,v_action.item_id,v_action.managed_device_id,
      v_action.user_id,v_action.entity_id,v_action.action_type,'requested',
      p_actor_id,v_action.request_metadata||jsonb_build_object(
        'retry_reason',trim(p_statement),'retry_parent',v_action.action_id,
        'ambiguity_resolution_id',p_resolution_id),
      v_action.action_id,v_action.retry_generation+1
    ) returning * into v_child;
    if v_child.local_asset_id is not null or v_child.approved_at is not null
       or v_child.approved_by is not null or v_child.match_sha256 is not null then
      raise exception 'Retry child must require fresh match and approval';
    end if;
    update public.os_it_intune_actions set
      retry_child_action_id=v_child.action_id,updated_at=now()
    where action_id=v_action.action_id;
    update public.os_it_intune_ambiguity_resolutions
      set retry_child_action_id=v_child.action_id
    where resolution_id=p_resolution_id;
    insert into public.os_it_intune_action_events (
      action_id,from_status,to_status,actor_id,source,evidence,
      transition_key,row_version
    ) values (
      v_child.action_id,null,'requested',p_actor_id,'ambiguity_retry',
      jsonb_build_object('retry_of',v_action.action_id,
        'resolution_id',p_resolution_id,'fresh_match_required',true,
        'fresh_approval_required',true),
      v_child.action_id::text||':requested:ambiguity-retry',0
    );
    v_event := 'retry_child_created'; v_to := 'failed';
  end if;
  if p_review_decision='approve' then
    update public.os_it_intune_ambiguity_resolutions set
      status='approved',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),
      reviewer_provider_evidence=p_provider_evidence,
      reviewer_evidence_sha256=v_hash,
      reviewer_evidence_semantic_sha256=v_semantic_hash,
      reviewer_provider_request_id=p_provider_evidence->>'graph_request_id',
      reviewed_at=now(),row_version=row_version+1
    where resolution_id=p_resolution_id;
  end if;
  insert into public.os_it_intune_ambiguity_events (
    resolution_id,action_id,entity_id,event_type,actor_id,from_status,
    to_status,evidence_sha256,action_version,resolution_version,reason
  ) values (
    p_resolution_id,v_action.action_id,v_action.entity_id,v_event,p_actor_id,
    'awaiting_review',
    case when p_review_decision='reject' then 'rejected' else 'approved' end,
    v_hash,v_action.row_version+1,v_resolution.row_version+1,trim(p_statement)
  );
  insert into public.os_it_intune_action_events (
    action_id,from_status,to_status,actor_id,source,evidence,
    transition_key,row_version
  ) values (
    v_action.action_id,'manual_review',v_to,p_actor_id,
    'ambiguity_resolution',
    jsonb_build_object('resolution_id',p_resolution_id,
      'decision',v_resolution.decision,'review_decision',p_review_decision,
      'evidence_sha256',v_hash,'retry_child_action_id',v_child.action_id),
    v_action.action_id::text||':ambiguity-resolution:'||p_resolution_id::text,
    v_action.row_version+1
  );
  return jsonb_build_object('resolution_id',p_resolution_id,
    'status',case when p_review_decision='reject' then 'rejected'
      else 'approved' end,'action_status',v_to,
    'retry_child_action_id',v_child.action_id);
end;
$$;

-- Replace the Phase 37 claim function so quarantined rows are never claimable.
create or replace function public.claim_it_intune_action_v3(
  p_worker_id text,
  p_lease_seconds integer default 120
) returns public.os_it_intune_actions
language plpgsql security definer set search_path = public
as $$
declare v_action public.os_it_intune_actions%rowtype; v_from text;
begin
  if nullif(trim(p_worker_id),'') is null then
    raise exception 'Worker ID required';
  end if;
  select * into v_action from public.os_it_intune_actions
  where status in ('approved','preflighting','dispatch_authorized',
    'submitted','verifying')
    and (next_poll_at is null or next_poll_at<=now())
    and (lease_expires_at is null or lease_expires_at<now())
    and (status not in ('approved','preflighting') or (
      approval_expires_at>now() and local_asset_id is not null
      and approval_match_sha256=match_sha256 and attempt_count<3))
  order by coalesce(next_poll_at,approved_at,requested_at)
  for update skip locked limit 1;
  if not found then return null; end if;
  v_from := v_action.status;
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
  insert into public.os_it_intune_action_events (
    action_id,from_status,to_status,source,evidence,transition_key,
    worker_id,attempt_no,row_version
  ) values (
    v_action.action_id,v_from,v_action.status,
    case when v_from='dispatch_authorized'
      then 'authorization_recovery' else 'worker_claim_v3' end,
    jsonb_build_object('phase',case when v_action.status='preflighting'
      then 'preflight' else 'verification' end,
      'authorization_recovered',v_from='dispatch_authorized'),
    v_action.action_id::text||':claim-v3:'||v_action.row_version,
    p_worker_id,v_action.attempt_count,v_action.row_version
  ) on conflict do nothing;
  return v_action;
end;
$$;

-- Generic retry is pre-dispatch only. Ambiguous/dispatched parents can only
-- create a child through the approved two-actor resolution above.
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
  where action_id=p_action_id for update;
  if p_actor_id is null or length(trim(coalesce(p_reason,'')))<10 then
    raise exception 'Retry actor and a 10-character reason are required';
  end if;
  if not found or v_old.status not in ('failed','cancelled') then
    raise exception 'Action is not eligible for generic retry';
  end if;
  if v_old.dispatch_authorized_at is not null
     or v_old.submitted_at is not null
     or exists (select 1 from public.os_it_intune_dispatch_attempts d
       where d.action_id=v_old.action_id) then
    raise exception 'Dispatched parent requires two-actor ambiguity review';
  end if;
  if v_old.retry_child_action_id is not null then
    return jsonb_build_object('action_id',v_old.retry_child_action_id,
      'status','requested','idempotent_replay',true);
  end if;
  if v_old.row_version<>p_expected_row_version
     or v_old.retry_generation>=2 then
    raise exception 'Retry version changed or generation limit reached';
  end if;
  if v_old.status='failed' and coalesce(v_old.failure_code,'') not in (
    'provider_throttled','provider_5xx','provider_rejected'
  ) then
    raise exception 'Failure requires correction or manual review before retry';
  end if;
  v_root := coalesce(v_old.retry_of_action_id,v_old.action_id);
  insert into public.os_it_intune_actions (
    idempotency_key,run_id,item_id,managed_device_id,user_id,entity_id,
    action_type,status,requested_by,request_metadata,
    retry_of_action_id,retry_generation
  ) values (
    'retry:'||v_root||':'||(v_old.retry_generation+1),
    v_old.run_id,v_old.item_id,v_old.managed_device_id,v_old.user_id,
    v_old.entity_id,v_old.action_type,'requested',p_actor_id,
    v_old.request_metadata||jsonb_build_object(
      'retry_reason',trim(p_reason),'retry_parent',v_old.action_id),
    v_old.action_id,v_old.retry_generation+1
  ) returning * into v_new;
  update public.os_it_intune_actions set
    retry_child_action_id=v_new.action_id,retried_by=p_actor_id,
    retried_at=now(),retry_reason=trim(p_reason),
    row_version=row_version+1,updated_at=now()
  where action_id=v_old.action_id;
  insert into public.os_it_intune_action_events (
    action_id,from_status,to_status,actor_id,source,evidence,
    transition_key,row_version
  ) values
    (v_old.action_id,v_old.status,v_old.status,p_actor_id,'retry_parent',
      jsonb_build_object('retry_child',v_new.action_id,'reason',trim(p_reason)),
      v_old.action_id::text||':retry-child:'||v_new.action_id::text,
      v_old.row_version+1),
    (v_new.action_id,null,'requested',p_actor_id,'retry',
      jsonb_build_object('retry_of',v_old.action_id,'reason',trim(p_reason),
        'fresh_match_required',true,'fresh_approval_required',true),
      v_new.action_id::text||':requested:retry',0);
  return jsonb_build_object('action_id',v_new.action_id,
    'status','requested','retry_generation',v_new.retry_generation);
end;
$$;

-- Exposes isolated SLO inputs without changing the shared SLO evaluator.
create or replace view public.os_it_intune_manual_review_slo
with (security_invoker=true) as
select action_id,entity_id,manual_review_started_at,
  extract(epoch from (now()-manual_review_started_at))/60.0 as age_minutes,
  case when now()-manual_review_started_at>interval '4 hours'
    then 'breached' when now()-manual_review_started_at>interval '2 hours'
    then 'warning' else 'healthy' end as slo_state
from public.os_it_intune_actions
where status='manual_review';
grant select on public.os_it_intune_manual_review_slo to authenticated;

revoke all on function public.expire_it_intune_ambiguity_resolutions()
  from public,authenticated;
revoke all on function public.propose_it_intune_ambiguity_resolution(uuid,uuid,text,jsonb,text,bigint)
  from public,authenticated;
revoke all on function public.review_it_intune_ambiguity_resolution(uuid,uuid,text,jsonb,text,bigint,bigint)
  from public,authenticated;
grant execute on function public.expire_it_intune_ambiguity_resolutions()
  to service_role;
grant execute on function public.propose_it_intune_ambiguity_resolution(uuid,uuid,text,jsonb,text,bigint)
  to service_role;
grant execute on function public.review_it_intune_ambiguity_resolution(uuid,uuid,text,jsonb,text,bigint,bigint)
  to service_role;
