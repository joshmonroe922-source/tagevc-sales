-- Phase 41: Intune outage postmortems and bounded threshold recommendation
-- drafts. Apply after phase40_intune_resilience_observability.sql.
-- Recommendations create Phase 40 tuning proposals only — they never close,
-- reset, or mutate open/half-open breaker state.

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

create table if not exists public.os_it_intune_outage_postmortems (
  postmortem_id uuid primary key default gen_random_uuid(),
  episode_id uuid not null unique
    references public.os_it_intune_outage_episodes(episode_id),
  status text not null default 'draft',
  root_cause_class text not null default 'unknown',
  timeline jsonb not null,
  timeline_sha256 text not null,
  blameless_notes text not null default '',
  blameless_notes_sha256 text not null,
  aggregate_evidence jsonb not null,
  aggregate_evidence_sha256 text not null,
  drafted_by uuid,
  drafted_at timestamptz not null default now(),
  published_by uuid,
  published_at timestamptz,
  publish_statement text,
  rejected_by uuid,
  rejected_at timestamptz,
  reject_statement text,
  row_version bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_it_intune_postmortem_status_check
    check (status in ('draft','published','rejected')),
  constraint os_it_intune_postmortem_cause_check
    check (root_cause_class in (
      'provider_outage','threshold_too_sensitive','thin_sampling',
      'multi_scope_correlation','unknown'
    )),
  constraint os_it_intune_postmortem_hash_check check (
    timeline_sha256~'^[0-9a-f]{64}$'
    and blameless_notes_sha256~'^[0-9a-f]{64}$'
    and aggregate_evidence_sha256~'^[0-9a-f]{64}$'
  ),
  constraint os_it_intune_postmortem_publish_check check (
    (status='draft' and published_by is null and published_at is null
      and publish_statement is null)
    or
    (status='published' and published_by is not null and published_at is not null
      and length(trim(coalesce(publish_statement,'')))>=20)
    or
    (status='rejected' and rejected_by is not null and rejected_at is not null
      and length(trim(coalesce(reject_statement,'')))>=20)
  ),
  constraint os_it_intune_postmortem_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
    and not (timeline ? 'entity_id')
    and not (timeline ? 'entity_ids')
  )
);

create table if not exists public.os_it_intune_outage_postmortem_events (
  event_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  event_type text not null,
  actor_id uuid,
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_it_intune_postmortem_event_type_check
    check (event_type in ('drafted','updated','published','rejected')),
  constraint os_it_intune_postmortem_event_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_postmortem_event_no_entity_leak check (
    not (detail ? 'entity_id')
    and not (detail ? 'entity_ids')
    and coalesce((detail->>'entity_identifiers_included')::boolean,false)=false
  )
);

create table if not exists public.os_it_intune_threshold_recommendation_drafts (
  recommendation_id uuid primary key default gen_random_uuid(),
  episode_id uuid not null
    references public.os_it_intune_outage_episodes(episode_id),
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  breaker_id uuid not null
    references public.os_it_intune_provider_breakers(breaker_id),
  status text not null default 'pending',
  base_config_version_no bigint not null,
  recommended_failure_window_minutes integer not null,
  recommended_minimum_samples integer not null,
  recommended_failure_threshold integer not null,
  recommended_failure_rate_threshold numeric(5,4) not null,
  recommended_reset_success_threshold integer not null,
  risk_class text not null,
  rationale text not null,
  aggregate_evidence jsonb not null,
  evidence_sha256 text not null,
  generated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now()+interval '7 days'),
  accepted_by uuid,
  accepted_at timestamptz,
  resulting_proposal_id uuid
    references public.os_it_intune_breaker_tuning_proposals(proposal_id),
  dismissed_by uuid,
  dismissed_at timestamptz,
  dismiss_statement text,
  row_version bigint not null default 0,
  constraint os_it_intune_reco_status_check
    check (status in ('pending','accepted','dismissed','expired')),
  constraint os_it_intune_reco_risk_check
    check (risk_class in ('standard','riskier')),
  constraint os_it_intune_reco_bounds check (
    recommended_failure_window_minutes between 5 and 120
    and recommended_minimum_samples between 3 and 50
    and recommended_failure_threshold between 2 and recommended_minimum_samples
    and recommended_failure_rate_threshold between 0.2500 and 0.9500
    and recommended_reset_success_threshold between 2 and 10
  ),
  constraint os_it_intune_reco_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$'),
  constraint os_it_intune_reco_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_reco_accept_check check (
    (status<>'accepted' and resulting_proposal_id is null and accepted_by is null
      and accepted_at is null)
    or
    (status='accepted' and resulting_proposal_id is not null
      and accepted_by is not null and accepted_at is not null)
  )
);

