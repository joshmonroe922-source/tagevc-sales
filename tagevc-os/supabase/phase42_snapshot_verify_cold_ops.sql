-- Phase 42: public ed25519 verify material (no private keys) and cold
-- retention HEAD cadence evidence. Snapshot packages remain non-qualifying.
-- NEVER mutates os_store_snapshots.
-- Apply after phase41_snapshot_external_receipts.sql.

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

create table if not exists public.os_snapshot_public_verify_material (
  material_id uuid primary key default gen_random_uuid(),
  key_id text not null,
  public_key_spki_sha256 text not null,
  public_key_spki_b64 text not null,
  algorithm text not null default 'ed25519',
  contract_version text not null default 'phase42-v1',
  published_by uuid not null references public.profiles(id),
  published_at timestamptz not null default now(),
  active boolean not null default true,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  constraint os_snapshot_verify_material_key_check
    check (key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_verify_material_hash_check
    check (public_key_spki_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_verify_material_key_b64_check
    check (length(public_key_spki_b64) between 44 and 512
      and public_key_spki_b64 ~ '^[A-Za-z0-9+/]+={0,2}$'),
  constraint os_snapshot_verify_material_algorithm_check
    check (algorithm='ed25519' and contract_version='phase42-v1'),
  constraint os_snapshot_verify_material_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_verify_material_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  constraint os_snapshot_verify_material_key_unique unique (key_id)
);

create index if not exists os_snapshot_verify_material_active_idx
  on public.os_snapshot_public_verify_material(active,published_at desc)
  where active;

create table if not exists public.os_snapshot_cold_retention_check_runs (
  run_id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.os_snapshot_export_packages(package_id),
  retention_check_id uuid
    references public.os_snapshot_retention_checks(check_id),
  idempotency_key text not null unique,
  cadence_hours integer not null,
  status text not null,
  checked_at timestamptz not null,
  evidence_sha256 text not null,
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_cold_run_idempotency_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_cold_run_cadence_check
    check (cadence_hours between 24 and 720),
  constraint os_snapshot_cold_run_status_check
    check (status in ('verified','unavailable','missing','hash_mismatch','expired','skipped_not_due')),
  constraint os_snapshot_cold_run_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_cold_run_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_cold_run_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_cold_run_package_idx
  on public.os_snapshot_cold_retention_check_runs(package_id,checked_at desc);

create or replace function public.prevent_phase42_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_verify_material_immutable
  on public.os_snapshot_public_verify_material;
create trigger os_snapshot_verify_material_immutable
  before update or delete or truncate
  on public.os_snapshot_public_verify_material for each statement
  execute function public.prevent_phase42_snapshot_immutable_change();
drop trigger if exists os_snapshot_cold_runs_immutable
  on public.os_snapshot_cold_retention_check_runs;
create trigger os_snapshot_cold_runs_immutable
  before update or delete or truncate
  on public.os_snapshot_cold_retention_check_runs for each statement
  execute function public.prevent_phase42_snapshot_immutable_change();

-- Allow deactivating prior material for the same key_id before insert of a
-- replacement row by briefly disabling only the verify-material trigger.
create or replace function public.phase42_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.publish_snapshot_verify_material_phase42(
  p_actor_id uuid,
  p_key_id text,
  p_public_key_spki_sha256 text,
  p_public_key_spki_b64 text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_snapshot_public_verify_material%rowtype;
  v_material_id uuid;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_key_id,'') !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or coalesce(p_public_key_spki_sha256,'') !~ '^[0-9a-f]{64}$'
     or length(coalesce(p_public_key_spki_b64,'')) not between 44 and 512
     or coalesce(p_public_key_spki_b64,'') !~ '^[A-Za-z0-9+/]+={0,2}$'
     or not public.phase42_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 42 verify material authorization or input failed';
  end if;
  if p_public_key_spki_b64 ~* 'private'
     or p_detail::text ~* 'private_key'
  then
    raise exception 'Private key material is not allowed in verify publication';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase42-verify-material:'||p_key_id,0));

  select * into v_existing from public.os_snapshot_public_verify_material
    where key_id=p_key_id;
  if found then
    if v_existing.public_key_spki_sha256=p_public_key_spki_sha256
       and v_existing.public_key_spki_b64=p_public_key_spki_b64
       and v_existing.active then
      return jsonb_build_object(
        'ok',true,'replayed',true,
        'material_id',v_existing.material_id,
        'key_id',v_existing.key_id,
        'public_key_spki_sha256',v_existing.public_key_spki_sha256,
        'qualification_eligible',false,
        'attestation_eligible',false
      );
    end if;
    -- Immutable table: fingerprint rotation requires a new key_id.
    raise exception 'Verify material for key_id already published; use a new key_id to rotate';
  end if;

  insert into public.os_snapshot_public_verify_material(
    key_id,public_key_spki_sha256,public_key_spki_b64,published_by,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_key_id,p_public_key_spki_sha256,p_public_key_spki_b64,p_actor_id,
    coalesce(p_detail,'{}'::jsonb),false,false,false
  ) returning material_id into v_material_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'material_id',v_material_id,
    'key_id',p_key_id,
    'public_key_spki_sha256',p_public_key_spki_sha256,
    'algorithm','ed25519',
    'qualification_eligible',false,
    'attestation_eligible',false
  );
end $$;

create or replace function public.record_snapshot_cold_retention_check_phase42(
  p_actor_id uuid,
  p_package_id uuid,
  p_idempotency_key text,
  p_retention_check_id uuid,
  p_cadence_hours integer,
  p_status text,
  p_checked_at timestamptz,
  p_evidence_sha256 text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.os_snapshot_export_packages%rowtype;
  v_existing public.os_snapshot_cold_retention_check_runs%rowtype;
  v_last timestamptz;
  v_run_id uuid;
  v_check public.os_snapshot_retention_checks%rowtype;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or coalesce(p_cadence_hours,0) not between 24 and 720
     or p_status not in ('verified','unavailable','missing','hash_mismatch','expired','skipped_not_due')
     or coalesce(p_evidence_sha256,'') !~ '^[0-9a-f]{64}$'
     or p_checked_at<now()-interval '10 minutes'
     or p_checked_at>now()+interval '2 minutes'
     or not public.phase42_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 42 cold retention check authorization or input failed';
  end if;

  select * into v_package from public.os_snapshot_export_packages
    where package_id=p_package_id for update;
  if not found then
    raise exception 'Export package was not found';
  end if;
  if v_package.retention_tier is distinct from 'cold' then
    raise exception 'Cold retention cadence applies only to cold-tier packages';
  end if;
  if v_package.qualification_eligible
     or v_package.attestation_eligible
     or v_package.production_relation_mutated then
    raise exception 'Cold retention checks cannot qualify soak or attestation';
  end if;

  if p_status<>'skipped_not_due' then
    if p_retention_check_id is null then
      raise exception 'Cold retention run requires a retention_check_id';
    end if;
    select * into v_check from public.os_snapshot_retention_checks
      where check_id=p_retention_check_id;
    if not found or v_check.package_id<>p_package_id then
      raise exception 'Retention check does not bind this cold package';
    end if;
    if v_check.status is distinct from p_status then
      raise exception 'Cold run status must match retention check status';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase42-cold-run:'||p_idempotency_key,0));

  select * into v_existing from public.os_snapshot_cold_retention_check_runs
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.package_id<>p_package_id
       or v_existing.status<>p_status
       or v_existing.evidence_sha256<>p_evidence_sha256 then
      return jsonb_build_object(
        'ok',false,'replayed',true,'replay_conflict',true,
        'run_id',v_existing.run_id,
        'qualification_eligible',false
      );
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'run_id',v_existing.run_id,
      'package_id',v_existing.package_id,
      'status',v_existing.status,
      'qualification_eligible',false,
      'attestation_eligible',false
    );
  end if;

  select max(checked_at) into v_last
  from public.os_snapshot_cold_retention_check_runs
  where package_id=p_package_id
    and status<>'skipped_not_due';

  if v_last is not null
     and p_status<>'skipped_not_due'
     and p_checked_at < v_last + make_interval(hours => p_cadence_hours)
  then
    raise exception 'Cold retention cadence not due yet';
  end if;

  insert into public.os_snapshot_cold_retention_check_runs(
    package_id,retention_check_id,idempotency_key,cadence_hours,status,
    checked_at,evidence_sha256,actor_id,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_package_id,p_retention_check_id,p_idempotency_key,p_cadence_hours,p_status,
    p_checked_at,p_evidence_sha256,p_actor_id,coalesce(p_detail,'{}'::jsonb),
    false,false,false
  ) returning run_id into v_run_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'run_id',v_run_id,
    'package_id',p_package_id,
    'retention_check_id',p_retention_check_id,
    'status',p_status,
    'cadence_hours',p_cadence_hours,
    'qualification_eligible',false,
    'attestation_eligible',false
  );
end $$;

create or replace view public.os_snapshot_phase42_verify_cold_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_public_verify_material
    where active) as active_verify_keys,
  (select count(*) from public.os_snapshot_cold_retention_check_runs
    where created_at>=now()-interval '30 days'
      and status<>'skipped_not_due') as cold_runs_30d,
  (select count(*) from public.os_snapshot_cold_retention_check_runs
    where created_at>=now()-interval '30 days'
      and status='verified') as cold_verified_30d,
  (select count(*) from public.os_snapshot_export_packages
    where retention_tier='cold') as packages_cold,
  (select max(checked_at) from public.os_snapshot_cold_retention_check_runs
    where status<>'skipped_not_due') as last_cold_check_at,
  false as qualification_eligible,
  false as attestation_eligible,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase42_verify_cold_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'active_verify_keys',s.active_verify_keys,
    'cold_runs_30d',s.cold_runs_30d,
    'cold_verified_30d',s.cold_verified_30d,
    'packages_cold',s.packages_cold,
    'last_cold_check_at',s.last_cold_check_at,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'evidence_class',s.evidence_class
  )
  from public.os_snapshot_phase42_verify_cold_slo s;
