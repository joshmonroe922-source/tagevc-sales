-- Phase 48: CI-integrated offline_script dual acceptance + on-call ack SLO
-- dashboards tied to paging rotations.
-- Apply after phase47_snapshot_cutover_ops.sql.
-- Bootstraps Phase 46/47 rotation/acceptance/on-call/ack tables if missing
-- so this migration is re-runnable when prior snapshot SQL was skipped.
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

create or replace function public.phase48_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap prior rotation / acceptance / on-call / ack tables
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

create table if not exists public.os_snapshot_ed25519_cutover_acceptances (
  acceptance_id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null
    references public.os_snapshot_ed25519_key_rotations(rotation_id),
  verifier_kind text not null,
  acceptance_sha256 text not null,
  previous_key_id text not null,
  next_key_id text not null,
  dual_acceptance_complete boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_cutover_acc_verifier_check
    check (verifier_kind in ('offline_script','admin','worker')),
  constraint os_snapshot_cutover_acc_hash_check
    check (acceptance_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_cutover_acc_prev_key_check
    check (previous_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_cutover_acc_next_key_check
    check (next_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_cutover_acc_distinct_keys_check
    check (previous_key_id<>next_key_id),
  constraint os_snapshot_cutover_acc_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_cutover_acc_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_cutover_acc_rotation_verifier_unique
    unique (rotation_id, verifier_kind)
);

create index if not exists os_snapshot_cutover_acc_rotation_idx
  on public.os_snapshot_ed25519_cutover_acceptances(rotation_id,created_at desc);

create table if not exists public.os_snapshot_oncall_page_routes (
  route_id uuid primary key default gen_random_uuid(),
  destination_key text not null unique,
  route_status text not null default 'active',
  last_paged_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_snapshot_oncall_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_snapshot_oncall_status_check
    check (route_status in ('active','paused','disabled')),
  constraint os_snapshot_oncall_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_oncall_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

insert into public.os_snapshot_oncall_page_routes(
  destination_key,route_status,detail,
  qualification_eligible,attestation_eligible,production_relation_mutated
) values
  ('ops_alerts','active',jsonb_build_object('contract_version','phase48-v1'),false,false,false),
  ('oncall','active',jsonb_build_object('contract_version','phase48-v1'),false,false,false)
on conflict (destination_key) do nothing;

create table if not exists public.os_snapshot_oncall_page_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  route_id uuid not null
    references public.os_snapshot_oncall_page_routes(route_id),
  window_key text not null,
  delivery_status text not null,
  response_code integer,
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_oncall_del_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_oncall_del_status_check
    check (delivery_status in (
      'delivered','failed','skipped_no_webhook','skipped_paused'
    )),
  constraint os_snapshot_oncall_del_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_oncall_del_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_oncall_del_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_oncall_del_window_unique
    unique (window_key)
);

create table if not exists public.os_snapshot_oncall_ack_slo_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null
    references public.os_snapshot_oncall_page_deliveries(delivery_id),
  window_key text not null unique,
  ack_within_minutes integer not null,
  overdue boolean not null default false,
  severity text not null default 'warning',
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.profiles(id),
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_oncall_ack_minutes_check
    check (ack_within_minutes between 1 and 10080),
  constraint os_snapshot_oncall_ack_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_oncall_ack_severity_check
    check (severity in ('info','warning','critical')),
  constraint os_snapshot_oncall_ack_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_oncall_ack_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_oncall_ack_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_oncall_ack_delivery_unique
    unique (delivery_id)
);

create table if not exists public.os_snapshot_oncall_ack_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  consecutive_ack_overdue integer not null default 0,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_oncall_ack_alert_kind_check
    check (alert_kind in ('consecutive_ack_overdue')),
  constraint os_snapshot_oncall_ack_alert_consec_check
    check (consecutive_ack_overdue>=0 and consecutive_ack_overdue<=10000),
  constraint os_snapshot_oncall_ack_alert_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_oncall_ack_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_snapshot_oncall_ack_alert_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_oncall_ack_alert_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_oncall_ack_alert_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

-- Ensure phase47 offline_script dual-acceptance helper exists for wrap path.
create or replace function public.snapshot_cutover_offline_script_dual_acceptance_phase47(
  p_rotation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      bool_or(a.verifier_kind='offline_script')
      and count(distinct a.verifier_kind)>=2
    from public.os_snapshot_ed25519_cutover_acceptances a
    where a.rotation_id=p_rotation_id
  ),false);
$$;

create or replace function public.complete_snapshot_ed25519_cutover_phase47(
  p_actor_id uuid,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
  v_ready boolean;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 47 ed25519 cutover authorization failed';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;

  if v_rot.status='cutover_complete' then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'rotation_id',v_rot.rotation_id,
      'status',v_rot.status,
      'cutover_completed_at',v_rot.cutover_completed_at,
      'dual_acceptance_complete',true,
      'offline_script_required',true,
      'offline_script_accepted',true,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false,
      'contract_version','phase47-v1'
    );
  end if;

  v_ready:=public.snapshot_cutover_offline_script_dual_acceptance_phase47(
    p_rotation_id
  );
  if not v_ready then
    raise exception
      'Dual-acceptance including verifier_kind=offline_script (+ one other) is required before cutover';
  end if;

  update public.os_snapshot_ed25519_key_rotations
    set status='cutover_complete',
        cutover_completed_at=now(),
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'completed_by',p_actor_id,
          'contract_version','phase47-v1'
        )
    where rotation_id=p_rotation_id
      and status='dual_active';

  if not found then
    raise exception 'Only dual_active rotations can complete cutover';
  end if;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'rotation_id',p_rotation_id,
    'status','cutover_complete',
    'cutover_completed_at',now(),
    'dual_acceptance_complete',true,
    'offline_script_required',true,
    'offline_script_accepted',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase47-v1'
  );
