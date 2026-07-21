-- Phase 38: versioned Shared Services SLO policy, ownership, incident events,
-- and transactional notification delivery.

create table if not exists public.os_slo_policies (
  policy_id uuid primary key default gen_random_uuid(),
  policy_version text not null,
  service text not null,
  metric_key text not null,
  scope text not null default 'entity',
  comparator text not null,
  warning_threshold numeric not null,
  critical_threshold numeric not null,
  window_seconds integer not null,
  evaluation_interval_seconds integer not null default 3600,
  warning_breach_buckets integer not null default 2,
  recovery_buckets integer not null default 2,
  enabled boolean not null default true,
  effective_at timestamptz not null default now(),
  retired_at timestamptz,
  config jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint os_slo_policy_scope_check check (scope in ('entity','firm')),
  constraint os_slo_policy_comparator_check check (comparator in ('higher_bad','lower_bad')),
  constraint os_slo_policy_threshold_check check (
    (comparator='higher_bad' and warning_threshold <= critical_threshold)
    or (comparator='lower_bad' and warning_threshold >= critical_threshold)
  ),
  unique(policy_version,service,metric_key,scope)
);
alter table public.os_slo_policies
  add column if not exists created_by uuid;
create unique index if not exists os_slo_one_active_policy
  on public.os_slo_policies(service,metric_key,scope)
  where enabled and retired_at is null;

insert into public.os_slo_policies (
  policy_version,service,metric_key,scope,comparator,warning_threshold,
  critical_threshold,window_seconds
) select seed.* from (values
  ('phase38-v1','marketing','paid_sync_due_age_seconds','entity','higher_bad',1800,7200,7200),
  ('phase38-v1','marketing','paid_sync_terminal_failures_24h','entity','higher_bad',1,3,86400),
  ('phase38-v1','docusign','send_recovery_due_age_seconds','entity','higher_bad',900,3600,3600),
  ('phase38-v1','docusign','send_manual_review_count','entity','higher_bad',1,3,3600),
  ('phase38-v1','intune','intune_due_action_age_seconds','entity','higher_bad',600,1800,1800),
  ('phase38-v1','intune','intune_platform_failures_1h','entity','higher_bad',1,3,3600),
  ('phase38-v1','snapshot','snapshot_cron_observation_age_seconds','firm','higher_bad',21600,28800,28800),
  ('phase38-v1','snapshot','snapshot_attestation_validity_seconds','firm','lower_bad',1209600,604800,1209600),
  ('phase38-v1','snapshot','snapshot_evidence_integrity','firm','higher_bad',1,1,28800)
) as seed(policy_version,service,metric_key,scope,comparator,
  warning_threshold,critical_threshold,window_seconds)
where not exists (
  select 1 from public.os_slo_policies active
  where active.service=seed.service and active.metric_key=seed.metric_key
    and active.scope=seed.scope and active.enabled and active.retired_at is null
)
on conflict (policy_version,service,metric_key,scope) do nothing;
-- If this migration is replayed after a newer policy was published, never
-- reactivate or compete with it. The seed rows above can only be active when
-- no policy existed yet; retire a late seed in favor of the already-active row.
update public.os_slo_policies seed set enabled=false,retired_at=coalesce(retired_at,now())
where seed.policy_version='phase38-v1' and seed.enabled
  and exists (
    select 1 from public.os_slo_policies newer
    where newer.service=seed.service and newer.metric_key=seed.metric_key
      and newer.scope=seed.scope and newer.enabled and newer.retired_at is null
      and newer.policy_id<>seed.policy_id
  );

create or replace function public.slo_actor_authorized(
  p_actor_id uuid,p_entity_id text,p_firm_wide boolean default false
) returns boolean language sql security definer set search_path=public stable as $$
  select exists (
    select 1 from public.profiles p where p.id=p_actor_id and p.active
      and (
        p.role in ('visionary','admin','service_lead','coo')
        or (not p_firm_wide and p.entity_id is not null
          and p.entity_id=p_entity_id)
      )
  )
$$;

create or replace function public.publish_slo_policy(
  p_policy_version text,p_service text,p_metric_key text,p_scope text,
  p_comparator text,p_warning_threshold numeric,p_critical_threshold numeric,
  p_window_seconds integer,p_evaluation_interval_seconds integer,
  p_warning_breach_buckets integer,p_recovery_buckets integer,
  p_config jsonb,p_actor_id uuid
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.slo_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to publish SLO policy';
  end if;
  if nullif(trim(p_policy_version),'') is null
     or p_scope not in ('entity','firm')
     or p_comparator not in ('higher_bad','lower_bad')
     or p_window_seconds<=0 or p_evaluation_interval_seconds<=0
     or p_warning_breach_buckets<1 or p_recovery_buckets<1 then
    raise exception 'SLO policy configuration is invalid';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'slo-policy:'||p_service||':'||p_metric_key||':'||p_scope,0));
  update public.os_slo_policies set enabled=false,retired_at=now()
  where service=p_service and metric_key=p_metric_key and scope=p_scope
    and enabled and retired_at is null;
  insert into public.os_slo_policies(
    policy_version,service,metric_key,scope,comparator,warning_threshold,
    critical_threshold,window_seconds,evaluation_interval_seconds,
    warning_breach_buckets,recovery_buckets,config,created_by
  ) values (
    trim(p_policy_version),p_service,p_metric_key,p_scope,p_comparator,
    p_warning_threshold,p_critical_threshold,p_window_seconds,
    p_evaluation_interval_seconds,p_warning_breach_buckets,p_recovery_buckets,
    coalesce(p_config,'{}'),p_actor_id
  ) returning policy_id into v_id;
  return v_id;
end $$;

create table if not exists public.os_slo_owners (
  ownership_id uuid primary key default gen_random_uuid(),
  service text not null,
  metric_key text,
  entity_id text references public.entities(entity_id),
  owner_id uuid not null,
  escalation_owner_id uuid,
  active boolean not null default true,
  assigned_by uuid,
  assigned_at timestamptz not null default now(),
  ended_at timestamptz,
  note text
);
alter table public.os_slo_owners
  drop constraint if exists os_slo_owners_owner_fk,
  drop constraint if exists os_slo_owners_escalation_owner_fk,
  drop constraint if exists os_slo_owners_assigned_by_fk;
alter table public.os_slo_owners
  add constraint os_slo_owners_owner_fk foreign key(owner_id)
    references public.profiles(id),
  add constraint os_slo_owners_escalation_owner_fk foreign key(escalation_owner_id)
    references public.profiles(id),
  add constraint os_slo_owners_assigned_by_fk foreign key(assigned_by)
    references public.profiles(id);
