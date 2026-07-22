-- Phase 42: Intune recommendation soak observations after accepted
-- Phase 41 drafts. Apply after phase41_intune_outage_postmortems.sql.
-- Observations are aggregate-only and append-only. They never close, reset,
-- or mutate open/half-open breaker state.

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

create table if not exists public.os_it_intune_recommendation_soak_observations (
  observation_id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  proposal_id uuid not null
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  soak_status text not null,
  proposal_decision text,
  breaker_state text not null,
  soak_elapsed_minutes integer not null,
  sample_count integer not null default 0,
  failure_count integer not null default 0,
  failure_rate numeric(5,4) not null default 0,
  config_version_no bigint,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  closes_or_resets_breaker boolean not null default false,
  observed_at timestamptz not null default now(),
  constraint os_it_intune_reco_soak_status_check
    check (soak_status in (
      'awaiting_decision','soaking','healthy','degraded',
      'rejected','expired','breaker_open_observed'
    )),
  constraint os_it_intune_reco_soak_decision_check
    check (proposal_decision is null
      or proposal_decision in ('approve','reject')),
  constraint os_it_intune_reco_soak_breaker_state_check
    check (breaker_state in ('closed','open','half_open')),
  constraint os_it_intune_reco_soak_counts_check
    check (sample_count>=0 and failure_count>=0
      and failure_count<=sample_count
      and failure_rate between 0 and 1
      and soak_elapsed_minutes>=0),
  constraint os_it_intune_reco_soak_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_reco_soak_never_close_reset_check
    check (closes_or_resets_breaker=false),
  constraint os_it_intune_reco_soak_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_reco_soak_reco_observed_idx
  on public.os_it_intune_recommendation_soak_observations(
    recommendation_id, observed_at desc, observation_id desc);
create index if not exists os_it_intune_reco_soak_status_idx
  on public.os_it_intune_recommendation_soak_observations(soak_status, observed_at desc);

alter table public.os_it_intune_recommendation_soak_observations
  enable row level security;

drop policy if exists "os_it_intune_reco_soak_select"
  on public.os_it_intune_recommendation_soak_observations;
create policy "os_it_intune_reco_soak_select"
  on public.os_it_intune_recommendation_soak_observations for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=os_it_intune_recommendation_soak_observations.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));

grant select on public.os_it_intune_recommendation_soak_observations to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_recommendation_soak_observations
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase42_soak_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 42 Intune soak evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_reco_soak_append_only
  on public.os_it_intune_recommendation_soak_observations;
create trigger os_it_intune_reco_soak_append_only
  before update or delete
  on public.os_it_intune_recommendation_soak_observations
  for each row execute function public.prevent_it_intune_phase42_soak_mutation();

drop trigger if exists os_it_intune_reco_soak_no_truncate
  on public.os_it_intune_recommendation_soak_observations;
create trigger os_it_intune_reco_soak_no_truncate
  before truncate
  on public.os_it_intune_recommendation_soak_observations
  for each statement execute function public.prevent_it_intune_phase42_soak_mutation();

create or replace function public.it_intune_phase42_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.observe_it_intune_recommendation_soak_phase42()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_reco record;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_decision text;
  v_proposal_expires_at timestamptz;
  v_config public.os_it_intune_breaker_config_versions%rowtype;
  v_samples integer;
  v_failures integer;
  v_rate numeric(5,4);
  v_elapsed integer;
  v_status text;
  v_evidence jsonb;
  v_hash text;
  v_observed integer:=0;
  v_healthy integer:=0;
  v_degraded integer:=0;
  v_awaiting integer:=0;
  v_open_observed integer:=0;
  v_min_soak_minutes integer:=60;