end $$;

-- ---------------------------------------------------------------------------
-- CI cutover acceptance evidence (offline_script source=ci)
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_ci_cutover_acceptances (
  ci_acceptance_id uuid primary key default gen_random_uuid(),
  rotation_id uuid not null
    references public.os_snapshot_ed25519_key_rotations(rotation_id),
  acceptance_id uuid
    references public.os_snapshot_ed25519_cutover_acceptances(acceptance_id),
  ci_run_key text not null,
  acceptance_sha256 text not null,
  window_key text not null unique,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_ci_acc_run_check
    check (ci_run_key ~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'),
  constraint os_snapshot_ci_acc_hash_check
    check (acceptance_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_ci_acc_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_ci_acc_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_ci_acc_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_ci_acc_rotation_unique
    unique (rotation_id)
);

create index if not exists os_snapshot_ci_acc_created_idx
  on public.os_snapshot_ci_cutover_acceptances(created_at desc);

-- ---------------------------------------------------------------------------
-- On-call ack SLO dashboards tied to paging rotation destination_keys
-- ---------------------------------------------------------------------------
create table if not exists public.os_snapshot_oncall_ack_slo_dashboards (
  dashboard_id uuid primary key default gen_random_uuid(),
  destination_key text not null,
  window_key text not null unique,
  window_days integer not null default 30,
  delivered_count integer not null default 0,
  ack_count integer not null default 0,
  overdue_count integer not null default 0,
  pending_ack_count integer not null default 0,
  ack_within_slo_rate numeric(6,4),
  severity text not null default 'healthy',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_ack_dash_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_snapshot_ack_dash_days_check
    check (window_days between 1 and 90),
  constraint os_snapshot_ack_dash_counts_check
    check (
      delivered_count>=0 and ack_count>=0 and overdue_count>=0
      and pending_ack_count>=0
    ),
  constraint os_snapshot_ack_dash_rate_check
    check (
      ack_within_slo_rate is null
      or (ack_within_slo_rate>=0 and ack_within_slo_rate<=1)
    ),
  constraint os_snapshot_ack_dash_severity_check
    check (severity in ('healthy','warning','critical')),
  constraint os_snapshot_ack_dash_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_ack_dash_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_ack_dash_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_ack_dash_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_ack_dash_dest_idx
  on public.os_snapshot_oncall_ack_slo_dashboards(destination_key,created_at desc);

create or replace function public.prevent_phase48_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_ci_acc_immutable
  on public.os_snapshot_ci_cutover_acceptances;
create trigger os_snapshot_ci_acc_immutable
  before update or delete or truncate
  on public.os_snapshot_ci_cutover_acceptances for each statement
  execute function public.prevent_phase48_snapshot_immutable_change();

drop trigger if exists os_snapshot_ack_dash_immutable
  on public.os_snapshot_oncall_ack_slo_dashboards;
create trigger os_snapshot_ack_dash_immutable
  before update or delete or truncate
  on public.os_snapshot_oncall_ack_slo_dashboards for each statement
  execute function public.prevent_phase48_snapshot_immutable_change();

-- CI dual acceptance: offline_script with CI evidence + one other verifier.
create or replace function public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
  p_rotation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select
      bool_or(a.verifier_kind='offline_script')
      and count(distinct a.verifier_kind)>=2
      and exists (
        select 1 from public.os_snapshot_ci_cutover_acceptances c
        where c.rotation_id=p_rotation_id
      )
    from public.os_snapshot_ed25519_cutover_acceptances a
    where a.rotation_id=p_rotation_id
  ),false);
$$;

-- Record CI offline_script acceptance evidence (wraps phase46 acceptance RPC path).
create or replace function public.record_snapshot_ci_cutover_acceptance_phase48(
  p_actor_id uuid,
  p_rotation_id uuid,
  p_acceptance_sha256 text,
  p_ci_run_key text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
  v_acc public.os_snapshot_ed25519_cutover_acceptances%rowtype;
  v_existing public.os_snapshot_ci_cutover_acceptances%rowtype;
  v_acceptance_id uuid;
  v_ci_id uuid;
  v_window text;
  v_dual boolean:=false;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_acceptance_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_ci_run_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._/-]{2,199}$'
     or not public.phase48_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 48 CI cutover acceptance authorization or input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in CI cutover acceptance evidence';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id for update;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;
  if v_rot.status not in ('dual_active','cutover_complete') then
    raise exception 'CI cutover acceptance requires dual_active or cutover_complete rotation';
  end if;

  v_window:='phase48:ci_cutover:'||p_rotation_id::text;

  select * into v_existing from public.os_snapshot_ci_cutover_acceptances
    where rotation_id=p_rotation_id;
  if found then
    v_dual:=public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
      p_rotation_id
    );
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'ci_acceptance_id',v_existing.ci_acceptance_id,
      'rotation_id',v_existing.rotation_id,
      'ci_run_key',v_existing.ci_run_key,
      'ci_dual_acceptance_ready',v_dual,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false,
      'contract_version','phase48-v1'
    );
  end if;

  select * into v_acc from public.os_snapshot_ed25519_cutover_acceptances
    where rotation_id=p_rotation_id and verifier_kind='offline_script';
  if not found then
    insert into public.os_snapshot_ed25519_cutover_acceptances(
      rotation_id,verifier_kind,acceptance_sha256,
      previous_key_id,next_key_id,dual_acceptance_complete,detail,actor_id,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      p_rotation_id,'offline_script',p_acceptance_sha256,
      v_rot.previous_key_id,v_rot.next_key_id,
      (
        select count(distinct a.verifier_kind)+1>=2
        from public.os_snapshot_ed25519_cutover_acceptances a
        where a.rotation_id=p_rotation_id
          and a.verifier_kind is distinct from 'offline_script'
      ),
      coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
        'ci',true,
        'ci_run_key',p_ci_run_key,
        'contract_version','phase48-v1',
        'source','record_snapshot_ci_cutover_acceptance_phase48',
        'verifier_kind','offline_script'
      ),
      p_actor_id,false,false,false
    ) returning acceptance_id into v_acceptance_id;
  else
    v_acceptance_id:=v_acc.acceptance_id;
  end if;

  insert into public.os_snapshot_ci_cutover_acceptances(
    rotation_id,acceptance_id,ci_run_key,acceptance_sha256,window_key,detail,
    actor_id,qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_rotation_id,v_acceptance_id,p_ci_run_key,p_acceptance_sha256,v_window,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'ci',true,
      'contract_version','phase48-v1',
      'source','record_snapshot_ci_cutover_acceptance_phase48'
    ),
    p_actor_id,false,false,false
  ) returning ci_acceptance_id into v_ci_id;

  v_dual:=public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
    p_rotation_id
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'ci_acceptance_id',v_ci_id,
    'acceptance_id',v_acceptance_id,
    'rotation_id',p_rotation_id,
    'ci_run_key',p_ci_run_key,
    'ci_dual_acceptance_ready',v_dual,
    'offline_script_required',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase48-v1'
  );
