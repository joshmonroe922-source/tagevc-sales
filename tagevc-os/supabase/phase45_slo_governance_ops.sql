-- Phase 45: nightly SLO scenario replay, quarterly owner handoff digests,
-- ownership visibility report, and ops alerts (replay failed / digest overdue).
-- Apply after phase44_slo_governance_ops.sql.
-- Counterfactual only — never mutates os_slo_alerts or delivery.

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

create or replace function public.phase45_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Nightly scenario replay runs (append-only completion evidence)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_nightly_scenario_replay_runs (
  run_id uuid primary key default gen_random_uuid(),
  scheduled_for timestamptz not null,
  scenarios_claimed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  material_risk_count integer not null default 0,
  evidence_sha256 text not null,
  status text not null default 'queued',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_slo_nightly_replay_counts_check
    check (
      scenarios_claimed>=0 and succeeded>=0 and failed>=0
      and material_risk_count>=0
      and succeeded+failed<=scenarios_claimed
    ),
  constraint os_slo_nightly_replay_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_nightly_replay_status_check
    check (status in ('queued','running','completed','failed','partial')),
  constraint os_slo_nightly_replay_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_nightly_replay_scheduled_unique
    unique (scheduled_for)
);

create index if not exists os_slo_nightly_replay_runs_status_idx
  on public.os_slo_nightly_scenario_replay_runs(status,scheduled_for desc);

