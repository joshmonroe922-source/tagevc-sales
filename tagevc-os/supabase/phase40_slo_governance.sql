-- Phase 40: SLO draft comparison, counterfactual historical simulation, and
-- expiring owner coverage governance.
-- Apply after phase39_slo_policy_editing_route_tests.sql.

alter table public.os_slo_owners
  add column if not exists effective_at timestamptz,
  add column if not exists expires_at timestamptz,
  add column if not exists replacement_owner_id uuid references public.profiles(id);
update public.os_slo_owners
set effective_at=coalesce(effective_at,assigned_at)
where effective_at is null;
alter table public.os_slo_owners alter column effective_at set not null;
do $$ begin
  alter table public.os_slo_owners add constraint os_slo_owner_coverage_bounds
    check (expires_at is null or expires_at>effective_at);
exception when duplicate_object then null; end $$;

alter table public.os_slo_policies
  add column if not exists owner_effective_at timestamptz,
  add column if not exists owner_expires_at timestamptz,
  add column if not exists replacement_owner_id uuid references public.profiles(id);
update public.os_slo_policies set owner_effective_at=coalesce(owner_effective_at,effective_at)
where owner_effective_at is null and lifecycle_status in ('published','draft','validated');

create or replace function public.prevent_append_only_change()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_evaluations_append_only on public.os_slo_evaluations;
create trigger os_slo_evaluations_append_only before update or delete
  on public.os_slo_evaluations for each row execute function public.prevent_append_only_change();
drop trigger if exists os_slo_evaluations_no_truncate on public.os_slo_evaluations;
create trigger os_slo_evaluations_no_truncate before truncate
  on public.os_slo_evaluations for each statement execute function public.prevent_append_only_change();

create or replace function public.phase40_normalized_policy(p public.os_slo_policies)
returns jsonb language sql immutable as $$
  select jsonb_build_object(
    'comparator',p.comparator,
    'warning_threshold',p.warning_threshold,
    'critical_threshold',p.critical_threshold,
    'window_seconds',p.window_seconds,
    'evaluation_interval_seconds',p.evaluation_interval_seconds,
    'warning_breach_buckets',p.warning_breach_buckets,
    'recovery_buckets',p.recovery_buckets,
    'webhook_destination_keys',coalesce((
      select jsonb_agg(destination.key order by destination.key)
      from jsonb_object_keys(
        coalesce(p.config->'webhook_destinations','{}')
      ) as destination(key)
    ),'[]'::jsonb),
    'owner_id',p.owner_id,
    'owner_entity_id',p.owner_entity_id,
    'owner_effective_at',p.owner_effective_at,
    'owner_expires_at',p.owner_expires_at,
    'replacement_owner_id',p.replacement_owner_id
  )
$$;

create or replace view public.os_slo_policy_draft_comparisons
with (security_invoker=true) as
select d.policy_id as draft_policy_id,a.policy_id as active_policy_id,
  d.service,d.metric_key,d.scope,d.lifecycle_status,
  public.phase40_normalized_policy(a) as active_fields,
  public.phase40_normalized_policy(d) as draft_fields,
  coalesce((
    select jsonb_agg(jsonb_build_object(
      'field',field,'active',public.phase40_normalized_policy(a)->field,
      'draft',public.phase40_normalized_policy(d)->field,
      'material_risk',field in (
        'comparator','warning_threshold','critical_threshold','window_seconds',
        'evaluation_interval_seconds','warning_breach_buckets','recovery_buckets',
        'owner_id','owner_entity_id','owner_expires_at','replacement_owner_id'
      )
    ) order by field)
    from jsonb_object_keys(public.phase40_normalized_policy(d)) field
    where public.phase40_normalized_policy(a)->field
      is distinct from public.phase40_normalized_policy(d)->field
  ),'[]'::jsonb) as changes,
  exists (
    select 1 from jsonb_object_keys(public.phase40_normalized_policy(d)) field
    where public.phase40_normalized_policy(a)->field
      is distinct from public.phase40_normalized_policy(d)->field
      and field in (
        'comparator','warning_threshold','critical_threshold','window_seconds',
        'evaluation_interval_seconds','warning_breach_buckets','recovery_buckets',
        'owner_id','owner_entity_id','owner_expires_at','replacement_owner_id'
      )
  ) as material_risk