end $$;

create or replace function public.complete_snapshot_ed25519_cutover_phase48(
  p_actor_id uuid,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
  v_ready boolean;
  v_complete jsonb;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 48 ed25519 cutover authorization failed';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;

  if v_rot.status='cutover_complete' then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'rotation_id',v_rot.rotation_id,
      'status',v_rot.status,
      'cutover_completed_at',v_rot.cutover_completed_at,
      'dual_acceptance_complete',true,
      'offline_script_required',true,
      'ci_dual_acceptance_required',true,
      'ci_dual_acceptance_ready',true,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false,
      'contract_version','phase48-v1'
    );
  end if;

  v_ready:=public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
    p_rotation_id
  );
  if not v_ready then
    raise exception
      'CI dual-acceptance (offline_script via CI + one other verifier) is required before cutover';
  end if;

  v_complete:=public.complete_snapshot_ed25519_cutover_phase47(
    p_actor_id, p_rotation_id
  );

  return coalesce(v_complete,'{}'::jsonb)||jsonb_build_object(
    'dual_acceptance_complete',true,
    'offline_script_required',true,
    'ci_dual_acceptance_required',true,
    'ci_dual_acceptance_ready',true,
    'contract_version','phase48-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

-- Materialize on-call ack SLO dashboards per paging rotation destination.
create or replace function public.scan_snapshot_oncall_ack_slo_dashboards_phase48(
  p_actor_id uuid default null,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer:=least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz:=now()-(v_days||' days')::interval;
  v_row record;
  v_recorded integer:=0;
  v_window text;
  v_hash text;
  v_rate numeric;
  v_severity text;
  v_attempted integer;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan on-call ack SLO dashboards';
  end if;

  for v_row in
    select
      r.destination_key,
      count(d.delivery_id) filter (where d.delivery_status='delivered')::integer
        as delivered_count,
      count(a.snapshot_id) filter (
        where a.acknowledged_at is not null and not a.overdue
      )::integer as ack_count,
      count(a.snapshot_id) filter (where a.overdue)::integer as overdue_count,
      count(a.snapshot_id) filter (
        where a.acknowledged_at is null
      )::integer as pending_ack_count
    from public.os_snapshot_oncall_page_routes r
    left join public.os_snapshot_oncall_page_deliveries d
      on d.route_id=r.route_id and d.created_at>=v_since
    left join public.os_snapshot_oncall_ack_slo_snapshots a
      on a.delivery_id=d.delivery_id
    where r.route_status='active'
    group by r.destination_key
    order by r.destination_key
    limit 50
  loop
    v_attempted:=v_row.ack_count+v_row.overdue_count;
    if v_attempted=0 then
      v_rate:=null;
      v_severity:='healthy';
    else
      v_rate:=round((v_row.ack_count::numeric / v_attempted::numeric),4);
      if v_rate<0.8000 then
        v_severity:='critical';
      elsif v_rate<0.9500 then
        v_severity:='warning';
      else
        v_severity:='healthy';
      end if;
    end if;

    v_window:='phase48:ack_dash:'||v_row.destination_key||':'||
      to_char(now() at time zone 'utc','YYYY-MM-DD')||':'||v_days::text;

    if exists (
      select 1 from public.os_snapshot_oncall_ack_slo_dashboards d
      where d.window_key=v_window
    ) then
      continue;
    end if;

    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'ack_count',v_row.ack_count,
      'ack_within_slo_rate',v_rate,
      'contract_version','phase48-v1',
      'delivered_count',v_row.delivered_count,
      'destination_key',v_row.destination_key,
      'overdue_count',v_row.overdue_count,
      'pending_ack_count',v_row.pending_ack_count,
      'severity',v_severity,
      'window_days',v_days,
      'window_key',v_window
    )::text);

    insert into public.os_snapshot_oncall_ack_slo_dashboards(
      destination_key,window_key,window_days,delivered_count,ack_count,
      overdue_count,pending_ack_count,ack_within_slo_rate,severity,
      metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      v_row.destination_key,v_window,v_days,v_row.delivered_count,v_row.ack_count,
      v_row.overdue_count,v_row.pending_ack_count,v_rate,v_severity,
      v_hash,
      jsonb_build_object(
        'contract_version','phase48-v1',
        'paging_rotation',v_row.destination_key,
        'source','scan_snapshot_oncall_ack_slo_dashboards_phase48'
      ),
      false,false,false
    );
    v_recorded:=v_recorded+1;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'dashboards_recorded',v_recorded,
    'window_days',v_days,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase48-v1'
  );