create unique index if not exists os_it_intune_one_pending_reco_per_breaker_episode
  on public.os_it_intune_threshold_recommendation_drafts(episode_id,breaker_id)
  where status='pending';

create table if not exists public.os_it_intune_threshold_recommendation_events (
  event_id uuid primary key default gen_random_uuid(),
  recommendation_id uuid not null
    references public.os_it_intune_threshold_recommendation_drafts(recommendation_id),
  event_type text not null,
  actor_id uuid,
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_it_intune_reco_event_type_check
    check (event_type in ('generated','accepted','dismissed','expired')),
  constraint os_it_intune_reco_event_hash_check
    check (evidence_sha256~'^[0-9a-f]{64}$')
);

alter table public.os_it_intune_outage_postmortems enable row level security;
alter table public.os_it_intune_outage_postmortem_events enable row level security;
alter table public.os_it_intune_threshold_recommendation_drafts enable row level security;
alter table public.os_it_intune_threshold_recommendation_events enable row level security;

drop policy if exists "os_it_intune_postmortem_select"
  on public.os_it_intune_outage_postmortems;
create policy "os_it_intune_postmortem_select"
  on public.os_it_intune_outage_postmortems for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_postmortem_event_select"
  on public.os_it_intune_outage_postmortem_events;
create policy "os_it_intune_postmortem_event_select"
  on public.os_it_intune_outage_postmortem_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_it_intune_reco_select"
  on public.os_it_intune_threshold_recommendation_drafts;
create policy "os_it_intune_reco_select"
  on public.os_it_intune_threshold_recommendation_drafts for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_provider_breakers b
    where b.breaker_id=os_it_intune_threshold_recommendation_drafts.breaker_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));
drop policy if exists "os_it_intune_reco_event_select"
  on public.os_it_intune_threshold_recommendation_events;
create policy "os_it_intune_reco_event_select"
  on public.os_it_intune_threshold_recommendation_events for select to authenticated
  using (exists (
    select 1 from public.os_it_intune_threshold_recommendation_drafts d
    join public.os_it_intune_provider_breakers b on b.breaker_id=d.breaker_id
    where d.recommendation_id=
      os_it_intune_threshold_recommendation_events.recommendation_id
      and (public.is_firm_wide_access()
        or (b.entity_id is not null and public.can_access_entity(b.entity_id)))
  ));

grant select on public.os_it_intune_outage_postmortems,
  public.os_it_intune_outage_postmortem_events,
  public.os_it_intune_threshold_recommendation_drafts,
  public.os_it_intune_threshold_recommendation_events to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_outage_postmortems,
  public.os_it_intune_outage_postmortem_events,
  public.os_it_intune_threshold_recommendation_drafts,
  public.os_it_intune_threshold_recommendation_events
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase41_event_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 41 Intune evidence is append-only';
end;
$$;

do $phase41_triggers$
declare v_table text;
begin
  foreach v_table in array array[
    'os_it_intune_outage_postmortem_events',
    'os_it_intune_threshold_recommendation_events'
  ] loop
    execute format('drop trigger if exists %I on public.%I',
      v_table||'_append_only',v_table);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.prevent_it_intune_phase41_event_mutation()',
      v_table||'_append_only',v_table);
    execute format('drop trigger if exists %I on public.%I',
      v_table||'_no_truncate',v_table);
    execute format(
      'create trigger %I before truncate on public.%I for each statement execute function public.prevent_it_intune_phase41_event_mutation()',
      v_table||'_no_truncate',v_table);
  end loop;
end;
$phase41_triggers$;

create or replace function public.it_intune_phase41_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase41_clamp_int(
  p_value integer, p_min integer, p_max integer
) returns integer
language sql immutable set search_path=public as $$
  select least(greatest(p_value, p_min), p_max);
$$;

