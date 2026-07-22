-- Phase 43: Intune soak open→closed cycle completion evidence.
-- Apply after phase42_intune_recommendation_soak.sql.
-- Records aggregate-only evidence when a breaker naturally returns to closed
-- after a Phase 42 breaker_open_observed soak row. Never closes, resets, or
-- mutates breaker state. Does not rebuild postmortems or recommendations.

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

-- Extend Phase 42 soak statuses for natural close / cycle completion.
alter table public.os_it_intune_recommendation_soak_observations
  drop constraint if exists os_it_intune_reco_soak_status_check;
alter table public.os_it_intune_recommendation_soak_observations
  add constraint os_it_intune_reco_soak_status_check
  check (soak_status in (
    'awaiting_decision','soaking','healthy','degraded',
    'rejected','expired','breaker_open_observed',
    'breaker_closed_observed','cycle_complete'
  ));

create table if not exists public.os_it_intune_soak_cycle_evidence (
  cycle_id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  proposal_id uuid not null
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  open_observation_id uuid not null
    references public.os_it_intune_recommendation_soak_observations(observation_id),
  closed_observation_id uuid not null
    references public.os_it_intune_recommendation_soak_observations(observation_id),
  open_observed_at timestamptz not null,
  closed_observed_at timestamptz not null,
  cycle_elapsed_minutes integer not null,
  open_breaker_state text not null,
  closed_breaker_state text not null,
  cycle_status text not null,
  sample_count integer not null default 0,
  failure_count integer not null default 0,
  failure_rate numeric(5,4) not null default 0,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  closes_or_resets_breaker boolean not null default false,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_soak_cycle_open_state_check
    check (open_breaker_state in ('open','half_open')),
  constraint os_it_intune_soak_cycle_closed_state_check
    check (closed_breaker_state = 'closed'),
  constraint os_it_intune_soak_cycle_status_check
    check (cycle_status = 'cycle_complete'),
  constraint os_it_intune_soak_cycle_elapsed_check
    check (cycle_elapsed_minutes>=0
      and closed_observed_at>=open_observed_at),
  constraint os_it_intune_soak_cycle_counts_check
    check (sample_count>=0 and failure_count>=0
      and failure_count<=sample_count
      and failure_rate between 0 and 1),
  constraint os_it_intune_soak_cycle_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_soak_cycle_never_close_reset_check
    check (closes_or_resets_breaker = false),
  constraint os_it_intune_soak_cycle_obs_distinct_check
    check (open_observation_id<>closed_observation_id),
  constraint os_it_intune_soak_cycle_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_soak_cycle_open_unique
    unique (recommendation_id, open_observation_id)
);

create index if not exists os_it_intune_soak_cycle_reco_recorded_idx
  on public.os_it_intune_soak_cycle_evidence(
    recommendation_id, recorded_at desc, cycle_id desc);
create index if not exists os_it_intune_soak_cycle_breaker_recorded_idx
  on public.os_it_intune_soak_cycle_evidence(
    breaker_id, recorded_at desc);

alter table public.os_it_intune_soak_cycle_evidence
  enable row level security;

drop policy if exists "os_it_intune_soak_cycle_select"
  on public.os_it_intune_soak_cycle_evidence;
create policy "os_it_intune_soak_cycle_select"
  on public.os_it_intune_soak_cycle_evidence for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=os_it_intune_soak_cycle_evidence.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));

grant select on public.os_it_intune_soak_cycle_evidence to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_soak_cycle_evidence
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase43_cycle_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 43 Intune soak cycle evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_soak_cycle_append_only
  on public.os_it_intune_soak_cycle_evidence;
create trigger os_it_intune_soak_cycle_append_only
  before update or delete
  on public.os_it_intune_soak_cycle_evidence
  for each row execute function public.prevent_it_intune_phase43_cycle_mutation();

drop trigger if exists os_it_intune_soak_cycle_no_truncate
  on public.os_it_intune_soak_cycle_evidence;
create trigger os_it_intune_soak_cycle_no_truncate
  before truncate
  on public.os_it_intune_soak_cycle_evidence
  for each statement execute function public.prevent_it_intune_phase43_cycle_mutation();

create or replace function public.it_intune_phase43_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.record_it_intune_soak_cycle_evidence_phase43()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_reco record;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_open public.os_it_intune_recommendation_soak_observations%rowtype;
  v_closed_id uuid;
  v_samples integer;
  v_failures integer;
  v_rate numeric(5,4);
  v_elapsed integer;
  v_evidence jsonb;
  v_hash text;
  v_obs_hash text;
  v_obs_evidence jsonb;
  v_cycles integer:=0;
  v_skipped_open integer:=0;
  v_skipped_no_open integer:=0;
  v_skipped_unpublished integer:=0;
