-- Phase 47: offline_script-required dual-acceptance cutover default path,
-- and on-call acknowledgment SLOs for consecutive-failure pages.
-- Apply after phase46_snapshot_cutover_ops.sql.
-- Bootstraps Phase 46 rotation/acceptance/on-call tables if missing so this
-- migration is re-runnable when Phase 46 snapshot SQL was skipped.
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

create or replace function public.phase47_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Phase 46 rotation ledger (required FK target)
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

alter table public.os_snapshot_ed25519_key_rotations enable row level security;

drop policy if exists "os_snapshot_ed25519_rot_select"
  on public.os_snapshot_ed25519_key_rotations;
create policy "os_snapshot_ed25519_rot_select"
  on public.os_snapshot_ed25519_key_rotations for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_ed25519_key_rotations to authenticated;
revoke insert,update,delete,truncate on public.os_snapshot_ed25519_key_rotations
  from public,authenticated;

-- Bootstrap Phase 46 dual-acceptance evidence table.
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

-- Bootstrap Phase 46 on-call routes + deliveries.
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
  ('ops_alerts','active',jsonb_build_object('contract_version','phase47-v1'),false,false,false),
  ('oncall','active',jsonb_build_object('contract_version','phase47-v1'),false,false,false)
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

create index if not exists os_snapshot_oncall_del_route_idx
  on public.os_snapshot_oncall_page_deliveries(route_id,created_at desc);

-- Ensure phase46 dual-acceptance helper exists for wrap path.
create or replace function public.snapshot_cutover_dual_acceptance_complete_phase46(
  p_rotation_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select count(distinct a.verifier_kind)>=2
    from public.os_snapshot_ed25519_cutover_acceptances a
    where a.rotation_id=p_rotation_id
  ),false);
$$;

create or replace function public.complete_snapshot_ed25519_cutover_phase46(
  p_actor_id uuid,
  p_rotation_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
  v_dual boolean;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 46 ed25519 cutover authorization failed';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id for update;
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
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false,
      'contract_version','phase46-v1'
    );
  end if;

  v_dual:=public.snapshot_cutover_dual_acceptance_complete_phase46(p_rotation_id);
  if not v_dual then
    raise exception 'Dual-acceptance evidence from two distinct verifier_kinds is required before cutover';
  end if;
  if v_rot.status<>'dual_active' then
    raise exception 'Only dual_active rotations can complete cutover';
  end if;

  update public.os_snapshot_ed25519_key_rotations
    set status='cutover_complete',
        cutover_completed_at=now(),
        detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
          'completed_by',p_actor_id,
          'contract_version','phase46-v1'
        )
    where rotation_id=p_rotation_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'rotation_id',p_rotation_id,
    'status','cutover_complete',
    'cutover_completed_at',now(),
    'dual_acceptance_complete',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

-- ---------------------------------------------------------------------------
-- On-call acknowledgment SLO snapshots (deliveries without ack)
-- ---------------------------------------------------------------------------
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

create index if not exists os_snapshot_oncall_ack_overdue_idx
  on public.os_snapshot_oncall_ack_slo_snapshots(overdue,created_at desc);

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

create index if not exists os_snapshot_oncall_ack_alerts_kind_idx
  on public.os_snapshot_oncall_ack_alerts(alert_kind,created_at desc);

create or replace function public.prevent_phase47_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

-- Ack SLO snapshots: deletes forbidden; updates only via record_ack RPC
-- (acknowledged_at may be set once). Alerts remain fully append-only.
create or replace function public.prevent_phase47_oncall_ack_slo_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_snapshot_oncall_ack_slo_snapshots deletes are forbidden'; end $$;

drop trigger if exists os_snapshot_oncall_ack_slo_no_delete
  on public.os_snapshot_oncall_ack_slo_snapshots;
create trigger os_snapshot_oncall_ack_slo_no_delete before delete
  on public.os_snapshot_oncall_ack_slo_snapshots for each row
  execute function public.prevent_phase47_oncall_ack_slo_delete();
drop trigger if exists os_snapshot_oncall_ack_slo_no_truncate
  on public.os_snapshot_oncall_ack_slo_snapshots;
create trigger os_snapshot_oncall_ack_slo_no_truncate before truncate
  on public.os_snapshot_oncall_ack_slo_snapshots for each statement
  execute function public.prevent_phase47_oncall_ack_slo_delete();

drop trigger if exists os_snapshot_oncall_ack_alerts_immutable
  on public.os_snapshot_oncall_ack_alerts;
create trigger os_snapshot_oncall_ack_alerts_immutable
  before update or delete or truncate
  on public.os_snapshot_oncall_ack_alerts for each statement
  execute function public.prevent_phase47_snapshot_immutable_change();