from public.os_slo_policies d
join public.os_slo_policies a on a.policy_id=d.draft_of_policy_id
where d.lifecycle_status in ('draft','validated') and a.lifecycle_status='published';

create or replace function public.save_slo_policy_draft_phase40(
  p_source_policy_id uuid,p_draft_policy_id uuid,p_policy_version text,
  p_comparator text,p_warning_threshold numeric,p_critical_threshold numeric,
  p_window_seconds integer,p_evaluation_interval_seconds integer,
  p_warning_breach_buckets integer,p_recovery_buckets integer,p_config jsonb,
  p_owner_id uuid,p_owner_entity_id text,p_owner_effective_at timestamptz,
  p_owner_expires_at timestamptz,p_replacement_owner_id uuid,
  p_actor_id uuid,p_expected_row_version bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_result jsonb; v_id uuid; v_before bigint; v_after bigint;
begin
  if p_owner_effective_at is null
     or (p_owner_expires_at is not null and p_owner_expires_at<=p_owner_effective_at)
     or (p_owner_expires_at is not null and (
       p_replacement_owner_id is null
       or not public.phase39_owner_authorized(p_replacement_owner_id,p_owner_entity_id)
     )) then raise exception 'Draft owner coverage is invalid'; end if;
  v_result:=public.save_slo_policy_draft_phase39(
    p_source_policy_id,p_draft_policy_id,p_policy_version,p_comparator,
    p_warning_threshold,p_critical_threshold,p_window_seconds,
    p_evaluation_interval_seconds,p_warning_breach_buckets,p_recovery_buckets,
    p_config,p_owner_id,p_owner_entity_id,p_actor_id,p_expected_row_version);
  v_id:=(v_result->>'policy_id')::uuid;
  select row_version into v_before from public.os_slo_policies where policy_id=v_id for update;
  update public.os_slo_policies set owner_effective_at=p_owner_effective_at,
    owner_expires_at=p_owner_expires_at,replacement_owner_id=p_replacement_owner_id,
    row_version=row_version+1,updated_at=now()
  where policy_id=v_id and (
    owner_effective_at is distinct from p_owner_effective_at
    or owner_expires_at is distinct from p_owner_expires_at
    or replacement_owner_id is distinct from p_replacement_owner_id
  ) returning row_version into v_after;
  if v_after is not null then
    insert into public.os_slo_policy_audit(
      policy_id,action,actor_id,from_row_version,to_row_version,detail
    ) values(v_id,'draft_updated',p_actor_id,v_before,v_after,
      jsonb_build_object('phase40_owner_coverage',true));
  else v_after:=v_before;
  end if;
  return (v_result-'row_version')||jsonb_build_object('row_version',v_after);
end $$;

create table if not exists public.os_slo_simulations (
  simulation_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  draft_policy_id uuid not null references public.os_slo_policies(policy_id),
  source_policy_id uuid not null references public.os_slo_policies(policy_id),
  requested_by uuid not null references public.profiles(id),
  entity_ids text[] not null default '{}',
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  max_buckets integer not null,
  policy_snapshot jsonb not null,
  source_evaluation_count integer not null default 0,
  counterfactual boolean not null default true check(counterfactual),
  status text not null default 'queued',
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_slo_simulation_status check(status in ('queued','leased','completed','failed')),
  constraint os_slo_simulation_window check(ends_at>starts_at and ends_at-starts_at<=interval '90 days'),
  constraint os_slo_simulation_bucket_bound check(max_buckets between 1 and 2160),
  constraint os_slo_simulation_entity_bound check(cardinality(entity_ids)<=100)
);
create table if not exists public.os_slo_simulation_jobs (
  job_id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null unique references public.os_slo_simulations(simulation_id),
  status text not null default 'queued',
  attempt_count integer not null default 0,
  max_attempts integer not null default 3,
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_slo_sim_job_status check(status in ('queued','leased','retry_wait','completed','failed')),
  constraint os_slo_sim_job_lease check(
    (status='leased' and lease_token is not null and lease_expires_at is not null)
    or (status<>'leased' and lease_token is null and lease_expires_at is null)
  )
);
create index if not exists os_slo_simulation_jobs_due
  on public.os_slo_simulation_jobs(next_attempt_at,created_at)
  where status in ('queued','leased','retry_wait');
create table if not exists public.os_slo_simulation_results (
  result_id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.os_slo_simulations(simulation_id),
  source_evaluation_id uuid not null references public.os_slo_evaluations(evaluation_id),
  evaluation_bucket timestamptz not null,
  entity_id text,
  observed_value numeric,
  historical_severity text not null,
  counterfactual_severity text not null,
  counterfactual boolean not null default true check(counterfactual),
  policy_snapshot jsonb not null,
  created_at timestamptz not null default now(),
  unique(simulation_id,source_evaluation_id)
);
create table if not exists public.os_slo_simulation_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.os_slo_simulations(simulation_id),
  event_type text not null check(event_type in ('requested','claimed','completed','failed')),
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
drop trigger if exists os_slo_sim_results_append_only on public.os_slo_simulation_results;
create trigger os_slo_sim_results_append_only before update or delete
  on public.os_slo_simulation_results for each row execute function public.prevent_append_only_change();
drop trigger if exists os_slo_sim_results_no_truncate on public.os_slo_simulation_results;
create trigger os_slo_sim_results_no_truncate before truncate
  on public.os_slo_simulation_results for each statement execute function public.prevent_append_only_change();
drop trigger if exists os_slo_sim_evidence_append_only on public.os_slo_simulation_evidence;
create trigger os_slo_sim_evidence_append_only before update or delete
  on public.os_slo_simulation_evidence for each row execute function public.prevent_append_only_change();
drop trigger if exists os_slo_sim_evidence_no_truncate on public.os_slo_simulation_evidence;
create trigger os_slo_sim_evidence_no_truncate before truncate
  on public.os_slo_simulation_evidence for each statement execute function public.prevent_append_only_change();

create or replace function public.request_slo_simulation_phase40(
  p_idempotency_key text,p_draft_policy_id uuid,p_entity_ids text[],
  p_starts_at timestamptz,p_ends_at timestamptz,p_max_buckets integer,p_actor_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_draft public.os_slo_policies%rowtype; v_id uuid; v_status text;
  v_entities text[]:=coalesce(p_entity_ids,'{}');
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to simulate SLO policies';
  end if;
  if p_idempotency_key !~ '^[A-Za-z0-9._:-]{8,120}$'
     or p_ends_at<=p_starts_at or p_ends_at-p_starts_at>interval '90 days'
     or p_max_buckets not between 1 and 2160 or cardinality(v_entities)>100 then
    raise exception 'Simulation bounds are invalid';
  end if;
  select * into v_draft from public.os_slo_policies
  where policy_id=p_draft_policy_id and lifecycle_status in ('draft','validated');
  if not found then raise exception 'Governed draft was not found'; end if;
  if v_draft.scope='firm' and cardinality(v_entities)>0 then
    raise exception 'Firm policy simulations cannot specify entities';
  end if;
  if v_draft.scope='entity' and (
    cardinality(v_entities)=0 or exists (
      select 1 from unnest(v_entities) e
      where not exists(select 1 from public.entities x where x.entity_id=e)
    )
  ) then raise exception 'Entity simulations require known scoped entities'; end if;
  insert into public.os_slo_simulations(
    idempotency_key,draft_policy_id,source_policy_id,requested_by,entity_ids,
    starts_at,ends_at,max_buckets,policy_snapshot
  ) values (
    p_idempotency_key,v_draft.policy_id,v_draft.draft_of_policy_id,p_actor_id,
    v_entities,p_starts_at,p_ends_at,p_max_buckets,
    public.phase40_normalized_policy(v_draft)||jsonb_build_object(
      'policy_id',v_draft.policy_id,'policy_version',v_draft.policy_version,
      'service',v_draft.service,'metric_key',v_draft.metric_key,'scope',v_draft.scope,
      'label','COUNTERFACTUAL — no production state mutated')
  ) on conflict(idempotency_key) do nothing returning simulation_id,status into v_id,v_status;
  if v_id is null then
    select simulation_id,status into v_id,v_status from public.os_slo_simulations
    where idempotency_key=p_idempotency_key and draft_policy_id=p_draft_policy_id
      and requested_by=p_actor_id and entity_ids=v_entities
      and starts_at=p_starts_at and ends_at=p_ends_at and max_buckets=p_max_buckets;
    if not found then raise exception 'Idempotency key belongs to another request'; end if;
  else
    insert into public.os_slo_simulation_jobs(simulation_id) values(v_id);
    insert into public.os_slo_simulation_evidence(simulation_id,event_type,actor_id,detail)
    values(v_id,'requested',p_actor_id,jsonb_build_object(
      'counterfactual',true,'starts_at',p_starts_at,'ends_at',p_ends_at,
      'max_buckets',p_max_buckets,'entity_count',cardinality(v_entities)));
  end if;
  return jsonb_build_object('simulation_id',v_id,'status',v_status,
    'counterfactual',true,'label','COUNTERFACTUAL — no production state mutated');
end $$;

create or replace function public.claim_slo_simulation_jobs_phase40(
  p_limit integer,p_lease_seconds integer
) returns setof public.os_slo_simulation_jobs
language plpgsql security definer set search_path=public as $$
begin
  with exhausted as (
    update public.os_slo_simulation_jobs set status='failed',lease_token=null,
      lease_expires_at=null,last_error='Simulation lease expired after maximum attempts',
      updated_at=now()
    where status='leased' and lease_expires_at<=now() and attempt_count>=max_attempts
    returning simulation_id
  ), parents as (
    update public.os_slo_simulations s set status='failed',completed_at=now()
    where s.simulation_id in(select simulation_id from exhausted)
    returning s.simulation_id
  )
  insert into public.os_slo_simulation_evidence(simulation_id,event_type,detail)
  select simulation_id,'failed',jsonb_build_object('reason','lease_attempts_exhausted')
  from parents;
  return query with due as (
    select job_id from public.os_slo_simulation_jobs
    where (status in ('queued','retry_wait') and next_attempt_at<=now())
       or (status='leased' and lease_expires_at<=now() and attempt_count<max_attempts)
    order by next_attempt_at,created_at for update skip locked
    limit least(greatest(p_limit,1),25)
  ), claimed as (
    update public.os_slo_simulation_jobs j set status='leased',
      lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,30),600)),
      attempt_count=attempt_count+1,updated_at=now()
      from due where j.job_id=due.job_id returning j.*
  ), parents as (
    update public.os_slo_simulations s set status='leased'
    where s.simulation_id in (select simulation_id from claimed)
    returning s.simulation_id
  ), evidence as (
    insert into public.os_slo_simulation_evidence(simulation_id,event_type,detail)
    select simulation_id,'claimed',jsonb_build_object('lease_token',lease_token)
    from claimed returning simulation_id
  )
  select c.* from claimed c left join parents p using(simulation_id)
    left join evidence e using(simulation_id);