begin
  -- Cycle evidence never updates breaker rows and never calls reset/close RPCs.
  for v_reco in
    select d.recommendation_id,d.breaker_id,d.resulting_proposal_id as proposal_id,
      d.accepted_at,d.postmortem_id,pm.status as postmortem_status
    from public.os_it_intune_threshold_recommendation_drafts d
    left join public.os_it_intune_outage_postmortems pm
      on pm.postmortem_id=d.postmortem_id
    where d.status='accepted'
      and d.resulting_proposal_id is not null
      and d.accepted_at is not null
    order by d.accepted_at desc
    limit 25
  loop
    if v_reco.postmortem_id is null
       or coalesce(v_reco.postmortem_status,'')<>'published' then
      v_skipped_unpublished:=v_skipped_unpublished+1;
      continue;
    end if;

    select * into v_breaker from public.os_it_intune_provider_breakers
    where breaker_id=v_reco.breaker_id;
    if not found then
      continue;
    end if;

    -- Only record when the breaker has naturally returned to closed.
    if v_breaker.state<>'closed' then
      v_skipped_open:=v_skipped_open+1;
      continue;
    end if;

    v_open:=null;
    select o.* into v_open
    from public.os_it_intune_recommendation_soak_observations o
    where o.recommendation_id=v_reco.recommendation_id
      and o.soak_status='breaker_open_observed'
      and o.observed_at>=v_reco.accepted_at
      and not exists (
        select 1 from public.os_it_intune_soak_cycle_evidence c
        where c.recommendation_id=o.recommendation_id
          and c.open_observation_id=o.observation_id
      )
    order by o.observed_at asc, o.observation_id asc
    limit 1;

    if not found then
      v_skipped_no_open:=v_skipped_no_open+1;
      continue;
    end if;

    v_samples:=0;
    v_failures:=0;
    select count(*) filter (where o.outcome<>'ignored'),
      count(*) filter (where o.outcome in ('failure','ambiguous'))
    into v_samples, v_failures
    from public.os_it_intune_provider_observations o
    where o.breaker_id=v_reco.breaker_id
      and o.observed_at>=v_open.observed_at
      and o.observed_at<=now();

    if coalesce(v_samples,0)>0 then
      v_rate:=round((v_failures::numeric/v_samples::numeric),4);
    else
      v_rate:=0;
    end if;
    v_elapsed:=greatest(0,ceil(extract(epoch from (now()-v_open.observed_at))/60.0));

    -- Append closed-observed then cycle_complete so latest soak status is complete.
    v_obs_evidence:=public.it_intune_phase43_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase43-v1',
      'observation_kind','breaker_closed_observed',
      'recommendation_id',v_reco.recommendation_id,
      'proposal_id',v_reco.proposal_id,
      'breaker_id',v_reco.breaker_id,
      'postmortem_id',v_reco.postmortem_id,
      'open_observation_id',v_open.observation_id,
      'soak_status','breaker_closed_observed',
      'breaker_state','closed',
      'open_breaker_state',v_open.breaker_state,
      'cycle_elapsed_minutes',v_elapsed,
      'sample_count',coalesce(v_samples,0),
      'failure_count',coalesce(v_failures,0),
      'failure_rate',v_rate,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_obs_hash:=public.os_sha256_hex(v_obs_evidence::text);

    insert into public.os_it_intune_recommendation_soak_observations(
      recommendation_id,proposal_id,breaker_id,soak_status,proposal_decision,
      breaker_state,soak_elapsed_minutes,sample_count,failure_count,failure_rate,
      config_version_no,aggregate_evidence,evidence_sha256,closes_or_resets_breaker
    ) values (
      v_reco.recommendation_id,v_reco.proposal_id,v_reco.breaker_id,
      'breaker_closed_observed',null,'closed',v_elapsed,coalesce(v_samples,0),
      coalesce(v_failures,0),v_rate,null,v_obs_evidence,v_obs_hash,false
    );

    v_obs_evidence:=public.it_intune_phase43_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase43-v1',
      'observation_kind','cycle_complete',
      'recommendation_id',v_reco.recommendation_id,
      'proposal_id',v_reco.proposal_id,
      'breaker_id',v_reco.breaker_id,
      'postmortem_id',v_reco.postmortem_id,
      'open_observation_id',v_open.observation_id,
      'soak_status','cycle_complete',
      'breaker_state','closed',
      'open_breaker_state',v_open.breaker_state,
      'cycle_elapsed_minutes',v_elapsed,
      'sample_count',coalesce(v_samples,0),
      'failure_count',coalesce(v_failures,0),
      'failure_rate',v_rate,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_obs_hash:=public.os_sha256_hex(v_obs_evidence::text);

    insert into public.os_it_intune_recommendation_soak_observations(
      recommendation_id,proposal_id,breaker_id,soak_status,proposal_decision,
      breaker_state,soak_elapsed_minutes,sample_count,failure_count,failure_rate,
      config_version_no,aggregate_evidence,evidence_sha256,closes_or_resets_breaker
    ) values (
      v_reco.recommendation_id,v_reco.proposal_id,v_reco.breaker_id,
      'cycle_complete',null,'closed',v_elapsed,coalesce(v_samples,0),
      coalesce(v_failures,0),v_rate,null,v_obs_evidence,v_obs_hash,false
    ) returning observation_id into v_closed_id;

    v_evidence:=public.it_intune_phase43_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase43-v1',
      'cycle_status','cycle_complete',
      'recommendation_id',v_reco.recommendation_id,
      'proposal_id',v_reco.proposal_id,
      'breaker_id',v_reco.breaker_id,
      'postmortem_id',v_reco.postmortem_id,
      'open_observation_id',v_open.observation_id,
      'closed_observation_id',v_closed_id,
      'open_observed_at',v_open.observed_at,
      'closed_observed_at',now(),
      'open_breaker_state',v_open.breaker_state,
      'closed_breaker_state','closed',
      'cycle_elapsed_minutes',v_elapsed,
      'sample_count',coalesce(v_samples,0),
      'failure_count',coalesce(v_failures,0),
      'failure_rate',v_rate,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_soak_cycle_evidence(
      recommendation_id,proposal_id,breaker_id,postmortem_id,
      open_observation_id,closed_observation_id,open_observed_at,
      closed_observed_at,cycle_elapsed_minutes,open_breaker_state,
      closed_breaker_state,cycle_status,sample_count,failure_count,
      failure_rate,aggregate_evidence,evidence_sha256,closes_or_resets_breaker
    ) values (
      v_reco.recommendation_id,v_reco.proposal_id,v_reco.breaker_id,
      v_reco.postmortem_id,v_open.observation_id,v_closed_id,
      v_open.observed_at,now(),v_elapsed,v_open.breaker_state,'closed',
      'cycle_complete',coalesce(v_samples,0),coalesce(v_failures,0),
      v_rate,v_evidence,v_hash,false
    );
    v_cycles:=v_cycles+1;
  end loop;

  return jsonb_build_object(
    'cycles_recorded',v_cycles,
    'skipped_breaker_still_open',v_skipped_open,
    'skipped_no_open_observation',v_skipped_no_open,
    'skipped_unpublished_postmortem',v_skipped_unpublished,
    'closes_or_resets_breaker',false
  );