-- Default cutover path: dual acceptance must include offline_script + one other.
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
  v_complete jsonb;
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

  -- Prefer wrapping Phase 46 complete (which itself enforces dual acceptance).
  v_complete:=public.complete_snapshot_ed25519_cutover_phase46(
    p_actor_id, p_rotation_id
  );

  return coalesce(v_complete,'{}'::jsonb)||jsonb_build_object(
    'dual_acceptance_complete',true,
    'offline_script_required',true,
    'offline_script_accepted',true,
    'contract_version','phase47-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.record_snapshot_oncall_ack_phase47(
  p_actor_id uuid,
  p_delivery_id uuid,
  p_ack_within_minutes integer default 60,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery public.os_snapshot_oncall_page_deliveries%rowtype;
  v_existing public.os_snapshot_oncall_ack_slo_snapshots%rowtype;
  v_snapshot_id uuid;
  v_minutes integer:=least(greatest(coalesce(p_ack_within_minutes,60),1),10080);
  v_overdue boolean:=false;
  v_severity text:='info';
  v_window text;
  v_hash text;
  v_age_minutes numeric;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or not public.phase47_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 47 on-call ack authorization or input failed';
  end if;

  select * into v_delivery from public.os_snapshot_oncall_page_deliveries
    where delivery_id=p_delivery_id;
  if not found then
    raise exception 'On-call page delivery was not found';
  end if;

  v_window:='phase47:oncall_ack:'||v_delivery.delivery_id::text;
  v_age_minutes:=extract(
    epoch from (now() - v_delivery.created_at)
  )/60.0;
  v_overdue:=v_age_minutes>v_minutes;
  v_severity:=case
    when v_overdue and v_age_minutes>v_minutes*2 then 'critical'
    when v_overdue then 'warning'
    else 'info'
  end;

  select * into v_existing from public.os_snapshot_oncall_ack_slo_snapshots
    where delivery_id=p_delivery_id for update;
  if found then
    if v_existing.acknowledged_at is not null then
      return jsonb_build_object(
        'ok',true,'replayed',true,
        'snapshot_id',v_existing.snapshot_id,
        'delivery_id',v_existing.delivery_id,
        'overdue',v_existing.overdue,
        'ack_within_minutes',v_existing.ack_within_minutes,
        'acknowledged_at',v_existing.acknowledged_at,
        'qualification_eligible',false,
        'attestation_eligible',false,
        'production_relation_mutated',false
      );
    end if;

    update public.os_snapshot_oncall_ack_slo_snapshots
      set acknowledged_at=now(),
          acknowledged_by=p_actor_id,
          detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
            'acknowledged',true,
            'contract_version','phase47-v1',
            'age_minutes_at_ack',round(v_age_minutes,2)
          )
      where snapshot_id=v_existing.snapshot_id;

    return jsonb_build_object(
      'ok',true,'replayed',false,
      'snapshot_id',v_existing.snapshot_id,
      'delivery_id',p_delivery_id,
      'window_key',v_existing.window_key,
      'ack_within_minutes',v_existing.ack_within_minutes,
      'overdue',v_existing.overdue,
      'severity',v_existing.severity,
      'acknowledged_at',now(),
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false,
      'contract_version','phase47-v1'
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'ack_within_minutes',v_minutes,
    'contract_version','phase47-v1',
    'delivery_id',p_delivery_id,
    'overdue',v_overdue,
    'severity',v_severity,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_oncall_ack_slo_snapshots(
    delivery_id,window_key,ack_within_minutes,overdue,severity,
    acknowledged_at,acknowledged_by,metrics_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_delivery_id,v_window,v_minutes,v_overdue,v_severity,
    now(),p_actor_id,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'contract_version','phase47-v1',
      'age_minutes',round(v_age_minutes,2)
    ),
    false,false,false
  ) returning snapshot_id into v_snapshot_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'snapshot_id',v_snapshot_id,
    'delivery_id',p_delivery_id,
    'window_key',v_window,
    'ack_within_minutes',v_minutes,
    'overdue',v_overdue,
    'severity',v_severity,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase47-v1'
  );
end $$;