begin
  -- Soak observations never update breaker rows and never call reset/close RPCs.
  for v_reco in
    select d.recommendation_id,d.breaker_id,d.resulting_proposal_id as proposal_id,
      d.accepted_at,d.evidence_sha256 as recommendation_evidence_sha256,
      d.recommended_failure_rate_threshold,d.recommended_minimum_samples
    from public.os_it_intune_threshold_recommendation_drafts d
    where d.status='accepted'
      and d.resulting_proposal_id is not null
      and d.accepted_at is not null
    order by d.accepted_at desc
    limit 25
  loop
    select * into v_breaker from public.os_it_intune_provider_breakers
    where breaker_id=v_reco.breaker_id;
    if not found then
      continue;
    end if;

    v_decision:=null;
    v_proposal_expires_at:=null;
    select d.decision, p.expires_at
    into v_decision, v_proposal_expires_at
    from public.os_it_intune_breaker_tuning_proposals p
    left join public.os_it_intune_breaker_tuning_decisions d
      on d.proposal_id=p.proposal_id
    where p.proposal_id=v_reco.proposal_id;

    v_config:=null;
    select * into v_config
    from public.os_it_intune_breaker_config_versions
    where breaker_id=v_reco.breaker_id
    order by version_no desc limit 1;

    v_samples:=0;
    v_failures:=0;
    select count(*) filter (where o.outcome<>'ignored'),
      count(*) filter (where o.outcome in ('failure','ambiguous'))
    into v_samples, v_failures
    from public.os_it_intune_provider_observations o
    where o.breaker_id=v_reco.breaker_id
      and o.observed_at>=v_reco.accepted_at;

    if coalesce(v_samples,0)>0 then
      v_rate:=round((v_failures::numeric/v_samples::numeric),4);
    else
      v_rate:=0;
    end if;
    v_elapsed:=greatest(0,ceil(extract(epoch from (now()-v_reco.accepted_at))/60.0));

    if v_breaker.state in ('open','half_open') then
      v_status:='breaker_open_observed';
      v_open_observed:=v_open_observed+1;
    elsif v_decision='reject' then
      v_status:='rejected';
    elsif v_decision is null
       and v_proposal_expires_at is not null
       and v_proposal_expires_at<=now() then
      v_status:='expired';
    elsif v_decision is null then
      v_status:='awaiting_decision';
      v_awaiting:=v_awaiting+1;
    elsif v_elapsed<v_min_soak_minutes
       or coalesce(v_samples,0)<greatest(
            coalesce(v_config.minimum_samples,v_reco.recommended_minimum_samples),3)
    then
      v_status:='soaking';
    elsif v_rate>
          coalesce(v_config.failure_rate_threshold,
            v_reco.recommended_failure_rate_threshold) then
      v_status:='degraded';
      v_degraded:=v_degraded+1;
    else
      v_status:='healthy';
      v_healthy:=v_healthy+1;
    end if;

    v_evidence:=public.it_intune_phase42_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase42-v1',
      'recommendation_id',v_reco.recommendation_id,
      'proposal_id',v_reco.proposal_id,
      'breaker_id',v_reco.breaker_id,
      'soak_status',v_status,
      'proposal_decision',v_decision,
      'breaker_state',v_breaker.state,
      'soak_elapsed_minutes',v_elapsed,
      'sample_count',coalesce(v_samples,0),
      'failure_count',coalesce(v_failures,0),
      'failure_rate',v_rate,
      'config_version_no',v_config.version_no,
      'min_soak_minutes',v_min_soak_minutes,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);

    insert into public.os_it_intune_recommendation_soak_observations(
      recommendation_id,proposal_id,breaker_id,soak_status,proposal_decision,
      breaker_state,soak_elapsed_minutes,sample_count,failure_count,failure_rate,
      config_version_no,aggregate_evidence,evidence_sha256,closes_or_resets_breaker
    ) values (
      v_reco.recommendation_id,v_reco.proposal_id,v_reco.breaker_id,v_status,
      v_decision,v_breaker.state,v_elapsed,coalesce(v_samples,0),
      coalesce(v_failures,0),v_rate,v_config.version_no,v_evidence,v_hash,false
    );
    v_observed:=v_observed+1;
  end loop;

  return jsonb_build_object(
    'observations_recorded',v_observed,
    'healthy_count',v_healthy,
    'degraded_count',v_degraded,
    'awaiting_decision_count',v_awaiting,
    'breaker_open_observed_count',v_open_observed,
    'closes_or_resets_breaker',false
  );
end;
$$;

