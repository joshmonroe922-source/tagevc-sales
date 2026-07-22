-- Phase 46: firm-wide nightly scenario replay, published quarterly handoff
-- digests, and ownership-change visibility alerts.
-- Apply after phase45_slo_governance_ops.sql.
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

create or replace function public.phase46_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Firm-wide nightly replay schedules + runs (material-risk / firm-wide flag)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_firm_wide_nightly_replay_schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  schedule_key text not null unique,
  enabled boolean not null default true,
  last_scheduled_for timestamptz,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_slo_fw_nightly_sched_key_check
    check (schedule_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_slo_fw_nightly_sched_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

insert into public.os_slo_firm_wide_nightly_replay_schedules(
  schedule_key,enabled,detail
) values (
  'firm_wide_nightly',true,
  jsonb_build_object('contract_version','phase46-v1')
) on conflict (schedule_key) do nothing;

create table if not exists public.os_slo_firm_wide_nightly_replay_runs (
  run_id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null
    references public.os_slo_firm_wide_nightly_replay_schedules(schedule_id),
  scheduled_for timestamptz not null,
  scenarios_claimed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  material_risk_count integer not null default 0,
  firm_wide_flag_count integer not null default 0,
  evidence_sha256 text not null,
  status text not null default 'queued',
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_slo_fw_nightly_counts_check
    check (
      scenarios_claimed>=0 and succeeded>=0 and failed>=0
      and material_risk_count>=0 and firm_wide_flag_count>=0
      and succeeded+failed<=scenarios_claimed
    ),
  constraint os_slo_fw_nightly_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_fw_nightly_status_check
    check (status in ('queued','running','completed','failed','partial')),
  constraint os_slo_fw_nightly_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_fw_nightly_scheduled_unique
    unique (scheduled_for)
);

create index if not exists os_slo_fw_nightly_runs_status_idx
  on public.os_slo_firm_wide_nightly_replay_runs(status,scheduled_for desc);

-- ---------------------------------------------------------------------------
-- Quarterly handoff digest publications (count + destination_key only; no PII)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_handoff_digest_publications (
  publication_id uuid primary key default gen_random_uuid(),
  digest_id uuid not null
    references public.os_slo_owner_handoff_digests(digest_id),
  digest_quarter text not null,
  publish_status text not null default 'queued',
  published_at timestamptz,
  recipient_count integer not null default 0,
  destination_key text not null,
  digest_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_handoff_pub_quarter_check
    check (digest_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  constraint os_slo_handoff_pub_status_check
    check (publish_status in ('queued','published','failed','skipped')),
  constraint os_slo_handoff_pub_recipient_check
    check (recipient_count>=0 and recipient_count<=100000),
  constraint os_slo_handoff_pub_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_handoff_pub_hash_check
    check (digest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_handoff_pub_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_handoff_pub_published_ts_check
    check (
      (publish_status='published' and published_at is not null)
      or (publish_status<>'published')
    ),
  constraint os_slo_handoff_pub_digest_dest_unique
    unique (digest_id, destination_key)
);

create index if not exists os_slo_handoff_pub_quarter_idx
  on public.os_slo_owner_handoff_digest_publications(digest_quarter,created_at desc);

-- ---------------------------------------------------------------------------
-- Ownership-change alerts (upcoming expiry without accepted handoff)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_ownership_change_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  ownership_id uuid,
  expires_at timestamptz,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_ownership_change_kind_check
    check (alert_kind in ('ownership_expiry_without_handoff')),
  constraint os_slo_ownership_change_severity_check
    check (severity in ('warning','critical')),
  constraint os_slo_ownership_change_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_ownership_change_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_ownership_change_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_ownership_change_alerts_kind_idx
  on public.os_slo_ownership_change_alerts(alert_kind,created_at desc);

create or replace function public.prevent_slo_phase46_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_handoff_pub_append_only
  on public.os_slo_owner_handoff_digest_publications;
create trigger os_slo_handoff_pub_append_only before update or delete
  on public.os_slo_owner_handoff_digest_publications for each row
  execute function public.prevent_slo_phase46_append_only();
drop trigger if exists os_slo_handoff_pub_no_truncate
  on public.os_slo_owner_handoff_digest_publications;
create trigger os_slo_handoff_pub_no_truncate before truncate
  on public.os_slo_owner_handoff_digest_publications for each statement
  execute function public.prevent_slo_phase46_append_only();

drop trigger if exists os_slo_ownership_change_alerts_append_only
  on public.os_slo_ownership_change_alerts;
create trigger os_slo_ownership_change_alerts_append_only before update or delete
  on public.os_slo_ownership_change_alerts for each row
  execute function public.prevent_slo_phase46_append_only();
drop trigger if exists os_slo_ownership_change_alerts_no_truncate
  on public.os_slo_ownership_change_alerts;
create trigger os_slo_ownership_change_alerts_no_truncate before truncate
  on public.os_slo_ownership_change_alerts for each statement
  execute function public.prevent_slo_phase46_append_only();

create or replace function public.prevent_slo_phase46_fw_run_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_slo_firm_wide_nightly_replay_runs deletes are forbidden'; end $$;
drop trigger if exists os_slo_fw_nightly_run_no_delete
  on public.os_slo_firm_wide_nightly_replay_runs;
create trigger os_slo_fw_nightly_run_no_delete before delete
  on public.os_slo_firm_wide_nightly_replay_runs for each row
  execute function public.prevent_slo_phase46_fw_run_delete();
drop trigger if exists os_slo_fw_nightly_run_no_truncate
  on public.os_slo_firm_wide_nightly_replay_runs;
create trigger os_slo_fw_nightly_run_no_truncate before truncate
  on public.os_slo_firm_wide_nightly_replay_runs for each statement
  execute function public.prevent_slo_phase46_fw_run_delete();

create or replace function public.prevent_slo_phase46_fw_sched_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_slo_firm_wide_nightly_replay_schedules deletes are forbidden'; end $$;
drop trigger if exists os_slo_fw_nightly_sched_no_delete
  on public.os_slo_firm_wide_nightly_replay_schedules;
create trigger os_slo_fw_nightly_sched_no_delete before delete
  on public.os_slo_firm_wide_nightly_replay_schedules for each row
  execute function public.prevent_slo_phase46_fw_sched_delete();
drop trigger if exists os_slo_fw_nightly_sched_no_truncate
  on public.os_slo_firm_wide_nightly_replay_schedules;
create trigger os_slo_fw_nightly_sched_no_truncate before truncate
  on public.os_slo_firm_wide_nightly_replay_schedules for each statement
  execute function public.prevent_slo_phase46_fw_sched_delete();

create or replace function public.phase46_scenario_is_firm_wide_claim(p_scenario_id uuid)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.os_slo_simulation_scenarios s
    where s.scenario_id=p_scenario_id
      and (
        coalesce((s.metadata->>'firm_wide')::boolean,false)
        or exists (
          select 1 from public.os_slo_policy_revision_ledger r
          where r.comparison_digest=s.draft_policy_hash
            and r.material_risk
        )
        or (
          s.published_policy_hash is not null
          and s.draft_policy_hash is distinct from s.published_policy_hash
        )
      )
  );
$$;

create or replace function public.enqueue_slo_firm_wide_nightly_replay_phase46(
  p_actor_id uuid default null,
  p_scheduled_for timestamptz default null,
  p_schedule_key text default 'firm_wide_nightly'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled timestamptz;
  v_schedule public.os_slo_firm_wide_nightly_replay_schedules%rowtype;
  v_run_id uuid;
  v_existing public.os_slo_firm_wide_nightly_replay_runs%rowtype;
  v_hash text;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to enqueue firm-wide nightly replay';
  end if;

  select * into v_schedule from public.os_slo_firm_wide_nightly_replay_schedules
    where schedule_key=coalesce(nullif(trim(p_schedule_key),''),'firm_wide_nightly')
    for update;
  if not found then
    raise exception 'Firm-wide nightly replay schedule was not found';
  end if;
  if not v_schedule.enabled then
    raise exception 'Firm-wide nightly replay schedule is disabled';
  end if;

  v_scheduled:=date_trunc('day', coalesce(p_scheduled_for, now() at time zone 'utc'));

  select * into v_existing from public.os_slo_firm_wide_nightly_replay_runs
    where scheduled_for=v_scheduled;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'run_id',v_existing.run_id,
      'schedule_id',v_existing.schedule_id,
      'scheduled_for',v_existing.scheduled_for,
      'status',v_existing.status,
      'production_alerts_mutated',false
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase46-v1',
    'scheduled_for',v_scheduled,
    'schedule_key',v_schedule.schedule_key,
    'status','queued'
  )::text);

  insert into public.os_slo_firm_wide_nightly_replay_runs(
    schedule_id,scheduled_for,scenarios_claimed,succeeded,failed,
    material_risk_count,firm_wide_flag_count,evidence_sha256,status,detail
  ) values (
    v_schedule.schedule_id,v_scheduled,0,0,0,0,0,v_hash,'queued',
    jsonb_build_object('contract_version','phase46-v1','enqueued_by',p_actor_id)
  ) returning run_id into v_run_id;

  update public.os_slo_firm_wide_nightly_replay_schedules
    set last_scheduled_for=v_scheduled, updated_at=now()
    where schedule_id=v_schedule.schedule_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'run_id',v_run_id,
    'schedule_id',v_schedule.schedule_id,
    'scheduled_for',v_scheduled,
    'status','queued',
    'production_alerts_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

-- Claims ALL material-risk scenarios (or firm_wide metadata flag) — not ad-hoc limit.
-- Counterfactual only via phase44 replay — never mutates os_slo_alerts / delivery.
create or replace function public.run_slo_firm_wide_nightly_replay_phase46(
  p_actor_id uuid default null,
  p_scheduled_for timestamptz default null,
  p_schedule_key text default 'firm_wide_nightly'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.os_slo_firm_wide_nightly_replay_runs%rowtype;
  v_enqueue jsonb;
  v_scenario record;
  v_replay jsonb;
  v_claimed integer:=0;
  v_succeeded integer:=0;
  v_failed integer:=0;
  v_material integer:=0;
  v_firm_wide integer:=0;
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
    raise exception 'Phase 46 firm-wide nightly scenario replay authorization failed';
  end if;
  if p_actor_id is null and auth.role() is distinct from 'service_role' then
    raise exception 'Phase 46 firm-wide nightly scenario replay requires an actor or service role';
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
      raise exception 'No visionary/admin actor available for firm-wide nightly scenario replay';
    end if;
  end if;

  v_enqueue:=public.enqueue_slo_firm_wide_nightly_replay_phase46(
    p_actor_id, p_scheduled_for, p_schedule_key
  );

  select * into v_run from public.os_slo_firm_wide_nightly_replay_runs
    where run_id=(v_enqueue->>'run_id')::uuid
    for update;
  if not found then
    raise exception 'Firm-wide nightly scenario replay run was not found';
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
      'firm_wide_flag_count',v_run.firm_wide_flag_count,
      'evidence_sha256',v_run.evidence_sha256,
      'production_alerts_mutated',false
    );
  end if;

  update public.os_slo_firm_wide_nightly_replay_runs
    set status='running'
    where run_id=v_run.run_id;

  v_day:=to_char(v_run.scheduled_for at time zone 'utc','YYYY-MM-DD');

  for v_scenario in
    select s.scenario_id,s.draft_policy_hash,s.published_policy_hash,s.metadata
    from public.os_slo_simulation_scenarios s
    where public.phase46_scenario_is_firm_wide_claim(s.scenario_id)
    order by s.created_at,s.scenario_id
  loop
    v_claimed:=v_claimed+1;
    if coalesce((v_scenario.metadata->>'firm_wide')::boolean,false) then
      v_firm_wide:=v_firm_wide+1;
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

    v_idem:='phase46:firm_wide:'||v_day||':'||v_scenario.scenario_id::text;
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
    'contract_version','phase46-v1',
    'failed',v_failed,
    'firm_wide_flag_count',v_firm_wide,
    'material_risk_count',v_material,
    'production_alerts_mutated',false,
    'run_id',v_run.run_id,
    'scenarios_claimed',v_claimed,
    'scheduled_for',v_run.scheduled_for,
    'status',v_status,
    'succeeded',v_succeeded
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  update public.os_slo_firm_wide_nightly_replay_runs
    set scenarios_claimed=v_claimed,
        succeeded=v_succeeded,
        failed=v_failed,
        material_risk_count=v_material,
        firm_wide_flag_count=v_firm_wide,
        evidence_sha256=v_hash,
        status=v_status,
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'completed_by',p_actor_id,
          'claim_mode','material_risk_or_firm_wide'
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
    'firm_wide_flag_count',v_firm_wide,
    'evidence_sha256',v_hash,
    'production_alerts_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

create or replace function public.publish_slo_owner_handoff_digest_phase46(
  p_actor_id uuid default null,
  p_digest_quarter text default null,
  p_destination_key text default 'ops_alerts',
  p_recipient_count integer default 0
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_generate jsonb;
  v_digest_id uuid;
  v_quarter text;
  v_sha text;
  v_dest text;
  v_existing public.os_slo_owner_handoff_digest_publications%rowtype;
  v_publication_id uuid;
  v_status text:='published';
  v_detail jsonb;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to publish handoff digests';
  end if;

  v_dest:=coalesce(nullif(trim(p_destination_key),''),'ops_alerts');
  if v_dest !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Handoff digest destination_key is invalid';
  end if;
  if coalesce(p_recipient_count,0)<0 or coalesce(p_recipient_count,0)>100000 then
    raise exception 'Handoff digest recipient_count is out of range';
  end if;

  -- Builds on Phase 45 generate (idempotent per quarter).
  v_generate:=public.generate_slo_owner_handoff_digest_phase45(
    p_actor_id, p_digest_quarter
  );
  if not coalesce((v_generate->>'ok')::boolean,false) then
    raise exception 'Handoff digest generation failed before publish';
  end if;

  v_digest_id:=(v_generate->>'digest_id')::uuid;
  v_quarter:=v_generate->>'digest_quarter';
  v_sha:=v_generate->>'digest_sha256';

  select * into v_existing from public.os_slo_owner_handoff_digest_publications
    where digest_id=v_digest_id and destination_key=v_dest;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'publication_id',v_existing.publication_id,
      'digest_id',v_existing.digest_id,
      'digest_quarter',v_existing.digest_quarter,
      'publish_status',v_existing.publish_status,
      'published_at',v_existing.published_at,
      'recipient_count',v_existing.recipient_count,
      'destination_key',v_existing.destination_key,
      'digest_sha256',v_existing.digest_sha256,
      'live_succession_mutated',false
    );
  end if;

  if coalesce(p_recipient_count,0)=0 then
    v_status:='skipped';
  end if;

  v_detail:=jsonb_build_object(
    'accepted_count',coalesce((v_generate->>'accepted_count')::integer,0),
    'contract_version','phase46-v1',
    'expiry_count',coalesce((v_generate->>'expiry_count')::integer,0),
    'generated_replayed',coalesce((v_generate->>'replayed')::boolean,false),
    'published_by',p_actor_id,
    'suggestion_count',coalesce((v_generate->>'suggestion_count')::integer,0)
  );

  insert into public.os_slo_owner_handoff_digest_publications(
    digest_id,digest_quarter,publish_status,published_at,
    recipient_count,destination_key,digest_sha256,detail
  ) values (
    v_digest_id,v_quarter,v_status,
    case when v_status='published' then now() else null end,
    coalesce(p_recipient_count,0),v_dest,v_sha,v_detail
  ) returning publication_id into v_publication_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'publication_id',v_publication_id,
    'digest_id',v_digest_id,
    'digest_quarter',v_quarter,
    'publish_status',v_status,
    'published_at',case when v_status='published' then now() else null end,
    'recipient_count',coalesce(p_recipient_count,0),
    'destination_key',v_dest,
    'digest_sha256',v_sha,
    'live_succession_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

create or replace function public.record_slo_ownership_change_alert_phase46(
  p_alert_kind text,
  p_window_key text,
  p_severity text default 'warning',
  p_ownership_id uuid default null,
  p_expires_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_slo_ownership_change_alerts%rowtype;
  v_alert_id uuid;
  v_hash text;
begin
  if p_alert_kind not in ('ownership_expiry_without_handoff')
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or coalesce(p_severity,'warning') not in ('warning','critical')
     or not public.phase46_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 46 ownership-change alert input failed';
  end if;

  select * into v_existing from public.os_slo_ownership_change_alerts
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
    'contract_version','phase46-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'expires_at',p_expires_at,
    'ownership_id',p_ownership_id,
    'severity',coalesce(p_severity,'warning'),
    'window_key',p_window_key
  )::text);

  insert into public.os_slo_ownership_change_alerts(
    alert_kind,window_key,ownership_id,expires_at,severity,metrics_sha256,detail
  ) values (
    p_alert_kind,p_window_key,p_ownership_id,p_expires_at,
    coalesce(p_severity,'warning'),v_hash,coalesce(p_detail,'{}'::jsonb)
  ) returning alert_id into v_alert_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'alert_id',v_alert_id,
    'alert_kind',p_alert_kind,
    'window_key',p_window_key,
    'metrics_sha256',v_hash
  );
