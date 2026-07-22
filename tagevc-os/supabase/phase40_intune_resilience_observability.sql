-- Phase 40: Intune breaker tuning history, provider outage correlation,
-- read-only health canary alerts, and recovery visibility.
-- Apply after phases 36, 37, 38, and 39. This migration deliberately does not
-- replace the Phase 39 dispatch authorization functions or Phase 38 tombstones.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.os_sha256_hex(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select encode(digest(convert_to(coalesce(p_input, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create table if not exists public.os_it_intune_breaker_config_versions (
  config_version_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  version_no bigint not null,
  source_proposal_id uuid,
  failure_window_minutes integer not null,
  minimum_samples integer not null,
  failure_threshold integer not null,
  failure_rate_threshold numeric(5,4) not null,
  reset_success_threshold integer not null,
  risk_class text not null,
  applied_by uuid,
  applied_at timestamptz not null default now(),
  evidence_sha256 text not null,
  constraint os_it_intune_config_version_unique
    unique (breaker_id,version_no),
  constraint os_it_intune_config_version_risk_check
    check (risk_class in ('baseline','standard','riskier')),
  constraint os_it_intune_config_version_bounds check (
    failure_window_minutes between 1 and 1440
    and minimum_samples between 1 and 100
    and failure_threshold between 1 and 100
    and failure_rate_threshold between 0 and 1
    and reset_success_threshold between 1 and 20
  ),
  constraint os_it_intune_config_version_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);

create table if not exists public.os_it_intune_breaker_tuning_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  entity_id text references public.entities(entity_id),
  base_config_version_no bigint not null,
  proposed_failure_window_minutes integer not null,
  proposed_minimum_samples integer not null,
  proposed_failure_threshold integer not null,
  proposed_failure_rate_threshold numeric(5,4) not null,
  proposed_reset_success_threshold integer not null,
  risk_class text not null,
  proposed_by uuid not null,
  proposed_reason text not null,
  proposal_evidence jsonb not null,
  evidence_sha256 text not null,
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '24 hours'),
  constraint os_it_intune_tuning_risk_check
    check (risk_class in ('standard','riskier')),
  constraint os_it_intune_tuning_bounds check (
    proposed_failure_window_minutes between 5 and 120
    and proposed_minimum_samples between 3 and 50
    and proposed_failure_threshold between 2 and proposed_minimum_samples
    and proposed_failure_rate_threshold between 0.2500 and 0.9500
    and proposed_reset_success_threshold between 2 and 10
  ),
  constraint os_it_intune_tuning_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);

create table if not exists public.os_it_intune_breaker_tuning_decisions (
  decision_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  decision text not null,
  decided_by uuid not null,
  statement text not null,
  proposal_evidence_sha256 text not null,
  resulting_config_version_id uuid
    references public.os_it_intune_breaker_config_versions(config_version_id),
  decided_at timestamptz not null default now(),
  constraint os_it_intune_tuning_decision_check
    check (decision in ('approved','rejected','expired')),
  constraint os_it_intune_tuning_decision_hash_check
    check (proposal_evidence_sha256~'^[0-9a-f]{64}$')
);

alter table public.os_it_intune_breaker_config_versions
  drop constraint if exists os_it_intune_config_source_proposal_fk;
alter table public.os_it_intune_breaker_config_versions
  add constraint os_it_intune_config_source_proposal_fk
  foreign key (source_proposal_id)
  references public.os_it_intune_breaker_tuning_proposals(proposal_id);

create table if not exists public.os_it_intune_breaker_tuning_events (
  event_id uuid primary key default gen_random_uuid(),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  proposal_id uuid
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  event_type text not null,
  actor_id uuid not null,
  config_version_no bigint not null,
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_it_intune_tuning_event_type_check
    check (event_type in ('proposed','approved','rejected','expired')),
  constraint os_it_intune_tuning_event_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);

create table if not exists public.os_it_intune_health_canary_runs (
  canary_run_id uuid primary key default gen_random_uuid(),
  run_key uuid not null unique,
  provider text not null default 'ms_graph',
  operation text not null default 'tenant_health_read',
  status text not null default 'queued',
  worker_id text,
  lease_token uuid,
  lease_acquired_at timestamptz,
  lease_expires_at timestamptz,
  attempt_no integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  http_status integer,
  outcome text,
  error_code text,
  graph_request_id text,
  evidence jsonb not null default '{}'::jsonb,
  observed_at timestamptz,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_it_intune_health_canary_status_check
    check (status in ('queued','leased','succeeded','retry_wait','failed')),
  constraint os_it_intune_health_canary_outcome_check
    check (outcome is null or outcome in ('success','failure','ignored')),
  constraint os_it_intune_health_canary_http_check
    check (http_status is null or http_status between 100 and 599),
  constraint os_it_intune_health_canary_attempt_check
    check (attempt_no between 0 and 3),
  constraint os_it_intune_health_canary_lease_check check (
    (status='leased' and worker_id is not null and lease_token is not null
      and lease_acquired_at is not null and lease_expires_at is not null)
    or
    (status<>'leased' and worker_id is null and lease_token is null
      and lease_acquired_at is null and lease_expires_at is null)
  )
);
create index if not exists os_it_intune_health_canary_due_idx
  on public.os_it_intune_health_canary_runs(next_attempt_at,created_at)
  where status in ('queued','retry_wait','leased');
create unique index if not exists os_it_intune_one_active_health_canary
  on public.os_it_intune_health_canary_runs(provider,operation)
  where status in ('queued','retry_wait','leased');

create table if not exists public.os_it_intune_outage_episodes (
  episode_id uuid primary key default gen_random_uuid(),
  provider text not null,
  operation text not null,
  state text not null,
  started_at timestamptz not null,
  recovering_at timestamptz,
  resolved_at timestamptz,
  correlated_scope_count integer not null,
  failure_count integer not null,
  sample_count integer not null,
  evidence jsonb not null,
  evidence_sha256 text not null,
  row_version bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint os_it_intune_outage_state_check
    check (state in ('active','recovering','resolved')),
  constraint os_it_intune_outage_aggregate_check check (
    correlated_scope_count>=0 and failure_count>=0
    and sample_count>=failure_count
  ),
  constraint os_it_intune_outage_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);
create unique index if not exists os_it_intune_one_live_outage
  on public.os_it_intune_outage_episodes(provider,operation)
  where state in ('active','recovering');

create table if not exists public.os_it_intune_outage_episode_events (
  event_id uuid primary key default gen_random_uuid(),
  episode_id uuid not null
    references public.os_it_intune_outage_episodes(episode_id),
  event_type text not null,
  from_state text,
  to_state text not null,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  episode_version bigint not null,
  created_at timestamptz not null default now(),
  constraint os_it_intune_outage_event_type_check
    check (event_type in ('detected','evidence_updated','recovering','resolved')),
  constraint os_it_intune_outage_event_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);

create table if not exists public.os_it_intune_health_incidents (
  incident_id uuid primary key default gen_random_uuid(),
  dedupe_key text not null unique,
  episode_id uuid references public.os_it_intune_outage_episodes(episode_id),
  incident_type text not null,
  status text not null,
  severity text not null,
  opened_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  resolved_at timestamptz,
  occurrence_count integer not null default 1,
  evidence jsonb not null default '{}'::jsonb,
  constraint os_it_intune_health_incident_status_check
    check (status in ('open','resolved')),
  constraint os_it_intune_health_incident_severity_check
    check (severity in ('warning','critical'))
);

create table if not exists public.os_it_intune_health_incident_events (
  event_id uuid primary key default gen_random_uuid(),
  incident_id uuid not null
    references public.os_it_intune_health_incidents(incident_id),
  event_type text not null,
  evidence jsonb not null,
  created_at timestamptz not null default now(),
  constraint os_it_intune_health_incident_event_type_check
    check (event_type in ('opened','reobserved','resolved'))
);

alter table public.os_it_intune_breaker_config_versions enable row level security;
alter table public.os_it_intune_breaker_tuning_proposals enable row level security;
alter table public.os_it_intune_breaker_tuning_decisions enable row level security;
alter table public.os_it_intune_breaker_tuning_events enable row level security;
alter table public.os_it_intune_health_canary_runs enable row level security;
alter table public.os_it_intune_outage_episodes enable row level security;
alter table public.os_it_intune_outage_episode_events enable row level security;
alter table public.os_it_intune_health_incidents enable row level security;
alter table public.os_it_intune_health_incident_events enable row level security;

drop policy if exists "os_it_intune_config_version_select"
  on public.os_it_intune_breaker_config_versions;
create policy "os_it_intune_config_version_select"
  on public.os_it_intune_breaker_config_versions for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=os_it_intune_breaker_config_versions.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));
drop policy if exists "os_it_intune_tuning_proposal_select"
  on public.os_it_intune_breaker_tuning_proposals;
create policy "os_it_intune_tuning_proposal_select"
  on public.os_it_intune_breaker_tuning_proposals for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
drop policy if exists "os_it_intune_tuning_decision_select"
  on public.os_it_intune_breaker_tuning_decisions;
create policy "os_it_intune_tuning_decision_select"
  on public.os_it_intune_breaker_tuning_decisions for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_breaker_tuning_proposals p
    where p.proposal_id=os_it_intune_breaker_tuning_decisions.proposal_id
      and (public.is_firm_wide_access()
        or (p.entity_id is not null and public.can_access_entity(p.entity_id)))
  ));