create unique index if not exists os_slo_one_active_owner
  on public.os_slo_owners(service,coalesce(metric_key,'*'),coalesce(entity_id,'__firm__'))
  where active;

create or replace function public.set_slo_owner(
  p_service text,p_metric_key text,p_entity_id text,p_owner_id uuid,
  p_escalation_owner_id uuid,p_actor_id uuid,p_note text
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if not public.slo_actor_authorized(p_actor_id,p_entity_id,p_entity_id is null)
     or not public.slo_actor_authorized(
       p_owner_id,p_entity_id,p_entity_id is null)
     or (p_escalation_owner_id is not null
       and not public.slo_actor_authorized(
         p_escalation_owner_id,p_entity_id,p_entity_id is null)) then
    raise exception 'Actor or owner is not authorized and active';
  end if;
  if nullif(trim(p_service),'') is null or p_owner_id is null then
    raise exception 'SLO service and owner are required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('slo-owner:'||p_service||':'||
    coalesce(p_metric_key,'*')||':'||coalesce(p_entity_id,'__firm__'),0));
  update public.os_slo_owners set active=false,ended_at=now()
  where service=p_service and metric_key is not distinct from p_metric_key
    and entity_id is not distinct from p_entity_id and active;
  insert into public.os_slo_owners(
    service,metric_key,entity_id,owner_id,escalation_owner_id,
    assigned_by,note
  ) values (
    p_service,p_metric_key,p_entity_id,p_owner_id,p_escalation_owner_id,
    p_actor_id,nullif(trim(p_note),'')
  ) returning ownership_id into v_id;
  return v_id;
end $$;

alter table public.os_slo_alerts
  add column if not exists owner_id uuid,
  add column if not exists acknowledged_at timestamptz,
  add column if not exists acknowledged_by uuid,
  add column if not exists acknowledgement_note text,
  add column if not exists incident_key text,
  add column if not exists current_policy_version text,
  add column if not exists row_version bigint not null default 0;
update public.os_slo_alerts set incident_key =
  service || ':' || metric_key || ':' || coalesce(entity_id,'__firm__'),
  current_policy_version=coalesce(current_policy_version,policy_version)
where incident_key is null or current_policy_version is null;
alter table public.os_slo_alerts alter column incident_key set not null;
alter table public.os_slo_alerts
  drop constraint if exists os_slo_alerts_owner_fk,
  drop constraint if exists os_slo_alerts_acknowledged_by_fk;
alter table public.os_slo_alerts
  add constraint os_slo_alerts_owner_fk foreign key(owner_id)
    references public.profiles(id),
  add constraint os_slo_alerts_acknowledged_by_fk foreign key(acknowledged_by)
    references public.profiles(id);
drop index if exists public.os_slo_one_open_alert;
create unique index if not exists os_slo_one_open_incident
  on public.os_slo_alerts(service,metric_key,coalesce(entity_id,'__firm__'))
  where status='open';

create table if not exists public.os_slo_alert_events (
  event_id uuid primary key default gen_random_uuid(),
  alert_id uuid not null references public.os_slo_alerts(alert_id),
  event_type text not null,
  actor_id uuid,
  from_status text,
  to_status text,
  from_severity text,
  to_severity text,
  from_owner_id uuid,
  to_owner_id uuid,
  evaluation_id uuid references public.os_slo_evaluations(evaluation_id),
  policy_version text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_slo_alert_event_type_check check (
    event_type in ('opened','escalated','deescalated','acknowledged',
      'reassigned','resolved','same_bucket_reconciled')
  )
);
create index if not exists os_slo_alert_event_timeline
  on public.os_slo_alert_events(alert_id,occurred_at,event_id);

create or replace function public.prevent_append_only_change()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;
drop trigger if exists os_slo_alert_events_append_only on public.os_slo_alert_events;
create trigger os_slo_alert_events_append_only before update or delete
  on public.os_slo_alert_events for each row execute function public.prevent_append_only_change();

create table if not exists public.os_slo_delivery_outbox (
  outbox_id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.os_slo_alert_events(event_id),
  adapter text not null,
  destination_key text not null,
  payload jsonb not null,
  status text not null default 'pending',
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique(event_id,adapter,destination_key),
  constraint os_slo_outbox_adapter_check check (adapter in ('in_app_owner','webhook')),
  constraint os_slo_outbox_status_check check (status in ('pending','enqueued'))
);
create table if not exists public.os_slo_delivery_jobs (
  job_id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null unique references public.os_slo_delivery_outbox(outbox_id),
  adapter text not null,
  destination_key text not null,
  payload jsonb not null,
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_slo_job_status_check check (
    status in ('queued','leased','retry_wait','delivered','failed')
  )
);
create index if not exists os_slo_delivery_due
  on public.os_slo_delivery_jobs(next_attempt_at,created_at)
  where status in ('queued','retry_wait','leased');
create table if not exists public.os_slo_delivery_attempts (
  attempt_id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.os_slo_delivery_jobs(job_id),
  attempt_no integer not null,
  lease_token uuid not null,
  adapter text not null,
  outcome text not null,
  response_code integer,
  provider_id text,
  error_detail text,
  started_at timestamptz not null,
  completed_at timestamptz not null default now(),
  unique(job_id,attempt_no)
);
alter table public.os_slo_delivery_attempts
  add column if not exists provider_id text;

create table if not exists public.os_operational_worker_definitions (
  service text not null,
  worker_name text not null,
  cadence_seconds integer not null,
  stale_after_seconds integer not null,
  enabled boolean not null default true,
  description text,
  updated_at timestamptz not null default now(),
  primary key(service,worker_name)
);
insert into public.os_operational_worker_definitions values
  ('marketing','paid-metrics-worker',600,1200,true,'Process paid metric sync jobs',now()),
  ('docusign','send-recovery-worker',300,900,true,'Recover uncertain DocuSign sends',now()),
  ('intune','intune-action-worker',300,900,true,'Dispatch and verify Intune actions',now()),
  ('shared_services','slo-evaluate',3600,5400,true,'Evaluate active versioned SLO policy',now()),
  ('shared_services','slo-delivery',300,900,true,'Deliver alert event notifications',now()),
  ('snapshot','soak-health',21600,28800,true,'Capture canonical snapshot evidence cycle',now())
on conflict (service,worker_name) do update set
  cadence_seconds=excluded.cadence_seconds,
  stale_after_seconds=excluded.stale_after_seconds,
  description=excluded.description,updated_at=now();

create or replace view public.os_operational_worker_health as
select d.service,d.worker_name,d.cadence_seconds,d.stale_after_seconds,
  r.status as latest_status,r.started_at as latest_started_at,
  r.completed_at as latest_completed_at,
  case when r.started_at is null then true
    else r.started_at < now()-make_interval(secs=>d.stale_after_seconds) end as stale,
  coalesce(r.claimed,0) as claimed,coalesce(r.succeeded,0) as succeeded,
  coalesce(r.failed,0) as failed