end $$;

create or replace function public.run_slo_simulation_job_phase40(
  p_job_id uuid,p_lease_token uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_job public.os_slo_simulation_jobs%rowtype;
  v_sim public.os_slo_simulations%rowtype; v_count integer;
begin
  select * into v_job from public.os_slo_simulation_jobs where job_id=p_job_id for update;
  if not found or v_job.status<>'leased' or v_job.lease_token<>p_lease_token
     or v_job.lease_expires_at<=now() then raise exception 'Simulation lease is not current'; end if;
  select * into v_sim from public.os_slo_simulations
    where simulation_id=v_job.simulation_id for update;
  insert into public.os_slo_simulation_results(
    simulation_id,source_evaluation_id,evaluation_bucket,entity_id,observed_value,
    historical_severity,counterfactual_severity,policy_snapshot
  )
  select v_sim.simulation_id,e.evaluation_id,e.evaluation_bucket,e.entity_id,
    e.observed_value,e.severity,
    case when e.observed_value is null then 'unknown'
      when v_sim.policy_snapshot->>'comparator'='higher_bad'
        and e.observed_value>=(v_sim.policy_snapshot->>'critical_threshold')::numeric then 'critical'
      when v_sim.policy_snapshot->>'comparator'='higher_bad'
        and e.observed_value>=(v_sim.policy_snapshot->>'warning_threshold')::numeric then 'warning'
      when v_sim.policy_snapshot->>'comparator'='lower_bad'
        and e.observed_value<=(v_sim.policy_snapshot->>'critical_threshold')::numeric then 'critical'
      when v_sim.policy_snapshot->>'comparator'='lower_bad'
        and e.observed_value<=(v_sim.policy_snapshot->>'warning_threshold')::numeric then 'warning'
      else 'healthy' end,v_sim.policy_snapshot
  from public.os_slo_evaluations e
  where e.service=v_sim.policy_snapshot->>'service'
    and e.metric_key=v_sim.policy_snapshot->>'metric_key'
    and e.evaluation_bucket>=v_sim.starts_at and e.evaluation_bucket<v_sim.ends_at
    and (jsonb_array_length(to_jsonb(v_sim.entity_ids))=0 or e.entity_id=any(v_sim.entity_ids))
  order by e.evaluation_bucket,e.evaluation_id limit v_sim.max_buckets
  on conflict(simulation_id,source_evaluation_id) do nothing;
  select count(*) into v_count from public.os_slo_simulation_results
    where simulation_id=v_sim.simulation_id;
  update public.os_slo_simulations set status='completed',completed_at=now(),
    source_evaluation_count=v_count where simulation_id=v_sim.simulation_id;
  update public.os_slo_simulation_jobs set status='completed',
    lease_token=null,lease_expires_at=null,updated_at=now() where job_id=v_job.job_id;
  insert into public.os_slo_simulation_evidence(simulation_id,event_type,detail)
  values(v_sim.simulation_id,'completed',jsonb_build_object(
    'result_count',v_count,'counterfactual',true,
    'production_tables_mutated',jsonb_build_array()));
  return jsonb_build_object('simulation_id',v_sim.simulation_id,'status','completed',
    'result_count',v_count,'counterfactual',true);
end $$;

create table if not exists public.os_slo_owner_coverage_alerts (
  coverage_alert_id uuid primary key default gen_random_uuid(),
  ownership_id uuid not null references public.os_slo_owners(ownership_id),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  entity_id text,
  owner_id uuid not null references public.profiles(id),
  replacement_owner_id uuid references public.profiles(id),
  expires_at timestamptz not null,
  warning_days integer not null,
  status text not null default 'open' check(status in ('open','resolved')),
  first_observed_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  unique(ownership_id,expires_at)
);
create table if not exists public.os_slo_owner_coverage_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  coverage_alert_id uuid not null references public.os_slo_owner_coverage_alerts(coverage_alert_id),
  event_type text not null check(event_type in ('opened','observed','resolved')),
  detail jsonb not null default '{}',
  occurred_at timestamptz not null default now()
);
drop trigger if exists os_slo_owner_coverage_evidence_append_only on public.os_slo_owner_coverage_evidence;
create trigger os_slo_owner_coverage_evidence_append_only before update or delete
  on public.os_slo_owner_coverage_evidence for each row execute function public.prevent_append_only_change();