drop policy if exists "os_it_intune_tuning_event_select"
  on public.os_it_intune_breaker_tuning_events;
create policy "os_it_intune_tuning_event_select"
  on public.os_it_intune_breaker_tuning_events for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=os_it_intune_breaker_tuning_events.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));
drop policy if exists "os_it_intune_health_canary_select"
  on public.os_it_intune_health_canary_runs;
create policy "os_it_intune_health_canary_select"
  on public.os_it_intune_health_canary_runs for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_outage_episode_select"
  on public.os_it_intune_outage_episodes;
create policy "os_it_intune_outage_episode_select"
  on public.os_it_intune_outage_episodes for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_outage_event_select"
  on public.os_it_intune_outage_episode_events;
create policy "os_it_intune_outage_event_select"
  on public.os_it_intune_outage_episode_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_health_incident_select"
  on public.os_it_intune_health_incidents;
create policy "os_it_intune_health_incident_select"
  on public.os_it_intune_health_incidents for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_health_incident_event_select"
  on public.os_it_intune_health_incident_events;
create policy "os_it_intune_health_incident_event_select"
  on public.os_it_intune_health_incident_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_breaker_config_versions,
  public.os_it_intune_breaker_tuning_proposals,
  public.os_it_intune_breaker_tuning_decisions,
  public.os_it_intune_breaker_tuning_events,
  public.os_it_intune_health_canary_runs,
  public.os_it_intune_outage_episodes,
  public.os_it_intune_outage_episode_events,
  public.os_it_intune_health_incidents,
  public.os_it_intune_health_incident_events to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_breaker_config_versions,
  public.os_it_intune_breaker_tuning_proposals,
  public.os_it_intune_breaker_tuning_decisions,
  public.os_it_intune_breaker_tuning_events,
  public.os_it_intune_health_canary_runs,
  public.os_it_intune_outage_episodes,
  public.os_it_intune_outage_episode_events,
  public.os_it_intune_health_incidents,
  public.os_it_intune_health_incident_events
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase40_event_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 40 Intune evidence is append-only';
end;
$$;

