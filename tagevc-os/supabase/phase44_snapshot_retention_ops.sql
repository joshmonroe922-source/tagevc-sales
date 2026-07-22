-- Phase 44: snapshot package integrity evidence, retention monitoring alerts,
-- and multi-hour canary schedule enhancements. Stage 4e evidence/attestation-safe
-- ops only — packages remain non-qualifying.
-- Apply after phase43_snapshot_verify_cold_production.sql.

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

create or replace function public.phase44_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Package integrity verification evidence (append-only, non-qualifying)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_package_integrity_checks (
  check_id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.os_snapshot_export_packages(package_id),
  check_status text not null,
  key_id text,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_pkg_integrity_status_check
    check (check_status in (
      'verified','digest_mismatch','signature_invalid',
      'metadata_incomplete','skipped'
    )),
  constraint os_snapshot_pkg_integrity_key_check
    check (key_id is null
      or key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_pkg_integrity_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_pkg_integrity_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_pkg_integrity_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_pkg_integrity_pkg_idx
  on public.os_snapshot_package_integrity_checks(package_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Retention monitoring alerts (idempotent window_key, non-qualifying)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_retention_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  package_id uuid references public.os_snapshot_export_packages(package_id),
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_ret_ops_alert_kind_check
    check (alert_kind in (
      'cold_head_failed','cold_head_partial','hash_mismatch',
      'destination_missing','package_expired_unverified','canary_failed'
    )),
  constraint os_snapshot_ret_ops_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_ret_ops_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_ret_ops_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_ret_ops_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_ret_ops_alerts_kind_idx
  on public.os_snapshot_retention_ops_alerts(alert_kind,created_at desc);

-- ---------------------------------------------------------------------------
-- Multi-hour canary schedule enhancements (recurring cadence, non-qualifying)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase44_canary_schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  definition_id text,
  package_id uuid references public.os_snapshot_export_packages(package_id),
  cadence_hours integer not null,
  last_run_at timestamptz,
  status text not null default 'active',
  evidence jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_phase44_canary_def_check
    check (definition_id is null
      or definition_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_phase44_canary_cadence_check
    check (cadence_hours between 1 and 168),
  constraint os_snapshot_phase44_canary_status_check
    check (status in ('active','paused','completed','failed')),
  constraint os_snapshot_phase44_canary_target_check
    check (definition_id is not null or package_id is not null),
  constraint os_snapshot_phase44_canary_evidence_check
    check (jsonb_typeof(evidence)='object' and pg_column_size(evidence)<=4096),
  constraint os_snapshot_phase44_canary_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_phase44_canary_due_idx
  on public.os_snapshot_phase44_canary_schedules(status,last_run_at,created_at)
  where status='active';

create or replace function public.prevent_phase44_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_pkg_integrity_immutable
  on public.os_snapshot_package_integrity_checks;
create trigger os_snapshot_pkg_integrity_immutable
  before update or delete or truncate
  on public.os_snapshot_package_integrity_checks for each statement
  execute function public.prevent_phase44_snapshot_immutable_change();

drop trigger if exists os_snapshot_ret_ops_alerts_immutable
  on public.os_snapshot_retention_ops_alerts;
create trigger os_snapshot_ret_ops_alerts_immutable
  before update or delete or truncate
  on public.os_snapshot_retention_ops_alerts for each statement
  execute function public.prevent_phase44_snapshot_immutable_change();

-- Canary schedules: no delete/truncate; status/last_run updates via RPC only.
create or replace function public.prevent_phase44_canary_schedule_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_snapshot_phase44_canary_schedules deletes are forbidden'; end $$;
drop trigger if exists os_snapshot_phase44_canary_no_delete
  on public.os_snapshot_phase44_canary_schedules;
create trigger os_snapshot_phase44_canary_no_delete before delete
  on public.os_snapshot_phase44_canary_schedules for each row
  execute function public.prevent_phase44_canary_schedule_delete();
drop trigger if exists os_snapshot_phase44_canary_no_truncate
  on public.os_snapshot_phase44_canary_schedules;
create trigger os_snapshot_phase44_canary_no_truncate before truncate
  on public.os_snapshot_phase44_canary_schedules for each statement
  execute function public.prevent_phase44_canary_schedule_delete();

create or replace function public.verify_snapshot_export_package_integrity_phase44(
  p_actor_id uuid,
  p_package_id uuid,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.os_snapshot_export_packages%rowtype;
  v_status text;
  v_check_id uuid;
  v_hash text;
  v_digest text;
  v_detail jsonb;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or not public.phase44_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 44 package integrity authorization or input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in integrity evidence';
  end if;

  select * into v_package from public.os_snapshot_export_packages
    where package_id=p_package_id;
  if not found then
    raise exception 'Export package was not found';
  end if;

  if v_package.canonical_package_text is null
     or v_package.package_sha256 is null
     or v_package.package_signature is null
     or v_package.signature_key_id is null
     or v_package.destination_key is null
     or v_package.artifact_sha256 is null then
    v_status:='metadata_incomplete';
  else
    v_digest:=public.os_sha256_hex(v_package.canonical_package_text);
    if v_digest is distinct from v_package.package_sha256 then
      v_status:='digest_mismatch';
    elsif v_package.signature_algorithm is distinct from 'hmac-sha256'
       or v_package.package_signature !~ '^[0-9a-f]{64}$'
       or v_package.signature_key_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$' then
      v_status:='signature_invalid';
    else
      v_status:='verified';
    end if;
  end if;

  v_detail:=coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
    'check_status',v_status,
    'contract_version','phase44-v1',
    'destination_key',v_package.destination_key,
    'package_sha256',v_package.package_sha256,
    'retained_until',v_package.retained_until
  );
  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'check_status',v_status,
    'contract_version','phase44-v1',
    'key_id',v_package.signature_key_id,
    'package_id',p_package_id,
    'package_sha256',v_package.package_sha256
  )::text);

  insert into public.os_snapshot_package_integrity_checks(
    package_id,check_status,key_id,metrics_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_package_id,v_status,v_package.signature_key_id,v_hash,v_detail,
    false,false,false
  ) returning check_id into v_check_id;

  return jsonb_build_object(
    'ok',true,
    'check_id',v_check_id,
    'package_id',p_package_id,
    'check_status',v_status,
    'key_id',v_package.signature_key_id,
    'metrics_sha256',v_hash,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.record_snapshot_retention_ops_alert_phase44(
  p_alert_kind text,
  p_window_key text,
  p_package_id uuid default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_snapshot_retention_ops_alerts%rowtype;
  v_alert_id uuid;
  v_hash text;
begin
  if p_alert_kind not in (
       'cold_head_failed','cold_head_partial','hash_mismatch',
       'destination_missing','package_expired_unverified','canary_failed'
     )
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or not public.phase44_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 44 retention ops alert input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in retention alert evidence';
  end if;

  select * into v_existing from public.os_snapshot_retention_ops_alerts
    where window_key=p_window_key;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'alert_id',v_existing.alert_id,
      'alert_kind',v_existing.alert_kind,
      'qualification_eligible',false
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'alert_kind',p_alert_kind,
    'contract_version','phase44-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'package_id',p_package_id,
    'window_key',p_window_key
  )::text);

  insert into public.os_snapshot_retention_ops_alerts(
    alert_kind,window_key,package_id,metrics_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_alert_kind,p_window_key,p_package_id,v_hash,coalesce(p_detail,'{}'::jsonb),
    false,false,false
  ) returning alert_id into v_alert_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'alert_id',v_alert_id,
    'alert_kind',p_alert_kind,
    'window_key',p_window_key,
    'metrics_sha256',v_hash,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.list_snapshot_retention_ops_alerts_phase44(
  p_limit integer default 50
)
returns table (
  alert_id uuid,
  alert_kind text,
  window_key text,
  package_id uuid,
  metrics_sha256 text,
  created_at timestamptz,
  qualification_eligible boolean,
  attestation_eligible boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list retention ops alerts';
  end if;
  return query
  select
    a.alert_id,a.alert_kind,a.window_key,a.package_id,a.metrics_sha256,
    a.created_at,a.qualification_eligible,a.attestation_eligible
  from public.os_snapshot_retention_ops_alerts a
  order by a.created_at desc,a.alert_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.schedule_snapshot_phase44_canary_ops(
  p_actor_id uuid,
  p_cadence_hours integer,
  p_definition_id text default null,
  p_package_id uuid default null,
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_schedule_id uuid;
  v_evidence jsonb;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_cadence_hours,0) not between 1 and 168
     or (p_definition_id is null and p_package_id is null)
     or (p_definition_id is not null
         and p_definition_id !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$')
     or not public.phase44_snapshot_safe_detail(coalesce(p_evidence,'{}'::jsonb))
  then
    raise exception 'Phase 44 canary schedule authorization or input failed';
  end if;
  if p_package_id is not null and not exists (
    select 1 from public.os_snapshot_export_packages p
    where p.package_id=p_package_id
      and not p.qualification_eligible
      and not p.attestation_eligible
      and not p.production_relation_mutated
  ) then
    raise exception 'Canary schedule package was not found or is disallowed';
  end if;

  v_evidence:=coalesce(p_evidence,'{}'::jsonb)||jsonb_build_object(
    'cadence_hours',p_cadence_hours,
    'contract_version','phase44-v1',
    'recurring',true
  );

  insert into public.os_snapshot_phase44_canary_schedules(
    definition_id,package_id,cadence_hours,status,evidence,actor_id,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_definition_id,p_package_id,p_cadence_hours,'active',v_evidence,p_actor_id,
    false,false,false
  ) returning schedule_id into v_schedule_id;

  return jsonb_build_object(
    'ok',true,
    'schedule_id',v_schedule_id,
    'cadence_hours',p_cadence_hours,
    'definition_id',p_definition_id,
    'package_id',p_package_id,
    'status','active',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.list_due_phase44_canary_schedules(
  p_limit integer default 25
)
returns table (
  schedule_id uuid,
  definition_id text,
  package_id uuid,
  cadence_hours integer,
  last_run_at timestamptz,
  status text,
  due boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list due Phase 44 canary schedules';
  end if;
  return query
  select
    s.schedule_id,
    s.definition_id,
    s.package_id,
    s.cadence_hours,
    s.last_run_at,
    s.status,
    (
      s.last_run_at is null
      or s.last_run_at + make_interval(hours => s.cadence_hours) <= now()
    ) as due
  from public.os_snapshot_phase44_canary_schedules s
  where s.status='active'
    and not s.qualification_eligible
    and not s.attestation_eligible
    and not s.production_relation_mutated
    and (
      s.last_run_at is null
      or s.last_run_at + make_interval(hours => s.cadence_hours) <= now()
    )
  order by coalesce(s.last_run_at,s.created_at),s.schedule_id
  limit least(greatest(coalesce(p_limit,25),1),100);
end $$;

create or replace function public.mark_snapshot_phase44_canary_schedule_run(
  p_actor_id uuid,
  p_schedule_id uuid,
  p_run_status text default 'active',
  p_evidence jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_snapshot_phase44_canary_schedules%rowtype;
  v_evidence jsonb;
begin
  if (
       auth.role() is distinct from 'service_role'
       and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     )
     or p_run_status not in ('active','paused','completed','failed')
     or not public.phase44_snapshot_safe_detail(coalesce(p_evidence,'{}'::jsonb))
  then
    raise exception 'Phase 44 canary schedule run mark authorization or input failed';
  end if;

  select * into v_row from public.os_snapshot_phase44_canary_schedules
    where schedule_id=p_schedule_id for update;
  if not found then
    raise exception 'Phase 44 canary schedule was not found';
  end if;

  v_evidence:=coalesce(v_row.evidence,'{}'::jsonb)
    || coalesce(p_evidence,'{}'::jsonb)
    || jsonb_build_object(
      'contract_version','phase44-v1',
      'last_marked_at',now(),
      'qualification_eligible',false
    );

  update public.os_snapshot_phase44_canary_schedules
    set last_run_at=now(),
        status=p_run_status,
        evidence=v_evidence
    where schedule_id=p_schedule_id;

  return jsonb_build_object(
    'ok',true,
    'schedule_id',p_schedule_id,
    'status',p_run_status,
    'last_run_at',now(),
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.scan_snapshot_retention_ops_alerts_phase44(
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
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan snapshot retention ops alerts';
  end if;

  for v_row in
    select s.schedule_id,s.status,s.due_package_count,s.checked_package_count
    from public.os_snapshot_production_cold_head_schedules s
    where s.scheduled_at>=now()-interval '7 days'
      and s.status in ('failed','partial')
    order by s.scheduled_at desc
    limit 20
  loop
    if v_row.status='failed' then
      v_one:=public.record_snapshot_retention_ops_alert_phase44(
        'cold_head_failed',
        'phase44:cold_head_failed:'||v_row.schedule_id::text,
        null,
        jsonb_build_object(
          'checked_package_count',v_row.checked_package_count,
          'due_package_count',v_row.due_package_count,
          'schedule_id',v_row.schedule_id
        )
      );
    else
      v_one:=public.record_snapshot_retention_ops_alert_phase44(
        'cold_head_partial',
        'phase44:cold_head_partial:'||v_row.schedule_id::text,
        null,
        jsonb_build_object(
          'checked_package_count',v_row.checked_package_count,
          'due_package_count',v_row.due_package_count,
          'schedule_id',v_row.schedule_id
        )
      );
    end if;
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  for v_row in
    select c.package_id,c.check_id
    from public.os_snapshot_retention_checks c
    where c.checked_at>=now()-interval '7 days'
      and c.status='hash_mismatch'
    order by c.checked_at desc
    limit 20
  loop
    v_one:=public.record_snapshot_retention_ops_alert_phase44(
      'hash_mismatch',
      'phase44:hash_mismatch:'||v_row.check_id::text,
      v_row.package_id,
      jsonb_build_object('check_id',v_row.check_id)
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  for v_row in
    select p.package_id
    from public.os_snapshot_export_packages p
    where p.retained_until<=now()
      and not exists (
        select 1 from public.os_snapshot_package_integrity_checks i
        where i.package_id=p.package_id and i.check_status='verified'
      )
    order by p.retained_until
    limit 20
  loop
    v_one:=public.record_snapshot_retention_ops_alert_phase44(
      'package_expired_unverified',
      'phase44:pkg_expired_unverified:'||v_row.package_id::text||':'||v_day,
      v_row.package_id,
      jsonb_build_object('source','scan_snapshot_retention_ops_alerts_phase44')
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  for v_row in
    select o.orchestration_id,o.package_id
    from public.os_snapshot_phase40_orchestrations o
    where o.completed_at>=now()-interval '7 days'
      and o.status='failed'
    order by o.completed_at desc
    limit 20
  loop
    v_one:=public.record_snapshot_retention_ops_alert_phase44(
      'canary_failed',
      'phase44:canary_failed:'||v_row.orchestration_id::text,
      v_row.package_id,
      jsonb_build_object('orchestration_id',v_row.orchestration_id)
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  -- Advisory: cold packages exist but no successful production cold HEAD in 30d.
  if exists (
       select 1 from public.os_snapshot_export_packages p
       where p.retention_tier='cold'
         and not p.qualification_eligible
     )
     and not exists (
       select 1 from public.os_snapshot_production_cold_head_schedules s
       where s.scheduled_at>=now()-interval '30 days'
         and s.status in ('completed','partial')
     ) then
    v_one:=public.record_snapshot_retention_ops_alert_phase44(
      'destination_missing',
      'phase44:destination_missing:'||v_day,
      null,
      jsonb_build_object('source','scan_snapshot_retention_ops_alerts_phase44')
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'alerts_recorded',v_recorded,
    'qualification_eligible',false,
    'contract_version','phase44-v1'
  );
end $$;

create or replace view public.os_snapshot_phase44_ops_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_package_integrity_checks
    where created_at>=now()-interval '30 days') as integrity_checks_30d,
  (select count(*) from public.os_snapshot_package_integrity_checks
    where created_at>=now()-interval '30 days'
      and check_status='verified') as integrity_verified_30d,
  (select count(*) from public.os_snapshot_retention_ops_alerts
    where created_at>=now()-interval '30 days') as retention_alerts_30d,
  (select count(*) from public.os_snapshot_phase44_canary_schedules
    where status='active') as active_canary_schedules,
  (select count(*) from public.os_snapshot_phase44_canary_schedules
    where last_run_at>=now()-interval '30 days') as canary_schedule_runs_30d,
  false as qualification_eligible,
  false as attestation_eligible,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase44_ops_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'integrity_checks_30d',s.integrity_checks_30d,
    'integrity_verified_30d',s.integrity_verified_30d,
    'retention_alerts_30d',s.retention_alerts_30d,
    'active_canary_schedules',s.active_canary_schedules,
    'canary_schedule_runs_30d',s.canary_schedule_runs_30d,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase44-v1'
  )
  from public.os_snapshot_phase44_ops_slo s;
$$;

alter table public.os_snapshot_package_integrity_checks enable row level security;
alter table public.os_snapshot_retention_ops_alerts enable row level security;
alter table public.os_snapshot_phase44_canary_schedules enable row level security;

drop policy if exists "os_snapshot_pkg_integrity_select"
  on public.os_snapshot_package_integrity_checks;
create policy "os_snapshot_pkg_integrity_select"
  on public.os_snapshot_package_integrity_checks for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_ret_ops_alerts_select"
  on public.os_snapshot_retention_ops_alerts;
create policy "os_snapshot_ret_ops_alerts_select"
  on public.os_snapshot_retention_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase44_canary_select"
  on public.os_snapshot_phase44_canary_schedules;
create policy "os_snapshot_phase44_canary_select"
  on public.os_snapshot_phase44_canary_schedules for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_package_integrity_checks,
  public.os_snapshot_retention_ops_alerts,
  public.os_snapshot_phase44_canary_schedules,
  public.os_snapshot_phase44_ops_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_package_integrity_checks,
  public.os_snapshot_retention_ops_alerts,
  public.os_snapshot_phase44_canary_schedules
  from public,authenticated,service_role;

-- Packages remain non-qualifying; DML stays RPC-only.
revoke insert,update,delete,truncate on public.os_snapshot_export_packages
  from public,authenticated,service_role;

revoke all on function public.prevent_phase44_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.prevent_phase44_canary_schedule_delete()
  from public,authenticated,service_role;
revoke all on function public.verify_snapshot_export_package_integrity_phase44(
  uuid,uuid,jsonb
) from public,authenticated;
revoke all on function public.record_snapshot_retention_ops_alert_phase44(
  text,text,uuid,jsonb
) from public,authenticated;
revoke all on function public.schedule_snapshot_phase44_canary_ops(
  uuid,integer,text,uuid,jsonb
) from public,authenticated;
revoke all on function public.mark_snapshot_phase44_canary_schedule_run(
  uuid,uuid,text,jsonb
) from public,authenticated;
revoke all on function public.scan_snapshot_retention_ops_alerts_phase44(uuid)
  from public,authenticated;
revoke all on function public.list_snapshot_retention_ops_alerts_phase44(integer)
  from public,anon;
revoke all on function public.list_due_phase44_canary_schedules(integer)
  from public,anon;
revoke all on function public.get_snapshot_phase44_ops_report()
  from public,anon;

grant execute on function public.phase44_snapshot_safe_detail(jsonb),
  public.list_snapshot_retention_ops_alerts_phase44(integer),
  public.list_due_phase44_canary_schedules(integer),
  public.get_snapshot_phase44_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.verify_snapshot_export_package_integrity_phase44(
  uuid,uuid,jsonb
),
  public.record_snapshot_retention_ops_alert_phase44(text,text,uuid,jsonb),
  public.schedule_snapshot_phase44_canary_ops(uuid,integer,text,uuid,jsonb),
  public.mark_snapshot_phase44_canary_schedule_run(uuid,uuid,text,jsonb),
  public.scan_snapshot_retention_ops_alerts_phase44(uuid)
  to service_role;