-- Scan delivered deliveries without ack; materialize overdue SLO snapshots + alerts.
create or replace function public.scan_snapshot_oncall_ack_slo_phase47(
  p_actor_id uuid default null,
  p_ack_within_minutes integer default 60,
  p_lookback_hours integer default 168
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_minutes integer:=least(greatest(coalesce(p_ack_within_minutes,60),1),10080);
  v_lookback integer:=least(greatest(coalesce(p_lookback_hours,168),1),720);
  v_row record;
  v_recorded integer:=0;
  v_overdue integer:=0;
  v_snapshot_id uuid;
  v_window text;
  v_hash text;
  v_severity text;
  v_age_minutes numeric;
  v_consec integer:=0;
  v_alert_id uuid;
  v_alert_window text;
  v_existing_alert public.os_snapshot_oncall_ack_alerts%rowtype;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan on-call ack SLOs';
  end if;

  for v_row in
    select d.delivery_id,d.created_at,d.window_key as delivery_window
    from public.os_snapshot_oncall_page_deliveries d
    where d.delivery_status='delivered'
      and d.created_at>=now()-(v_lookback||' hours')::interval
      and not exists (
        select 1 from public.os_snapshot_oncall_ack_slo_snapshots a
        where a.delivery_id=d.delivery_id
      )
      and extract(epoch from (now() - d.created_at))/60.0 > v_minutes
    order by d.created_at,d.delivery_id
    limit 200
  loop
    v_age_minutes:=extract(epoch from (now() - v_row.created_at))/60.0;
    v_severity:=case
      when v_age_minutes>v_minutes*2 then 'critical'
      else 'warning'
    end;
    v_window:='phase47:oncall_ack_scan:'||v_row.delivery_id::text;
    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'ack_within_minutes',v_minutes,
      'contract_version','phase47-v1',
      'delivery_id',v_row.delivery_id,
      'overdue',true,
      'severity',v_severity,
      'window_key',v_window
    )::text);

    insert into public.os_snapshot_oncall_ack_slo_snapshots(
      delivery_id,window_key,ack_within_minutes,overdue,severity,
      acknowledged_at,acknowledged_by,metrics_sha256,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      v_row.delivery_id,v_window,v_minutes,true,v_severity,
      null,null,v_hash,
      jsonb_build_object(
        'age_minutes',round(v_age_minutes,2),
        'contract_version','phase47-v1',
        'delivery_window',v_row.delivery_window,
        'source','scan_snapshot_oncall_ack_slo_phase47'
      ),
      false,false,false
    ) returning snapshot_id into v_snapshot_id;

    v_recorded:=v_recorded+1;
    v_overdue:=v_overdue+1;
  end loop;

  select count(*) into v_consec
  from public.os_snapshot_oncall_ack_slo_snapshots
  where overdue
    and acknowledged_at is null
    and created_at>=now()-interval '7 days';

  if v_consec>=2 then
    v_alert_window:='phase47:consec_ack_overdue:'||
      to_char(now() at time zone 'utc','YYYY-MM-DD');
    select * into v_existing_alert from public.os_snapshot_oncall_ack_alerts
      where window_key=v_alert_window;
    if not found then
      v_hash:=public.os_sha256_hex(jsonb_build_object(
        'alert_kind','consecutive_ack_overdue',
        'consecutive_ack_overdue',v_consec,
        'contract_version','phase47-v1',
        'window_key',v_alert_window
      )::text);
      insert into public.os_snapshot_oncall_ack_alerts(
        alert_kind,window_key,consecutive_ack_overdue,severity,metrics_sha256,detail,
        qualification_eligible,attestation_eligible,production_relation_mutated
      ) values (
        'consecutive_ack_overdue',v_alert_window,v_consec,
        case when v_consec>=4 then 'critical' else 'warning' end,
        v_hash,
        jsonb_build_object(
          'ack_within_minutes',v_minutes,
          'contract_version','phase47-v1',
          'source','scan_snapshot_oncall_ack_slo_phase47'
        ),
        false,false,false
      ) returning alert_id into v_alert_id;
    else
      v_alert_id:=v_existing_alert.alert_id;
    end if;
  end if;

  return jsonb_build_object(
    'ok',true,
    'ack_snapshots_recorded',v_recorded,
    'overdue_recorded',v_overdue,
    'consecutive_ack_overdue',v_consec,
    'ack_alert_id',v_alert_id,
    'ack_within_minutes',v_minutes,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase47-v1'
  );
end $$;