do $phase40_triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'os_it_intune_breaker_config_versions',
    'os_it_intune_breaker_tuning_proposals',
    'os_it_intune_breaker_tuning_decisions',
    'os_it_intune_breaker_tuning_events',
    'os_it_intune_outage_episode_events',
    'os_it_intune_health_incident_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I',
      v_table||'_append_only',v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.prevent_it_intune_phase40_event_mutation()',
      v_table||'_append_only',v_table);
    execute format('drop trigger if exists %I on public.%I',
      v_table||'_no_truncate',v_table);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.prevent_it_intune_phase40_event_mutation()',
      v_table||'_no_truncate',v_table);
  end loop;
end;
$phase40_triggers$;

create or replace function public.seed_it_intune_breaker_config_versions()
returns integer
language plpgsql security definer set search_path=public as $$
declare v_count integer;
begin
  insert into public.os_it_intune_breaker_config_versions(
    breaker_id,version_no,failure_window_minutes,minimum_samples,
    failure_threshold,failure_rate_threshold,reset_success_threshold,
    risk_class,applied_by,evidence_sha256
  )
  select b.breaker_id,1,b.failure_window_minutes,b.minimum_samples,
    b.failure_threshold,b.failure_rate_threshold,b.reset_success_threshold,
    'baseline',null,public.os_sha256_hex(jsonb_build_object(
      'breaker_id',b.breaker_id,'version_no',1,
      'failure_window_minutes',b.failure_window_minutes,
      'minimum_samples',b.minimum_samples,
      'failure_threshold',b.failure_threshold,
      'failure_rate_threshold',b.failure_rate_threshold,
      'reset_success_threshold',b.reset_success_threshold
    )::text)
  from public.os_it_intune_provider_breakers b
  where not exists (
    select 1 from public.os_it_intune_breaker_config_versions v
    where v.breaker_id=b.breaker_id
  );
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;
select public.seed_it_intune_breaker_config_versions();