create or replace function public.get_it_intune_phase42_ops_report()
returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare
  v_latest jsonb;
  v_health jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.accepted_at desc),'[]'::jsonb)
  into v_latest
  from (
    select d.recommendation_id,d.breaker_id,d.resulting_proposal_id as proposal_id,
      d.accepted_at,d.risk_class,b.provider,b.operation,b.state as breaker_state,
      s.soak_status,s.soak_elapsed_minutes,s.sample_count,s.failure_count,
      s.failure_rate,s.proposal_decision,s.observed_at as last_observed_at,
      s.evidence_sha256 as soak_evidence_sha256
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
    where d.status='accepted'
    order by d.accepted_at desc
    limit 50
  ) x;

  select jsonb_build_object(
    'accepted_recommendation_count',
      (select count(*) from public.os_it_intune_threshold_recommendation_drafts
        where status='accepted'),
    'soak_observation_count',
      (select count(*) from public.os_it_intune_recommendation_soak_observations),
    'awaiting_decision_count',
      (select count(*) from (
        select distinct on (o.recommendation_id) o.soak_status
        from public.os_it_intune_recommendation_soak_observations o
        order by o.recommendation_id,o.observed_at desc,o.observation_id desc
      ) latest where soak_status='awaiting_decision'),
    'soaking_count',
      (select count(*) from (
        select distinct on (o.recommendation_id) o.soak_status
        from public.os_it_intune_recommendation_soak_observations o
        order by o.recommendation_id,o.observed_at desc,o.observation_id desc
      ) latest where soak_status='soaking'),
    'healthy_count',
      (select count(*) from (
        select distinct on (o.recommendation_id) o.soak_status
        from public.os_it_intune_recommendation_soak_observations o
        order by o.recommendation_id,o.observed_at desc,o.observation_id desc
      ) latest where soak_status='healthy'),
    'degraded_count',
      (select count(*) from (
        select distinct on (o.recommendation_id) o.soak_status
        from public.os_it_intune_recommendation_soak_observations o
        order by o.recommendation_id,o.observed_at desc,o.observation_id desc
      ) latest where soak_status='degraded'),
    'breaker_open_observed_count',
      (select count(*) from (
        select distinct on (o.recommendation_id) o.soak_status
        from public.os_it_intune_recommendation_soak_observations o
        order by o.recommendation_id,o.observed_at desc,o.observation_id desc
      ) latest where soak_status='breaker_open_observed'),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ) into v_health;

  return v_health || jsonb_build_object('accepted_recommendations',v_latest);
end;
$$;

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
  s.observed_at as soak_observed_at,s.evidence_sha256 as soak_evidence_sha256
from public.os_it_intune_threshold_recommendation_drafts d
join public.os_it_intune_provider_breakers b on b.breaker_id=d.breaker_id
left join lateral (
  select o.soak_status,o.soak_elapsed_minutes,o.sample_count,o.failure_count,
    o.failure_rate,o.proposal_decision,o.observed_at,o.evidence_sha256
  from public.os_it_intune_recommendation_soak_observations o
  where o.recommendation_id=d.recommendation_id
  order by o.observed_at desc,o.observation_id desc
  limit 1
) s on true;
grant select on public.os_it_intune_recommendation_soak_status to authenticated;

create or replace view public.os_it_intune_phase42_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_threshold_recommendation_drafts
    where status='accepted') as accepted_recommendation_count,
  (select count(*) from public.os_it_intune_recommendation_soak_observations)
    as soak_observation_count,
  (select count(*) from (
    select distinct on (o.recommendation_id) o.soak_status
    from public.os_it_intune_recommendation_soak_observations o
    order by o.recommendation_id,o.observed_at desc,o.observation_id desc
  ) latest where soak_status='awaiting_decision') as awaiting_decision_count,
  (select count(*) from (
    select distinct on (o.recommendation_id) o.soak_status
    from public.os_it_intune_recommendation_soak_observations o
    order by o.recommendation_id,o.observed_at desc,o.observation_id desc
  ) latest where soak_status='soaking') as soaking_count,
  (select count(*) from (
    select distinct on (o.recommendation_id) o.soak_status
    from public.os_it_intune_recommendation_soak_observations o
    order by o.recommendation_id,o.observed_at desc,o.observation_id desc
  ) latest where soak_status='healthy') as healthy_count,
  (select count(*) from (
    select distinct on (o.recommendation_id) o.soak_status
    from public.os_it_intune_recommendation_soak_observations o
    order by o.recommendation_id,o.observed_at desc,o.observation_id desc
  ) latest where soak_status='degraded') as degraded_count,
  (select count(*) from (
    select distinct on (o.recommendation_id) o.soak_status
    from public.os_it_intune_recommendation_soak_observations o
    order by o.recommendation_id,o.observed_at desc,o.observation_id desc
  ) latest where soak_status='breaker_open_observed')
    as breaker_open_observed_count;
grant select on public.os_it_intune_phase42_health to authenticated;

revoke all on function public.it_intune_phase42_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.observe_it_intune_recommendation_soak_phase42()
  from public,authenticated;
revoke all on function public.get_it_intune_phase42_ops_report()
  from public,authenticated;

grant execute on function public.observe_it_intune_recommendation_soak_phase42(),
  public.get_it_intune_phase42_ops_report()
  to service_role;