create or replace function public.it_intune_phase41_clamp_rate(
  p_value numeric
) returns numeric
language sql immutable set search_path=public as $$
  select least(greatest(round(p_value,4), 0.2500), 0.9500);
$$;

create or replace function public.build_it_intune_outage_postmortem_timeline(
  p_episode_id uuid
) returns jsonb
language plpgsql stable security definer set search_path=public as $$
declare v_timeline jsonb;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_type',e.event_type,
    'from_state',e.from_state,
    'to_state',e.to_state,
    'evidence_sha256',e.evidence_sha256,
    'episode_version',e.episode_version,
    'created_at',e.created_at
  ) order by e.created_at,e.event_id),'[]'::jsonb)
  into v_timeline
  from public.os_it_intune_outage_episode_events e
  where e.episode_id=p_episode_id;
  return jsonb_build_object(
    'evidence_version','phase41-v1',
    'entity_identifiers_included',false,
    'events',v_timeline
  );
end;
$$;

create or replace function public.seed_it_intune_outage_postmortem(
  p_episode_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_episode public.os_it_intune_outage_episodes%rowtype;
  v_postmortem public.os_it_intune_outage_postmortems%rowtype;
  v_timeline jsonb; v_agg jsonb; v_hash text; v_notes_hash text;
  v_cause text;
begin
  select * into v_episode from public.os_it_intune_outage_episodes
  where episode_id=p_episode_id;
  if not found then raise exception 'Outage episode not found'; end if;
  if v_episode.state<>'resolved' then
    raise exception 'Postmortems require a resolved outage episode';
  end if;
  select postmortem_id into v_postmortem.postmortem_id
  from public.os_it_intune_outage_postmortems where episode_id=p_episode_id;
  if found then return v_postmortem.postmortem_id; end if;

  v_timeline:=public.build_it_intune_outage_postmortem_timeline(p_episode_id);
  v_agg:=public.it_intune_phase41_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase41-v1',
    'provider',v_episode.provider,
    'operation',v_episode.operation,
    'started_at',v_episode.started_at,
    'recovering_at',v_episode.recovering_at,
    'resolved_at',v_episode.resolved_at,
    'duration_minutes',greatest(0,ceil(extract(epoch from (
      coalesce(v_episode.resolved_at,now())-v_episode.started_at))/60.0)),
    'correlated_scope_count',v_episode.correlated_scope_count,
    'failure_count',v_episode.failure_count,
    'sample_count',v_episode.sample_count,
    'failure_rate',case when v_episode.sample_count>0
      then round((v_episode.failure_count::numeric
        /v_episode.sample_count::numeric),4)
      else 0 end,
    'entity_identifiers_included',false
  ));
  if v_episode.correlated_scope_count>=2
     and v_episode.failure_count>=3 then
    v_cause:='multi_scope_correlation';
  elsif v_episode.sample_count>0
     and (v_episode.failure_count::numeric/v_episode.sample_count::numeric)
       >=0.7500 then
    v_cause:='provider_outage';
  elsif v_episode.sample_count>0 and v_episode.sample_count<6 then
    v_cause:='thin_sampling';
  else
    v_cause:='unknown';
  end if;
  v_hash:=public.os_sha256_hex(v_agg::text);
  v_notes_hash:=public.os_sha256_hex('');
  insert into public.os_it_intune_outage_postmortems(
    episode_id,status,root_cause_class,timeline,timeline_sha256,
    blameless_notes,blameless_notes_sha256,aggregate_evidence,
    aggregate_evidence_sha256
  ) values (
    p_episode_id,'draft',v_cause,v_timeline,
    public.os_sha256_hex(v_timeline::text),'',v_notes_hash,v_agg,v_hash
  ) returning * into v_postmortem;
  insert into public.os_it_intune_outage_postmortem_events(
    postmortem_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    v_postmortem.postmortem_id,'drafted',null,v_hash,
    jsonb_build_object('root_cause_class',v_cause,
      'entity_identifiers_included',false)
  );
  return v_postmortem.postmortem_id;
end;
$$;