-- ---------------------------------------------------------------------------
-- Quarterly owner handoff digests (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_handoff_digests (
  digest_id uuid primary key default gen_random_uuid(),
  digest_quarter text not null,
  suggestion_count integer not null default 0,
  expiry_count integer not null default 0,
  accepted_count integer not null default 0,
  digest_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  constraint os_slo_handoff_digest_quarter_check
    check (digest_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  constraint os_slo_handoff_digest_counts_check
    check (suggestion_count>=0 and expiry_count>=0 and accepted_count>=0),
  constraint os_slo_handoff_digest_hash_check
    check (digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_handoff_digest_metadata_check
    check (jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=4096),
  constraint os_slo_handoff_digest_quarter_unique
    unique (digest_quarter)
);

create index if not exists os_slo_owner_handoff_digests_generated_idx
  on public.os_slo_owner_handoff_digests(generated_at desc);

-- ---------------------------------------------------------------------------
-- Phase 45 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_phase45_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_phase45_alert_kind_check
    check (alert_kind in ('nightly_replay_failed','handoff_digest_overdue')),
  constraint os_slo_phase45_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_slo_phase45_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_phase45_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_phase45_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_phase45_ops_alerts_kind_idx
  on public.os_slo_phase45_ops_alerts(alert_kind,created_at desc);

create or replace function public.prevent_slo_phase45_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_handoff_digests_append_only
  on public.os_slo_owner_handoff_digests;
create trigger os_slo_handoff_digests_append_only before update or delete
  on public.os_slo_owner_handoff_digests for each row
  execute function public.prevent_slo_phase45_append_only();
drop trigger if exists os_slo_handoff_digests_no_truncate
  on public.os_slo_owner_handoff_digests;
create trigger os_slo_handoff_digests_no_truncate before truncate
  on public.os_slo_owner_handoff_digests for each statement
  execute function public.prevent_slo_phase45_append_only();

drop trigger if exists os_slo_phase45_ops_alerts_append_only
  on public.os_slo_phase45_ops_alerts;
create trigger os_slo_phase45_ops_alerts_append_only before update or delete
  on public.os_slo_phase45_ops_alerts for each row
  execute function public.prevent_slo_phase45_append_only();
drop trigger if exists os_slo_phase45_ops_alerts_no_truncate
  on public.os_slo_phase45_ops_alerts;
create trigger os_slo_phase45_ops_alerts_no_truncate before truncate
  on public.os_slo_phase45_ops_alerts for each statement
  execute function public.prevent_slo_phase45_append_only();

-- Nightly runs: no delete/truncate; status updates only via RPC.
create or replace function public.prevent_slo_phase45_nightly_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_slo_nightly_scenario_replay_runs deletes are forbidden'; end $$;
drop trigger if exists os_slo_nightly_replay_no_delete
  on public.os_slo_nightly_scenario_replay_runs;
create trigger os_slo_nightly_replay_no_delete before delete
  on public.os_slo_nightly_scenario_replay_runs for each row
  execute function public.prevent_slo_phase45_nightly_delete();
drop trigger if exists os_slo_nightly_replay_no_truncate
  on public.os_slo_nightly_scenario_replay_runs;
create trigger os_slo_nightly_replay_no_truncate before truncate
  on public.os_slo_nightly_scenario_replay_runs for each statement
  execute function public.prevent_slo_phase45_nightly_delete();

create or replace function public.phase45_current_digest_quarter(p_at timestamptz default now())
returns text
language sql
immutable
as $$
  select to_char(p_at at time zone 'utc','YYYY')
    || '-Q'
    || ((extract(month from p_at at time zone 'utc')::integer - 1) / 3 + 1)::text;
$$;

create or replace function public.enqueue_slo_nightly_scenario_replay_phase45(
  p_actor_id uuid default null,
  p_scheduled_for timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled timestamptz;
  v_run_id uuid;
  v_existing public.os_slo_nightly_scenario_replay_runs%rowtype;
  v_hash text;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to enqueue nightly scenario replay';
  end if;

  v_scheduled:=date_trunc('day', coalesce(p_scheduled_for, now() at time zone 'utc'));

  select * into v_existing from public.os_slo_nightly_scenario_replay_runs
    where scheduled_for=v_scheduled;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'run_id',v_existing.run_id,
      'scheduled_for',v_existing.scheduled_for,
      'status',v_existing.status,
      'production_alerts_mutated',false
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase45-v1',
    'scheduled_for',v_scheduled,
    'status','queued'
  )::text);

  insert into public.os_slo_nightly_scenario_replay_runs(
    scheduled_for,scenarios_claimed,succeeded,failed,material_risk_count,
    evidence_sha256,status,detail
  ) values (
    v_scheduled,0,0,0,0,v_hash,'queued',
    jsonb_build_object('contract_version','phase45-v1','enqueued_by',p_actor_id)
  ) returning run_id into v_run_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'run_id',v_run_id,
    'scheduled_for',v_scheduled,
    'status','queued',
    'production_alerts_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

-- Batch replay: claims queued run, replays registered scenarios via phase44
-- counterfactual replay only — never mutates os_slo_alerts / delivery.
create or replace function public.run_slo_nightly_scenario_replay_phase45(
  p_actor_id uuid default null,
  p_limit integer default 50,
  p_scheduled_for timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.os_slo_nightly_scenario_replay_runs%rowtype;
  v_enqueue jsonb;
  v_scenario record;
  v_replay jsonb;
  v_claimed integer:=0;
  v_succeeded integer:=0;
  v_failed integer:=0;
  v_material integer:=0;
  v_status text;
  v_evidence jsonb;
  v_hash text;
  v_day text;
  v_idem text;
  v_actor uuid;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 45 nightly scenario replay authorization failed';
  end if;
  if p_actor_id is null and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 45 nightly scenario replay requires an actor or service role';
  end if;
  if coalesce(p_limit,0) not between 1 and 200 then
    raise exception 'Nightly replay limit must be between 1 and 200';
  end if;

  if p_actor_id is not null then
    v_actor:=p_actor_id;
  else
    select p.id into v_actor
    from public.profiles p
    where p.active and p.role in ('visionary','admin')
    order by p.created_at,p.id
    limit 1;
    if v_actor is null then
      raise exception 'No visionary/admin actor available for nightly scenario replay';
    end if;
  end if;

  v_enqueue:=public.enqueue_slo_nightly_scenario_replay_phase45(
    p_actor_id, p_scheduled_for
  );

  select * into v_run from public.os_slo_nightly_scenario_replay_runs
    where run_id=(v_enqueue->>'run_id')::uuid
    for update;
  if not found then
    raise exception 'Nightly scenario replay run was not found';
  end if;

  if v_run.status in ('completed','failed','partial') then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'run_id',v_run.run_id,
      'status',v_run.status,
      'scenarios_claimed',v_run.scenarios_claimed,
      'succeeded',v_run.succeeded,
      'failed',v_run.failed,
      'material_risk_count',v_run.material_risk_count,
      'evidence_sha256',v_run.evidence_sha256,
      'production_alerts_mutated',false
    );
  end if;

  update public.os_slo_nightly_scenario_replay_runs
    set status='running'
    where run_id=v_run.run_id;

  v_day:=to_char(v_run.scheduled_for at time zone 'utc','YYYY-MM-DD');

  for v_scenario in
    select s.scenario_id,s.draft_policy_hash,s.published_policy_hash
    from public.os_slo_simulation_scenarios s
    order by s.created_at,s.scenario_id
    limit p_limit
  loop
    v_claimed:=v_claimed+1;
    v_idem:='phase45:nightly:'||v_day||':'||v_scenario.scenario_id::text;
    begin
      v_replay:=public.replay_slo_simulation_scenario_phase44(
        v_actor,
        v_scenario.scenario_id,
        v_idem,
        null,
        168
      );
      if coalesce((v_replay->>'ok')::boolean,false) then
        v_succeeded:=v_succeeded+1;
      else
        v_failed:=v_failed+1;
      end if;
      if exists (
        select 1 from public.os_slo_policy_revision_ledger r
        where r.comparison_digest=v_scenario.draft_policy_hash
          and r.material_risk
      ) or (
        v_scenario.published_policy_hash is not null
        and v_scenario.draft_policy_hash is distinct from v_scenario.published_policy_hash
      ) then
        v_material:=v_material+1;
      end if;
    exception when others then
      v_failed:=v_failed+1;
    end;
  end loop;

  if v_failed>0 and v_succeeded=0 and v_claimed>0 then
    v_status:='failed';
  elsif v_failed>0 then
    v_status:='partial';
  else
    v_status:='completed';
  end if;

  v_evidence:=jsonb_build_object(
    'contract_version','phase45-v1',
    'failed',v_failed,
    'material_risk_count',v_material,
    'production_alerts_mutated',false,
    'run_id',v_run.run_id,
    'scenarios_claimed',v_claimed,
    'scheduled_for',v_run.scheduled_for,
    'status',v_status,
    'succeeded',v_succeeded
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  update public.os_slo_nightly_scenario_replay_runs
    set scenarios_claimed=v_claimed,
        succeeded=v_succeeded,
        failed=v_failed,
        material_risk_count=v_material,
        evidence_sha256=v_hash,
        status=v_status,
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'completed_by',p_actor_id,
          'limit',p_limit
        ),
        completed_at=now()
    where run_id=v_run.run_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'run_id',v_run.run_id,
    'scheduled_for',v_run.scheduled_for,
    'status',v_status,
    'scenarios_claimed',v_claimed,
    'succeeded',v_succeeded,
    'failed',v_failed,
    'material_risk_count',v_material,
    'evidence_sha256',v_hash,
    'production_alerts_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.generate_slo_owner_handoff_digest_phase45(
  p_actor_id uuid default null,
  p_digest_quarter text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_quarter text;
  v_existing public.os_slo_owner_handoff_digests%rowtype;
  v_digest_id uuid;
  v_suggestion integer:=0;
  v_expiry integer:=0;
  v_accepted integer:=0;
  v_meta jsonb;
  v_hash text;
  v_q_start timestamptz;
  v_q_end timestamptz;
  v_year integer;
  v_q integer;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to generate handoff digests';
  end if;

  v_quarter:=coalesce(
    nullif(trim(p_digest_quarter),''),
    public.phase45_current_digest_quarter(now())
  );
  if v_quarter !~ '^[0-9]{4}-Q[1-4]$' then
    raise exception 'Digest quarter must look like YYYY-Qn';
  end if;

  select * into v_existing from public.os_slo_owner_handoff_digests
    where digest_quarter=v_quarter;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'digest_id',v_existing.digest_id,
      'digest_quarter',v_existing.digest_quarter,
      'suggestion_count',v_existing.suggestion_count,
      'expiry_count',v_existing.expiry_count,
      'accepted_count',v_existing.accepted_count,
      'digest_sha256',v_existing.digest_sha256,
      'live_succession_mutated',false
    );
  end if;

  v_year:=substring(v_quarter from 1 for 4)::integer;
  v_q:=substring(v_quarter from 7 for 1)::integer;
  v_q_start:=make_timestamptz(v_year, (v_q-1)*3+1, 1, 0, 0, 0, 'UTC');
  v_q_end:=v_q_start + interval '3 months';

  select count(*) into v_suggestion
  from public.os_slo_owner_handoff_suggestions s
  where s.created_at>=v_q_start and s.created_at<v_q_end;

  select count(*) into v_accepted
  from public.os_slo_owner_handoff_suggestions s
  where s.created_at>=v_q_start and s.created_at<v_q_end
    and s.status='accepted';

  select count(*) into v_expiry
  from public.os_slo_owners o
  where o.expires_at is not null
    and o.expires_at>=v_q_start
    and o.expires_at<v_q_end;

  v_meta:=jsonb_build_object(
    'contract_version','phase45-v1',
    'generated_by',p_actor_id,
    'quarter_end',v_q_end,
    'quarter_start',v_q_start
  );
  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'accepted_count',v_accepted,
    'contract_version','phase45-v1',
    'digest_quarter',v_quarter,
    'expiry_count',v_expiry,
    'suggestion_count',v_suggestion
  )::text);

  insert into public.os_slo_owner_handoff_digests(
    digest_quarter,suggestion_count,expiry_count,accepted_count,
    digest_sha256,metadata
  ) values (
    v_quarter,v_suggestion,v_expiry,v_accepted,v_hash,v_meta
  ) returning digest_id into v_digest_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'digest_id',v_digest_id,
    'digest_quarter',v_quarter,
    'suggestion_count',v_suggestion,
    'expiry_count',v_expiry,
    'accepted_count',v_accepted,
    'digest_sha256',v_hash,
    'live_succession_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.record_slo_phase45_ops_alert(
  p_alert_kind text,
  p_window_key text,
  p_severity text default 'warning',
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_slo_phase45_ops_alerts%rowtype;
  v_alert_id uuid;
  v_hash text;