$$;

alter table public.os_snapshot_public_verify_material enable row level security;
alter table public.os_snapshot_cold_retention_check_runs enable row level security;

drop policy if exists "os_snapshot_verify_material_select"
  on public.os_snapshot_public_verify_material;
create policy "os_snapshot_verify_material_select"
  on public.os_snapshot_public_verify_material for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_cold_runs_select"
  on public.os_snapshot_cold_retention_check_runs;
create policy "os_snapshot_cold_runs_select"
  on public.os_snapshot_cold_retention_check_runs for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_public_verify_material,
  public.os_snapshot_cold_retention_check_runs,
  public.os_snapshot_phase42_verify_cold_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_public_verify_material,
  public.os_snapshot_cold_retention_check_runs
  from public,authenticated,service_role;

-- Packages remain non-qualifying; DML stays RPC-only.
revoke insert,update,delete,truncate on public.os_snapshot_export_packages
  from public,authenticated,service_role;

revoke all on function public.prevent_phase42_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.publish_snapshot_verify_material_phase42(
  uuid,text,text,text,jsonb
) from public,authenticated;
revoke all on function public.record_snapshot_cold_retention_check_phase42(
  uuid,uuid,text,uuid,integer,text,timestamptz,text,jsonb
) from public,authenticated;
revoke all on function public.get_snapshot_phase42_verify_cold_report()
  from public,anon;

grant execute on function public.phase42_snapshot_safe_detail(jsonb),
  public.get_snapshot_phase42_verify_cold_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.publish_snapshot_verify_material_phase42(
    uuid,text,text,text,jsonb
  ),
  public.record_snapshot_cold_retention_check_phase42(
    uuid,uuid,text,uuid,integer,text,timestamptz,text,jsonb
  )
  to service_role;