end $$;

create or replace view public.os_snapshot_phase48_ops_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_ci_cutover_acceptances
    where created_at>=now()-interval '365 days') as ci_cutover_acceptances_365d,
  (select count(*) from public.os_snapshot_ed25519_key_rotations r
    where r.status='dual_active'
      and public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(
        r.rotation_id
      )
  ) as ci_offline_script_dual_ready,
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where status='cutover_complete'
      and cutover_completed_at>=now()-interval '365 days') as cutovers_completed_365d,
  (select count(*) from public.os_snapshot_oncall_ack_slo_dashboards
    where created_at>=now()-interval '30 days') as oncall_ack_dashboards_30d,
  (select count(*) from public.os_snapshot_oncall_ack_slo_dashboards
    where created_at>=now()-interval '30 days'
      and severity='critical') as oncall_ack_dashboard_critical_30d,
  (select count(*) from public.os_snapshot_oncall_ack_slo_snapshots
    where created_at>=now()-interval '30 days'
      and overdue) as oncall_ack_overdue_30d,
  false as qualification_eligible,
  false as attestation_eligible,
  false as production_relation_mutated,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase48_ops_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'ci_cutover_acceptances_365d',s.ci_cutover_acceptances_365d,
    'ci_offline_script_dual_ready',s.ci_offline_script_dual_ready,
    'cutovers_completed_365d',s.cutovers_completed_365d,
    'oncall_ack_dashboards_30d',s.oncall_ack_dashboards_30d,
    'oncall_ack_dashboard_critical_30d',s.oncall_ack_dashboard_critical_30d,
    'oncall_ack_overdue_30d',s.oncall_ack_overdue_30d,
    'ci_dual_acceptance_required',true,
    'offline_script_required',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase48-v1'
  )
  from public.os_snapshot_phase48_ops_slo s;
