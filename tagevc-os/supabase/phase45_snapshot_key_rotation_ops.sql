-- Phase 45: dual-key ed25519 rotation, consecutive failure paging evidence,
-- and Stage 4e non-qualifying ops report. Apply after
-- phase44_snapshot_retention_ops.sql.
-- Public-key metadata only — never store private keys.
-- Stage 4e: qualification_eligible / attestation_eligible /
-- production_relation_mutated remain false always.

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

create or replace function public.phase45_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Dual-key ed25519 rotation ledger (public metadata only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_ed25519_key_rotations (
  rotation_id uuid primary key default gen_random_uuid(),
  previous_key_id text not null,
  next_key_id text not null,
  previous_public_key_spki_sha256 text not null,
  previous_public_key_spki_b64 text not null,
  next_public_key_spki_sha256 text not null,
  next_public_key_spki_b64 text not null,
  cutover_started_at timestamptz not null default now(),
  cutover_completed_at timestamptz,
  status text not null default 'announced',
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_ed25519_rot_prev_key_check
    check (previous_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_ed25519_rot_next_key_check
    check (next_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_ed25519_rot_distinct_keys_check
    check (previous_key_id<>next_key_id),
  constraint os_snapshot_ed25519_rot_prev_hash_check
    check (previous_public_key_spki_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_ed25519_rot_next_hash_check
    check (next_public_key_spki_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_ed25519_rot_prev_b64_check
    check (length(previous_public_key_spki_b64) between 44 and 512
      and previous_public_key_spki_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint os_snapshot_ed25519_rot_next_b64_check
    check (length(next_public_key_spki_b64) between 44 and 512
      and next_public_key_spki_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint os_snapshot_ed25519_rot_status_check
    check (status in ('announced','dual_active','cutover_complete','aborted')),
  constraint os_snapshot_ed25519_rot_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_ed25519_rot_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_ed25519_rot_complete_ts_check
    check (
      (status='cutover_complete' and cutover_completed_at is not null)
      or (status<>'cutover_complete' and cutover_completed_at is null)
      or status='aborted'
    )
);

create index if not exists os_snapshot_ed25519_rot_status_idx
  on public.os_snapshot_ed25519_key_rotations(status,created_at desc);
create unique index if not exists os_snapshot_ed25519_rot_open_unique
  on public.os_snapshot_ed25519_key_rotations(previous_key_id,next_key_id)
  where status in ('announced','dual_active');

-- ---------------------------------------------------------------------------
-- Consecutive failure counters (mutable via RPC only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_consecutive_failure_counters (
  counter_kind text primary key,
  consecutive_count integer not null default 0,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  last_window_key text,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint os_snapshot_consec_fail_kind_check
    check (counter_kind in (
      'cold_head_failures','integrity_failures'
    )),
  constraint os_snapshot_consec_fail_count_check
    check (consecutive_count>=0 and consecutive_count<=10000),
  constraint os_snapshot_consec_fail_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_consec_fail_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

insert into public.os_snapshot_consecutive_failure_counters(
  counter_kind,consecutive_count,detail,
  qualification_eligible,attestation_eligible,production_relation_mutated
) values
  ('cold_head_failures',0,'{}'::jsonb,false,false,false),
  ('integrity_failures',0,'{}'::jsonb,false,false,false)
on conflict (counter_kind) do nothing;

-- ---------------------------------------------------------------------------
-- Phase 45 ops alerts (idempotent window_key, non-qualifying)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_phase45_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  consecutive_count integer not null default 0,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_phase45_alert_kind_check
    check (alert_kind in (
      'consecutive_cold_head_failures','consecutive_integrity_failures'
    )),
  constraint os_snapshot_phase45_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_phase45_alert_count_check
    check (consecutive_count>=0),
  constraint os_snapshot_phase45_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_phase45_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_phase45_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_phase45_ops_alerts_kind_idx
  on public.os_snapshot_phase45_ops_alerts(alert_kind,created_at desc);

create or replace function public.prevent_phase45_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_phase45_ops_alerts_immutable
  on public.os_snapshot_phase45_ops_alerts;
create trigger os_snapshot_phase45_ops_alerts_immutable
  before update or delete or truncate
  on public.os_snapshot_phase45_ops_alerts for each statement
  execute function public.prevent_phase45_snapshot_immutable_change();

-- Rotations: no delete/truncate; status transitions via RPC only.
create or replace function public.prevent_phase45_rotation_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_snapshot_ed25519_key_rotations deletes are forbidden'; end $$;
drop trigger if exists os_snapshot_ed25519_rot_no_delete
  on public.os_snapshot_ed25519_key_rotations;
create trigger os_snapshot_ed25519_rot_no_delete before delete
  on public.os_snapshot_ed25519_key_rotations for each row
  execute function public.prevent_phase45_rotation_delete();
drop trigger if exists os_snapshot_ed25519_rot_no_truncate
  on public.os_snapshot_ed25519_key_rotations;
create trigger os_snapshot_ed25519_rot_no_truncate before truncate
  on public.os_snapshot_ed25519_key_rotations for each statement
  execute function public.prevent_phase45_rotation_delete();

create or replace function public.prevent_phase45_counter_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_snapshot_consecutive_failure_counters deletes are forbidden'; end $$;
drop trigger if exists os_snapshot_consec_fail_no_delete
  on public.os_snapshot_consecutive_failure_counters;
create trigger os_snapshot_consec_fail_no_delete before delete
  on public.os_snapshot_consecutive_failure_counters for each row
  execute function public.prevent_phase45_counter_delete();
drop trigger if exists os_snapshot_consec_fail_no_truncate
  on public.os_snapshot_consecutive_failure_counters;
create trigger os_snapshot_consec_fail_no_truncate before truncate
  on public.os_snapshot_consecutive_failure_counters for each statement
  execute function public.prevent_phase45_counter_delete();

create or replace function public.announce_snapshot_ed25519_rotation_phase45(
  p_actor_id uuid,
  p_previous_key_id text,
  p_next_key_id text,
  p_previous_public_key_spki_sha256 text,
  p_previous_public_key_spki_b64 text,
  p_next_public_key_spki_sha256 text,
  p_next_public_key_spki_b64 text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotation_id uuid;
  v_existing public.os_snapshot_ed25519_key_rotations%rowtype;
  v_detail jsonb;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_previous_key_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or coalesce(p_next_key_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or p_previous_key_id=p_next_key_id
     or coalesce(p_previous_public_key_spki_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_next_public_key_spki_sha256,'') !~ '^[0-9a-f]{64}$'
     or length(coalesce(p_previous_public_key_spki_b64,'')) not between 44 and 512
     or length(coalesce(p_next_public_key_spki_b64,'')) not between 44 and 512
     or coalesce(p_previous_public_key_spki_b64,'') !~ '^[A-Za-z0-9+/]+={0,2}$'
     or coalesce(p_next_public_key_spki_b64,'') !~ '^[A-Za-z0-9+/]+={0,2}$'
     or not public.phase45_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 45 ed25519 rotation announce authorization or input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key'
     or p_previous_public_key_spki_b64 ~* 'private'
     or p_next_public_key_spki_b64 ~* 'private' then
    raise exception 'Private key material is not allowed in rotation evidence';
  end if;

  select * into v_existing from public.os_snapshot_ed25519_key_rotations
    where previous_key_id=p_previous_key_id
      and next_key_id=p_next_key_id
      and status in ('announced','dual_active')
    limit 1;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'rotation_id',v_existing.rotation_id,
      'status',v_existing.status,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false
    );
  end if;

  if exists (
    select 1 from public.os_snapshot_ed25519_key_rotations r
    where r.status in ('announced','dual_active')
  ) then
    raise exception 'An open ed25519 rotation already exists';
  end if;

  v_detail:=coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
    'contract_version','phase45-v1',
    'status','announced'
  );

  insert into public.os_snapshot_ed25519_key_rotations(
    previous_key_id,next_key_id,
    previous_public_key_spki_sha256,previous_public_key_spki_b64,
    next_public_key_spki_sha256,next_public_key_spki_b64,
    status,detail,actor_id,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_previous_key_id,p_next_key_id,
    p_previous_public_key_spki_sha256,p_previous_public_key_spki_b64,
    p_next_public_key_spki_sha256,p_next_public_key_spki_b64,
    'announced',v_detail,p_actor_id,
    false,false,false
  ) returning rotation_id into v_rotation_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'rotation_id',v_rotation_id,
    'previous_key_id',p_previous_key_id,
    'next_key_id',p_next_key_id,
    'status','announced',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.activate_snapshot_dual_key_phase45(
  p_actor_id uuid,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_snapshot_ed25519_key_rotations%rowtype;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 45 dual-key activation authorization failed';
  end if;

  select * into v_row from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id for update;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;
  if v_row.status='dual_active' then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'rotation_id',v_row.rotation_id,
      'status',v_row.status,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false
    );
  end if;
  if v_row.status<>'announced' then
    raise exception 'Only announced rotations can enter dual_active';
  end if;

  update public.os_snapshot_ed25519_key_rotations
    set status='dual_active',
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'activated_at',now(),
          'activated_by',p_actor_id,
          'contract_version','phase45-v1'
        )
    where rotation_id=p_rotation_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'rotation_id',p_rotation_id,
    'status','dual_active',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.complete_snapshot_ed25519_cutover_phase45(
  p_actor_id uuid,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_snapshot_ed25519_key_rotations%rowtype;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 45 ed25519 cutover authorization failed';
  end if;

  select * into v_row from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id for update;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;
  if v_row.status='cutover_complete' then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'rotation_id',v_row.rotation_id,
      'status',v_row.status,
      'cutover_completed_at',v_row.cutover_completed_at,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false
    );
  end if;
  if v_row.status<>'dual_active' then
    raise exception 'Only dual_active rotations can complete cutover';
  end if;

  update public.os_snapshot_ed25519_key_rotations
    set status='cutover_complete',
        cutover_completed_at=now(),
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'completed_by',p_actor_id,
          'contract_version','phase45-v1'
        )
    where rotation_id=p_rotation_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'rotation_id',p_rotation_id,
    'status','cutover_complete',
    'cutover_completed_at',now(),
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.record_snapshot_phase45_ops_alert(
  p_alert_kind text,
  p_window_key text,
  p_consecutive_count integer default 0,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_snapshot_phase45_ops_alerts%rowtype;
  v_alert_id uuid;
  v_hash text;
begin
  if p_alert_kind not in (
       'consecutive_cold_head_failures','consecutive_integrity_failures'
     )
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or coalesce(p_consecutive_count,0)<0
     or not public.phase45_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 45 snapshot ops alert input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in Phase 45 alert evidence';
  end if;

  select * into v_existing from public.os_snapshot_phase45_ops_alerts
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
    'consecutive_count',coalesce(p_consecutive_count,0),
    'contract_version','phase45-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'window_key',p_window_key
  )::text);

  insert into public.os_snapshot_phase45_ops_alerts(
    alert_kind,window_key,consecutive_count,metrics_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_alert_kind,p_window_key,coalesce(p_consecutive_count,0),v_hash,
    coalesce(p_detail,'{}'::jsonb),
    false,false,false
  ) returning alert_id into v_alert_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'alert_id',v_alert_id,
    'alert_kind',p_alert_kind,
    'window_key',p_window_key,
    'consecutive_count',coalesce(p_consecutive_count,0),
    'metrics_sha256',v_hash,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.bump_snapshot_consecutive_failure_phase45(
  p_counter_kind text,
  p_is_failure boolean,
  p_window_key text default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.os_snapshot_consecutive_failure_counters%rowtype;
  v_next integer;
begin
  if p_counter_kind not in ('cold_head_failures','integrity_failures')
     or not public.phase45_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 45 consecutive failure bump input failed';
  end if;

  select * into v_row from public.os_snapshot_consecutive_failure_counters
    where counter_kind=p_counter_kind for update;
  if not found then
    raise exception 'Consecutive failure counter was not found';
  end if;

  if coalesce(p_is_failure,false) then
    v_next:=least(v_row.consecutive_count+1,10000);
    update public.os_snapshot_consecutive_failure_counters
      set consecutive_count=v_next,
          last_failure_at=now(),
          last_window_key=coalesce(p_window_key,last_window_key),
          detail=coalesce(detail,'{}'::jsonb)||coalesce(p_detail,'{}'::jsonb)
            ||jsonb_build_object('contract_version','phase45-v1'),
          updated_at=now()
      where counter_kind=p_counter_kind;
  else
    v_next:=0;
    update public.os_snapshot_consecutive_failure_counters
      set consecutive_count=0,
          last_success_at=now(),
          detail=coalesce(detail,'{}'::jsonb)||coalesce(p_detail,'{}'::jsonb)
            ||jsonb_build_object('contract_version','phase45-v1','reset',true),
          updated_at=now()
      where counter_kind=p_counter_kind;
  end if;

  return jsonb_build_object(
    'ok',true,
    'counter_kind',p_counter_kind,
    'consecutive_count',v_next,
    'is_failure',coalesce(p_is_failure,false),
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.scan_snapshot_consecutive_failures_phase45(
  p_actor_id uuid default null,
  p_threshold integer default 3
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_threshold integer:=greatest(coalesce(p_threshold,3),1);
  v_recorded integer:=0;
  v_one jsonb;
  v_bump jsonb;
  v_day text:=to_char(now() at time zone 'utc','YYYY-MM-DD');
  v_cold_fail boolean:=false;
  v_integ_fail boolean:=false;
  v_cold_count integer:=0;
  v_integ_count integer:=0;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan consecutive snapshot failures';
  end if;
  if coalesce(p_threshold,3) not between 1 and 100 then
    raise exception 'Consecutive failure threshold must be between 1 and 100';
  end if;

  -- Prefer Phase 44 retention alerts; fall back to integrity checks.
  if exists (
    select 1 from public.os_snapshot_retention_ops_alerts a
    where a.created_at>=now()-interval '36 hours'
      and a.alert_kind in ('cold_head_failed','cold_head_partial')
  ) then
    v_cold_fail:=true;
  end if;

  if exists (
    select 1 from public.os_snapshot_package_integrity_checks i
    where i.created_at>=now()-interval '36 hours'
      and i.check_status in ('digest_mismatch','signature_invalid')
  ) or exists (
    select 1 from public.os_snapshot_retention_ops_alerts a
    where a.created_at>=now()-interval '36 hours'
      and a.alert_kind='hash_mismatch'
  ) then
    v_integ_fail:=true;
  end if;

  v_bump:=public.bump_snapshot_consecutive_failure_phase45(
    'cold_head_failures',v_cold_fail,
    case when v_cold_fail then 'phase45:cold:'||v_day else null end,
    jsonb_build_object('source','scan_snapshot_consecutive_failures_phase45')
  );
  v_cold_count:=coalesce((v_bump->>'consecutive_count')::integer,0);

  v_bump:=public.bump_snapshot_consecutive_failure_phase45(
    'integrity_failures',v_integ_fail,
    case when v_integ_fail then 'phase45:integrity:'||v_day else null end,
    jsonb_build_object('source','scan_snapshot_consecutive_failures_phase45')
  );
  v_integ_count:=coalesce((v_bump->>'consecutive_count')::integer,0);

  if v_cold_count>=v_threshold then
    v_one:=public.record_snapshot_phase45_ops_alert(
      'consecutive_cold_head_failures',
      'phase45:consecutive_cold_head:'||v_day||':'||v_cold_count::text,
      v_cold_count,
      jsonb_build_object('threshold',v_threshold)
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  if v_integ_count>=v_threshold then
    v_one:=public.record_snapshot_phase45_ops_alert(
      'consecutive_integrity_failures',
      'phase45:consecutive_integrity:'||v_day||':'||v_integ_count::text,
      v_integ_count,
      jsonb_build_object('threshold',v_threshold)
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'alerts_recorded',v_recorded,
    'cold_head_consecutive',v_cold_count,
    'integrity_consecutive',v_integ_count,
    'threshold',v_threshold,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase45-v1'
  );
end $$;

create or replace function public.list_snapshot_phase45_ops_alerts(p_limit integer default 50)
returns table (
  alert_id uuid,
  alert_kind text,
  window_key text,
  consecutive_count integer,
  metrics_sha256 text,
  created_at timestamptz,
  qualification_eligible boolean,
  attestation_eligible boolean,
  production_relation_mutated boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list Phase 45 snapshot ops alerts';
  end if;
  return query
  select
    a.alert_id,a.alert_kind,a.window_key,a.consecutive_count,a.metrics_sha256,
    a.created_at,a.qualification_eligible,a.attestation_eligible,
    a.production_relation_mutated
  from public.os_snapshot_phase45_ops_alerts a
  order by a.created_at desc,a.alert_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace view public.os_snapshot_phase45_ops_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where created_at>=now()-interval '365 days') as rotations_365d,
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where status in ('announced','dual_active')) as open_rotations,
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where status='dual_active') as dual_active_rotations,
  (select consecutive_count from public.os_snapshot_consecutive_failure_counters
    where counter_kind='cold_head_failures') as cold_head_consecutive,
  (select consecutive_count from public.os_snapshot_consecutive_failure_counters
    where counter_kind='integrity_failures') as integrity_consecutive,
  (select count(*) from public.os_snapshot_phase45_ops_alerts
    where created_at>=now()-interval '30 days') as ops_alerts_30d,
  false as qualification_eligible,
  false as attestation_eligible,
  false as production_relation_mutated,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase45_ops_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'rotations_365d',s.rotations_365d,
    'open_rotations',s.open_rotations,
    'dual_active_rotations',s.dual_active_rotations,
    'cold_head_consecutive',s.cold_head_consecutive,
    'integrity_consecutive',s.integrity_consecutive,
    'ops_alerts_30d',s.ops_alerts_30d,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase45-v1'
  )
  from public.os_snapshot_phase45_ops_slo s;
$$;

alter table public.os_snapshot_ed25519_key_rotations enable row level security;
alter table public.os_snapshot_consecutive_failure_counters enable row level security;
alter table public.os_snapshot_phase45_ops_alerts enable row level security;

drop policy if exists "os_snapshot_ed25519_rot_select"
  on public.os_snapshot_ed25519_key_rotations;
create policy "os_snapshot_ed25519_rot_select"
  on public.os_snapshot_ed25519_key_rotations for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_consec_fail_select"
  on public.os_snapshot_consecutive_failure_counters;
create policy "os_snapshot_consec_fail_select"
  on public.os_snapshot_consecutive_failure_counters for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase45_ops_alerts_select"
  on public.os_snapshot_phase45_ops_alerts;
create policy "os_snapshot_phase45_ops_alerts_select"
  on public.os_snapshot_phase45_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_ed25519_key_rotations,
  public.os_snapshot_consecutive_failure_counters,
  public.os_snapshot_phase45_ops_alerts,
  public.os_snapshot_phase45_ops_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_ed25519_key_rotations,
  public.os_snapshot_consecutive_failure_counters,
  public.os_snapshot_phase45_ops_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_phase45_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.prevent_phase45_rotation_delete()
  from public,authenticated,service_role;
revoke all on function public.prevent_phase45_counter_delete()
  from public,authenticated,service_role;
revoke all on function public.announce_snapshot_ed25519_rotation_phase45(
  uuid,text,text,text,text,text,text,jsonb
) from public,authenticated;
revoke all on function public.activate_snapshot_dual_key_phase45(uuid,uuid)
  from public,authenticated;
revoke all on function public.complete_snapshot_ed25519_cutover_phase45(uuid,uuid)
  from public,authenticated;
revoke all on function public.record_snapshot_phase45_ops_alert(
  text,text,integer,jsonb
) from public,authenticated;
revoke all on function public.bump_snapshot_consecutive_failure_phase45(
  text,boolean,text,jsonb
) from public,authenticated;
revoke all on function public.scan_snapshot_consecutive_failures_phase45(
  uuid,integer
) from public,authenticated;
revoke all on function public.list_snapshot_phase45_ops_alerts(integer)
  from public,anon;
revoke all on function public.get_snapshot_phase45_ops_report()
  from public,anon;

grant execute on function public.phase45_snapshot_safe_detail(jsonb),
  public.list_snapshot_phase45_ops_alerts(integer),
  public.get_snapshot_phase45_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.announce_snapshot_ed25519_rotation_phase45(
  uuid,text,text,text,text,text,text,jsonb
),
  public.activate_snapshot_dual_key_phase45(uuid,uuid),
  public.complete_snapshot_ed25519_cutover_phase45(uuid,uuid),
  public.record_snapshot_phase45_ops_alert(text,text,integer,jsonb),
  public.bump_snapshot_consecutive_failure_phase45(text,boolean,text,jsonb),
  public.scan_snapshot_consecutive_failures_phase45(uuid,integer)
  to service_role;