end $$;

create or replace function public.scan_slo_ownership_change_alerts_phase46(
  p_actor_id uuid default null,
  p_days_ahead integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recorded integer:=0;
  v_one jsonb;
  v_row record;
  v_days integer:=least(greatest(coalesce(p_days_ahead,60),1),180);
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan ownership-change alerts';
  end if;

  for v_row in
    select o.ownership_id,o.owner_id,o.expires_at
    from public.os_slo_owners o
    where o.active
      and o.expires_at is not null
      and o.expires_at>now()
      and o.expires_at<=now()+(v_days||' days')::interval
      and not exists (
        select 1 from public.os_slo_owner_handoff_suggestions s
        where s.ownership_id=o.ownership_id
          and s.status='accepted'
      )
    order by o.expires_at,o.ownership_id
    limit 200
  loop
    v_one:=public.record_slo_ownership_change_alert_phase46(
      'ownership_expiry_without_handoff',
      'phase46:ownership_expiry:'||v_row.ownership_id::text||':'||
        to_char(v_row.expires_at at time zone 'utc','YYYY-MM-DD'),
      case when v_row.expires_at<=now()+interval '14 days' then 'critical' else 'warning' end,
      v_row.ownership_id,
      v_row.expires_at,
      jsonb_build_object(
        'days_ahead',v_days,
        'source','scan_slo_ownership_change_alerts_phase46'
      )
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'alerts_recorded',v_recorded,
    'days_ahead',v_days,
    'contract_version','phase46-v1'
  );
end $$;

create or replace function public.get_slo_phase46_governance_report()
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
    raise exception 'Firm-wide access required for SLO Phase 46 governance report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sort_at), '[]'::jsonb)
    into v_upcoming
  from (
    select
      'coverage_expiry_without_handoff'::text as change_kind,
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
      and not exists (
        select 1 from public.os_slo_owner_handoff_suggestions s
        where s.ownership_id=o.ownership_id
          and s.status='accepted'
      )
    order by sort_at
    limit 40
  ) t;

  return jsonb_build_object(
    'firm_wide_replay_runs_30d',
      (select count(*) from public.os_slo_firm_wide_nightly_replay_runs
        where created_at>=now()-interval '30 days'),
    'firm_wide_replay_failed_30d',
      (select count(*) from public.os_slo_firm_wide_nightly_replay_runs
        where created_at>=now()-interval '30 days'
          and status in ('failed','partial')),
    'digest_publications',
      (select count(*) from public.os_slo_owner_handoff_digest_publications),
    'digest_publications_published',
      (select count(*) from public.os_slo_owner_handoff_digest_publications
        where publish_status='published'),
    'latest_publication_quarter',
      (select p.digest_quarter from public.os_slo_owner_handoff_digest_publications p
        order by p.created_at desc limit 1),
    'ownership_change_alerts_30d',
      (select count(*) from public.os_slo_ownership_change_alerts
        where created_at>=now()-interval '30 days'),
    'upcoming_ownership_changes_without_handoff',v_upcoming,
    'upcoming_ownership_change_without_handoff_count',jsonb_array_length(v_upcoming),
    'production_alerts_mutated',false,
    'live_succession_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

alter table public.os_slo_firm_wide_nightly_replay_schedules enable row level security;
alter table public.os_slo_firm_wide_nightly_replay_runs enable row level security;
alter table public.os_slo_owner_handoff_digest_publications enable row level security;
alter table public.os_slo_ownership_change_alerts enable row level security;

drop policy if exists "os_slo_fw_nightly_sched_select"
  on public.os_slo_firm_wide_nightly_replay_schedules;
create policy "os_slo_fw_nightly_sched_select"
  on public.os_slo_firm_wide_nightly_replay_schedules for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_fw_nightly_runs_select"
  on public.os_slo_firm_wide_nightly_replay_runs;
create policy "os_slo_fw_nightly_runs_select"
  on public.os_slo_firm_wide_nightly_replay_runs for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_handoff_pub_select"
  on public.os_slo_owner_handoff_digest_publications;
create policy "os_slo_handoff_pub_select"
  on public.os_slo_owner_handoff_digest_publications for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_ownership_change_alerts_select"
  on public.os_slo_ownership_change_alerts;
create policy "os_slo_ownership_change_alerts_select"
  on public.os_slo_ownership_change_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_firm_wide_nightly_replay_schedules,
  public.os_slo_firm_wide_nightly_replay_runs,
  public.os_slo_owner_handoff_digest_publications,
  public.os_slo_ownership_change_alerts
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_firm_wide_nightly_replay_schedules,
  public.os_slo_firm_wide_nightly_replay_runs,
  public.os_slo_owner_handoff_digest_publications,
  public.os_slo_ownership_change_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase46_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.prevent_slo_phase46_fw_run_delete()
  from public,anon,authenticated,service_role;
revoke all on function public.prevent_slo_phase46_fw_sched_delete()
  from public,anon,authenticated,service_role;
revoke all on function public.enqueue_slo_firm_wide_nightly_replay_phase46(
  uuid,timestamptz,text
) from public,authenticated;
revoke all on function public.run_slo_firm_wide_nightly_replay_phase46(
  uuid,timestamptz,text
) from public,authenticated;
revoke all on function public.publish_slo_owner_handoff_digest_phase46(
  uuid,text,text,integer
) from public,authenticated;
revoke all on function public.record_slo_ownership_change_alert_phase46(
  text,text,text,uuid,timestamptz,jsonb
) from public,authenticated;
revoke all on function public.scan_slo_ownership_change_alerts_phase46(
  uuid,integer
) from public,authenticated;
revoke all on function public.get_slo_phase46_governance_report()
  from public,anon;

grant execute on function public.phase46_slo_safe_detail(jsonb),
  public.phase46_scenario_is_firm_wide_claim(uuid),
  public.get_slo_phase46_governance_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.enqueue_slo_firm_wide_nightly_replay_phase46(
  uuid,timestamptz,text
),
  public.run_slo_firm_wide_nightly_replay_phase46(uuid,timestamptz,text),
  public.publish_slo_owner_handoff_digest_phase46(uuid,text,text,integer),
  public.record_slo_ownership_change_alert_phase46(
    text,text,text,uuid,timestamptz,jsonb
  ),
  public.scan_slo_ownership_change_alerts_phase46(uuid,integer)
  to service_role;