$$;

alter table public.os_snapshot_ed25519_key_rotations enable row level security;
alter table public.os_snapshot_ed25519_cutover_acceptances enable row level security;
alter table public.os_snapshot_oncall_page_routes enable row level security;
alter table public.os_snapshot_oncall_page_deliveries enable row level security;
alter table public.os_snapshot_oncall_ack_slo_snapshots enable row level security;
alter table public.os_snapshot_oncall_ack_alerts enable row level security;
alter table public.os_snapshot_ci_cutover_acceptances enable row level security;
alter table public.os_snapshot_oncall_ack_slo_dashboards enable row level security;

drop policy if exists "os_snapshot_ci_acc_select"
  on public.os_snapshot_ci_cutover_acceptances;
create policy "os_snapshot_ci_acc_select"
  on public.os_snapshot_ci_cutover_acceptances for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_ack_dash_select"
  on public.os_snapshot_oncall_ack_slo_dashboards;
create policy "os_snapshot_ack_dash_select"
  on public.os_snapshot_oncall_ack_slo_dashboards for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_ci_cutover_acceptances,
  public.os_snapshot_oncall_ack_slo_dashboards,
  public.os_snapshot_phase48_ops_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_ci_cutover_acceptances,
  public.os_snapshot_oncall_ack_slo_dashboards
  from public,authenticated,service_role;

revoke all on function public.prevent_phase48_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.complete_snapshot_ed25519_cutover_phase48(uuid,uuid)
  from public,authenticated;
revoke all on function public.record_snapshot_ci_cutover_acceptance_phase48(
  uuid,uuid,text,text,jsonb
) from public,authenticated;
revoke all on function public.scan_snapshot_oncall_ack_slo_dashboards_phase48(
  uuid,integer
) from public,authenticated;
revoke all on function public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(uuid)
  from public,anon;
revoke all on function public.get_snapshot_phase48_ops_report()
  from public,anon;

grant execute on function public.phase48_snapshot_safe_detail(jsonb),
  public.snapshot_cutover_ci_offline_script_dual_acceptance_phase48(uuid),
  public.get_snapshot_phase48_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.complete_snapshot_ed25519_cutover_phase48(uuid,uuid),
  public.record_snapshot_ci_cutover_acceptance_phase48(uuid,uuid,text,text,jsonb),
  public.scan_snapshot_oncall_ack_slo_dashboards_phase48(uuid,integer)
  to service_role;

-- Keep phase47 complete callable for wrap (service_role).
revoke all on function public.complete_snapshot_ed25519_cutover_phase47(uuid,uuid)
  from public,authenticated;
grant execute on function public.complete_snapshot_ed25519_cutover_phase47(uuid,uuid)
  to service_role;
grant execute on function public.snapshot_cutover_offline_script_dual_acceptance_phase47(uuid)
  to authenticated, service_role;