create or replace function public.update_it_intune_outage_postmortem_draft(
  p_postmortem_id uuid,p_actor_id uuid,p_root_cause_class text,
  p_blameless_notes text,p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_notes text; v_hash text;
begin
  select * into v_pm from public.os_it_intune_outage_postmortems
  where postmortem_id=p_postmortem_id for update;
  if not found or v_pm.status<>'draft'
     or v_pm.row_version<>p_expected_row_version
     or p_root_cause_class not in (
       'provider_outage','threshold_too_sensitive','thin_sampling',
       'multi_scope_correlation','unknown')
     or length(trim(coalesce(p_blameless_notes,'')))<20
     or not public.it_intune_manual_review_actor_allowed(p_actor_id,null) then
    raise exception 'Postmortem draft update denied or stale';
  end if;
  v_notes:=trim(p_blameless_notes);
  v_hash:=public.os_sha256_hex(v_notes);
  update public.os_it_intune_outage_postmortems set
    root_cause_class=p_root_cause_class,
    blameless_notes=v_notes,
    blameless_notes_sha256=v_hash,
    drafted_by=coalesce(drafted_by,p_actor_id),
    row_version=row_version+1,
    updated_at=now()
  where postmortem_id=p_postmortem_id returning * into v_pm;
  insert into public.os_it_intune_outage_postmortem_events(
    postmortem_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    p_postmortem_id,'updated',p_actor_id,v_hash,
    jsonb_build_object('root_cause_class',p_root_cause_class,
      'entity_identifiers_included',false)
  );
  return jsonb_build_object('postmortem_id',p_postmortem_id,
    'status',v_pm.status,'row_version',v_pm.row_version);
end;
$$;

create or replace function public.publish_it_intune_outage_postmortem(
  p_postmortem_id uuid,p_actor_id uuid,p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_statement text;
begin
  select * into v_pm from public.os_it_intune_outage_postmortems
  where postmortem_id=p_postmortem_id for update;
  if not found or v_pm.status<>'draft'
     or v_pm.row_version<>p_expected_row_version
     or length(trim(coalesce(v_pm.blameless_notes,'')))<20
     or v_pm.root_cause_class='unknown'
     or length(trim(coalesce(p_statement,'')))<20
     or v_pm.drafted_by is null
     or v_pm.drafted_by=p_actor_id
     or not public.it_intune_manual_review_actor_allowed(p_actor_id,null) then
    raise exception 'Independent postmortem publish denied or incomplete';
  end if;
  v_statement:=trim(p_statement);
  update public.os_it_intune_outage_postmortems set
    status='published',published_by=p_actor_id,published_at=now(),
    publish_statement=v_statement,row_version=row_version+1,updated_at=now()
  where postmortem_id=p_postmortem_id returning * into v_pm;
  insert into public.os_it_intune_outage_postmortem_events(
    postmortem_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    p_postmortem_id,'published',p_actor_id,v_pm.aggregate_evidence_sha256,
    jsonb_build_object('publish_statement_sha256',
      public.os_sha256_hex(v_statement),'entity_identifiers_included',false)
  );
  return jsonb_build_object('postmortem_id',p_postmortem_id,
    'status','published','row_version',v_pm.row_version);
end;
$$;

create or replace function public.reject_it_intune_outage_postmortem(
  p_postmortem_id uuid,p_actor_id uuid,p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_statement text;
begin
  select * into v_pm from public.os_it_intune_outage_postmortems
  where postmortem_id=p_postmortem_id for update;
  if not found or v_pm.status<>'draft'
     or v_pm.row_version<>p_expected_row_version
     or length(trim(coalesce(p_statement,'')))<20
     or not public.it_intune_manual_review_actor_allowed(p_actor_id,null) then
    raise exception 'Postmortem reject denied or stale';
  end if;
  v_statement:=trim(p_statement);
  update public.os_it_intune_outage_postmortems set
    status='rejected',rejected_by=p_actor_id,rejected_at=now(),
    reject_statement=v_statement,row_version=row_version+1,updated_at=now()
  where postmortem_id=p_postmortem_id returning * into v_pm;
  insert into public.os_it_intune_outage_postmortem_events(
    postmortem_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    p_postmortem_id,'rejected',p_actor_id,v_pm.aggregate_evidence_sha256,
    jsonb_build_object('reject_statement_sha256',
      public.os_sha256_hex(v_statement),'entity_identifiers_included',false)
  );
  return jsonb_build_object('postmortem_id',p_postmortem_id,
    'status','rejected','row_version',v_pm.row_version);
end;
$$;

create or replace function public.generate_it_intune_threshold_recommendation(
  p_episode_id uuid,p_breaker_id uuid
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_episode public.os_it_intune_outage_episodes%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_current public.os_it_intune_breaker_config_versions%rowtype;
  v_postmortem_id uuid;
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_window integer; v_min_samples integer; v_fail_threshold integer;
  v_rate numeric; v_reset integer; v_risk text; v_rationale text;
  v_evidence jsonb; v_hash text; v_failure_rate numeric;
  v_obs_failures integer; v_obs_samples integer;
begin
  perform public.seed_it_intune_breaker_config_versions();
  select * into v_episode from public.os_it_intune_outage_episodes
  where episode_id=p_episode_id;
  if not found or v_episode.state<>'resolved' then
    raise exception 'Recommendations require a resolved outage episode';
  end if;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=p_breaker_id;
  if not found then raise exception 'Breaker not found'; end if;
  if v_breaker.provider is distinct from v_episode.provider
     or v_breaker.operation is distinct from v_episode.operation then
    raise exception 'Breaker scope does not match outage episode';
  end if;
  -- Recommendations never touch breaker state. Open breakers may still receive
  -- a draft, but accept only creates a Phase 40 tuning proposal.
  select postmortem_id into v_postmortem_id
  from public.os_it_intune_outage_postmortems where episode_id=p_episode_id;
  if not found then
    v_postmortem_id:=public.seed_it_intune_outage_postmortem(p_episode_id);
  end if;
  select recommendation_id into v_reco.recommendation_id
  from public.os_it_intune_threshold_recommendation_drafts
  where episode_id=p_episode_id and breaker_id=p_breaker_id and status='pending';
  if found then return v_reco.recommendation_id; end if;

  select * into v_current from public.os_it_intune_breaker_config_versions
  where breaker_id=p_breaker_id order by version_no desc limit 1;
  select count(*) filter (where o.outcome in ('failure','ambiguous')),
    count(*) filter (where o.outcome<>'ignored')
  into v_obs_failures,v_obs_samples
  from public.os_it_intune_provider_observations o
  where o.breaker_id=p_breaker_id
    and o.observed_at between v_episode.started_at
      and coalesce(v_episode.resolved_at,now());
  v_failure_rate:=case when coalesce(v_obs_samples,0)>0
    then round((v_obs_failures::numeric/v_obs_samples::numeric),4)
    when v_episode.sample_count>0
    then round((v_episode.failure_count::numeric
      /v_episode.sample_count::numeric),4)
    else 0 end;

  v_window:=v_current.failure_window_minutes;
  v_min_samples:=v_current.minimum_samples;
  v_fail_threshold:=v_current.failure_threshold;
  v_rate:=v_current.failure_rate_threshold;
  v_reset:=v_current.reset_success_threshold;

  if coalesce(v_obs_samples,v_episode.sample_count)<v_current.minimum_samples*2 then
    v_min_samples:=public.it_intune_phase41_clamp_int(
      v_current.minimum_samples+1,3,50);
    v_fail_threshold:=public.it_intune_phase41_clamp_int(
      greatest(v_current.failure_threshold,2),2,v_min_samples);
    v_rationale:='Episode sampling was thin relative to the open threshold; '
      ||'draft raises minimum_samples within Phase 40 bounds.';
  elsif v_failure_rate>0 and v_failure_rate
      < v_current.failure_rate_threshold then
    v_rate:=public.it_intune_phase41_clamp_rate(
      v_current.failure_rate_threshold+0.0500);
    v_rationale:='Episode failure rate stayed below the open threshold while '
      ||'scopes correlated; draft raises failure_rate_threshold within bounds.';
  else
    v_window:=public.it_intune_phase41_clamp_int(
      v_current.failure_window_minutes+5,5,120);
    v_rationale:='Episode showed sustained multi-scope pressure; draft widens '
      ||'failure_window_minutes within Phase 40 bounds.';
  end if;

  if v_min_samples<v_current.minimum_samples
     or v_fail_threshold<v_current.failure_threshold
     or v_rate<v_current.failure_rate_threshold
     or v_reset<v_current.reset_success_threshold then
    v_risk:='riskier';
  else
    v_risk:='standard';
  end if;

  v_evidence:=public.it_intune_phase41_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase41-v1',
    'episode_id',p_episode_id,
    'breaker_id',p_breaker_id,
    'base_config_version_no',v_current.version_no,
    'episode_failure_count',v_episode.failure_count,
    'episode_sample_count',v_episode.sample_count,
    'episode_correlated_scope_count',v_episode.correlated_scope_count,
    'breaker_observation_failures',coalesce(v_obs_failures,0),
    'breaker_observation_samples',coalesce(v_obs_samples,0),
    'observed_failure_rate',v_failure_rate,
    'before',jsonb_build_object(
      'failure_window_minutes',v_current.failure_window_minutes,
      'minimum_samples',v_current.minimum_samples,
      'failure_threshold',v_current.failure_threshold,
      'failure_rate_threshold',v_current.failure_rate_threshold,
      'reset_success_threshold',v_current.reset_success_threshold),
    'after',jsonb_build_object(
      'failure_window_minutes',v_window,
      'minimum_samples',v_min_samples,
      'failure_threshold',v_fail_threshold,
      'failure_rate_threshold',v_rate,
      'reset_success_threshold',v_reset),
    'risk_class',v_risk,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);
  insert into public.os_it_intune_threshold_recommendation_drafts(
    episode_id,postmortem_id,breaker_id,status,base_config_version_no,
    recommended_failure_window_minutes,recommended_minimum_samples,
    recommended_failure_threshold,recommended_failure_rate_threshold,
    recommended_reset_success_threshold,risk_class,rationale,
    aggregate_evidence,evidence_sha256
  ) values (
    p_episode_id,v_postmortem_id,p_breaker_id,'pending',v_current.version_no,
    v_window,v_min_samples,v_fail_threshold,v_rate,v_reset,v_risk,
    v_rationale,v_evidence,v_hash
  ) returning * into v_reco;
  insert into public.os_it_intune_threshold_recommendation_events(
    recommendation_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    v_reco.recommendation_id,'generated',null,v_hash,
    jsonb_build_object('risk_class',v_risk,'closes_or_resets_breaker',false,
      'entity_identifiers_included',false)
  );
  return v_reco.recommendation_id;
end;
$$;

create or replace function public.generate_it_intune_phase41_followups()
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_episode record;
  v_breaker record;
  v_postmortems integer:=0;
  v_recommendations integer:=0;
  v_expired integer:=0;
  v_id uuid;
begin
  with expired as (
    update public.os_it_intune_threshold_recommendation_drafts d set
      status='expired',row_version=row_version+1
    where d.status='pending' and d.expires_at<=now()
    returning d.recommendation_id,d.evidence_sha256
  )
  insert into public.os_it_intune_threshold_recommendation_events(
    recommendation_id,event_type,actor_id,evidence_sha256,detail
  )
  select recommendation_id,'expired',null,evidence_sha256,
    jsonb_build_object('entity_identifiers_included',false)
  from expired;
  get diagnostics v_expired=row_count;

  for v_episode in
    select episode_id from public.os_it_intune_outage_episodes
    where state='resolved'
    order by resolved_at desc nulls last
    limit 25
  loop
    v_id:=public.seed_it_intune_outage_postmortem(v_episode.episode_id);
    if v_id is not null then v_postmortems:=v_postmortems+1; end if;
    for v_breaker in
      select distinct b.breaker_id
      from public.os_it_intune_provider_breakers b
      join public.os_it_intune_outage_episodes ep
        on ep.episode_id=v_episode.episode_id
      where b.provider=ep.provider and b.operation=ep.operation
        and exists (
          select 1 from public.os_it_intune_provider_observations o
          where o.breaker_id=b.breaker_id
            and o.observed_at between ep.started_at
              and coalesce(ep.resolved_at,now())
            and o.outcome<>'ignored'
        )
    loop
      v_id:=public.generate_it_intune_threshold_recommendation(
        v_episode.episode_id,v_breaker.breaker_id);
      if v_id is not null then
        v_recommendations:=v_recommendations+1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'postmortems_touched',v_postmortems,
    'recommendations_touched',v_recommendations,
    'recommendations_expired',v_expired,
    'closes_or_resets_breaker',false
  );
end;
$$;

create or replace function public.accept_it_intune_threshold_recommendation(
  p_recommendation_id uuid,p_actor_id uuid,p_reason text,
  p_expected_breaker_version bigint,p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_proposed jsonb;
  v_proposal_id uuid;
  v_reason text;
begin
  select * into v_reco from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=p_recommendation_id for update;
  if not found or v_reco.status<>'pending'
     or v_reco.expires_at<=now()
     or v_reco.row_version<>p_expected_row_version then
    raise exception 'Recommendation missing, expired, or stale';
  end if;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id for update;
  if not found or v_breaker.row_version<>p_expected_breaker_version then
    raise exception 'Breaker version fence rejected';
  end if;
  -- Accept creates a Phase 40 tuning proposal only. It never updates breaker
  -- state, never clears open/half_open, and never calls reset RPCs.
  if v_breaker.state in ('open','half_open') then
    raise exception
      'Recommendation cannot close, reset, or modify an open breaker';
  end if;
  v_reason:=trim(coalesce(nullif(trim(p_reason),''),v_reco.rationale));
  if length(v_reason)<20
     or not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Recommendation accept actor or reason denied';
  end if;
  v_proposed:=public.propose_it_intune_breaker_tuning(
    v_reco.breaker_id,p_actor_id,v_reason,
    v_reco.recommended_failure_window_minutes,
    v_reco.recommended_minimum_samples,
    v_reco.recommended_failure_threshold,
    v_reco.recommended_failure_rate_threshold,
    v_reco.recommended_reset_success_threshold,
    p_expected_breaker_version
  );
  v_proposal_id:=(v_proposed->>'proposal_id')::uuid;
  update public.os_it_intune_threshold_recommendation_drafts set
    status='accepted',accepted_by=p_actor_id,accepted_at=now(),
    resulting_proposal_id=v_proposal_id,row_version=row_version+1
  where recommendation_id=p_recommendation_id returning * into v_reco;
  insert into public.os_it_intune_threshold_recommendation_events(
    recommendation_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    p_recommendation_id,'accepted',p_actor_id,v_reco.evidence_sha256,
    jsonb_build_object('proposal_id',v_proposal_id,
      'closes_or_resets_breaker',false,
      'entity_identifiers_included',false)
  );
  return jsonb_build_object(
    'recommendation_id',p_recommendation_id,
    'proposal_id',v_proposal_id,
    'status','accepted',
    'closes_or_resets_breaker',false
  );
end;
$$;

create or replace function public.dismiss_it_intune_threshold_recommendation(
  p_recommendation_id uuid,p_actor_id uuid,p_statement text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_reco public.os_it_intune_threshold_recommendation_drafts%rowtype;
  v_breaker public.os_it_intune_provider_breakers%rowtype;
  v_statement text;
begin
  select * into v_reco from public.os_it_intune_threshold_recommendation_drafts
  where recommendation_id=p_recommendation_id for update;
  if not found or v_reco.status<>'pending'
     or v_reco.row_version<>p_expected_row_version
     or length(trim(coalesce(p_statement,'')))<20 then
    raise exception 'Recommendation dismiss denied or stale';
  end if;
  select * into v_breaker from public.os_it_intune_provider_breakers
  where breaker_id=v_reco.breaker_id;
  if not public.it_intune_manual_review_actor_allowed(
       p_actor_id,v_breaker.entity_id) then
    raise exception 'Recommendation dismiss actor denied';
  end if;
  v_statement:=trim(p_statement);
  update public.os_it_intune_threshold_recommendation_drafts set
    status='dismissed',dismissed_by=p_actor_id,dismissed_at=now(),
    dismiss_statement=v_statement,row_version=row_version+1
  where recommendation_id=p_recommendation_id returning * into v_reco;
  insert into public.os_it_intune_threshold_recommendation_events(
    recommendation_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    p_recommendation_id,'dismissed',p_actor_id,v_reco.evidence_sha256,
    jsonb_build_object('dismiss_statement_sha256',
      public.os_sha256_hex(v_statement),'entity_identifiers_included',false)
  );
  return jsonb_build_object('recommendation_id',p_recommendation_id,
    'status','dismissed');
end;
$$;

create or replace view public.os_it_intune_outage_postmortem_status
with (security_invoker=true) as
select p.postmortem_id,p.episode_id,p.status,p.root_cause_class,
  p.timeline_sha256,p.blameless_notes,p.blameless_notes_sha256,
  p.aggregate_evidence_sha256,p.drafted_by,p.drafted_at,
  p.published_by,p.published_at,p.row_version,p.updated_at,
  e.provider,e.operation,e.started_at,e.resolved_at,
  e.correlated_scope_count,e.failure_count,e.sample_count
from public.os_it_intune_outage_postmortems p
join public.os_it_intune_outage_episodes e on e.episode_id=p.episode_id;
grant select on public.os_it_intune_outage_postmortem_status to authenticated;

create or replace view public.os_it_intune_threshold_recommendation_status
with (security_invoker=true) as
select d.recommendation_id,d.episode_id,d.postmortem_id,d.breaker_id,d.status,
  d.base_config_version_no,d.recommended_failure_window_minutes,
  d.recommended_minimum_samples,d.recommended_failure_threshold,
  d.recommended_failure_rate_threshold,d.recommended_reset_success_threshold,
  d.risk_class,d.rationale,d.evidence_sha256,d.generated_at,d.expires_at,
  d.accepted_by,d.accepted_at,d.resulting_proposal_id,d.dismissed_by,
  d.dismissed_at,d.row_version,b.entity_id,b.provider,b.operation,b.state
    as breaker_state,b.row_version as breaker_version
from public.os_it_intune_threshold_recommendation_drafts d
join public.os_it_intune_provider_breakers b on b.breaker_id=d.breaker_id;
grant select on public.os_it_intune_threshold_recommendation_status
  to authenticated;

create or replace view public.os_it_intune_phase41_health
with (security_invoker=true) as
select
  (select count(*) from public.os_it_intune_outage_postmortems
    where status='draft') as draft_postmortem_count,
  (select count(*) from public.os_it_intune_outage_postmortems
    where status='published') as published_postmortem_count,
  (select count(*) from public.os_it_intune_threshold_recommendation_drafts
    where status='pending' and expires_at>now()) as pending_recommendation_count,
  (select count(*) from public.os_it_intune_threshold_recommendation_drafts
    where status='accepted') as accepted_recommendation_count,
  (select count(*) from public.os_it_intune_outage_episodes
    where state='resolved'
      and not exists (
        select 1 from public.os_it_intune_outage_postmortems p
        where p.episode_id=os_it_intune_outage_episodes.episode_id
      )) as unresolved_postmortem_backlog;
grant select on public.os_it_intune_phase41_health to authenticated;

revoke all on function public.it_intune_phase41_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase41_clamp_int(integer,integer,integer)
  from public,authenticated,service_role;
revoke all on function public.it_intune_phase41_clamp_rate(numeric)
  from public,authenticated,service_role;
revoke all on function public.build_it_intune_outage_postmortem_timeline(uuid)
  from public,authenticated;
revoke all on function public.seed_it_intune_outage_postmortem(uuid)
  from public,authenticated;
revoke all on function public.update_it_intune_outage_postmortem_draft(
  uuid,uuid,text,text,bigint) from public,authenticated;
revoke all on function public.publish_it_intune_outage_postmortem(
  uuid,uuid,text,bigint) from public,authenticated;
revoke all on function public.reject_it_intune_outage_postmortem(
  uuid,uuid,text,bigint) from public,authenticated;
revoke all on function public.generate_it_intune_threshold_recommendation(
  uuid,uuid) from public,authenticated;
revoke all on function public.generate_it_intune_phase41_followups()
  from public,authenticated;
revoke all on function public.accept_it_intune_threshold_recommendation(
  uuid,uuid,text,bigint,bigint) from public,authenticated;
revoke all on function public.dismiss_it_intune_threshold_recommendation(
  uuid,uuid,text,bigint) from public,authenticated;

grant execute on function public.build_it_intune_outage_postmortem_timeline(uuid),
  public.seed_it_intune_outage_postmortem(uuid),
  public.update_it_intune_outage_postmortem_draft(uuid,uuid,text,text,bigint),
  public.publish_it_intune_outage_postmortem(uuid,uuid,text,bigint),
  public.reject_it_intune_outage_postmortem(uuid,uuid,text,bigint),
  public.generate_it_intune_threshold_recommendation(uuid,uuid),
  public.generate_it_intune_phase41_followups(),
  public.accept_it_intune_threshold_recommendation(uuid,uuid,text,bigint,bigint),
  public.dismiss_it_intune_threshold_recommendation(uuid,uuid,text,bigint)
  to service_role;