create or replace view public.os_snapshot_phase47_ops_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_ed25519_cutover_acceptances
    where created_at>=now()-interval '365 days'
      and verifier_kind='offline_script') as offline_script_acceptances_365d,
  (select count(*) from public.os_snapshot_ed25519_key_rotations r
    where r.status='dual_active'
      and public.snapshot_cutover_offline_script_dual_acceptance_phase47(r.rotation_id)
  ) as offline_script_dual_ready,
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where status='cutover_complete'
      and cutover_completed_at>=now()-interval '365 days') as cutovers_completed_365d,
  (select count(*) from public.os_snapshot_oncall_ack_slo_snapshots
    where created_at>=now()-interval '30 days') as oncall_ack_snapshots_30d,
  (select count(*) from public.os_snapshot_oncall_ack_slo_snapshots
    where created_at>=now()-interval '30 days'
      and overdue) as oncall_ack_overdue_30d,
  (select count(*) from public.os_snapshot_oncall_ack_alerts
    where created_at>=now()-interval '30 days'
      and alert_kind='consecutive_ack_overdue') as consecutive_ack_overdue_alerts_30d,
  false as qualification_eligible,
  false as attestation_eligible,
  false as production_relation_mutated,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase47_ops_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'offline_script_acceptances_365d',s.offline_script_acceptances_365d,
    'offline_script_dual_ready',s.offline_script_dual_ready,
    'cutovers_completed_365d',s.cutovers_completed_365d,
    'oncall_ack_snapshots_30d',s.oncall_ack_snapshots_30d,
    'oncall_ack_overdue_30d',s.oncall_ack_overdue_30d,
    'consecutive_ack_overdue_alerts_30d',s.consecutive_ack_overdue_alerts_30d,
    'offline_script_required',true,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase47-v1'
  )
  from public.os_snapshot_phase47_ops_slo s;
$$;

alter table public.os_snapshot_ed25519_cutover_acceptances enable row level security;
alter table public.os_snapshot_oncall_page_routes enable row level security;
alter table public.os_snapshot_oncall_page_deliveries enable row level security;
alter table public.os_snapshot_oncall_ack_slo_snapshots enable row level security;
alter table public.os_snapshot_oncall_ack_alerts enable row level security;

drop policy if exists "os_snapshot_cutover_acc_select"
  on public.os_snapshot_ed25519_cutover_acceptances;
create policy "os_snapshot_cutover_acc_select"
  on public.os_snapshot_ed25519_cutover_acceptances for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_oncall_routes_select"
  on public.os_snapshot_oncall_page_routes;
create policy "os_snapshot_oncall_routes_select"
  on public.os_snapshot_oncall_page_routes for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_oncall_del_select"
  on public.os_snapshot_oncall_page_deliveries;
create policy "os_snapshot_oncall_del_select"
  on public.os_snapshot_oncall_page_deliveries for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_oncall_ack_slo_select"
  on public.os_snapshot_oncall_ack_slo_snapshots;
create policy "os_snapshot_oncall_ack_slo_select"
  on public.os_snapshot_oncall_ack_slo_snapshots for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_oncall_ack_alerts_select"
  on public.os_snapshot_oncall_ack_alerts;
create policy "os_snapshot_oncall_ack_alerts_select"
  on public.os_snapshot_oncall_ack_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_ed25519_cutover_acceptances,
  public.os_snapshot_oncall_page_routes,
  public.os_snapshot_oncall_page_deliveries,
  public.os_snapshot_oncall_ack_slo_snapshots,
  public.os_snapshot_oncall_ack_alerts,
  public.os_snapshot_phase47_ops_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_ed25519_cutover_acceptances,
  public.os_snapshot_oncall_page_routes,
  public.os_snapshot_oncall_page_deliveries,
  public.os_snapshot_oncall_ack_slo_snapshots,
  public.os_snapshot_oncall_ack_alerts
  from public,authenticated,service_role;

revoke all on function public.prevent_phase47_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.prevent_phase47_oncall_ack_slo_delete()
  from public,authenticated,service_role;
revoke all on function public.complete_snapshot_ed25519_cutover_phase47(uuid,uuid)
  from public,authenticated;
revoke all on function public.record_snapshot_oncall_ack_phase47(
  uuid,uuid,integer,jsonb
) from public,authenticated;
revoke all on function public.scan_snapshot_oncall_ack_slo_phase47(
  uuid,integer,integer
) from public,authenticated;
revoke all on function public.snapshot_cutover_offline_script_dual_acceptance_phase47(uuid)
  from public,anon;
revoke all on function public.get_snapshot_phase47_ops_report()
  from public,anon;

grant execute on function public.phase47_snapshot_safe_detail(jsonb),
  public.snapshot_cutover_offline_script_dual_acceptance_phase47(uuid),
  public.get_snapshot_phase47_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.complete_snapshot_ed25519_cutover_phase47(uuid,uuid),
  public.record_snapshot_oncall_ack_phase47(uuid,uuid,integer,jsonb),
  public.scan_snapshot_oncall_ack_slo_phase47(uuid,integer,integer)
  to service_role;

-- Keep phase46 complete callable for wrap (service_role).
revoke all on function public.complete_snapshot_ed25519_cutover_phase46(uuid,uuid)
  from public,authenticated;
grant execute on function public.complete_snapshot_ed25519_cutover_phase46(uuid,uuid)
  to service_role;
grant execute on function public.snapshot_cutover_dual_acceptance_complete_phase46(uuid)
  to authenticated, service_role;