drop trigger if exists os_slo_owner_coverage_evidence_no_truncate on public.os_slo_owner_coverage_evidence;
create trigger os_slo_owner_coverage_evidence_no_truncate before truncate
  on public.os_slo_owner_coverage_evidence for each statement execute function public.prevent_append_only_change();

create or replace view public.os_slo_owner_coverage_metrics
with (security_invoker=true) as
select p.policy_id,p.service,p.metric_key,o.entity_id,o.owner_id,o.expires_at,
  o.replacement_owner_id,
  greatest(0,ceil(extract(epoch from(o.expires_at-now()))/86400))::integer as days_remaining,
  (o.expires_at<=now()+interval '30 days') as warning,
  (o.replacement_owner_id is not null
    and public.phase39_owner_authorized(o.replacement_owner_id,o.entity_id)) as eligible_replacement_named
from public.os_slo_policies p
join public.os_slo_owners o on o.service=p.service and o.metric_key=p.metric_key
  and o.active and o.effective_at<=now() and (o.expires_at is null or o.expires_at>now())
where p.lifecycle_status='published' and p.enabled and o.expires_at is not null;

create or replace function public.scan_slo_owner_expiry_phase40(
  p_warning_days integer default 30
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v record; v_id uuid; v_opened boolean:=false; v_observed integer:=0;
begin
  if p_warning_days not between 1 and 90 then raise exception 'Warning days out of bounds'; end if;
  -- Activate pre-created successor rows in one transaction. Publication creates
  -- them with effective_at exactly equal to the predecessor expiry, so the
  -- governed timeline has no interval gap even if this scanner runs late.
  with due as (
    select next.ownership_id as next_id,prior.ownership_id as prior_id
    from public.os_slo_owners next
    join public.os_slo_owners prior on prior.service=next.service
      and prior.metric_key is not distinct from next.metric_key
      and prior.entity_id is not distinct from next.entity_id
      and prior.active and prior.expires_at=next.effective_at
    where not next.active and next.effective_at<=now()
      and next.note='Phase 40 scheduled replacement'
    for update of next,prior
  ), ended as (
    update public.os_slo_owners prior set active=false,ended_at=now()
    where prior.ownership_id in(select prior_id from due)
    returning prior.ownership_id
  )
  update public.os_slo_owners next set active=true
  where next.ownership_id in(select next_id from due)
    and exists(select 1 from ended);
  for v in select p.policy_id,o.*
    from public.os_slo_policies p join public.os_slo_owners o
      on o.service=p.service and o.metric_key=p.metric_key and o.active
    where p.lifecycle_status='published' and p.enabled
      and o.expires_at between now() and now()+make_interval(days=>p_warning_days)
  loop
    if v.replacement_owner_id is null
       or not public.phase39_owner_authorized(v.replacement_owner_id,v.entity_id) then
      raise exception 'Expiring ownership % requires a named eligible replacement',v.ownership_id;
    end if;
    insert into public.os_slo_owner_coverage_alerts(
      ownership_id,policy_id,entity_id,owner_id,replacement_owner_id,expires_at,warning_days
    ) values(v.ownership_id,v.policy_id,v.entity_id,v.owner_id,
      v.replacement_owner_id,v.expires_at,p_warning_days)
    on conflict(ownership_id,expires_at) do update set last_observed_at=now()
    returning coverage_alert_id,(xmax=0) into v_id,v_opened;
    insert into public.os_slo_owner_coverage_evidence(coverage_alert_id,event_type,detail)
    values(v_id,case when v_opened then 'opened' else 'observed' end,
      jsonb_build_object('warning_days',p_warning_days,
        'replacement_owner_id',v.replacement_owner_id,'entity_id',v.entity_id));
    if v_opened then
      insert into public.app_notifications(notification_id,user_id,kind,title,body,href)
      values('slo-owner-expiry:'||v_id,v.replacement_owner_id,'slo_owner_expiry',
        'SLO owner coverage expires soon',
        'You are the named replacement for an expiring SLO ownership assignment.',
        '/shared-services') on conflict(notification_id) do nothing;
    end if;
    v_observed:=v_observed+1;
  end loop;
  return jsonb_build_object('observed',v_observed,'warning_days',p_warning_days);
end $$;

create or replace function public.publish_slo_policy_draft_phase40(
  p_policy_id uuid,p_actor_id uuid,p_expected_row_version bigint,
  p_owner_effective_at timestamptz,p_owner_expires_at timestamptz,
  p_replacement_owner_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v public.os_slo_policies%rowtype; v_result jsonb; v_ownership uuid;
  v_successor uuid;
begin
  select * into v from public.os_slo_policies where policy_id=p_policy_id for update;
  if found and v.lifecycle_status='published' and v.published_by=p_actor_id
     and v.row_version=p_expected_row_version+1 then
    return jsonb_build_object('policy_id',v.policy_id,'row_version',v.row_version,
      'state','published','replayed',true,'coverage_effective_at',v.owner_effective_at,
      'coverage_expires_at',v.owner_expires_at,
      'replacement_owner_id',v.replacement_owner_id);
  end if;
  if not found or v.lifecycle_status<>'validated' then
    raise exception 'Validated draft was not found';
  end if;
  if v.created_by=p_actor_id then raise exception 'Maker-checker requires a different publisher'; end if;
  if p_owner_effective_at>now()+interval '5 minutes'
     or (p_owner_expires_at is not null and p_owner_expires_at<=greatest(now(),p_owner_effective_at))
     or (p_owner_expires_at is not null and (
       p_replacement_owner_id is null
       or not public.phase39_owner_authorized(p_replacement_owner_id,v.owner_entity_id)
     )) then raise exception 'Published policy must have continuous eligible owner coverage'; end if;
  update public.os_slo_policies set owner_effective_at=p_owner_effective_at,
    owner_expires_at=p_owner_expires_at,replacement_owner_id=p_replacement_owner_id
    where policy_id=p_policy_id;
  v_result:=public.publish_slo_policy_draft_phase39(
    p_policy_id,p_actor_id,p_expected_row_version);
  select ownership_id into v_ownership from public.os_slo_owners
    where service=v.service and metric_key=v.metric_key
      and entity_id is not distinct from v.owner_entity_id and active
    order by assigned_at desc limit 1;
  update public.os_slo_owners set effective_at=p_owner_effective_at,
    expires_at=p_owner_expires_at,replacement_owner_id=p_replacement_owner_id
    where ownership_id=v_ownership;
  if p_owner_expires_at is not null then
    insert into public.os_slo_owners(
      service,metric_key,entity_id,owner_id,active,assigned_by,effective_at,note
    ) values(
      v.service,v.metric_key,v.owner_entity_id,p_replacement_owner_id,false,
      p_actor_id,p_owner_expires_at,'Phase 40 scheduled replacement'
    ) returning ownership_id into v_successor;
  end if;
  return v_result||jsonb_build_object('coverage_effective_at',p_owner_effective_at,
    'coverage_expires_at',p_owner_expires_at,'replacement_owner_id',p_replacement_owner_id,
    'successor_ownership_id',v_successor);
end $$;

alter table public.os_slo_simulations enable row level security;
alter table public.os_slo_simulation_jobs enable row level security;
alter table public.os_slo_simulation_results enable row level security;
alter table public.os_slo_simulation_evidence enable row level security;
alter table public.os_slo_owner_coverage_alerts enable row level security;
alter table public.os_slo_owner_coverage_evidence enable row level security;
drop policy if exists "os_slo_simulations_select" on public.os_slo_simulations;
create policy "os_slo_simulations_select" on public.os_slo_simulations for select
  to authenticated using(public.is_firm_wide_access());
drop policy if exists "os_slo_sim_jobs_select" on public.os_slo_simulation_jobs;
create policy "os_slo_sim_jobs_select" on public.os_slo_simulation_jobs for select
  to authenticated using(public.is_firm_wide_access());
drop policy if exists "os_slo_sim_results_select" on public.os_slo_simulation_results;
create policy "os_slo_sim_results_select" on public.os_slo_simulation_results for select
  to authenticated using(public.is_firm_wide_access());
drop policy if exists "os_slo_sim_evidence_select" on public.os_slo_simulation_evidence;
create policy "os_slo_sim_evidence_select" on public.os_slo_simulation_evidence for select
  to authenticated using(public.is_firm_wide_access());
drop policy if exists "os_slo_coverage_alerts_select" on public.os_slo_owner_coverage_alerts;
create policy "os_slo_coverage_alerts_select" on public.os_slo_owner_coverage_alerts for select
  to authenticated using(public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
drop policy if exists "os_slo_coverage_evidence_select" on public.os_slo_owner_coverage_evidence;
create policy "os_slo_coverage_evidence_select" on public.os_slo_owner_coverage_evidence for select
  to authenticated using(exists(select 1 from public.os_slo_owner_coverage_alerts a
    where a.coverage_alert_id=os_slo_owner_coverage_evidence.coverage_alert_id
      and (public.is_firm_wide_access()
        or (a.entity_id is not null and public.can_access_entity(a.entity_id)))));
grant select on public.os_slo_policy_draft_comparisons,
  public.os_slo_simulations,public.os_slo_simulation_jobs,
  public.os_slo_simulation_results,public.os_slo_simulation_evidence,
  public.os_slo_owner_coverage_metrics,public.os_slo_owner_coverage_alerts,
  public.os_slo_owner_coverage_evidence to authenticated;
revoke insert,update,delete,truncate on public.os_slo_simulations,
  public.os_slo_simulation_jobs,public.os_slo_simulation_results,
  public.os_slo_simulation_evidence,public.os_slo_owner_coverage_alerts,
  public.os_slo_owner_coverage_evidence from public,authenticated,service_role;
revoke all on function public.request_slo_simulation_phase40(text,uuid,text[],timestamptz,timestamptz,integer,uuid) from public,authenticated;
revoke all on function public.save_slo_policy_draft_phase40(uuid,uuid,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid,text,timestamptz,timestamptz,uuid,uuid,bigint) from public,authenticated;
revoke all on function public.claim_slo_simulation_jobs_phase40(integer,integer) from public,authenticated;
revoke all on function public.run_slo_simulation_job_phase40(uuid,uuid) from public,authenticated;
revoke all on function public.scan_slo_owner_expiry_phase40(integer) from public,authenticated;
revoke all on function public.publish_slo_policy_draft_phase40(uuid,uuid,bigint,timestamptz,timestamptz,uuid) from public,authenticated;
grant execute on function public.save_slo_policy_draft_phase40(uuid,uuid,text,text,numeric,numeric,integer,integer,integer,integer,jsonb,uuid,text,timestamptz,timestamptz,uuid,uuid,bigint),
  public.request_slo_simulation_phase40(text,uuid,text[],timestamptz,timestamptz,integer,uuid),
  public.claim_slo_simulation_jobs_phase40(integer,integer),
  public.run_slo_simulation_job_phase40(uuid,uuid),
  public.scan_slo_owner_expiry_phase40(integer),
  public.publish_slo_policy_draft_phase40(uuid,uuid,bigint,timestamptz,timestamptz,uuid)
  to service_role;
revoke execute on function public.publish_slo_policy_draft_phase39(uuid,uuid,bigint)
  from public,authenticated,service_role;