create or replace function public.propose_it_intune_breaker_tuning(
  p_breaker_id uuid,p_actor_id uuid,p_reason text,
  p_failure_window_minutes integer,p_minimum_samples integer,
  p_failure_threshold integer,p_failure_rate_threshold numeric,
  p_reset_success_threshold integer,p_expected_breaker_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_current public.os_it_intune_breaker_config_versions%rowtype;
  v_proposal public.os_it_intune_breaker_tuning_proposals%rowtype;
  v_risk text; v_evidence jsonb; v_hash text;
begin
  perform public.seed_it_intune_breaker_config_versions();
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=p_breaker_id for update;
  select * into v_current from public.os_it_intune_breaker_config_versions
  where breaker_id=p_breaker_id order by version_no desc limit 1;
  if not found or v_breaker.row_version<>p_expected_breaker_version
     or length(trim(coalesce(p_reason,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Tuning actor, reason, entity, or breaker version denied';
  end if;
  if p_failure_window_minutes not between 5 and 120
     or p_minimum_samples not between 3 and 50
     or p_failure_threshold not between 2 and p_minimum_samples
     or p_failure_rate_threshold not between 0.2500 and 0.9500
     or p_reset_success_threshold not between 2 and 10 then
    raise exception 'Tuning thresholds exceed governed bounds';
  end if;
  if exists (
    select 1 from public.os_it_intune_breaker_tuning_proposals p
    where p.breaker_id=p_breaker_id and p.expires_at>now()
      and not exists (select 1
        from public.os_it_intune_breaker_tuning_decisions d
        where d.proposal_id=p.proposal_id)
  ) then raise exception 'Breaker already has an undecided tuning proposal'; end if;
  v_risk:=case when
    p_minimum_samples<v_current.minimum_samples
    or p_failure_threshold<v_current.failure_threshold
    or p_failure_rate_threshold<v_current.failure_rate_threshold
    or p_reset_success_threshold<v_current.reset_success_threshold
    then 'riskier' else 'standard' end;
  v_evidence:=jsonb_build_object(
    'breaker_id',p_breaker_id,'breaker_version',v_breaker.row_version,
    'base_config_version_no',v_current.version_no,
    'before',jsonb_build_object(
      'failure_window_minutes',v_current.failure_window_minutes,
      'minimum_samples',v_current.minimum_samples,
      'failure_threshold',v_current.failure_threshold,
      'failure_rate_threshold',v_current.failure_rate_threshold,
      'reset_success_threshold',v_current.reset_success_threshold),
    'after',jsonb_build_object(
      'failure_window_minutes',p_failure_window_minutes,
      'minimum_samples',p_minimum_samples,
      'failure_threshold',p_failure_threshold,
      'failure_rate_threshold',p_failure_rate_threshold,
      'reset_success_threshold',p_reset_success_threshold),
    'risk_class',v_risk);
  v_hash:=public.os_sha256_hex(v_evidence::text);
  insert into public.os_it_intune_breaker_tuning_proposals(
    breaker_id,entity_id,base_config_version_no,
    proposed_failure_window_minutes,proposed_minimum_samples,
    proposed_failure_threshold,proposed_failure_rate_threshold,
    proposed_reset_success_threshold,risk_class,proposed_by,proposed_reason,
    proposal_evidence,evidence_sha256
  ) values (
    p_breaker_id,v_breaker.entity_id,v_current.version_no,
    p_failure_window_minutes,p_minimum_samples,p_failure_threshold,
    p_failure_rate_threshold,p_reset_success_threshold,v_risk,p_actor_id,
    trim(p_reason),v_evidence,v_hash
  ) returning * into v_proposal;
  insert into public.os_it_intune_breaker_tuning_events(
    breaker_id,proposal_id,event_type,actor_id,config_version_no,
    evidence_sha256,detail
  ) values (
    p_breaker_id,v_proposal.proposal_id,'proposed',p_actor_id,
    v_current.version_no,v_hash,jsonb_build_object('risk_class',v_risk)
  );
  return jsonb_build_object('proposal_id',v_proposal.proposal_id,
    'risk_class',v_risk,'evidence_sha256',v_hash);
end;
$$;

create or replace function public.review_it_intune_breaker_tuning(
  p_proposal_id uuid,p_actor_id uuid,p_decision text,p_statement text,
  p_expected_breaker_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_proposal public.os_it_intune_breaker_tuning_proposals%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_current public.os_it_intune_breaker_config_versions%rowtype;
  v_version public.os_it_intune_breaker_config_versions%rowtype;
  v_decision public.os_it_intune_breaker_tuning_decisions%rowtype;
begin
  select * into v_proposal from public.os_it_intune_breaker_tuning_proposals
  where proposal_id=p_proposal_id;
  if not found then raise exception 'Tuning proposal not found'; end if;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=v_proposal.breaker_id for update;
  select * into v_current from public.os_it_intune_breaker_config_versions
  where breaker_id=v_breaker.breaker_id order by version_no desc limit 1;
  if exists (select 1 from public.os_it_intune_breaker_tuning_decisions
      where proposal_id=p_proposal_id) then
    raise exception 'Tuning proposal already has an immutable decision';
  end if;
  if p_decision not in ('approve','reject')
     or v_proposal.expires_at<=now()
     or v_proposal.proposed_by=p_actor_id
     or v_breaker.row_version<>p_expected_breaker_version
     or v_current.version_no<>v_proposal.base_config_version_no
     or length(trim(coalesce(p_statement,'')))<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Independent tuning review denied, stale, or expired';
  end if;
  -- Tuning is never a reset path. An open/half-open breaker must complete the
  -- Phase 39 governed recovery lifecycle before any threshold can change.
  if p_decision='approve' and v_breaker.state<>'closed' then
    raise exception 'Tuning cannot close, reset, or modify an open breaker';
  end if;
  if p_decision='approve' then
    insert into public.os_it_intune_breaker_config_versions(
      breaker_id,version_no,source_proposal_id,failure_window_minutes,
      minimum_samples,failure_threshold,failure_rate_threshold,
      reset_success_threshold,risk_class,applied_by,evidence_sha256
    ) values (
      v_breaker.breaker_id,v_current.version_no+1,v_proposal.proposal_id,
      v_proposal.proposed_failure_window_minutes,
      v_proposal.proposed_minimum_samples,
      v_proposal.proposed_failure_threshold,
      v_proposal.proposed_failure_rate_threshold,
      v_proposal.proposed_reset_success_threshold,
      v_proposal.risk_class,p_actor_id,v_proposal.evidence_sha256
    ) returning * into v_version;
    update public.os_it_intune_provider_breakers set
      failure_window_minutes=v_version.failure_window_minutes,
      minimum_samples=v_version.minimum_samples,
      failure_threshold=v_version.failure_threshold,
      failure_rate_threshold=v_version.failure_rate_threshold,
      reset_success_threshold=v_version.reset_success_threshold,
      row_version=row_version+1,updated_at=now()
    where breaker_id=v_breaker.breaker_id and state='closed';
    if not found then
      raise exception 'Breaker changed state while tuning was applied';
    end if;
  end if;
  insert into public.os_it_intune_breaker_tuning_decisions(
    proposal_id,decision,decided_by,statement,proposal_evidence_sha256,
    resulting_config_version_id
  ) values (
    p_proposal_id,case when p_decision='approve' then 'approved' else 'rejected' end,
    p_actor_id,trim(p_statement),v_proposal.evidence_sha256,
    v_version.config_version_id
  ) returning * into v_decision;
  insert into public.os_it_intune_breaker_tuning_events(
    breaker_id,proposal_id,event_type,actor_id,config_version_no,
    evidence_sha256,detail
  ) values (
    v_breaker.breaker_id,p_proposal_id,
    case when p_decision='approve' then 'approved' else 'rejected' end,
    p_actor_id,coalesce(v_version.version_no,v_current.version_no),
    v_proposal.evidence_sha256,
    jsonb_build_object('decision_id',v_decision.decision_id,
      'risk_class',v_proposal.risk_class)
  );
  return jsonb_build_object('decision',v_decision.decision,
    'config_version_no',coalesce(v_version.version_no,v_current.version_no));
end;
$$;

create or replace function public.enqueue_it_intune_health_canary(p_run_key uuid)
returns uuid
language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
  if p_run_key is null then raise exception 'Health canary run key required'; end if;
  begin
    insert into public.os_it_intune_health_canary_runs(run_key)
    values (p_run_key) returning canary_run_id into v_id;
  exception when unique_violation then
    select canary_run_id into v_id
    from public.os_it_intune_health_canary_runs
    where run_key=p_run_key
      or (provider='ms_graph' and operation='tenant_health_read'
        and status in ('queued','retry_wait','leased'))
    order by created_at limit 1;
    if v_id is null then raise; end if;
  end;
  return v_id;
end;
$$;

create or replace function public.claim_it_intune_health_canary(
  p_worker_id text,p_lease_seconds integer default 60
) returns public.os_it_intune_health_canary_runs
language plpgsql security definer set search_path=public as $$
declare v_run public.os_it_intune_health_canary_runs%rowtype;
begin
  if nullif(trim(p_worker_id),'') is null then raise exception 'Worker ID required'; end if;
  update public.os_it_intune_health_canary_runs set
    status='retry_wait',worker_id=null,lease_token=null,lease_acquired_at=null,
    lease_expires_at=null,next_attempt_at=now(),row_version=row_version+1
  where status='leased' and lease_expires_at<=now() and attempt_no<3;
  update public.os_it_intune_health_canary_runs set
    status='failed',worker_id=null,lease_token=null,lease_acquired_at=null,
    lease_expires_at=null,completed_at=now(),error_code='lease_retries_exhausted',
    row_version=row_version+1
  where status='leased' and lease_expires_at<=now() and attempt_no>=3;
  select * into v_run from public.os_it_intune_health_canary_runs
  where status in ('queued','retry_wait') and next_attempt_at<=now()
    and attempt_no<3
  order by next_attempt_at,created_at for update skip locked limit 1;
  if not found then return null; end if;
  update public.os_it_intune_health_canary_runs set
    status='leased',worker_id=p_worker_id,lease_token=gen_random_uuid(),
    lease_acquired_at=now(),lease_expires_at=now()+make_interval(
      secs=>least(greatest(p_lease_seconds,30),120)),
    attempt_no=attempt_no+1,row_version=row_version+1
  where canary_run_id=v_run.canary_run_id returning * into v_run;
  return v_run;
end;
$$;

create or replace function public.finish_it_intune_health_canary(
  p_canary_run_id uuid,p_worker_id text,p_lease_token uuid,
  p_expected_row_version bigint,p_http_status integer,p_error_code text,
  p_graph_request_id text,p_evidence jsonb
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_run public.os_it_intune_health_canary_runs%rowtype;
  v_outcome text; v_terminal boolean; v_failures integer;
  v_incident public.os_it_intune_health_incidents%rowtype;
begin
  select * into v_run from public.os_it_intune_health_canary_runs
  where canary_run_id=p_canary_run_id for update;
  if not found or v_run.status<>'leased'
     or v_run.worker_id is distinct from p_worker_id
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at<=now()
     or v_run.row_version<>p_expected_row_version then
    raise exception 'Health canary lease/version fence rejected';
  end if;
  -- The database derives outcome. This plane has no action_id, dispatch attempt,
  -- authorization token, or path to authorize_it_intune_dispatch_v4.
  if p_http_status between 200 and 299 then v_outcome:='success';
  elsif p_http_status in (408,425,429) or p_http_status>=500
     or (p_http_status is null and p_error_code='provider_transport')
    then v_outcome:='failure';
  else v_outcome:='ignored'; end if;
  v_terminal:=v_outcome<>'failure' or v_run.attempt_no>=3;
  update public.os_it_intune_health_canary_runs set
    status=case when not v_terminal then 'retry_wait'
      when v_outcome='success' then 'succeeded' else 'failed' end,
    outcome=v_outcome,http_status=p_http_status,
    error_code=left(p_error_code,100),
    graph_request_id=nullif(trim(p_graph_request_id),''),
    evidence=coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object(
      'request_method','GET','dispatch_authorized',false,
      'half_open_canary',false),
    observed_at=now(),next_attempt_at=case when not v_terminal
      then now()+make_interval(secs=>least(300,30*power(2,v_run.attempt_no)::integer))
      else next_attempt_at end,
    worker_id=null,lease_token=null,lease_acquired_at=null,lease_expires_at=null,
    completed_at=case when v_terminal then now() else null end,
    row_version=row_version+1
  where canary_run_id=p_canary_run_id returning * into v_run;
  select count(*) into v_failures from (
    select outcome from public.os_it_intune_health_canary_runs
    where completed_at is not null order by completed_at desc limit 2
  ) recent where outcome='failure';
  if v_failures=2 then
    insert into public.os_it_intune_health_incidents(
      dedupe_key,incident_type,status,severity,last_observed_at,evidence
    ) values (
      'ms_graph:tenant_health_read:unhealthy','read_only_canary','open',
      'warning',now(),jsonb_build_object('consecutive_failures',v_failures)
    ) on conflict (dedupe_key) do update set
      status='open',resolved_at=null,
      last_observed_at=excluded.last_observed_at,
      occurrence_count=os_it_intune_health_incidents.occurrence_count+1,
      evidence=excluded.evidence
    returning * into v_incident;
    insert into public.os_it_intune_health_incident_events(
      incident_id,event_type,evidence
    ) values (
      v_incident.incident_id,
      case when v_incident.occurrence_count=1 then 'opened' else 'reobserved' end,
      v_incident.evidence
    );
  elsif v_outcome='success' then
    update public.os_it_intune_health_incidents set
      status='resolved',resolved_at=now(),last_observed_at=now()
    where dedupe_key='ms_graph:tenant_health_read:unhealthy' and status='open'
    returning * into v_incident;
    if found then
      insert into public.os_it_intune_health_incident_events(
        incident_id,event_type,evidence
      ) values (
        v_incident.incident_id,'resolved',
        jsonb_build_object('canary_run_id',p_canary_run_id)
      );
    end if;
  end if;
  return jsonb_build_object('canary_run_id',p_canary_run_id,
    'status',v_run.status,'outcome',v_outcome,'attempt_no',v_run.attempt_no);
end;
$$;

create or replace function public.correlate_it_intune_provider_outage()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_scopes integer; v_failures integer; v_samples integer;
  v_success_canaries integer; v_evidence jsonb; v_hash text;
  v_episode public.os_it_intune_outage_episodes%rowtype;
  v_from text; v_event text;
begin
  -- Entity identifiers never leave this aggregate query and are not persisted
  -- in episode evidence. The episode is visible only to firm-wide operators.
  select count(distinct b.entity_scope),
    count(*) filter(where o.outcome in ('failure','ambiguous')),count(*)
  into v_scopes,v_failures,v_samples
  from public.os_it_intune_provider_observations o
  join public.os_it_intune_provider_breakers b on b.breaker_id=o.breaker_id
  where o.observed_at>=now()-interval '15 minutes' and o.outcome<>'ignored';
  select count(*) into v_success_canaries from (
    select outcome from public.os_it_intune_health_canary_runs
    where completed_at>=now()-interval '15 minutes'
    order by completed_at desc limit 3
  ) c where outcome='success';
  v_evidence:=jsonb_build_object(
    'evidence_version','phase40-v1','window_minutes',15,
    'correlated_scope_count',coalesce(v_scopes,0),
    'failure_count',coalesce(v_failures,0),
    'sample_count',coalesce(v_samples,0),
    'read_only_canary_successes',coalesce(v_success_canaries,0),
    'entity_identifiers_included',false);
  v_hash:=public.os_sha256_hex(v_evidence::text);
  select * into v_episode from public.os_it_intune_outage_episodes
  where provider='ms_graph' and operation='retire'
    and state in ('active','recovering') for update;
  if not found and coalesce(v_scopes,0)>=2 and coalesce(v_failures,0)>=3 then
    insert into public.os_it_intune_outage_episodes(
      provider,operation,state,started_at,correlated_scope_count,
      failure_count,sample_count,evidence,evidence_sha256
    ) values (
      'ms_graph','retire','active',now(),v_scopes,v_failures,v_samples,
      v_evidence,v_hash
    ) returning * into v_episode;
    v_from:=null; v_event:='detected';
  elsif found then
    v_from:=v_episode.state;
    if v_episode.state='active' and v_success_canaries>=1
       and v_failures=0 then
      update public.os_it_intune_outage_episodes set
        state='recovering',recovering_at=now(),
        correlated_scope_count=v_scopes,failure_count=v_failures,
        sample_count=v_samples,evidence=v_evidence,evidence_sha256=v_hash,
        row_version=row_version+1,updated_at=now()
      where episode_id=v_episode.episode_id returning * into v_episode;
      v_event:='recovering';
    elsif v_episode.state='recovering' and v_success_canaries>=3
       and v_failures=0 then
      update public.os_it_intune_outage_episodes set
        state='resolved',resolved_at=now(),
        correlated_scope_count=v_scopes,failure_count=v_failures,
        sample_count=v_samples,evidence=v_evidence,evidence_sha256=v_hash,
        row_version=row_version+1,updated_at=now()
      where episode_id=v_episode.episode_id returning * into v_episode;
      v_event:='resolved';
    else
      update public.os_it_intune_outage_episodes set
        state=case when v_episode.state='recovering' and v_failures>0
          then 'active' else state end,
        recovering_at=case when v_episode.state='recovering' and v_failures>0
          then null else recovering_at end,
        correlated_scope_count=v_scopes,failure_count=v_failures,
        sample_count=v_samples,evidence=v_evidence,evidence_sha256=v_hash,
        row_version=row_version+1,updated_at=now()
      where episode_id=v_episode.episode_id returning * into v_episode;
      v_event:='evidence_updated';
    end if;
  end if;
  if v_event is not null then
    insert into public.os_it_intune_outage_episode_events(
      episode_id,event_type,from_state,to_state,aggregate_evidence,
      evidence_sha256,episode_version
    ) values (
      v_episode.episode_id,v_event,v_from,v_episode.state,v_evidence,v_hash,
      v_episode.row_version
    );
  end if;
  return jsonb_build_object('episode_id',v_episode.episode_id,
    'state',v_episode.state,'correlated_scope_count',coalesce(v_scopes,0),
    'failures',coalesce(v_failures,0),'samples',coalesce(v_samples,0));
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
  end as blocked_action_count,
  (select count(*) from public.os_it_intune_provider_observations o
    where o.breaker_id=b.breaker_id and o.observed_at>=
      now()-make_interval(mins=>b.failure_window_minutes)
      and o.outcome<>'ignored') as sample_count,
  (select count(*) from public.os_it_intune_provider_observations o
    where o.breaker_id=b.breaker_id and o.observed_at>=
      now()-make_interval(mins=>b.failure_window_minutes)
      and o.outcome in ('failure','ambiguous')) as failure_count,
  b.canary_post_accepted_at,
  b.failure_window_minutes,b.minimum_samples,b.failure_threshold,
  b.failure_rate_threshold,b.reset_success_threshold
from public.os_it_intune_provider_breakers b;
grant select on public.os_it_intune_breaker_health to authenticated;

create or replace view public.os_it_intune_phase40_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_outage_episodes
    where state='active') as active_outage_count,
  (select count(*) from public.os_it_intune_outage_episodes
    where state='recovering') as recovering_outage_count,
  (select count(*) from public.os_it_intune_health_incidents
    where status='open') as open_incident_count,
  (select max(observed_at) from public.os_it_intune_health_canary_runs
    where outcome='success') as last_canary_success_at,
  (select max(observed_at) from public.os_it_intune_health_canary_runs
    where outcome='failure') as last_canary_failure_at,
  (select count(*) from public.os_it_intune_provider_breakers
    where state='open') as open_breaker_count,
  (select count(*) from public.os_it_intune_provider_breakers
    where state='half_open') as recovering_breaker_count,
  case
    when exists (select 1 from public.os_it_intune_outage_episodes
      where state='active') then 'breached'
    when exists (select 1 from public.os_it_intune_health_incidents
      where status='open') then 'warning'
    else 'healthy'
  end as slo_state;
grant select on public.os_it_intune_phase40_health to authenticated;

create or replace view public.os_it_intune_breaker_governance
with (security_invoker=true) as
select b.breaker_id,b.entity_id,b.state,b.row_version as breaker_version,
  b.failure_window_minutes,b.minimum_samples,b.failure_threshold,
  b.failure_rate_threshold,b.reset_success_threshold,
  cv.version_no as config_version_no,cv.risk_class as current_risk_class,
  cv.applied_at as config_applied_at,
  p.proposal_id as pending_proposal_id,p.proposed_by as pending_proposed_by,
  p.risk_class as pending_risk_class,p.proposed_reason as pending_reason,
  p.proposed_failure_window_minutes,p.proposed_minimum_samples,
  p.proposed_failure_threshold,p.proposed_failure_rate_threshold,
  p.proposed_reset_success_threshold,p.expires_at as pending_expires_at
from public.os_it_intune_provider_breakers b
left join lateral (
  select * from public.os_it_intune_breaker_config_versions v
  where v.breaker_id=b.breaker_id order by v.version_no desc limit 1
) cv on true
left join lateral (
  select * from public.os_it_intune_breaker_tuning_proposals candidate
  where candidate.breaker_id=b.breaker_id and candidate.expires_at>now()
    and not exists (
      select 1 from public.os_it_intune_breaker_tuning_decisions d
      where d.proposal_id=candidate.proposal_id
    )
  order by candidate.proposed_at desc limit 1
) p on true;
grant select on public.os_it_intune_breaker_governance to authenticated;

create or replace view public.os_it_intune_outage_status
with (security_invoker=true) as
select episode_id,provider,operation,state,started_at,recovering_at,resolved_at,
  correlated_scope_count,failure_count,sample_count,evidence_sha256,
  row_version,updated_at
from public.os_it_intune_outage_episodes;
grant select on public.os_it_intune_outage_status to authenticated;

revoke all on function public.seed_it_intune_breaker_config_versions()
  from public,authenticated,service_role;
revoke all on function public.propose_it_intune_breaker_tuning(
  uuid,uuid,text,integer,integer,integer,numeric,integer,bigint)
  from public,authenticated;
revoke all on function public.review_it_intune_breaker_tuning(
  uuid,uuid,text,text,bigint) from public,authenticated;
revoke all on function public.enqueue_it_intune_health_canary(uuid)
  from public,authenticated;
revoke all on function public.claim_it_intune_health_canary(text,integer)
  from public,authenticated;
revoke all on function public.finish_it_intune_health_canary(
  uuid,text,uuid,bigint,integer,text,text,jsonb) from public,authenticated;
revoke all on function public.correlate_it_intune_provider_outage()
  from public,authenticated;
grant execute on function public.propose_it_intune_breaker_tuning(
  uuid,uuid,text,integer,integer,integer,numeric,integer,bigint),
  public.review_it_intune_breaker_tuning(uuid,uuid,text,text,bigint),
  public.enqueue_it_intune_health_canary(uuid),
  public.claim_it_intune_health_canary(text,integer),
  public.finish_it_intune_health_canary(
    uuid,text,uuid,bigint,integer,text,text,jsonb),
  public.correlate_it_intune_provider_outage()
  to service_role;