end;
$$;

create or replace function public.get_it_intune_phase43_ops_report()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_latest jsonb;
  v_health jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),'[]'::jsonb)
  into v_latest
  from (
    select c.cycle_id,c.recommendation_id,c.proposal_id,c.breaker_id,
      c.postmortem_id,c.open_observation_id,c.closed_observation_id,
      c.open_observed_at,c.closed_observed_at,c.cycle_elapsed_minutes,
      c.open_breaker_state,c.closed_breaker_state,c.cycle_status,
      c.sample_count,c.failure_count,c.failure_rate,c.evidence_sha256,
      c.recorded_at,b.provider,b.operation,b.state as breaker_state
    from public.os_it_intune_soak_cycle_evidence c
    join public.os_it_intune_provider_breakers b on b.breaker_id=c.breaker_id
    order by c.recorded_at desc
    limit 50
  ) x;

  select jsonb_build_object(
    'cycle_evidence_count',
      (select count(*) from public.os_it_intune_soak_cycle_evidence),
    'cycle_complete_count',
      (select count(*) from public.os_it_intune_soak_cycle_evidence
        where cycle_status='cycle_complete'),
    'open_awaiting_close_count',
      (select count(*) from (
        select o.observation_id
        from public.os_it_intune_recommendation_soak_observations o
        where o.soak_status='breaker_open_observed'
          and not exists (
            select 1 from public.os_it_intune_soak_cycle_evidence c
            where c.open_observation_id=o.observation_id
          )
      ) pending),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health;

  return v_health || jsonb_build_object('completed_cycles',v_latest);
end;
$$;

create or replace view public.os_it_intune_soak_cycle_timeline
with (security_invoker=true) as
select c.cycle_id,c.recommendation_id,c.proposal_id,c.breaker_id,
  c.postmortem_id,c.open_observation_id,c.closed_observation_id,
  c.open_observed_at,c.closed_observed_at,c.cycle_elapsed_minutes,
  c.open_breaker_state,c.closed_breaker_state,c.cycle_status,
  c.sample_count,c.failure_count,c.failure_rate,c.evidence_sha256,
  c.recorded_at,c.closes_or_resets_breaker,b.entity_id,b.provider,
  b.operation,b.state as breaker_state,d.accepted_at,d.risk_class,
  pm.status as postmortem_status
from public.os_it_intune_soak_cycle_evidence c
join public.os_it_intune_provider_breakers b on b.breaker_id=c.breaker_id
join public.os_it_intune_threshold_recommendation_drafts d
  on d.recommendation_id=c.recommendation_id
left join public.os_it_intune_outage_postmortems pm
  on pm.postmortem_id=c.postmortem_id;
grant select on public.os_it_intune_soak_cycle_timeline to authenticated;

create or replace view public.os_it_intune_phase43_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_soak_cycle_evidence)
    as cycle_evidence_count,
  (select count(*) from public.os_it_intune_soak_cycle_evidence
    where cycle_status='cycle_complete') as cycle_complete_count,
  (select count(*) from (
    select o.observation_id
    from public.os_it_intune_recommendation_soak_observations o
    where o.soak_status='breaker_open_observed'
      and not exists (
        select 1 from public.os_it_intune_soak_cycle_evidence c
        where c.open_observation_id=o.observation_id
      )
  ) pending) as open_awaiting_close_count;
