-- Phase 39: governed SLO policy editing and isolated delivery-route tests.
-- Dependency order: phase37_shared_service_slos.sql,
-- phase38_slo_ownership_delivery.sql, then this migration.

alter table public.os_slo_policies
  add column if not exists lifecycle_status text not null default 'published',
  add column if not exists draft_of_policy_id uuid references public.os_slo_policies(policy_id),
  add column if not exists owner_id uuid references public.profiles(id),
  add column if not exists owner_entity_id text references public.entities(entity_id),
  add column if not exists row_version bigint not null default 0,
  add column if not exists validated_at timestamptz,
  add column if not exists validated_by uuid references public.profiles(id),
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references public.profiles(id),
  add column if not exists updated_at timestamptz not null default now();

update public.os_slo_policies set
  lifecycle_status=case when enabled and retired_at is null then 'published' else 'retired' end,
  retired_at=case when enabled then retired_at
    else coalesce(retired_at,effective_at,now()) end,
  published_at=coalesce(published_at,effective_at),
  published_by=coalesce(published_by,created_by)
where lifecycle_status not in ('draft','validated');

do $$ begin
  alter table public.os_slo_policies add constraint os_slo_policy_lifecycle_check
    check (lifecycle_status in ('draft','validated','published','retired'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.os_slo_policies add constraint os_slo_policy_state_check
    check (
      (lifecycle_status in ('draft','validated') and not enabled
        and retired_at is null and draft_of_policy_id is not null)
      or (lifecycle_status='published' and enabled and retired_at is null)
      or (lifecycle_status='retired' and not enabled and retired_at is not null)
    );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.os_slo_policies add constraint os_slo_policy_phase39_bounds_check
    check (
      warning_threshold::text<>'NaN' and critical_threshold::text<>'NaN'
      and warning_threshold between 0 and 1000000000000
      and critical_threshold between 0 and 1000000000000
      and window_seconds between 60 and 2592000
      and evaluation_interval_seconds between 60 and 86400
      and warning_breach_buckets between 1 and 24
      and recovery_buckets between 1 and 24
    );
exception when duplicate_object then null; end $$;

create unique index if not exists os_slo_one_draft_per_policy
  on public.os_slo_policies(draft_of_policy_id) where lifecycle_status in ('draft','validated');

create table if not exists public.os_slo_policy_audit (
  audit_id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  action text not null,
  actor_id uuid references public.profiles(id),
  from_row_version bigint,
  to_row_version bigint,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_slo_policy_audit_action_check check (
    action in ('draft_created','draft_updated','validated','published',
      'draft_discarded','config_sanitized')
  )
);
drop trigger if exists os_slo_policy_audit_append_only on public.os_slo_policy_audit;
create trigger os_slo_policy_audit_append_only before update or delete
  on public.os_slo_policy_audit for each row execute function public.prevent_append_only_change();
drop trigger if exists os_slo_policy_audit_no_truncate on public.os_slo_policy_audit;
create trigger os_slo_policy_audit_no_truncate before truncate
  on public.os_slo_policy_audit for each statement
  execute function public.prevent_append_only_change();

with normalized as (
  select p.policy_id,p.row_version,
    jsonb_build_object('webhook_destinations',coalesce((
      select jsonb_object_agg(route.key,route.key)
      from jsonb_each_text(coalesce(p.config->'webhook_destinations','{}')) route
      where route.key~'^[a-z][a-z0-9_]{0,62}$'
        and route.value=route.key and route.value!~* '://|^https?'
    ),'{}'::jsonb)) as safe_config
  from public.os_slo_policies p
), changed as (
  update public.os_slo_policies p set config=n.safe_config,
    row_version=p.row_version+1,updated_at=now()
  from normalized n
  where p.policy_id=n.policy_id and p.config is distinct from n.safe_config
  returning p.policy_id,n.row_version,p.row_version as new_row_version
)
insert into public.os_slo_policy_audit(
  policy_id,action,from_row_version,to_row_version,detail
)
select policy_id,'config_sanitized',row_version,new_row_version,
  jsonb_build_object('reason','Removed unsupported or unsafe legacy route config')
from changed;

update public.os_slo_delivery_outbox set
  destination_key='invalid_redacted_'||
    substr(encode(digest(destination_key,'sha256'),'hex'),1,16),
  payload=(payload-'destination_env')||jsonb_build_object(
    'destination_env','[redacted-invalid-key]')
where adapter='webhook' and (
  destination_key!~'^[a-z][a-z0-9_]{0,62}$' or destination_key~* '://|^https?'
);
update public.os_slo_delivery_jobs set
  destination_key='invalid_redacted_'||
    substr(encode(digest(destination_key,'sha256'),'hex'),1,16),
  payload=(payload-'destination_env')||jsonb_build_object(
    'destination_env','[redacted-invalid-key]')
where adapter='webhook' and (
  destination_key!~'^[a-z][a-z0-9_]{0,62}$' or destination_key~* '://|^https?'
);
do $$ begin
  alter table public.os_slo_delivery_outbox
    add constraint os_slo_outbox_destination_key_check check (
      adapter<>'webhook' or destination_key~'^[a-z][a-z0-9_]{0,62}$'
    );
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.os_slo_delivery_jobs
    add constraint os_slo_job_destination_key_check check (
      adapter<>'webhook' or destination_key~'^[a-z][a-z0-9_]{0,62}$'
    );
exception when duplicate_object then null; end $$;

drop trigger if exists os_slo_alert_events_no_truncate
  on public.os_slo_alert_events;
create trigger os_slo_alert_events_no_truncate before truncate
  on public.os_slo_alert_events for each statement
  execute function public.prevent_append_only_change();
drop trigger if exists os_slo_delivery_attempts_append_only
  on public.os_slo_delivery_attempts;
create trigger os_slo_delivery_attempts_append_only before update or delete
  on public.os_slo_delivery_attempts for each row
  execute function public.prevent_append_only_change();
drop trigger if exists os_slo_delivery_attempts_no_truncate
  on public.os_slo_delivery_attempts;
create trigger os_slo_delivery_attempts_no_truncate before truncate
  on public.os_slo_delivery_attempts for each statement
  execute function public.prevent_append_only_change();

create or replace function public.phase39_redact(p_value text)
returns text language sql immutable as $$
  select left(
    regexp_replace(
      regexp_replace(coalesce(p_value,''),'https?://[^[:space:]]+','[redacted-url]','gi'),
      '(token|secret|authorization|key)[=:][^[:space:]]+','\1=[redacted]','gi'
    ),500
  )
$$;

create or replace function public.validate_phase39_slo_config(
  p_comparator text,p_warning numeric,p_critical numeric,p_window integer,
  p_interval integer,p_warning_buckets integer,p_recovery_buckets integer,
  p_config jsonb
) returns void language plpgsql immutable as $$
declare v_key text; v_value text;
begin
  if p_comparator not in ('higher_bad','lower_bad')
     or p_warning is null or p_critical is null
     or p_warning::text='NaN' or p_critical::text='NaN'
     or p_warning not between 0 and 1000000000000
     or p_critical not between 0 and 1000000000000
     or p_window not between 60 and 2592000
     or p_interval not between 60 and 86400
     or p_warning_buckets not between 1 and 24
     or p_recovery_buckets not between 1 and 24
     or (p_comparator='higher_bad' and p_warning>p_critical)
     or (p_comparator='lower_bad' and p_warning<p_critical) then
    raise exception 'Invalid threshold, window, interval, or bucket configuration';
  end if;
  if jsonb_typeof(coalesce(p_config,'{}'))<>'object'
     or exists (
       select 1 from jsonb_object_keys(coalesce(p_config,'{}')) k
       where k not in ('webhook_destinations')
     )
     or jsonb_typeof(coalesce(p_config->'webhook_destinations','{}'))<>'object'
     or (select count(*) from jsonb_object_keys(
       coalesce(p_config->'webhook_destinations','{}')))>10 then
    raise exception 'Config only supports webhook_destinations object';
  end if;
  for v_key,v_value in
    select key,value from jsonb_each_text(coalesce(p_config->'webhook_destinations','{}'))
  loop
    if v_key !~ '^[a-z][a-z0-9_]{0,62}$'
       or v_value<>v_key or v_value~* '://|^https?' then
      raise exception 'Webhook destinations must be env destination keys, never URLs';
    end if;
  end loop;
end $$;

create or replace function public.phase39_actor_authorized(
  p_actor_id uuid,p_entity_id text,p_firm_wide boolean
) returns boolean language sql security definer set search_path=public stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id=p_actor_id and p.active
      and p.role in ('visionary','admin','service_lead','coo')
      and (
        p_firm_wide
        or p_entity_id is null
        or p.role in ('visionary','admin','service_lead','coo')
        or p.entity_id=p_entity_id
      )
  )
$$;

create or replace function public.phase39_owner_authorized(
  p_owner_id uuid,p_entity_id text
) returns boolean language sql security definer set search_path=public stable as $$
  select exists (
    select 1 from public.profiles p
    where p.id=p_owner_id and p.active
      and p.role in ('visionary','admin','service_lead','coo')
      and (
        (p_entity_id is null and (
          p.entity_id is null or p.entity_id='ENT-FIRM'
          or p.role in ('visionary','admin')
        ))
        or (p_entity_id is not null and (
          p.role in ('visionary','admin','service_lead')
          or p.entity_id=p_entity_id
        ))
      )
  )
$$;

update public.os_slo_owners o set active=false,ended_at=coalesce(ended_at,now()),
  note=concat_ws(' · ',nullif(note,''),
    'Retired by Phase 39 owner-role enforcement')
where o.active and not public.phase39_owner_authorized(o.owner_id,o.entity_id);
update public.os_slo_owners o set escalation_owner_id=null,
  note=concat_ws(' · ',nullif(note,''),
    'Escalation owner cleared by Phase 39 role enforcement')
where o.active and o.escalation_owner_id is not null
  and not public.phase39_owner_authorized(o.escalation_owner_id,o.entity_id);

with candidates as (
  select a.alert_id,a.owner_id,a.severity,a.latest_evaluation_id,
    a.current_policy_version,a.row_version
  from public.os_slo_alerts a
  where a.status='open' and a.owner_id is not null
    and not public.phase39_owner_authorized(a.owner_id,a.entity_id)
), cleared as (
  update public.os_slo_alerts a set owner_id=null,row_version=a.row_version+1,
    updated_at=now()
  from candidates c where a.alert_id=c.alert_id
  returning a.alert_id
)
insert into public.os_slo_alert_events(
  alert_id,event_type,from_status,to_status,from_severity,to_severity,
  from_owner_id,to_owner_id,evaluation_id,policy_version,detail
)
select c.alert_id,'reassigned','open','open',c.severity,c.severity,
  c.owner_id,null,c.latest_evaluation_id,c.current_policy_version,
  jsonb_build_object('reason','phase39_owner_role_enforcement',
    'from_row_version',c.row_version,'to_row_version',c.row_version+1)
from candidates c join cleared u on u.alert_id=c.alert_id;

create or replace function public.reassign_slo_alert(
  p_alert_id uuid,p_actor_id uuid,p_owner_id uuid,p_note text,
  p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_alerts%rowtype;
begin
  select * into v from public.os_slo_alerts where alert_id=p_alert_id for update;
  if not found or v.status<>'open' or p_owner_id is null then
    raise exception 'Alert is closed or owner invalid';
  end if;
  if not public.phase39_actor_authorized(
      p_actor_id,v.entity_id,v.entity_id is null)
     or not public.phase39_owner_authorized(p_owner_id,v.entity_id) then
    raise exception 'Actor is unauthorized or new owner is not active and eligible';
  end if;
  if v.owner_id=p_owner_id
     and v.row_version in (p_expected_row_version,p_expected_row_version+1)
     and (
       v.row_version=p_expected_row_version
       or exists (
         select 1 from public.os_slo_alert_events e
         where e.alert_id=v.alert_id and e.event_type='reassigned'
           and e.actor_id=p_actor_id and e.to_owner_id=p_owner_id
           and e.occurred_at>=v.updated_at-interval '5 seconds'
       )
     ) then
    return jsonb_build_object('alert_id',p_alert_id,
      'row_version',v.row_version,'replayed',true);
  end if;
  if v.row_version<>p_expected_row_version then
    raise exception 'Alert changed; refresh before reassigning';
  end if;
  update public.os_slo_alerts set owner_id=p_owner_id,row_version=row_version+1,
    updated_at=now() where alert_id=p_alert_id;
  perform public.enqueue_slo_alert_event(p_alert_id,'reassigned',p_actor_id,
    'open','open',v.severity,v.severity,v.owner_id,p_owner_id,
    v.latest_evaluation_id,v.current_policy_version,
    jsonb_build_object('note',left(coalesce(p_note,''),500)));
  return jsonb_build_object('alert_id',p_alert_id,'row_version',v.row_version+1);
end $$;

create or replace function public.save_slo_policy_draft_phase39(
  p_source_policy_id uuid,p_draft_policy_id uuid,p_policy_version text,
  p_comparator text,p_warning_threshold numeric,p_critical_threshold numeric,
  p_window_seconds integer,p_evaluation_interval_seconds integer,
  p_warning_breach_buckets integer,p_recovery_buckets integer,p_config jsonb,
  p_owner_id uuid,p_owner_entity_id text,p_actor_id uuid,p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_source public.os_slo_policies%rowtype;
  v_draft public.os_slo_policies%rowtype; v_id uuid; v_before bigint;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to edit SLO policies';
  end if;
  select * into v_source from public.os_slo_policies
    where policy_id=p_source_policy_id and lifecycle_status='published'
      and enabled and retired_at is null for share;
  if not found then raise exception 'Active source policy was not found'; end if;
  if nullif(trim(p_policy_version),'') is null
     or length(trim(p_policy_version))>80
     or p_policy_version !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$' then
    raise exception 'Policy version is invalid';
  end if;
  perform public.validate_phase39_slo_config(
    p_comparator,p_warning_threshold,p_critical_threshold,p_window_seconds,
    p_evaluation_interval_seconds,p_warning_breach_buckets,p_recovery_buckets,p_config);
  if not public.phase39_owner_authorized(p_owner_id,p_owner_entity_id) then
    raise exception 'Owner must be active, eligible, and in the selected entity scope';
  end if;
  if v_source.scope='firm' and p_owner_entity_id is not null then
    raise exception 'Firm policies require a firm-wide owner assignment';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slo-draft:'||p_source_policy_id,0));
  if p_draft_policy_id is null then
    if v_source.row_version<>p_expected_row_version then
      raise exception 'Active policy changed; refresh before drafting';
    end if;
    select * into v_draft from public.os_slo_policies
      where draft_of_policy_id=v_source.policy_id
        and lifecycle_status in ('draft','validated') for update;
    if found then
      if v_draft.created_by=p_actor_id
         and v_draft.lifecycle_status='draft'
         and v_draft.policy_version=trim(p_policy_version)
         and v_draft.comparator=p_comparator
         and v_draft.warning_threshold=p_warning_threshold
         and v_draft.critical_threshold=p_critical_threshold
         and v_draft.window_seconds=p_window_seconds
         and v_draft.evaluation_interval_seconds=p_evaluation_interval_seconds
         and v_draft.warning_breach_buckets=p_warning_breach_buckets
         and v_draft.recovery_buckets=p_recovery_buckets
         and v_draft.config=coalesce(p_config,'{}')
         and v_draft.owner_id=p_owner_id
         and v_draft.owner_entity_id is not distinct from p_owner_entity_id then
        return jsonb_build_object('policy_id',v_draft.policy_id,
          'row_version',v_draft.row_version,'state','draft','replayed',true);
      end if;
      raise exception 'A different draft already exists for this active policy';
    end if;
    insert into public.os_slo_policies(
      policy_version,service,metric_key,scope,comparator,warning_threshold,
      critical_threshold,window_seconds,evaluation_interval_seconds,
      warning_breach_buckets,recovery_buckets,enabled,effective_at,config,created_by,
      lifecycle_status,draft_of_policy_id,owner_id,owner_entity_id
    ) values (
      trim(p_policy_version),v_source.service,v_source.metric_key,v_source.scope,
      p_comparator,p_warning_threshold,p_critical_threshold,p_window_seconds,
      p_evaluation_interval_seconds,p_warning_breach_buckets,p_recovery_buckets,
      false,now(),coalesce(p_config,'{}'),p_actor_id,'draft',v_source.policy_id,
      p_owner_id,p_owner_entity_id
    ) returning policy_id,row_version into v_id,v_before;
    insert into public.os_slo_policy_audit(
      policy_id,action,actor_id,from_row_version,to_row_version,detail
    ) values (v_id,'draft_created',p_actor_id,null,v_before,
      jsonb_build_object('source_policy_id',v_source.policy_id));
  else
    select * into v_draft from public.os_slo_policies
      where policy_id=p_draft_policy_id and draft_of_policy_id=v_source.policy_id
        and lifecycle_status in ('draft','validated') for update;
    if not found or v_draft.row_version<>p_expected_row_version then
      raise exception 'Draft changed; refresh before saving';
    end if;
    if v_draft.created_by<>p_actor_id then
      raise exception 'Only the maker may edit this draft';
    end if;
    v_before:=v_draft.row_version;
    update public.os_slo_policies set policy_version=trim(p_policy_version),
      comparator=p_comparator,warning_threshold=p_warning_threshold,
      critical_threshold=p_critical_threshold,window_seconds=p_window_seconds,
      evaluation_interval_seconds=p_evaluation_interval_seconds,
      warning_breach_buckets=p_warning_breach_buckets,
      recovery_buckets=p_recovery_buckets,config=coalesce(p_config,'{}'),
      owner_id=p_owner_id,owner_entity_id=p_owner_entity_id,
      lifecycle_status='draft',validated_at=null,validated_by=null,
      row_version=row_version+1,updated_at=now()
    where policy_id=v_draft.policy_id returning policy_id into v_id;
    insert into public.os_slo_policy_audit(
      policy_id,action,actor_id,from_row_version,to_row_version
    ) values (v_id,'draft_updated',p_actor_id,v_before,v_before+1);
    v_before:=v_before+1;
  end if;
  return jsonb_build_object('policy_id',v_id,'row_version',v_before,'state','draft');
end $$;

create or replace function public.validate_slo_policy_draft_phase39(
  p_policy_id uuid,p_actor_id uuid,p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_policies%rowtype;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to validate SLO policies';
  end if;
  select * into v from public.os_slo_policies where policy_id=p_policy_id for update;
  if found and v.lifecycle_status='validated' and v.validated_by=p_actor_id
     and v.row_version=p_expected_row_version+1 then
    return jsonb_build_object('policy_id',v.policy_id,'row_version',v.row_version,
      'state','validated','replayed',true);
  end if;
  if not found or v.lifecycle_status<>'draft' or v.row_version<>p_expected_row_version then
    raise exception 'Draft changed; refresh before validating';
  end if;
  perform public.validate_phase39_slo_config(v.comparator,v.warning_threshold,
    v.critical_threshold,v.window_seconds,v.evaluation_interval_seconds,
    v.warning_breach_buckets,v.recovery_buckets,v.config);
  if not public.phase39_owner_authorized(v.owner_id,v.owner_entity_id) then
    raise exception 'Draft owner is no longer eligible';
  end if;
  update public.os_slo_policies set lifecycle_status='validated',
    validated_at=now(),validated_by=p_actor_id,row_version=row_version+1,
    updated_at=now() where policy_id=v.policy_id;
  insert into public.os_slo_policy_audit(
    policy_id,action,actor_id,from_row_version,to_row_version
  ) values (v.policy_id,'validated',p_actor_id,v.row_version,v.row_version+1);
  return jsonb_build_object('policy_id',v.policy_id,'row_version',v.row_version+1,
    'state','validated');
end $$;

create or replace function public.publish_slo_policy_draft_phase39(
  p_policy_id uuid,p_actor_id uuid,p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_policies%rowtype; v_owner_id uuid;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to publish SLO policies';
  end if;
  select * into v from public.os_slo_policies where policy_id=p_policy_id for update;
  if found and v.lifecycle_status='published' and v.published_by=p_actor_id
     and v.row_version=p_expected_row_version+1 then
    return jsonb_build_object('policy_id',v.policy_id,'row_version',v.row_version,
      'state','published','replayed',true);
  end if;
  if not found or v.lifecycle_status<>'validated' or v.row_version<>p_expected_row_version then
    raise exception 'Validated draft changed; refresh before publishing';
  end if;
  if v.created_by=p_actor_id then
    raise exception 'Maker-checker requires a different publisher';
  end if;
  perform public.validate_phase39_slo_config(v.comparator,v.warning_threshold,
    v.critical_threshold,v.window_seconds,v.evaluation_interval_seconds,
    v.warning_breach_buckets,v.recovery_buckets,v.config);
  if not public.phase39_owner_authorized(v.owner_id,v.owner_entity_id) then
    raise exception 'Draft owner is no longer eligible';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'slo-policy:'||v.service||':'||v.metric_key||':'||v.scope,0));
  update public.os_slo_policies set enabled=false,retired_at=now(),
    lifecycle_status='retired',row_version=row_version+1,updated_at=now()
  where service=v.service and metric_key=v.metric_key and scope=v.scope
    and enabled and retired_at is null and policy_id<>v.policy_id;
  update public.os_slo_policies set enabled=true,effective_at=now(),retired_at=null,
    lifecycle_status='published',published_at=now(),published_by=p_actor_id,
    row_version=row_version+1,updated_at=now() where policy_id=v.policy_id;
  perform pg_advisory_xact_lock(hashtextextended('slo-owner:'||v.service||':'||
    v.metric_key||':'||coalesce(v.owner_entity_id,'__firm__'),0));
  update public.os_slo_owners set active=false,ended_at=now()
    where service=v.service and metric_key is not distinct from v.metric_key
      and entity_id is not distinct from v.owner_entity_id and active;
  insert into public.os_slo_owners(
    service,metric_key,entity_id,owner_id,assigned_by,note
  ) values (v.service,v.metric_key,v.owner_entity_id,v.owner_id,p_actor_id,
    'Assigned by Phase 39 policy publication') returning ownership_id into v_owner_id;
  insert into public.os_slo_policy_audit(
    policy_id,action,actor_id,from_row_version,to_row_version,detail
  ) values (v.policy_id,'published',p_actor_id,v.row_version,v.row_version+1,
    jsonb_build_object('ownership_id',v_owner_id,'maker_id',v.created_by));
  return jsonb_build_object('policy_id',v.policy_id,'row_version',v.row_version+1,
    'state','published','ownership_id',v_owner_id);
end $$;

create table if not exists public.os_slo_route_tests (
  route_test_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  entity_id text references public.entities(entity_id),
  requested_by uuid not null references public.profiles(id),
  adapter text not null,
  destination_key text not null,
  owner_id uuid references public.profiles(id),
  is_test boolean not null default true check (is_test),
  status text not null default 'queued',
  payload_redacted jsonb not null default '{}'::jsonb,
  row_version bigint not null default 0,
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  last_result jsonb,
  constraint os_slo_route_test_adapter_check check (adapter in ('in_app_owner','webhook')),
  constraint os_slo_route_test_destination_check check (
    (adapter='in_app_owner' and destination_key='owner' and owner_id is not null)
    or (adapter='webhook' and owner_id is null
      and destination_key~'^[a-z][a-z0-9_]{0,62}$')
  ),
  constraint os_slo_route_test_status_check check (
    status in ('queued','leased','retry_wait','delivered','failed')
  )
);
create table if not exists public.os_slo_route_test_jobs (
  job_id uuid primary key default gen_random_uuid(),
  route_test_id uuid not null unique references public.os_slo_route_tests(route_test_id),
  adapter text not null,
  destination_key text not null,
  owner_id uuid references public.profiles(id),
  is_test boolean not null default true check (is_test),
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3 check (max_attempts between 1 and 5),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_slo_route_test_job_adapter_check check (adapter in ('in_app_owner','webhook')),
  constraint os_slo_route_test_job_destination_check check (
    (adapter='in_app_owner' and destination_key='owner' and owner_id is not null)
    or (adapter='webhook' and owner_id is null
      and destination_key~'^[a-z][a-z0-9_]{0,62}$')
  ),
  constraint os_slo_route_test_job_lease_check check (
    (status='leased' and lease_token is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_token is null and lease_expires_at is null)
  ),
  constraint os_slo_route_test_job_status_check check (
    status in ('queued','leased','retry_wait','delivered','failed')
  )
);
create index if not exists os_slo_route_test_jobs_due
  on public.os_slo_route_test_jobs(next_attempt_at,created_at)
  where status in ('queued','leased','retry_wait');
create table if not exists public.os_slo_route_test_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.os_slo_route_test_jobs(job_id),
  attempt_no integer not null,
  lease_token uuid not null,
  adapter text not null,
  outcome text not null,
  response_code integer,
  provider_id text,
  error_redacted text,
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  unique(job_id,attempt_no),
  constraint os_slo_route_test_attempt_outcome_check
    check (outcome in ('delivered','failed')),
  constraint os_slo_route_test_attempt_adapter_check
    check (adapter in ('in_app_owner','webhook')),
  constraint os_slo_route_test_attempt_response_check
    check (response_code is null or response_code between 100 and 599)
);
drop trigger if exists os_slo_route_test_attempts_append_only
  on public.os_slo_route_test_attempts;
create trigger os_slo_route_test_attempts_append_only before update or delete
  on public.os_slo_route_test_attempts for each row
  execute function public.prevent_append_only_change();
drop trigger if exists os_slo_route_test_attempts_no_truncate
  on public.os_slo_route_test_attempts;
create trigger os_slo_route_test_attempts_no_truncate before truncate
  on public.os_slo_route_test_attempts for each statement
  execute function public.prevent_append_only_change();

create or replace function public.request_slo_route_test_phase39(
  p_idempotency_key text,p_entity_id text,p_adapter text,p_destination_key text,
  p_owner_id uuid,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_id uuid; v_status text;
begin
  if not public.phase39_actor_authorized(
      p_actor_id,p_entity_id,p_entity_id is null) then
    raise exception 'Actor is not authorized for this route-test scope';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$'
     or p_adapter not in ('in_app_owner','webhook')
     or p_destination_key !~ '^[a-z][a-z0-9_]{0,62}$'
     or p_destination_key~* '://|^https?' then
    raise exception 'Invalid route-test request';
  end if;
  if p_adapter='in_app_owner' then
    if p_owner_id is null or not public.phase39_owner_authorized(p_owner_id,p_entity_id)
       or p_destination_key<>'owner' then
      raise exception 'In-app route tests require an eligible scoped owner';
    end if;
  elsif p_owner_id is not null then
    raise exception 'Webhook route tests cannot carry an owner destination';
  end if;
  insert into public.os_slo_route_tests(
    idempotency_key,entity_id,requested_by,adapter,destination_key,owner_id,
    payload_redacted
  ) values (
    p_idempotency_key,p_entity_id,p_actor_id,p_adapter,p_destination_key,p_owner_id,
    jsonb_build_object('test',true,'adapter',p_adapter,
      'destination_key',p_destination_key,'entity_id',p_entity_id)
  ) on conflict (idempotency_key) do nothing returning route_test_id,status into v_id,v_status;
  if v_id is null then
    select route_test_id,status into v_id,v_status from public.os_slo_route_tests
      where idempotency_key=p_idempotency_key and requested_by=p_actor_id
        and adapter=p_adapter and destination_key=p_destination_key
        and entity_id is not distinct from p_entity_id
        and owner_id is not distinct from p_owner_id;
    if not found then raise exception 'Idempotency key belongs to another request'; end if;
  else
    insert into public.os_slo_route_test_jobs(
      route_test_id,adapter,destination_key,owner_id
    ) values (v_id,p_adapter,p_destination_key,p_owner_id);
  end if;
  return jsonb_build_object('route_test_id',v_id,'status',v_status,'test',true);
end $$;

create or replace function public.claim_slo_route_test_jobs_phase39(
  p_limit integer,p_lease_seconds integer
) returns setof public.os_slo_route_test_jobs
language plpgsql security definer set search_path=public as $$
declare v_ids uuid[];
begin
  with due as (
    select job_id from public.os_slo_route_test_jobs
    where (status in ('queued','retry_wait') and next_attempt_at<=now())
       or (status='leased' and lease_expires_at<=now())
    order by next_attempt_at,created_at for update skip locked
    limit least(greatest(p_limit,1),50)
  ), claimed as (
    update public.os_slo_route_test_jobs j set status='leased',
      lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(
        secs=>least(greatest(p_lease_seconds,30),300)),
      updated_at=now() from due where j.job_id=due.job_id
      returning j.job_id,j.route_test_id
  ), parents as (
    update public.os_slo_route_tests t set status='leased',
      row_version=row_version+1
    where t.route_test_id in (select route_test_id from claimed)
    returning t.route_test_id
  )
  select array_agg(c.job_id) into v_ids
  from claimed c left join parents p on p.route_test_id=c.route_test_id;
  return query select j.* from public.os_slo_route_test_jobs j
    where j.job_id=any(coalesce(v_ids,'{}'::uuid[]));
end $$;

create or replace function public.complete_slo_route_test_job_phase39(
  p_job_id uuid,p_lease_token uuid,p_outcome text,p_response_code integer,
  p_provider_id text,p_error_detail text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_route_test_jobs%rowtype; v_no integer; v_terminal boolean;
  v_status text; v_error text;
begin
  select * into v from public.os_slo_route_test_jobs where job_id=p_job_id for update;
  if not found or not v.is_test or v.status<>'leased' or v.lease_token<>p_lease_token
     or v.lease_expires_at<=now() then raise exception 'Route-test lease is not current'; end if;
  if p_outcome not in ('delivered','failed') then raise exception 'Invalid outcome'; end if;
  if p_response_code is not null and p_response_code not between 100 and 599 then
    raise exception 'Invalid response code';
  end if;
  if not exists (
    select 1 from public.os_slo_route_tests t
    where t.route_test_id=v.route_test_id and t.is_test
      and t.adapter=v.adapter and t.destination_key=v.destination_key
      and t.owner_id is not distinct from v.owner_id
  ) then raise exception 'Route-test job does not match its test request'; end if;
  v_no:=v.attempt_count+1; v_terminal:=p_outcome='delivered' or v_no>=v.max_attempts;
  v_status:=case when p_outcome='delivered' then 'delivered'
    when v_terminal then 'failed' else 'retry_wait' end;
  v_error:=public.phase39_redact(p_error_detail);
  insert into public.os_slo_route_test_attempts(
    job_id,attempt_no,lease_token,adapter,outcome,response_code,provider_id,
    error_redacted,started_at
  ) values (v.job_id,v_no,p_lease_token,v.adapter,p_outcome,p_response_code,
    left(public.phase39_redact(p_provider_id),200),v_error,v.updated_at);
  update public.os_slo_route_test_jobs set status=v_status,attempt_count=v_no,
    next_attempt_at=case when not v_terminal then now()+interval '1 minute' end,
    lease_token=null,lease_expires_at=null,updated_at=now() where job_id=v.job_id;
  update public.os_slo_route_tests set status=v_status,row_version=row_version+1,
    completed_at=case when v_terminal then now() end,
    last_result=jsonb_build_object('outcome',p_outcome,'response_code',p_response_code,
      'provider_id',left(public.phase39_redact(p_provider_id),200),
      'error',nullif(v_error,''),'attempt_no',v_no,'test',true)
    where route_test_id=v.route_test_id;
  return jsonb_build_object('job_id',v.job_id,'status',v_status,'test',true);
end $$;

create or replace function public.deliver_slo_in_app_route_test_phase39(
  p_job_id uuid,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_route_test_jobs%rowtype; v_notification_id text;
begin
  select * into v from public.os_slo_route_test_jobs where job_id=p_job_id for update;
  if not found or not v.is_test or v.adapter<>'in_app_owner' or v.status<>'leased'
     or v.lease_token<>p_lease_token or v.lease_expires_at<=now() then
    raise exception 'In-app route-test lease is not current';
  end if;
  if not public.phase39_owner_authorized(v.owner_id,
      (select entity_id from public.os_slo_route_tests where route_test_id=v.route_test_id)) then
    raise exception 'Route-test owner is no longer eligible';
  end if;
  v_notification_id:='slo-test:'||v.route_test_id;
  insert into public.app_notifications(notification_id,user_id,kind,title,body,href)
  values (v_notification_id,v.owner_id,'slo_route_test',
    'TEST — Shared Services SLO route',
    'This is a delivery-route test. No incident was opened or changed.',
    '/shared-services')
  on conflict (notification_id) do nothing;
  return public.complete_slo_route_test_job_phase39(
    v.job_id,p_lease_token,'delivered',null,v_notification_id,null);
end $$;

alter table public.os_slo_policy_audit enable row level security;
alter table public.os_slo_route_tests enable row level security;
alter table public.os_slo_route_test_jobs enable row level security;
alter table public.os_slo_route_test_attempts enable row level security;
drop policy if exists "os_slo_policy_audit_select" on public.os_slo_policy_audit;
drop policy if exists "os_slo_route_tests_select" on public.os_slo_route_tests;
drop policy if exists "os_slo_route_test_jobs_select" on public.os_slo_route_test_jobs;
drop policy if exists "os_slo_route_test_attempts_select" on public.os_slo_route_test_attempts;
create policy "os_slo_policy_audit_select" on public.os_slo_policy_audit
  for select to authenticated using (public.is_firm_wide_access());
create policy "os_slo_route_tests_select" on public.os_slo_route_tests
  for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_slo_route_test_jobs_select" on public.os_slo_route_test_jobs
  for select to authenticated using (exists (
    select 1 from public.os_slo_route_tests t
    where t.route_test_id=os_slo_route_test_jobs.route_test_id
      and (public.is_firm_wide_access()
        or (t.entity_id is not null and public.can_access_entity(t.entity_id)))
  ));
create policy "os_slo_route_test_attempts_select" on public.os_slo_route_test_attempts
  for select to authenticated using (exists (
    select 1 from public.os_slo_route_test_jobs j
    join public.os_slo_route_tests t on t.route_test_id=j.route_test_id
    where j.job_id=os_slo_route_test_attempts.job_id
      and (public.is_firm_wide_access()
        or (t.entity_id is not null and public.can_access_entity(t.entity_id)))
  ));
grant select on public.os_slo_policy_audit,public.os_slo_route_tests,
  public.os_slo_route_test_jobs,public.os_slo_route_test_attempts to authenticated;
revoke insert,update,delete,truncate on
  public.os_slo_policies,public.os_slo_owners,public.os_slo_policy_audit,
  public.os_slo_delivery_outbox,public.os_slo_delivery_jobs,
  public.os_slo_delivery_attempts,public.os_slo_route_tests,
  public.os_slo_route_test_jobs,public.os_slo_route_test_attempts
  from public,authenticated,service_role;

revoke all on function public.phase39_redact(text) from public,authenticated;
revoke all on function public.validate_phase39_slo_config(text,numeric,numeric,integer,integer,integer,integer,jsonb) from public,authenticated;
revoke all on function public.phase39_actor_authorized(uuid,text,boolean) from public,authenticated;
revoke all on function public.phase39_owner_authorized(uuid,text) from public,authenticated;
revoke all on function public.reassign_slo_alert(uuid,uuid,uuid,text,bigint)
  from public,authenticated;
revoke all on function public.save_slo_policy_draft_phase39(uuid,uuid,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid,text,uuid,bigint) from public,authenticated;
revoke all on function public.validate_slo_policy_draft_phase39(uuid,uuid,bigint) from public,authenticated;
revoke all on function public.publish_slo_policy_draft_phase39(uuid,uuid,bigint) from public,authenticated;
revoke all on function public.request_slo_route_test_phase39(text,text,text,text,uuid,uuid) from public,authenticated;
revoke all on function public.claim_slo_route_test_jobs_phase39(integer,integer) from public,authenticated;
revoke all on function public.complete_slo_route_test_job_phase39(uuid,uuid,text,integer,text,text) from public,authenticated;
revoke all on function public.deliver_slo_in_app_route_test_phase39(uuid,uuid) from public,authenticated;
grant execute on function public.save_slo_policy_draft_phase39(uuid,uuid,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid,text,uuid,bigint),
  public.reassign_slo_alert(uuid,uuid,uuid,text,bigint),
  public.validate_slo_policy_draft_phase39(uuid,uuid,bigint),
  public.publish_slo_policy_draft_phase39(uuid,uuid,bigint),
  public.request_slo_route_test_phase39(text,text,text,text,uuid,uuid),
  public.claim_slo_route_test_jobs_phase39(integer,integer),
  public.complete_slo_route_test_job_phase39(uuid,uuid,text,integer,text,text),
  public.deliver_slo_in_app_route_test_phase39(uuid,uuid) to service_role;

-- Close the Phase 38 bypasses after the governed Phase 39 workflow exists.
revoke execute on function public.publish_slo_policy(text,text,text,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid)
  from public,authenticated,service_role;
revoke execute on function public.set_slo_owner(text,text,text,uuid,uuid,uuid,text)
  from public,authenticated,service_role;