begin
  if p_alert_kind not in ('nightly_replay_failed','handoff_digest_overdue')
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or coalesce(p_severity,'warning') not in ('warning','critical')
     or not public.phase45_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 45 ops alert input failed';
  end if;

  select * into v_existing from public.os_slo_phase45_ops_alerts
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
    'contract_version','phase45-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'severity',coalesce(p_severity,'warning'),
    'window_key',p_window_key
  )::text);

  insert into public.os_slo_phase45_ops_alerts(
    alert_kind,window_key,severity,metrics_sha256,detail
  ) values (
    p_alert_kind,p_window_key,coalesce(p_severity,'warning'),v_hash,
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

create or replace function public.scan_slo_phase45_ops_alerts(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recorded integer:=0;
  v_one jsonb;
  v_day text:=to_char(now() at time zone 'utc','YYYY-MM-DD');
  v_quarter text:=public.phase45_current_digest_quarter(now());
  v_prev_quarter text;
  v_year integer;
  v_q integer;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan SLO Phase 45 ops alerts';
  end if;

  if exists (
    select 1 from public.os_slo_nightly_scenario_replay_runs r
    where r.scheduled_for>=date_trunc('day', now() at time zone 'utc') - interval '2 days'
      and r.status in ('failed','partial')
  ) then
    v_one:=public.record_slo_phase45_ops_alert(
      'nightly_replay_failed',
      'phase45:nightly_replay_failed:'||v_day,
      'critical',
      jsonb_build_object('source','scan_slo_phase45_ops_alerts')
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  -- Previous quarter digest overdue after day 14 of the new quarter.
  v_year:=substring(v_quarter from 1 for 4)::integer;
  v_q:=substring(v_quarter from 7 for 1)::integer;
  if v_q=1 then
    v_prev_quarter:=(v_year-1)::text||'-Q4';
  else
    v_prev_quarter:=v_year::text||'-Q'||(v_q-1)::text;
  end if;

  if extract(day from now() at time zone 'utc')>=14
     and not exists (
       select 1 from public.os_slo_owner_handoff_digests d
       where d.digest_quarter=v_prev_quarter
     ) then
    v_one:=public.record_slo_phase45_ops_alert(
      'handoff_digest_overdue',
      'phase45:handoff_digest_overdue:'||v_prev_quarter,
      'warning',
      jsonb_build_object(
        'digest_quarter',v_prev_quarter,
        'source','scan_slo_phase45_ops_alerts'
      )
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'alerts_recorded',v_recorded,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.get_slo_phase45_governance_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_upcoming jsonb:='[]'::jsonb;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 45 governance report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sort_at), '[]'::jsonb)
    into v_upcoming
  from (
    select
      'coverage_expiry'::text as change_kind,
      o.ownership_id,
      o.owner_id,
      o.replacement_owner_id,
      o.expires_at as sort_at,
      o.expires_at,
      null::uuid as suggestion_id,
      null::text as suggestion_status
    from public.os_slo_owners o
    where o.active
      and o.expires_at is not null
      and o.expires_at>now()
      and o.expires_at<=now()+interval '60 days'
    union all
    select
      'handoff_suggestion'::text as change_kind,
      s.ownership_id,
      s.current_owner_id as owner_id,
      s.suggested_owner_id as replacement_owner_id,
      s.created_at as sort_at,
      null::timestamptz as expires_at,
      s.suggestion_id,
      s.status as suggestion_status
    from public.os_slo_owner_handoff_suggestions s
    where s.status='suggested'
    order by sort_at
    limit 40
  ) t;

  return jsonb_build_object(
    'nightly_replay_runs_30d',
      (select count(*) from public.os_slo_nightly_scenario_replay_runs
        where created_at>=now()-interval '30 days'),
    'nightly_replay_failed_30d',
      (select count(*) from public.os_slo_nightly_scenario_replay_runs
        where created_at>=now()-interval '30 days'
          and status in ('failed','partial')),
    'handoff_digests',
      (select count(*) from public.os_slo_owner_handoff_digests),
    'latest_digest_quarter',
      (select d.digest_quarter from public.os_slo_owner_handoff_digests d
        order by d.generated_at desc limit 1),
    'ops_alerts_30d',
      (select count(*) from public.os_slo_phase45_ops_alerts
        where created_at>=now()-interval '30 days'),
    'upcoming_ownership_changes',v_upcoming,
    'upcoming_ownership_change_count',jsonb_array_length(v_upcoming),
    'production_alerts_mutated',false,
    'live_succession_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

alter table public.os_slo_nightly_scenario_replay_runs enable row level security;
alter table public.os_slo_owner_handoff_digests enable row level security;
alter table public.os_slo_phase45_ops_alerts enable row level security;

drop policy if exists "os_slo_nightly_replay_select"
  on public.os_slo_nightly_scenario_replay_runs;
create policy "os_slo_nightly_replay_select"
  on public.os_slo_nightly_scenario_replay_runs for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_handoff_digests_select"
  on public.os_slo_owner_handoff_digests;
create policy "os_slo_handoff_digests_select"
  on public.os_slo_owner_handoff_digests for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_phase45_ops_alerts_select"
  on public.os_slo_phase45_ops_alerts;
create policy "os_slo_phase45_ops_alerts_select"
  on public.os_slo_phase45_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_nightly_scenario_replay_runs,
  public.os_slo_owner_handoff_digests,
  public.os_slo_phase45_ops_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_nightly_scenario_replay_runs,
  public.os_slo_owner_handoff_digests,
  public.os_slo_phase45_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase45_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.prevent_slo_phase45_nightly_delete()
  from public,anon,authenticated,service_role;
revoke all on function public.enqueue_slo_nightly_scenario_replay_phase45(
  uuid,timestamptz
) from public,authenticated;
revoke all on function public.run_slo_nightly_scenario_replay_phase45(
  uuid,integer,timestamptz
) from public,authenticated;
revoke all on function public.generate_slo_owner_handoff_digest_phase45(
  uuid,text
) from public,authenticated;
revoke all on function public.record_slo_phase45_ops_alert(
  text,text,text,jsonb
) from public,authenticated;
revoke all on function public.scan_slo_phase45_ops_alerts(uuid)
  from public,authenticated;
revoke all on function public.get_slo_phase45_governance_report()
  from public,anon;

grant execute on function public.phase45_slo_safe_detail(jsonb),
  public.phase45_current_digest_quarter(timestamptz),
  public.get_slo_phase45_governance_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.enqueue_slo_nightly_scenario_replay_phase45(
  uuid,timestamptz
),
  public.run_slo_nightly_scenario_replay_phase45(uuid,integer,timestamptz),
  public.generate_slo_owner_handoff_digest_phase45(uuid,text),
  public.record_slo_phase45_ops_alert(text,text,text,jsonb),
  public.scan_slo_phase45_ops_alerts(uuid)
  to service_role;