from public.os_operational_worker_definitions d
left join lateral (
  select status,started_at,completed_at,claimed,succeeded,failed
  from public.os_operational_worker_runs wr
  where wr.service=d.service and wr.worker_name=d.worker_name
  order by wr.started_at desc limit 1
) r on true
where d.enabled;

create or replace function public.enqueue_slo_alert_event(
  p_alert_id uuid, p_event_type text, p_actor_id uuid,
  p_from_status text, p_to_status text, p_from_severity text,
  p_to_severity text, p_from_owner_id uuid, p_to_owner_id uuid,
  p_evaluation_id uuid, p_policy_version text, p_detail jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_event uuid; v_owner uuid := coalesce(p_to_owner_id,p_from_owner_id);
begin
  insert into public.os_slo_alert_events (
    alert_id,event_type,actor_id,from_status,to_status,from_severity,to_severity,
    from_owner_id,to_owner_id,evaluation_id,policy_version,detail
  ) values (
    p_alert_id,p_event_type,p_actor_id,p_from_status,p_to_status,
    p_from_severity,p_to_severity,p_from_owner_id,p_to_owner_id,
    p_evaluation_id,p_policy_version,coalesce(p_detail,'{}')
  ) returning event_id into v_event;
  if v_owner is not null then
    insert into public.os_slo_delivery_outbox(event_id,adapter,destination_key,payload)
    values (v_event,'in_app_owner',v_owner::text,
      jsonb_build_object('alert_id',p_alert_id,'event_id',v_event,
        'event_type',p_event_type,'owner_id',v_owner,'detail',coalesce(p_detail,'{}')))
    on conflict do nothing;
  end if;
  insert into public.os_slo_delivery_outbox(event_id,adapter,destination_key,payload)
  select v_event,'webhook',key,
    jsonb_build_object('alert_id',p_alert_id,'event_id',v_event,
      'event_type',p_event_type,'destination_env',value,
      'detail',coalesce(p_detail,'{}'))
  from jsonb_each_text(coalesce(p_detail->'webhook_destinations','{}'::jsonb))
  on conflict do nothing;
  insert into public.os_slo_delivery_jobs(outbox_id,adapter,destination_key,payload)
  select outbox_id,adapter,destination_key,payload
  from public.os_slo_delivery_outbox where event_id=v_event
  on conflict (outbox_id) do nothing;
  update public.os_slo_delivery_outbox set status='enqueued'
  where event_id=v_event and status='pending';
  return v_event;
end $$;

create or replace function public.acknowledge_slo_alert(
  p_alert_id uuid,p_actor_id uuid,p_note text,p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_alerts%rowtype;
begin
  select * into v from public.os_slo_alerts where alert_id=p_alert_id for update;
  if not found or v.status<>'open' or v.row_version<>p_expected_row_version then
    raise exception 'Alert is closed or changed';
  end if;
  if not exists (select 1 from public.profiles where id=p_actor_id and active)
     or not (v.owner_id=p_actor_id
       or public.slo_actor_authorized(p_actor_id,v.entity_id,v.entity_id is null)) then
    raise exception 'Only the assigned owner or an authorized writer may acknowledge';
  end if;
  update public.os_slo_alerts set acknowledged_at=now(),acknowledged_by=p_actor_id,
    acknowledgement_note=nullif(trim(p_note),''),row_version=row_version+1,
    updated_at=now() where alert_id=p_alert_id;
  perform public.enqueue_slo_alert_event(p_alert_id,'acknowledged',p_actor_id,
    'open','open',v.severity,v.severity,v.owner_id,v.owner_id,
    v.latest_evaluation_id,v.policy_version,jsonb_build_object('note',p_note));
  return jsonb_build_object('alert_id',p_alert_id,'row_version',v.row_version+1);
end $$;

create or replace function public.reassign_slo_alert(
  p_alert_id uuid,p_actor_id uuid,p_owner_id uuid,p_note text,
  p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_alerts%rowtype;
begin
  select * into v from public.os_slo_alerts where alert_id=p_alert_id for update;
  if not found or v.status<>'open' or v.row_version<>p_expected_row_version
     or p_owner_id is null then raise exception 'Alert is closed, changed, or owner invalid'; end if;
  if not public.slo_actor_authorized(p_actor_id,v.entity_id,v.entity_id is null)
     or not public.slo_actor_authorized(
       p_owner_id,v.entity_id,v.entity_id is null) then
    raise exception 'Actor is unauthorized or new owner is inactive';
  end if;
  update public.os_slo_alerts set owner_id=p_owner_id,row_version=row_version+1,
    updated_at=now() where alert_id=p_alert_id;
  perform public.enqueue_slo_alert_event(p_alert_id,'reassigned',p_actor_id,
    'open','open',v.severity,v.severity,v.owner_id,p_owner_id,
    v.latest_evaluation_id,v.policy_version,jsonb_build_object('note',p_note));
  return jsonb_build_object('alert_id',p_alert_id,'row_version',v.row_version+1);
end $$;

create or replace function public.claim_slo_delivery_jobs(
  p_limit integer,p_lease_seconds integer
) returns setof public.os_slo_delivery_jobs
language plpgsql security definer set search_path=public as $$
begin
  return query
  with due as (
    select job_id from public.os_slo_delivery_jobs
    where (status in ('queued','retry_wait') and next_attempt_at<=now())
       or (status='leased' and lease_expires_at<=now())
    order by next_attempt_at,created_at for update skip locked
    limit least(greatest(p_limit,1),100)
  )
  update public.os_slo_delivery_jobs j set status='leased',
    lease_token=gen_random_uuid(),lease_expires_at=now()+
      make_interval(secs=>least(greatest(p_lease_seconds,30),900)),
    updated_at=now()
  from due where j.job_id=due.job_id returning j.*;
end $$;

create or replace function public.complete_slo_delivery_job(
  p_job_id uuid,p_lease_token uuid,p_outcome text,p_response_code integer,
  p_error_detail text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_delivery_jobs%rowtype; v_no integer; v_terminal boolean;
begin
  select * into v from public.os_slo_delivery_jobs where job_id=p_job_id for update;
  if not found or v.status<>'leased' or v.lease_token<>p_lease_token
     or v.lease_expires_at<=now() then raise exception 'Delivery lease is not current'; end if;
  v_no:=v.attempt_count+1;
  v_terminal:=p_outcome='delivered' or v_no>=v.max_attempts;
  insert into public.os_slo_delivery_attempts(
    job_id,attempt_no,lease_token,adapter,outcome,response_code,provider_id,
    error_detail,started_at
  ) values (p_job_id,v_no,p_lease_token,v.adapter,p_outcome,p_response_code,
    v.destination_key,left(p_error_detail,1000),v.updated_at);
  update public.os_slo_delivery_jobs set attempt_count=v_no,
    status=case when p_outcome='delivered' then 'delivered'
      when v_terminal then 'failed' else 'retry_wait' end,
    delivered_at=case when p_outcome='delivered' then now() end,
    next_attempt_at=case when not v_terminal
      then now()+make_interval(secs=>least(3600,30*(2^least(v_no,7))::integer)) end,
    lease_token=null,lease_expires_at=null,last_error=left(p_error_detail,1000),
    updated_at=now() where job_id=p_job_id;
  return jsonb_build_object('job_id',p_job_id,'attempt_no',v_no,
    'status',case when p_outcome='delivered' then 'delivered'
      when v_terminal then 'failed' else 'retry_wait' end);
end $$;

create or replace function public.deliver_slo_in_app_job(
  p_job_id uuid,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_delivery_jobs%rowtype; v_no integer; v_notification_id text;
begin
  select * into v from public.os_slo_delivery_jobs where job_id=p_job_id for update;
  if not found or v.status<>'leased' or v.lease_token<>p_lease_token
     or v.lease_expires_at<=now() or v.adapter<>'in_app_owner' then
    raise exception 'In-app delivery lease is not current';
  end if;
  if not exists (select 1 from public.profiles
    where id=v.destination_key::uuid and active) then
    raise exception 'In-app destination owner is inactive';
  end if;
  v_notification_id:='slo:'||(v.payload->>'event_id');
  insert into public.app_notifications(
    notification_id,user_id,kind,title,body,href
  ) values (
    v_notification_id,v.destination_key::uuid,'slo_alert',
    'Shared Services SLO '||coalesce(v.payload->>'event_type','updated'),
    'Alert '||coalesce(v.payload->>'alert_id','unknown')||' requires attention',
    '/shared-services'
  ) on conflict (notification_id) do nothing;
  v_no:=v.attempt_count+1;
  insert into public.os_slo_delivery_attempts(
    job_id,attempt_no,lease_token,adapter,outcome,provider_id,started_at
  ) values (
    v.job_id,v_no,p_lease_token,v.adapter,'delivered',v_notification_id,v.updated_at
  );
  update public.os_slo_delivery_jobs set status='delivered',attempt_count=v_no,
    delivered_at=now(),lease_token=null,lease_expires_at=null,last_error=null,
    updated_at=now() where job_id=v.job_id;
  return jsonb_build_object('job_id',v.job_id,'status','delivered',
    'provider','app_notifications','provider_id',v_notification_id);
end $$;

alter table public.os_slo_policies enable row level security;
alter table public.os_slo_owners enable row level security;
alter table public.os_slo_alert_events enable row level security;
alter table public.os_slo_delivery_outbox enable row level security;
alter table public.os_slo_delivery_jobs enable row level security;
alter table public.os_slo_delivery_attempts enable row level security;
alter table public.os_operational_worker_definitions enable row level security;
drop policy if exists "os_slo_policy_select" on public.os_slo_policies;
drop policy if exists "os_slo_owner_select" on public.os_slo_owners;
drop policy if exists "os_slo_event_select" on public.os_slo_alert_events;
drop policy if exists "os_slo_delivery_job_select" on public.os_slo_delivery_jobs;
drop policy if exists "os_slo_delivery_attempt_select" on public.os_slo_delivery_attempts;
drop policy if exists "os_worker_definition_select" on public.os_operational_worker_definitions;
create policy "os_slo_policy_select" on public.os_slo_policies
  for select to authenticated using (public.is_firm_wide_access());
create policy "os_slo_owner_select" on public.os_slo_owners
  for select to authenticated using (
    public.is_firm_wide_access() or (entity_id is not null and public.can_access_entity(entity_id)));
create policy "os_slo_event_select" on public.os_slo_alert_events
  for select to authenticated using (exists (
    select 1 from public.os_slo_alerts a where a.alert_id=os_slo_alert_events.alert_id
      and (public.is_firm_wide_access()
        or (a.entity_id is not null and public.can_access_entity(a.entity_id)))));
create policy "os_slo_delivery_job_select" on public.os_slo_delivery_jobs
  for select to authenticated using (public.is_firm_wide_access());
create policy "os_slo_delivery_attempt_select" on public.os_slo_delivery_attempts
  for select to authenticated using (public.is_firm_wide_access());
create policy "os_worker_definition_select" on public.os_operational_worker_definitions
  for select to authenticated using (public.is_firm_wide_access());
grant select on public.os_slo_policies,public.os_slo_owners,
  public.os_slo_alert_events,public.os_slo_delivery_jobs,
  public.os_slo_delivery_attempts,public.os_operational_worker_definitions
  to authenticated;
grant select on public.os_operational_worker_health to authenticated;
revoke all on function public.enqueue_slo_alert_event(uuid,text,uuid,text,text,text,text,uuid,uuid,uuid,text,jsonb) from public,authenticated;
revoke all on function public.publish_slo_policy(text,text,text,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid) from public,authenticated;
revoke all on function public.set_slo_owner(text,text,text,uuid,uuid,uuid,text) from public,authenticated;
revoke all on function public.acknowledge_slo_alert(uuid,uuid,text,bigint) from public,authenticated;
revoke all on function public.reassign_slo_alert(uuid,uuid,uuid,text,bigint) from public,authenticated;
revoke all on function public.claim_slo_delivery_jobs(integer,integer) from public,authenticated;
revoke all on function public.complete_slo_delivery_job(uuid,uuid,text,integer,text) from public,authenticated;
revoke all on function public.deliver_slo_in_app_job(uuid,uuid) from public,authenticated;
grant execute on function public.acknowledge_slo_alert(uuid,uuid,text,bigint),
  public.reassign_slo_alert(uuid,uuid,uuid,text,bigint),
  public.claim_slo_delivery_jobs(integer,integer),
  public.complete_slo_delivery_job(uuid,uuid,text,integer,text),
  public.deliver_slo_in_app_job(uuid,uuid),
  public.publish_slo_policy(text,text,text,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid),
  public.set_slo_owner(text,text,text,uuid,uuid,uuid,text) to service_role;

-- Reconcile the observations collected by the Phase 37 evaluator against the
-- active Phase 38 policy. This is deliberately separate from metric collection:
-- policy revision never forks an open incident, and same-bucket changes are
-- reconciled without incrementing occurrence/consecutive counters twice.
create or replace function public.reconcile_phase38_slo_alerts(
  p_evaluation_bucket timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v record; v_eval public.os_slo_evaluations%rowtype;
  v_alert public.os_slo_alerts%rowtype; v_old_severity text;
  v_previous_severity text;
  v_is_new boolean; v_severity text; v_owner uuid; v_transition text;
  v_snapshot_value numeric; v_snapshot_detail jsonb;
  v_transitions jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('phase38-slo-reconcile',0));
  for v in
    select source.*,p.policy_id,p.policy_version as active_policy_version,
      p.comparator as active_comparator,p.warning_threshold as active_warning,
      p.critical_threshold as active_critical,p.window_seconds as active_window,
      p.warning_breach_buckets,p.recovery_buckets,
      p.config as active_policy_config
    from public.os_slo_evaluations source
    join public.os_slo_policies p on p.service=source.service
      and p.metric_key=source.metric_key
      and p.scope=case when source.entity_id is null then 'firm' else 'entity' end
      and p.enabled and p.retired_at is null and p.effective_at<=source.evaluated_at
    where source.evaluation_bucket=p_evaluation_bucket
      and source.policy_version='phase37-v1'
  loop
    if v.service='snapshot' and to_regclass('public.os_snapshot_evidence_cycles') is not null
       and v.metric_key in ('snapshot_cron_observation_age_seconds',
         'snapshot_evidence_integrity') then
      execute 'select metric_value,detail from public.phase38_latest_snapshot_metric($1,$2)'
        into v_snapshot_value,v_snapshot_detail using v.metric_key,v.evaluated_at;
      v.observed_value:=coalesce(v_snapshot_value,
        case when v.metric_key='snapshot_evidence_integrity' then 1 else 999999 end);
      v.detail:=v.detail||coalesce(v_snapshot_detail,'{}'::jsonb);
    end if;
    v.detail:=v.detail||jsonb_build_object('webhook_destinations',
      coalesce(v.active_policy_config->'webhook_destinations','{}'::jsonb));
    v_severity:=case
      when v.observed_value is null then 'unknown'
      when v.active_comparator='higher_bad' and v.observed_value>=v.active_critical then 'critical'
      when v.active_comparator='higher_bad' and v.observed_value>=v.active_warning then 'warning'
      when v.active_comparator='lower_bad' and v.observed_value<=v.active_critical then 'critical'
      when v.active_comparator='lower_bad' and v.observed_value<=v.active_warning then 'warning'
      else 'healthy' end;
    select severity into v_old_severity from public.os_slo_evaluations
    where evaluation_bucket=p_evaluation_bucket
      and policy_version=v.active_policy_version and service=v.service
      and metric_key=v.metric_key and entity_id is not distinct from v.entity_id;
    v_is_new:=not found;
    select severity into v_previous_severity from public.os_slo_evaluations
    where service=v.service and metric_key=v.metric_key
      and entity_id is not distinct from v.entity_id
      and policy_version=v.active_policy_version
      and evaluation_bucket<p_evaluation_bucket
    order by evaluation_bucket desc limit 1;
    insert into public.os_slo_evaluations(
      evaluation_bucket,policy_version,service,metric_key,entity_id,severity,
      observed_value,warning_threshold,critical_threshold,comparator,
      window_seconds,sample_count,detail,evaluated_at
    ) values (
      p_evaluation_bucket,v.active_policy_version,v.service,v.metric_key,v.entity_id,
      v_severity,v.observed_value,v.active_warning,v.active_critical,
      v.active_comparator,v.active_window,v.sample_count,
      v.detail||jsonb_build_object('policy_id',v.policy_id),v.evaluated_at
    ) on conflict (
      evaluation_bucket,policy_version,service,metric_key,
      (coalesce(entity_id,'__firm__'))
    ) do nothing;
    select * into v_eval from public.os_slo_evaluations
    where evaluation_bucket=p_evaluation_bucket
      and policy_version=v.active_policy_version and service=v.service
      and metric_key=v.metric_key and entity_id is not distinct from v.entity_id;
    select * into v_alert from public.os_slo_alerts
    where service=v.service and metric_key=v.metric_key
      and entity_id is not distinct from v.entity_id
      and (status='open' or latest_evaluation_id=v.evaluation_id)
    order by (status='open') desc,updated_at desc limit 1 for update;
    select o.owner_id into v_owner from public.os_slo_owners o
    where o.service=v.service and o.active
      and (o.metric_key=v.metric_key or o.metric_key is null)
      and (o.entity_id is not distinct from v.entity_id or o.entity_id is null)
    order by (o.metric_key is not null) desc,(o.entity_id is not null) desc,
      o.assigned_at desc limit 1;

    if v_alert.alert_id is null and v_severity in ('warning','critical') and (
      v_severity='critical' or (
        select count(*)>=v.warning_breach_buckets from (
          select e.evaluation_bucket from public.os_slo_evaluations e
          where e.service=v.service and e.metric_key=v.metric_key
            and e.entity_id is not distinct from v.entity_id
            and e.policy_version=v.active_policy_version
            and e.severity in ('warning','critical')
          order by e.evaluation_bucket desc limit v.warning_breach_buckets
        ) q
      )
    ) then
      insert into public.os_slo_alerts(
        service,metric_key,entity_id,policy_version,status,severity,
        first_breached_at,last_breached_at,latest_evaluation_id,detail,
        owner_id,incident_key,current_policy_version
      ) values (
        v.service,v.metric_key,v.entity_id,v.active_policy_version,'open',v_severity,
        v.evaluated_at,v.evaluated_at,v_eval.evaluation_id,v.detail,v_owner,
        v.service||':'||v.metric_key||':'||coalesce(v.entity_id,'__firm__'),
        v.active_policy_version
      ) returning * into v_alert;
      perform public.enqueue_slo_alert_event(v_alert.alert_id,'opened',null,null,
        'open',null,v_severity,null,v_owner,v_eval.evaluation_id,
        v.active_policy_version,v.detail);
      v_transition:='opened';
    elsif v_alert.alert_id is not null and v_alert.status='open'
      and v_severity in ('warning','critical') then
      v_transition:=case
        when v_alert.current_policy_version is null then 'opened'
        when coalesce(v_old_severity,v_previous_severity)='warning'
          and v_severity='critical' then 'escalated'
        when coalesce(v_old_severity,v_previous_severity)='critical'
          and v_severity='warning' then 'deescalated'
        when not v_is_new and v_old_severity is distinct from v_severity
          then 'same_bucket_reconciled' end;
      update public.os_slo_alerts set severity=v_severity,
        current_policy_version=v.active_policy_version,last_breached_at=v.evaluated_at,
        consecutive_healthy=0,
        latest_evaluation_id=v_eval.evaluation_id,detail=v.detail,
        owner_id=coalesce(owner_id,v_owner),row_version=row_version+1,updated_at=now()
      where alert_id=v_alert.alert_id;
      if v_transition is not null then
        perform public.enqueue_slo_alert_event(v_alert.alert_id,v_transition,null,
          case when v_transition='opened' then null else 'open' end,'open',
          case when v_transition='opened' then null else v_alert.severity end,
          v_severity,v_alert.owner_id,
          coalesce(v_alert.owner_id,v_owner),v_eval.evaluation_id,
          v.active_policy_version,v.detail);
      end if;
    elsif v_alert.alert_id is not null and v_severity='healthy'
      and v_alert.status='open' then
      if not v_is_new and v_old_severity in ('warning','critical') then
        update public.os_slo_alerts set
          current_policy_version=v.active_policy_version,
          latest_evaluation_id=v_eval.evaluation_id,detail=v.detail,
          row_version=row_version+1,updated_at=now()
        where alert_id=v_alert.alert_id;
        perform public.enqueue_slo_alert_event(v_alert.alert_id,
          'same_bucket_reconciled',null,'open','open',v_alert.severity,
          v_alert.severity,v_alert.owner_id,v_alert.owner_id,
          v_eval.evaluation_id,v.active_policy_version,
          v.detail||jsonb_build_object('latest_evaluation_severity','healthy',
            'recovery_counted',false));
        v_transition:='same_bucket_reconciled';
      elsif v_alert.consecutive_healthy>=v.recovery_buckets then
        update public.os_slo_alerts set status='resolved',resolved_at=v.evaluated_at,
          latest_evaluation_id=v_eval.evaluation_id,current_policy_version=v.active_policy_version,
          row_version=row_version+1,updated_at=now() where alert_id=v_alert.alert_id;
        perform public.enqueue_slo_alert_event(v_alert.alert_id,'resolved',null,
          'open','resolved',v_alert.severity,'healthy',v_alert.owner_id,
          v_alert.owner_id,v_eval.evaluation_id,v.active_policy_version,v.detail);
        v_transition:='resolved';
      end if;
    elsif v_alert.alert_id is not null and v_alert.status='resolved'
      and v_severity='healthy' and not exists (
        select 1 from public.os_slo_alert_events e
        where e.alert_id=v_alert.alert_id and e.event_type='resolved'
          and e.evaluation_id=v_eval.evaluation_id
      ) then
      update public.os_slo_alerts set current_policy_version=v.active_policy_version,
        latest_evaluation_id=v_eval.evaluation_id,row_version=row_version+1,
        updated_at=now() where alert_id=v_alert.alert_id;
      perform public.enqueue_slo_alert_event(v_alert.alert_id,'resolved',null,
        'open','resolved',v_previous_severity,'healthy',v_alert.owner_id,
        v_alert.owner_id,v_eval.evaluation_id,v.active_policy_version,v.detail);
      v_transition:='resolved';
    end if;
    if v_transition is not null then
      v_transitions:=v_transitions||jsonb_build_array(jsonb_build_object(
        'alert_id',v_alert.alert_id,'transition',v_transition,'service',v.service,
        'metric_key',v.metric_key,'severity',v_severity,'entity_id',v.entity_id));
    end if;
    v_transition:=null; v_alert:=null; v_old_severity:=null;
    v_previous_severity:=null;
  end loop;
  return jsonb_build_object('policy_version','phase38-v1',
    'evaluation_bucket',p_evaluation_bucket,'transitions',v_transitions);
end $$;
revoke all on function public.reconcile_phase38_slo_alerts(timestamptz)
  from public,authenticated;
grant execute on function public.reconcile_phase38_slo_alerts(timestamptz)
  to service_role;
drop function if exists public.reconcile_phase38_slo_alerts(timestamptz);

-- Authoritative Phase 38 evaluator. Metric collection and policy-driven state
-- transitions share one transaction; no Phase 37 evaluator is invoked.
create or replace function public.evaluate_shared_service_slos_phase38(
  p_evaluated_at timestamptz default now()
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v record; v_eval public.os_slo_evaluations%rowtype;
  v_alert public.os_slo_alerts%rowtype;
  v_bucket timestamptz; v_severity text; v_owner uuid;
  v_transition text; v_inserted integer; v_contiguous boolean;
  v_next_healthy integer; v_snapshot_value numeric; v_snapshot_detail jsonb;
  v_transitions jsonb:='[]'::jsonb; v_evaluations integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('phase38-slo-evaluator',0));
  create temporary table tmp_phase38_metrics(
    service text,metric_key text,entity_id text,observed_value numeric,
    sample_count integer,detail jsonb
  ) on commit drop;

  insert into tmp_phase38_metrics
  select 'marketing','paid_sync_due_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at-
      coalesce(r.next_attempt_at,r.lease_expires_at,r.queued_at)))),0),
    count(r.run_id),jsonb_build_object('due_runs',count(r.run_id))
  from (select distinct entity_id from public.os_marketing_social_accounts
    where account_type='paid_ads' and entity_id is not null) entities
  left join public.os_marketing_paid_sync_runs r on r.entity_id=entities.entity_id
    and (r.status='queued'
      or (r.status='retry_wait' and r.next_attempt_at<=p_evaluated_at)
      or (r.status='leased' and r.lease_expires_at<=p_evaluated_at))
  group by entities.entity_id;
  insert into tmp_phase38_metrics
  select 'marketing','paid_sync_terminal_failures_24h',entities.entity_id,
    count(r.run_id),count(r.run_id),
    jsonb_build_object('terminal_failures',count(r.run_id))
  from (select distinct entity_id from public.os_marketing_social_accounts
    where account_type='paid_ads' and entity_id is not null) entities
  left join public.os_marketing_paid_sync_runs r on r.entity_id=entities.entity_id
    and r.status='failed' and r.updated_at>=p_evaluated_at-interval '24 hours'
  group by entities.entity_id;
  insert into tmp_phase38_metrics
  select 'docusign','send_recovery_due_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at-
      coalesce(i.next_recovery_at,i.lease_expires_at,i.requested_at)))),0),
    count(i.intent_id),jsonb_build_object('due_intents',count(i.intent_id))
  from (select distinct entity_id from public.os_docusign_send_intents
    where entity_id is not null) entities
  left join public.os_docusign_send_intents i on i.entity_id=entities.entity_id
    and (i.state='provider_unknown'
      or (i.state='retry_wait' and i.next_recovery_at<=p_evaluated_at)
      or (i.state='recovering' and i.lease_expires_at<=p_evaluated_at))
  group by entities.entity_id;
  insert into tmp_phase38_metrics
  select 'docusign','send_manual_review_count',entities.entity_id,
    count(i.intent_id),count(i.intent_id),
    jsonb_build_object('manual_review_count',count(i.intent_id))
  from (select distinct entity_id from public.os_docusign_send_intents
    where entity_id is not null) entities
  left join public.os_docusign_send_intents i on i.entity_id=entities.entity_id
    and i.state='manual_review' group by entities.entity_id;
  insert into tmp_phase38_metrics
  select 'intune','intune_due_action_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at-
      coalesce(a.next_poll_at,a.approved_at,a.requested_at)))),0),
    count(a.action_id),jsonb_build_object('due_actions',count(a.action_id))
  from (select distinct entity_id from public.os_it_intune_actions
    where entity_id is not null) entities
  left join public.os_it_intune_actions a on a.entity_id=entities.entity_id
    and a.status in ('approved','preflighting','dispatch_authorized','submitted','verifying')
    and (a.next_poll_at is null or a.next_poll_at<=p_evaluated_at)
  group by entities.entity_id;
  insert into tmp_phase38_metrics
  select 'intune','intune_platform_failures_1h',entities.entity_id,
    count(a.action_id),count(a.action_id),
    jsonb_build_object('platform_failures',count(a.action_id))
  from (select distinct entity_id from public.os_it_intune_actions
    where entity_id is not null) entities
  left join public.os_it_intune_actions a on a.entity_id=entities.entity_id
    and a.last_error_class='platform'
    and a.updated_at>=p_evaluated_at-interval '1 hour'
  group by entities.entity_id;
  insert into tmp_phase38_metrics values
    ('snapshot','snapshot_cron_observation_age_seconds',null,999999,0,'{}'),
    ('snapshot','snapshot_attestation_validity_seconds',null,
      coalesce((select max(extract(epoch from(valid_until-p_evaluated_at)))
        from public.os_snapshot_rollback_rehearsals
        where status='attested' and valid_until>p_evaluated_at),0),
      (select count(*) from public.os_snapshot_rollback_rehearsals
        where status='attested' and valid_until>p_evaluated_at),'{}'),
    ('snapshot','snapshot_evidence_integrity',null,1,1,'{}');

  for v in
    select m.*,p.policy_id,p.policy_version,p.comparator,p.warning_threshold,
      p.critical_threshold,p.window_seconds,p.evaluation_interval_seconds,
      p.warning_breach_buckets,p.recovery_buckets,p.config
    from tmp_phase38_metrics m join public.os_slo_policies p
      on p.service=m.service and p.metric_key=m.metric_key
      and p.scope=case when m.entity_id is null then 'firm' else 'entity' end
      and p.enabled and p.retired_at is null and p.effective_at<=p_evaluated_at
  loop
    if v.metric_key='paid_sync_terminal_failures_24h' then
      select count(*),count(*) into v.observed_value,v.sample_count
      from public.os_marketing_paid_sync_runs r
      where r.entity_id=v.entity_id and r.status='failed'
        and r.updated_at>=p_evaluated_at-
          make_interval(secs=>v.window_seconds);
      v.detail:=jsonb_build_object('terminal_failures',v.observed_value,
        'window_seconds',v.window_seconds);
    elsif v.metric_key='intune_platform_failures_1h' then
      select count(*),count(*) into v.observed_value,v.sample_count
      from public.os_it_intune_actions a
      where a.entity_id=v.entity_id and a.last_error_class='platform'
        and a.updated_at>=p_evaluated_at-
          make_interval(secs=>v.window_seconds);
      v.detail:=jsonb_build_object('platform_failures',v.observed_value,
        'window_seconds',v.window_seconds);
    end if;
    if v.service='snapshot'
       and v.metric_key in ('snapshot_cron_observation_age_seconds',
         'snapshot_evidence_integrity')
       and to_regclass('public.os_snapshot_evidence_cycles') is not null then
      execute 'select metric_value,detail from public.phase38_latest_snapshot_metric($1,$2)'
        into v_snapshot_value,v_snapshot_detail using v.metric_key,p_evaluated_at;
      v.observed_value:=coalesce(v_snapshot_value,
        case when v.metric_key='snapshot_evidence_integrity' then 1 else 999999 end);
      v.detail:=v.detail||coalesce(v_snapshot_detail,'{}');
    end if;
    v.detail:=v.detail||jsonb_build_object('policy_id',v.policy_id,
      'webhook_destinations',coalesce(v.config->'webhook_destinations','{}'));
    v_severity:=case
      when v.observed_value is null then 'unknown'
      when v.comparator='higher_bad' and v.observed_value>=v.critical_threshold then 'critical'
      when v.comparator='higher_bad' and v.observed_value>=v.warning_threshold then 'warning'
      when v.comparator='lower_bad' and v.observed_value<=v.critical_threshold then 'critical'
      when v.comparator='lower_bad' and v.observed_value<=v.warning_threshold then 'warning'
      else 'healthy' end;
    v_bucket:=date_bin(make_interval(secs=>v.evaluation_interval_seconds),
      p_evaluated_at,timestamptz '2000-01-01 00:00:00+00');
    insert into public.os_slo_evaluations(
      evaluation_bucket,policy_version,service,metric_key,entity_id,severity,
      observed_value,warning_threshold,critical_threshold,comparator,
      window_seconds,sample_count,detail,evaluated_at
    ) values (
      v_bucket,v.policy_version,v.service,v.metric_key,v.entity_id,v_severity,
      v.observed_value,v.warning_threshold,v.critical_threshold,v.comparator,
      v.window_seconds,v.sample_count,v.detail,p_evaluated_at
    ) on conflict (
      evaluation_bucket,policy_version,service,metric_key,
      (coalesce(entity_id,'__firm__'))
    ) do nothing;
    get diagnostics v_inserted=row_count;
    select * into v_eval from public.os_slo_evaluations
    where evaluation_bucket=v_bucket and policy_version=v.policy_version
      and service=v.service and metric_key=v.metric_key
      and entity_id is not distinct from v.entity_id;
    if v_inserted=0 then continue; end if;
    v_evaluations:=v_evaluations+1;
    select * into v_alert from public.os_slo_alerts
    where service=v.service and metric_key=v.metric_key
      and entity_id is not distinct from v.entity_id and status='open' for update;
    select o.owner_id into v_owner from public.os_slo_owners o
    join public.profiles profile on profile.id=o.owner_id and profile.active
    where o.service=v.service and o.active
      and (o.metric_key=v.metric_key or o.metric_key is null)
      and (o.entity_id is not distinct from v.entity_id or o.entity_id is null)
    order by (o.metric_key is not null) desc,(o.entity_id is not null) desc,
      o.assigned_at desc limit 1;
    if v_severity in ('warning','critical') then
      select count(*)=v.warning_breach_buckets
        and min(evaluation_bucket)=v_bucket-
          make_interval(secs=>v.evaluation_interval_seconds*
            (v.warning_breach_buckets-1))
        and max(evaluation_bucket)=v_bucket
      into v_contiguous from (
        select evaluation_bucket from public.os_slo_evaluations e
        where e.service=v.service and e.metric_key=v.metric_key
          and e.entity_id is not distinct from v.entity_id
          and e.policy_version=v.policy_version
          and e.severity in ('warning','critical')
        order by evaluation_bucket desc limit v.warning_breach_buckets
      ) recent;
      if v_alert.alert_id is null
         and (v_severity='critical' or v_contiguous) then
        insert into public.os_slo_alerts(
          service,metric_key,entity_id,policy_version,current_policy_version,
          status,severity,first_breached_at,last_breached_at,
          consecutive_breaches,consecutive_healthy,occurrence_count,
          latest_evaluation_id,detail,owner_id,incident_key
        ) values (
          v.service,v.metric_key,v.entity_id,v.policy_version,v.policy_version,
          'open',v_severity,p_evaluated_at,p_evaluated_at,
          case when v_severity='critical' then 1 else v.warning_breach_buckets end,
          0,1,v_eval.evaluation_id,v.detail,v_owner,
          v.service||':'||v.metric_key||':'||coalesce(v.entity_id,'__firm__')
        ) returning * into v_alert;
        perform public.enqueue_slo_alert_event(v_alert.alert_id,'opened',null,
          null,'open',null,v_severity,null,v_owner,v_eval.evaluation_id,
          v.policy_version,v.detail);
        v_transition:='opened';
      elsif v_alert.alert_id is not null then
        v_transition:=case
          when v_alert.severity='warning' and v_severity='critical' then 'escalated'
          when v_alert.severity='critical' and v_severity='warning' then 'deescalated'
        end;
        update public.os_slo_alerts set severity=v_severity,
          current_policy_version=v.policy_version,last_breached_at=p_evaluated_at,
          consecutive_breaches=consecutive_breaches+1,consecutive_healthy=0,
          occurrence_count=occurrence_count+1,
          latest_evaluation_id=v_eval.evaluation_id,detail=v.detail,
          owner_id=coalesce(owner_id,v_owner),row_version=row_version+1,
          updated_at=now() where alert_id=v_alert.alert_id;
        if v_transition is not null then
          perform public.enqueue_slo_alert_event(v_alert.alert_id,v_transition,null,
            'open','open',v_alert.severity,v_severity,v_alert.owner_id,
            coalesce(v_alert.owner_id,v_owner),v_eval.evaluation_id,
            v.policy_version,v.detail);
        end if;
      end if;
    elsif v_alert.alert_id is not null and v_severity='healthy' then
      v_next_healthy:=v_alert.consecutive_healthy+1;
      if v_next_healthy>=v.recovery_buckets then
        update public.os_slo_alerts set status='resolved',resolved_at=p_evaluated_at,
          consecutive_healthy=v_next_healthy,consecutive_breaches=0,
          current_policy_version=v.policy_version,
          latest_evaluation_id=v_eval.evaluation_id,row_version=row_version+1,
          updated_at=now() where alert_id=v_alert.alert_id;
        perform public.enqueue_slo_alert_event(v_alert.alert_id,'resolved',null,
          'open','resolved',v_alert.severity,'healthy',v_alert.owner_id,
          v_alert.owner_id,v_eval.evaluation_id,v.policy_version,v.detail);
        v_transition:='resolved';
      else
        update public.os_slo_alerts set consecutive_healthy=v_next_healthy,
          consecutive_breaches=0,current_policy_version=v.policy_version,
          latest_evaluation_id=v_eval.evaluation_id,row_version=row_version+1,
          updated_at=now() where alert_id=v_alert.alert_id;
      end if;
    elsif v_alert.alert_id is not null then
      update public.os_slo_alerts set consecutive_healthy=0,
        consecutive_breaches=0,current_policy_version=v.policy_version,
        latest_evaluation_id=v_eval.evaluation_id,row_version=row_version+1,
        updated_at=now() where alert_id=v_alert.alert_id;
    end if;
    if v_transition is not null then
      v_transitions:=v_transitions||jsonb_build_array(jsonb_build_object(
        'alert_id',v_alert.alert_id,'transition',v_transition,
        'service',v.service,'metric_key',v.metric_key,'severity',v_severity,
        'entity_id',v.entity_id));
    end if;
    v_alert:=null;v_owner:=null;v_transition:=null;
  end loop;
  return jsonb_build_object('policy_version','phase38-active',
    'evaluated_at',p_evaluated_at,
    'evaluation_bucket',date_bin(interval '1 hour',p_evaluated_at,
      timestamptz '2000-01-01 00:00:00+00'),
    'evaluations',v_evaluations,
    'transitions',v_transitions);
