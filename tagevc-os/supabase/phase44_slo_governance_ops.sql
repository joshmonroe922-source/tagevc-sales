-- Phase 44: SLO scenario library, owner handoff suggestions, policy revision
-- ledger, and governance ops alerts (archival / drill / handoff overdue).
-- Apply after phase43_slo_export_archival_succession_drills.sql.
-- Does not auto-apply live succession; suggestions only.

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

create or replace function public.phase44_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Historical scenario library (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_simulation_scenarios (
  scenario_id uuid primary key default gen_random_uuid(),
  name text not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  entity_scope jsonb not null default '[]'::jsonb,
  draft_policy_hash text not null,
  published_policy_hash text,
  last_result_digest text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_sim_scenario_name_check
    check (char_length(name) between 3 and 120),
  constraint os_slo_sim_scenario_window_check
    check (window_end>window_start and window_end-window_start<=interval '90 days'),
  constraint os_slo_sim_scenario_hash_check
    check (draft_policy_hash ~ '^[0-9a-f]{64}$'
      and (published_policy_hash is null or published_policy_hash ~ '^[0-9a-f]{64}$')
      and (last_result_digest is null or last_result_digest ~ '^[0-9a-f]{64}$')),
  constraint os_slo_sim_scenario_scope_check
    check (jsonb_typeof(entity_scope)='array' and pg_column_size(entity_scope)<=2048),
  constraint os_slo_sim_scenario_metadata_check
    check (jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=4096)
);

create index if not exists os_slo_sim_scenarios_created_idx
  on public.os_slo_simulation_scenarios(created_at desc);

create table if not exists public.os_slo_simulation_scenario_replays (
  replay_id uuid primary key default gen_random_uuid(),
  scenario_id uuid not null
    references public.os_slo_simulation_scenarios(scenario_id),
  simulation_id uuid references public.os_slo_simulations(simulation_id),
  actor_id uuid not null references public.profiles(id),
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  production_alerts_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_slo_sim_replay_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_sim_replay_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_sim_replay_nonlive_check
    check (not production_alerts_mutated)
);

create index if not exists os_slo_sim_scenario_replays_idx
  on public.os_slo_simulation_scenario_replays(scenario_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Owner coverage handoff suggestions (suggest only — never auto-apply)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_handoff_suggestions (
  suggestion_id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  ownership_id uuid references public.os_slo_owners(ownership_id),
  current_owner_id uuid not null references public.profiles(id),
  suggested_owner_id uuid not null references public.profiles(id),
  eligibility_ok boolean not null,
  reason text not null,
  status text not null default 'suggested',
  metrics_sha256 text not null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint os_slo_handoff_status_check
    check (status in ('suggested','accepted','dismissed','expired')),
  constraint os_slo_handoff_reason_check
    check (char_length(reason) between 3 and 500),
  constraint os_slo_handoff_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_handoff_distinct_owners_check
    check (current_owner_id<>suggested_owner_id)
);

create index if not exists os_slo_handoff_suggestions_policy_idx
  on public.os_slo_owner_handoff_suggestions(policy_id,created_at desc);
create index if not exists os_slo_handoff_suggestions_status_idx
  on public.os_slo_owner_handoff_suggestions(status,created_at desc)
  where status='suggested';

-- ---------------------------------------------------------------------------
-- Policy revision ledger (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_policy_revision_ledger (
  revision_id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  from_row_version bigint not null,
  to_row_version bigint not null,
  comparison_digest text not null,
  material_risk boolean not null,
  actor_id uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint os_slo_revision_versions_check
    check (to_row_version>from_row_version and from_row_version>=0),
  constraint os_slo_revision_digest_check
    check (comparison_digest ~ '^[0-9a-f]{64}$')
);

create index if not exists os_slo_revision_ledger_policy_idx
  on public.os_slo_policy_revision_ledger(policy_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Phase 44 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_phase44_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  severity text not null default 'warning',
  policy_id uuid references public.os_slo_policies(policy_id),
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_phase44_alert_kind_check
    check (alert_kind in (
      'archival_overdue','succession_drill_overdue','owner_expiry_without_handoff'
    )),
  constraint os_slo_phase44_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_slo_phase44_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_phase44_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_phase44_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_phase44_ops_alerts_kind_idx
  on public.os_slo_phase44_ops_alerts(alert_kind,created_at desc);

create or replace function public.prevent_slo_phase44_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_sim_scenarios_append_only
  on public.os_slo_simulation_scenarios;
create trigger os_slo_sim_scenarios_append_only before update or delete
  on public.os_slo_simulation_scenarios for each row
  execute function public.prevent_slo_phase44_append_only();
drop trigger if exists os_slo_sim_scenarios_no_truncate
  on public.os_slo_simulation_scenarios;
create trigger os_slo_sim_scenarios_no_truncate before truncate
  on public.os_slo_simulation_scenarios for each statement
  execute function public.prevent_slo_phase44_append_only();

drop trigger if exists os_slo_sim_scenario_replays_append_only
  on public.os_slo_simulation_scenario_replays;
create trigger os_slo_sim_scenario_replays_append_only before update or delete
  on public.os_slo_simulation_scenario_replays for each row
  execute function public.prevent_slo_phase44_append_only();
drop trigger if exists os_slo_sim_scenario_replays_no_truncate
  on public.os_slo_simulation_scenario_replays;
create trigger os_slo_sim_scenario_replays_no_truncate before truncate
  on public.os_slo_simulation_scenario_replays for each statement
  execute function public.prevent_slo_phase44_append_only();

drop trigger if exists os_slo_revision_ledger_append_only
  on public.os_slo_policy_revision_ledger;
create trigger os_slo_revision_ledger_append_only before update or delete
  on public.os_slo_policy_revision_ledger for each row
  execute function public.prevent_slo_phase44_append_only();
drop trigger if exists os_slo_revision_ledger_no_truncate
  on public.os_slo_policy_revision_ledger;
create trigger os_slo_revision_ledger_no_truncate before truncate
  on public.os_slo_policy_revision_ledger for each statement
  execute function public.prevent_slo_phase44_append_only();

drop trigger if exists os_slo_phase44_ops_alerts_append_only
  on public.os_slo_phase44_ops_alerts;
create trigger os_slo_phase44_ops_alerts_append_only before update or delete
  on public.os_slo_phase44_ops_alerts for each row
  execute function public.prevent_slo_phase44_append_only();
drop trigger if exists os_slo_phase44_ops_alerts_no_truncate
  on public.os_slo_phase44_ops_alerts;
create trigger os_slo_phase44_ops_alerts_no_truncate before truncate
  on public.os_slo_phase44_ops_alerts for each statement
  execute function public.prevent_slo_phase44_append_only();

-- Handoff suggestions: no delete/truncate; status updates only via RPC.
create or replace function public.prevent_slo_phase44_handoff_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_slo_owner_handoff_suggestions deletes are forbidden'; end $$;
drop trigger if exists os_slo_handoff_suggestions_no_delete
  on public.os_slo_owner_handoff_suggestions;
create trigger os_slo_handoff_suggestions_no_delete before delete
  on public.os_slo_owner_handoff_suggestions for each row
  execute function public.prevent_slo_phase44_handoff_delete();
drop trigger if exists os_slo_handoff_suggestions_no_truncate
  on public.os_slo_owner_handoff_suggestions;
create trigger os_slo_handoff_suggestions_no_truncate before truncate
  on public.os_slo_owner_handoff_suggestions for each statement
  execute function public.prevent_slo_phase44_handoff_delete();

create or replace function public.phase44_sanitize_entity_scope(p_scope jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_out jsonb:='[]'::jsonb;
  v_elem jsonb;
  v_id text;
begin
  if jsonb_typeof(coalesce(p_scope,'[]'::jsonb))<>'array' then
    raise exception 'Entity scope must be a JSON array';
  end if;
  for v_elem in select value from jsonb_array_elements(coalesce(p_scope,'[]'::jsonb))
  loop
    if jsonb_typeof(v_elem)='string' then
      v_id:=nullif(trim(v_elem#>>'{}'),'');
    elsif jsonb_typeof(v_elem)='object' then
      v_id:=nullif(trim(coalesce(v_elem->>'entity_id','')),'');
    else
      v_id:=null;
    end if;
    if v_id is not null
       and v_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'
       and not exists (
         select 1 from jsonb_array_elements_text(v_out) existing(val)
         where existing.val=v_id
       ) then
      v_out:=v_out||jsonb_build_array(v_id);
    end if;
  end loop;
  if jsonb_array_length(v_out)>100 then
    raise exception 'Entity scope exceeds 100 entries';
  end if;
  return v_out;
end $$;

create or replace function public.register_slo_simulation_scenario_phase44(
  p_actor_id uuid,
  p_name text,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_entity_scope jsonb,
  p_draft_policy_hash text,
  p_published_policy_hash text default null,
  p_last_result_digest text default null,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scope jsonb;
  v_scenario_id uuid;
  v_meta jsonb;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     or coalesce(nullif(trim(p_name),''),'')=''
     or char_length(trim(p_name)) not between 3 and 120
     or p_window_end<=p_window_start
     or p_window_end-p_window_start>interval '90 days'
     or coalesce(p_draft_policy_hash,'') !~ '^[0-9a-f]{64}$'
     or (p_published_policy_hash is not null
         and p_published_policy_hash !~ '^[0-9a-f]{64}$')
     or (p_last_result_digest is not null
         and p_last_result_digest !~ '^[0-9a-f]{64}$')
     or not public.phase44_slo_safe_detail(coalesce(p_metadata,'{}'::jsonb))
  then
    raise exception 'Phase 44 scenario registration authorization or input failed';
  end if;

  v_scope:=public.phase44_sanitize_entity_scope(coalesce(p_entity_scope,'[]'::jsonb));
  v_meta:=coalesce(p_metadata,'{}'::jsonb)||jsonb_build_object(
    'contract_version','phase44-v1',
    'registered_by',p_actor_id
  );

  insert into public.os_slo_simulation_scenarios(
    name,window_start,window_end,entity_scope,draft_policy_hash,
    published_policy_hash,last_result_digest,metadata
  ) values (
    trim(p_name),p_window_start,p_window_end,v_scope,p_draft_policy_hash,
    p_published_policy_hash,p_last_result_digest,v_meta
  ) returning scenario_id into v_scenario_id;

  return jsonb_build_object(
    'ok',true,
    'scenario_id',v_scenario_id,
    'name',trim(p_name),
    'entity_scope',v_scope,
    'draft_policy_hash',p_draft_policy_hash,
    'contract_version','phase44-v1'
  );
end $$;

-- Replay: queue counterfactual simulation when draft_policy_id provided;
-- always records replay evidence and never mutates production alerts.
create or replace function public.replay_slo_simulation_scenario_phase44(
  p_actor_id uuid,
  p_scenario_id uuid,
  p_idempotency_key text,
  p_draft_policy_id uuid default null,
  p_max_buckets integer default 168
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scenario public.os_slo_simulation_scenarios%rowtype;
  v_entities text[];
  v_sim jsonb;
  v_simulation_id uuid;
  v_replay_id uuid;
  v_evidence jsonb;
  v_hash text;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     or coalesce(p_idempotency_key,'') !~ '^[A-Za-z0-9._:-]{8,120}$'
     or coalesce(p_max_buckets,0) not between 1 and 2160
  then
    raise exception 'Phase 44 scenario replay authorization or input failed';
  end if;

  select * into v_scenario from public.os_slo_simulation_scenarios
    where scenario_id=p_scenario_id;
  if not found then
    raise exception 'Simulation scenario was not found';
  end if;

  select coalesce(array_agg(x order by x),'{}')
    into v_entities
  from jsonb_array_elements_text(v_scenario.entity_scope) as t(x);

  if p_draft_policy_id is not null then
    v_sim:=public.request_slo_simulation_phase40(
      p_idempotency_key,
      p_draft_policy_id,
      v_entities,
      v_scenario.window_start,
      v_scenario.window_end,
      p_max_buckets,
      p_actor_id
    );
    v_simulation_id:=nullif(v_sim->>'simulation_id','')::uuid;
  end if;

  v_evidence:=jsonb_build_object(
    'contract_version','phase44-v1',
    'draft_policy_id',p_draft_policy_id,
    'draft_policy_hash',v_scenario.draft_policy_hash,
    'entity_scope',v_scenario.entity_scope,
    'production_alerts_mutated',false,
    'scenario_id',p_scenario_id,
    'simulation_id',v_simulation_id,
    'window_end',v_scenario.window_end,
    'window_start',v_scenario.window_start
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_slo_simulation_scenario_replays(
    scenario_id,simulation_id,actor_id,evidence_sha256,detail,
    production_alerts_mutated
  ) values (
    p_scenario_id,v_simulation_id,p_actor_id,v_hash,
    jsonb_build_object(
      'idempotency_key',p_idempotency_key,
      'queued',p_draft_policy_id is not null
    ),
    false
  ) returning replay_id into v_replay_id;

  return jsonb_build_object(
    'ok',true,
    'replay_id',v_replay_id,
    'scenario_id',p_scenario_id,
    'simulation_id',v_simulation_id,
    'simulation',v_sim,
    'evidence_sha256',v_hash,
    'production_alerts_mutated',false
  );
end $$;

create or replace function public.suggest_slo_owner_handoffs_phase44(
  p_warning_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_suggested uuid;
  v_eligible boolean;
  v_reason text;
  v_hash text;
  v_inserted integer:=0;
  v_skipped integer:=0;
begin
  if coalesce(p_warning_days,0) not between 1 and 90 then
    raise exception 'Warning days must be between 1 and 90';
  end if;

  for v_row in
    select
      p.policy_id,
      o.ownership_id,
      o.owner_id as current_owner_id,
      o.entity_id,
      o.expires_at,
      o.replacement_owner_id
    from public.os_slo_policies p
    join public.os_slo_owners o
      on o.service=p.service
     and o.metric_key=p.metric_key
     and o.active
     and o.effective_at<=now()
     and o.expires_at is not null
     and o.expires_at<=now()+make_interval(days=>p_warning_days)
     and o.expires_at>now()
    where p.lifecycle_status='published' and p.enabled
    order by o.expires_at,p.policy_id
    limit 100
  loop
    v_suggested:=v_row.replacement_owner_id;
    if v_suggested is null or v_suggested=v_row.current_owner_id then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    if to_regprocedure('public.phase40_replacement_eligible(uuid,text)') is not null then
      v_eligible:=public.phase40_replacement_eligible(v_suggested,v_row.entity_id);
    else
      v_eligible:=false;
    end if;

    if v_eligible then
      v_reason:='Named replacement is eligible before owner coverage expiry';
    else
      v_reason:='Named replacement is present but not currently eligible';
    end if;

    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase44-v1',
      'current_owner_id',v_row.current_owner_id,
      'eligibility_ok',v_eligible,
      'expires_at',v_row.expires_at,
      'ownership_id',v_row.ownership_id,
      'policy_id',v_row.policy_id,
      'suggested_owner_id',v_suggested,
      'warning_days',p_warning_days
    )::text);

    if exists (
      select 1 from public.os_slo_owner_handoff_suggestions s
      where s.policy_id=v_row.policy_id
        and s.ownership_id is not distinct from v_row.ownership_id
        and s.suggested_owner_id=v_suggested
        and s.status='suggested'
        and s.metrics_sha256=v_hash
    ) then
      v_skipped:=v_skipped+1;
      continue;
    end if;

    insert into public.os_slo_owner_handoff_suggestions(
      policy_id,ownership_id,current_owner_id,suggested_owner_id,
      eligibility_ok,reason,status,metrics_sha256
    ) values (
      v_row.policy_id,v_row.ownership_id,v_row.current_owner_id,v_suggested,
      v_eligible,v_reason,'suggested',v_hash
    );
    v_inserted:=v_inserted+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'suggested_count',v_inserted,
    'skipped_count',v_skipped,
    'warning_days',p_warning_days,
    'live_succession_mutated',false,
    'contract_version','phase44-v1'
  );
end $$;

create or replace function public.resolve_slo_owner_handoff_suggestion_phase44(
  p_actor_id uuid,
  p_suggestion_id uuid,
  p_status text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_slo_owner_handoff_suggestions%rowtype;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     or p_status not in ('accepted','dismissed','expired')
  then
    raise exception 'Phase 44 handoff resolve authorization or status failed';
  end if;

  select * into v_row from public.os_slo_owner_handoff_suggestions
    where suggestion_id=p_suggestion_id for update;
  if not found then
    raise exception 'Handoff suggestion was not found';
  end if;
  if v_row.status<>'suggested' then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'suggestion_id',v_row.suggestion_id,
      'status',v_row.status,
      'live_succession_mutated',false
    );
  end if;

  update public.os_slo_owner_handoff_suggestions
    set status=p_status,resolved_at=now()
    where suggestion_id=p_suggestion_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'suggestion_id',p_suggestion_id,
    'status',p_status,
    'live_succession_mutated',false,
    'note','Suggestion resolved only; live succession not applied'
  );
end $$;

create or replace function public.record_slo_policy_revision_phase44(
  p_actor_id uuid,
  p_policy_id uuid,
  p_from_row_version bigint,
  p_to_row_version bigint,
  p_comparison_digest text,
  p_material_risk boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision_id uuid;
  v_existing public.os_slo_policy_revision_ledger%rowtype;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     or coalesce(p_from_row_version,-1)<0
     or coalesce(p_to_row_version,0)<=coalesce(p_from_row_version,-1)
     or coalesce(p_comparison_digest,'') !~ '^[0-9a-f]{64}$'
  then
    raise exception 'Phase 44 policy revision authorization or input failed';
  end if;
  if not exists (
    select 1 from public.os_slo_policies where policy_id=p_policy_id
  ) then
    raise exception 'Policy was not found for revision ledger';
  end if;

  select * into v_existing from public.os_slo_policy_revision_ledger
    where policy_id=p_policy_id
      and from_row_version=p_from_row_version
      and to_row_version=p_to_row_version
      and comparison_digest=p_comparison_digest
    limit 1;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'revision_id',v_existing.revision_id,
      'material_risk',v_existing.material_risk
    );
  end if;

  insert into public.os_slo_policy_revision_ledger(
    policy_id,from_row_version,to_row_version,comparison_digest,
    material_risk,actor_id
  ) values (
    p_policy_id,p_from_row_version,p_to_row_version,p_comparison_digest,
    coalesce(p_material_risk,false),p_actor_id
  ) returning revision_id into v_revision_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'revision_id',v_revision_id,
    'policy_id',p_policy_id,
    'from_row_version',p_from_row_version,
    'to_row_version',p_to_row_version,
    'comparison_digest',p_comparison_digest,
    'material_risk',coalesce(p_material_risk,false),
    'contract_version','phase44-v1'
  );
end $$;

create or replace function public.record_slo_phase44_ops_alert(
  p_alert_kind text,
  p_window_key text,
  p_severity text default 'warning',
  p_policy_id uuid default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_slo_phase44_ops_alerts%rowtype;
  v_alert_id uuid;
  v_hash text;
begin
  if p_alert_kind not in (
       'archival_overdue','succession_drill_overdue','owner_expiry_without_handoff'
     )
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or coalesce(p_severity,'warning') not in ('warning','critical')
     or not public.phase44_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 44 ops alert input failed';
  end if;

  select * into v_existing from public.os_slo_phase44_ops_alerts
    where window_key=p_window_key;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'alert_id',v_existing.alert_id,
      'alert_kind',v_existing.alert_kind
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'alert_kind',p_alert_kind,
    'contract_version','phase44-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'policy_id',p_policy_id,
    'severity',coalesce(p_severity,'warning'),
    'window_key',p_window_key
  )::text);

  insert into public.os_slo_phase44_ops_alerts(
    alert_kind,window_key,severity,policy_id,metrics_sha256,detail
  ) values (
    p_alert_kind,p_window_key,coalesce(p_severity,'warning'),p_policy_id,v_hash,
    coalesce(p_detail,'{}'::jsonb)
  ) returning alert_id into v_alert_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'alert_id',v_alert_id,
    'alert_kind',p_alert_kind,
    'window_key',p_window_key,
    'metrics_sha256',v_hash
  );
end $$;

create or replace function public.list_slo_phase44_critical_windows(
  p_limit integer default 50
)
returns table (
  window_key text,
  alert_kind text,
  severity text,
  policy_id uuid,
  metrics_sha256 text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required to list SLO Phase 44 critical windows';
  end if;
  return query
  select
    a.window_key,a.alert_kind,a.severity,a.policy_id,a.metrics_sha256,a.created_at
  from public.os_slo_phase44_ops_alerts a
  where a.severity='critical'
     or a.alert_kind in (
       'archival_overdue','succession_drill_overdue','owner_expiry_without_handoff'
     )
  order by a.created_at desc,a.alert_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.scan_slo_phase44_ops_alerts(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recorded integer:=0;
  v_one jsonb;
  v_row record;
  v_day text:=to_char(now() at time zone 'utc','YYYY-MM-DD');
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan SLO Phase 44 ops alerts';
  end if;

  -- Expired exports still unarchived.
  if exists (
    select 1 from public.os_slo_simulation_exports e
    where e.retained_until<=now()
      and not exists (
        select 1 from public.os_slo_simulation_export_archival_receipts a
        where a.export_id=e.export_id
      )
  ) then
    v_one:=public.record_slo_phase44_ops_alert(
      'archival_overdue',
      'phase44:archival_overdue:'||v_day,
      'warning',
      null,
      jsonb_build_object('source','scan_slo_phase44_ops_alerts')
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  -- Expiring owners without recent succession drill and without open handoff.
  for v_row in
    select p.policy_id,o.ownership_id,o.expires_at
    from public.os_slo_policies p
    join public.os_slo_owners o
      on o.service=p.service and o.metric_key=p.metric_key
     and o.active and o.expires_at is not null
     and o.expires_at<=now()+interval '30 days' and o.expires_at>now()
    where p.lifecycle_status='published' and p.enabled
      and not exists (
        select 1 from public.os_slo_owner_succession_drills d
        where d.policy_id=p.policy_id
          and d.drilled_at>=now()-interval '90 days'
      )
      and not exists (
        select 1 from public.os_slo_owner_handoff_suggestions s
        where s.policy_id=p.policy_id
          and s.status='suggested'
          and s.eligibility_ok
      )
    order by o.expires_at
    limit 25
  loop
    v_one:=public.record_slo_phase44_ops_alert(
      'owner_expiry_without_handoff',
      'phase44:owner_handoff:'||v_row.policy_id::text||':'||v_day,
      'critical',
      v_row.policy_id,
      jsonb_build_object(
        'ownership_id',v_row.ownership_id,
        'expires_at',v_row.expires_at
      )
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;

    if not exists (
      select 1 from public.os_slo_owner_succession_drills d
      where d.policy_id=v_row.policy_id
        and d.drilled_at>=now()-interval '90 days'
    ) then
      v_one:=public.record_slo_phase44_ops_alert(
        'succession_drill_overdue',
        'phase44:drill_overdue:'||v_row.policy_id::text||':'||v_day,
        'warning',
        v_row.policy_id,
        jsonb_build_object('ownership_id',v_row.ownership_id)
      );
      if coalesce((v_one->>'replayed')::boolean,false)=false then
        v_recorded:=v_recorded+1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'alerts_recorded',v_recorded,
    'contract_version','phase44-v1'
  );
end $$;

create or replace function public.get_slo_phase44_governance_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'scenarios',
      (select count(*) from public.os_slo_simulation_scenarios),
    'scenario_replays_30d',
      (select count(*) from public.os_slo_simulation_scenario_replays
        where created_at>=now()-interval '30 days'),
    'handoff_suggestions_open',
      (select count(*) from public.os_slo_owner_handoff_suggestions
        where status='suggested'),
    'handoff_suggestions_eligible',
      (select count(*) from public.os_slo_owner_handoff_suggestions
        where status='suggested' and eligibility_ok),
    'policy_revisions_30d',
      (select count(*) from public.os_slo_policy_revision_ledger
        where created_at>=now()-interval '30 days'),
    'material_risk_revisions_30d',
      (select count(*) from public.os_slo_policy_revision_ledger
        where created_at>=now()-interval '30 days' and material_risk),
    'ops_alerts_30d',
      (select count(*) from public.os_slo_phase44_ops_alerts
        where created_at>=now()-interval '30 days'),
    'live_succession_mutated',false,
    'production_alerts_mutated',false,
    'contract_version','phase44-v1'
  );
$$;

alter table public.os_slo_simulation_scenarios enable row level security;
alter table public.os_slo_simulation_scenario_replays enable row level security;
alter table public.os_slo_owner_handoff_suggestions enable row level security;
alter table public.os_slo_policy_revision_ledger enable row level security;
alter table public.os_slo_phase44_ops_alerts enable row level security;

drop policy if exists "os_slo_sim_scenarios_select"
  on public.os_slo_simulation_scenarios;
create policy "os_slo_sim_scenarios_select"
  on public.os_slo_simulation_scenarios for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_sim_scenario_replays_select"
  on public.os_slo_simulation_scenario_replays;
create policy "os_slo_sim_scenario_replays_select"
  on public.os_slo_simulation_scenario_replays for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_handoff_suggestions_select"
  on public.os_slo_owner_handoff_suggestions;
create policy "os_slo_handoff_suggestions_select"
  on public.os_slo_owner_handoff_suggestions for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_revision_ledger_select"
  on public.os_slo_policy_revision_ledger;
create policy "os_slo_revision_ledger_select"
  on public.os_slo_policy_revision_ledger for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_phase44_ops_alerts_select"
  on public.os_slo_phase44_ops_alerts;
create policy "os_slo_phase44_ops_alerts_select"
  on public.os_slo_phase44_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_simulation_scenarios,
  public.os_slo_simulation_scenario_replays,
  public.os_slo_owner_handoff_suggestions,
  public.os_slo_policy_revision_ledger,
  public.os_slo_phase44_ops_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_simulation_scenarios,
  public.os_slo_simulation_scenario_replays,
  public.os_slo_owner_handoff_suggestions,
  public.os_slo_policy_revision_ledger,
  public.os_slo_phase44_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase44_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.prevent_slo_phase44_handoff_delete()
  from public,anon,authenticated,service_role;
revoke all on function public.register_slo_simulation_scenario_phase44(
  uuid,text,timestamptz,timestamptz,jsonb,text,text,text,jsonb
) from public,authenticated;
revoke all on function public.replay_slo_simulation_scenario_phase44(
  uuid,uuid,text,uuid,integer
) from public,authenticated;
revoke all on function public.suggest_slo_owner_handoffs_phase44(integer)
  from public,authenticated;
revoke all on function public.resolve_slo_owner_handoff_suggestion_phase44(
  uuid,uuid,text
) from public,authenticated;
revoke all on function public.record_slo_policy_revision_phase44(
  uuid,uuid,bigint,bigint,text,boolean
) from public,authenticated;
revoke all on function public.record_slo_phase44_ops_alert(
  text,text,text,uuid,jsonb
) from public,authenticated;
revoke all on function public.scan_slo_phase44_ops_alerts(uuid)
  from public,authenticated;
revoke all on function public.list_slo_phase44_critical_windows(integer)
  from public,anon;
revoke all on function public.get_slo_phase44_governance_report()
  from public,anon;

grant execute on function public.phase44_slo_safe_detail(jsonb),
  public.phase44_sanitize_entity_scope(jsonb),
  public.list_slo_phase44_critical_windows(integer),
  public.get_slo_phase44_governance_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.register_slo_simulation_scenario_phase44(
  uuid,text,timestamptz,timestamptz,jsonb,text,text,text,jsonb
),
  public.replay_slo_simulation_scenario_phase44(uuid,uuid,text,uuid,integer),
  public.suggest_slo_owner_handoffs_phase44(integer),
  public.resolve_slo_owner_handoff_suggestion_phase44(uuid,uuid,text),
  public.record_slo_policy_revision_phase44(uuid,uuid,bigint,bigint,text,boolean),
  public.record_slo_phase44_ops_alert(text,text,text,uuid,jsonb),
  public.scan_slo_phase44_ops_alerts(uuid)
  to service_role;