grant select on public.os_it_intune_phase43_health to authenticated;

-- Refresh Phase 42 status view so cycle_complete / closed statuses flow through.
create or replace view public.os_it_intune_recommendation_soak_status
with (security_invoker=true) as
select d.recommendation_id,d.episode_id,d.postmortem_id,d.breaker_id,d.status,
  d.base_config_version_no,d.recommended_failure_window_minutes,
  d.recommended_minimum_samples,d.recommended_failure_threshold,
  d.recommended_failure_rate_threshold,d.recommended_reset_success_threshold,
  d.risk_class,d.rationale,d.evidence_sha256,d.generated_at,d.expires_at,
  d.accepted_by,d.accepted_at,d.resulting_proposal_id,d.dismissed_by,
  d.dismissed_at,d.row_version,b.entity_id,b.provider,b.operation,b.state
    as breaker_state,b.row_version as breaker_version,
  s.soak_status,s.soak_elapsed_minutes,s.sample_count as soak_sample_count,
  s.failure_count as soak_failure_count,s.failure_rate as soak_failure_rate,
  s.proposal_decision as soak_proposal_decision,
  s.observed_at as soak_observed_at,s.evidence_sha256 as soak_evidence_sha256,
  cy.cycle_id as soak_cycle_id,cy.cycle_status as soak_cycle_status,
  cy.cycle_elapsed_minutes as soak_cycle_elapsed_minutes,
  cy.open_observed_at as soak_cycle_open_at,
  cy.closed_observed_at as soak_cycle_closed_at,
  cy.evidence_sha256 as soak_cycle_evidence_sha256
from public.os_it_intune_threshold_recommendation_drafts d
join public.os_it_intune_provider_breakers b on b.breaker_id=d.breaker_id
left join lateral (
  select o.soak_status,o.soak_elapsed_minutes,o.sample_count,o.failure_count,
    o.failure_rate,o.proposal_decision,o.observed_at,o.evidence_sha256
  from public.os_it_intune_recommendation_soak_observations o
  where o.recommendation_id=d.recommendation_id
  order by o.observed_at desc,o.observation_id desc
  limit 1
) s on true
left join lateral (
  select c.cycle_id,c.cycle_status,c.cycle_elapsed_minutes,c.open_observed_at,
    c.closed_observed_at,c.evidence_sha256
  from public.os_it_intune_soak_cycle_evidence c
  where c.recommendation_id=d.recommendation_id
  order by c.recorded_at desc,c.cycle_id desc
  limit 1
) cy on true;
grant select on public.os_it_intune_recommendation_soak_status to authenticated;

revoke all on function public.it_intune_phase43_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.record_it_intune_soak_cycle_evidence_phase43()
  from public,authenticated;
revoke all on function public.get_it_intune_phase43_ops_report()
  from public,authenticated;

grant execute on function public.record_it_intune_soak_cycle_evidence_phase43(),
  public.get_it_intune_phase43_ops_report()
  to service_role;