end $$;
revoke all on function public.evaluate_shared_service_slos_phase38(timestamptz)
  from public,authenticated;
revoke execute on function public.evaluate_shared_service_slos(timestamptz)
  from service_role;
grant execute on function public.evaluate_shared_service_slos_phase38(timestamptz)
  to service_role;

create or replace function public.assert_phase38_slo_invariants()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_duplicate_open integer;v_inactive_owners integer;
  v_missing_attempts integer;v_missing_notifications integer;
begin
  select count(*) into v_duplicate_open from (
    select service,metric_key,coalesce(entity_id,'__firm__')
    from public.os_slo_alerts where status='open'
    group by service,metric_key,coalesce(entity_id,'__firm__')
    having count(*)>1
  ) duplicates;
  select count(*) into v_inactive_owners
  from public.os_slo_owners o left join public.profiles p on p.id=o.owner_id
  where o.active and not coalesce(p.active,false);
  select count(*) into v_missing_attempts
  from public.os_slo_delivery_jobs j where j.status='delivered'
    and not exists (select 1 from public.os_slo_delivery_attempts a
      where a.job_id=j.job_id and a.outcome='delivered');
  select count(*) into v_missing_notifications
  from public.os_slo_delivery_jobs j
  where j.status='delivered' and j.adapter='in_app_owner'
    and not exists (select 1 from public.app_notifications n
      where n.notification_id='slo:'||(j.payload->>'event_id')
        and n.user_id=j.destination_key::uuid);
  if v_duplicate_open+v_inactive_owners+v_missing_attempts+
     v_missing_notifications>0 then
    raise exception 'Phase 38 SLO invariant violation';
  end if;
  return jsonb_build_object('ok',true,'duplicate_open',v_duplicate_open,
    'inactive_owners',v_inactive_owners,'delivered_without_attempt',
    v_missing_attempts,'in_app_without_notification',v_missing_notifications);
end $$;
revoke all on function public.assert_phase38_slo_invariants()
  from public,authenticated;
grant execute on function public.assert_phase38_slo_invariants()
  to service_role;
