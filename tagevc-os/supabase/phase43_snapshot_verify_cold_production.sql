-- Phase 43: firm-wide published verify material catalog (public keys only)
-- and production cold HEAD scheduling against due cold packages.
-- NEVER mutates os_store_snapshots. Packages remain non-qualifying.
-- Apply after phase42_snapshot_verify_cold_ops.sql.

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

create table if not exists public.os_snapshot_production_cold_head_schedules (
  schedule_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  cadence_hours integer not null,
  due_package_count integer not null default 0,
  checked_package_count integer not null default 0,
  skipped_package_count integer not null default 0,
  status text not null,
  scheduled_at timestamptz not null default now(),
  actor_id uuid references public.profiles(id),
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_prod_cold_idempotency_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_prod_cold_cadence_check
    check (cadence_hours between 24 and 720),
  constraint os_snapshot_prod_cold_status_check
    check (status in ('completed','partial','skipped_none_due','failed')),
  constraint os_snapshot_prod_cold_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_prod_cold_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_prod_cold_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_prod_cold_sched_idx
  on public.os_snapshot_production_cold_head_schedules(scheduled_at desc);

create or replace function public.prevent_phase43_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_prod_cold_sched_immutable
  on public.os_snapshot_production_cold_head_schedules;
create trigger os_snapshot_prod_cold_sched_immutable
  before update or delete or truncate
  on public.os_snapshot_production_cold_head_schedules for each statement
  execute function public.prevent_phase43_snapshot_immutable_change();

create or replace function public.phase43_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- Public-only firm-wide catalog (no private key material).
create or replace view public.os_snapshot_firm_wide_verify_catalog
with (security_invoker=true) as
select
  m.material_id,
  m.key_id,
  m.public_key_spki_sha256,
  m.public_key_spki_b64,
  m.algorithm,
  m.contract_version,
  m.published_at,
  m.active,
  m.qualification_eligible,
  m.attestation_eligible,
  m.production_relation_mutated
from public.os_snapshot_public_verify_material m
where m.active
  and m.algorithm='ed25519'
  and not m.qualification_eligible
  and not m.attestation_eligible
  and not m.production_relation_mutated;

create or replace function public.list_snapshot_firm_wide_verify_material_phase43(
  p_limit integer default 50
)
returns table (
  material_id uuid,
  key_id text,
  public_key_spki_sha256 text,
  public_key_spki_b64 text,
  algorithm text,
  contract_version text,
  published_at timestamptz,
  active boolean
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list published verify material';
  end if;
  return query
  select
    c.material_id,c.key_id,c.public_key_spki_sha256,c.public_key_spki_b64,
    c.algorithm,c.contract_version,c.published_at,c.active
  from public.os_snapshot_firm_wide_verify_catalog c
  order by c.published_at desc,c.material_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.list_due_cold_packages_phase43(
  p_cadence_hours integer default 168,
  p_limit integer default 25
)
returns table (
  package_id uuid,
  destination_key text,
  retained_until timestamptz,
  last_cold_check_at timestamptz,
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
    raise exception 'Firm-wide access required to list due cold packages';
  end if;
  if coalesce(p_cadence_hours,0) not between 24 and 720 then
    raise exception 'Cold cadence hours must be between 24 and 720';
  end if;
  return query
  select
    p.package_id,
    p.destination_key,
    p.retained_until,
    (
      select max(r.checked_at)
      from public.os_snapshot_cold_retention_check_runs r
      where r.package_id=p.package_id
        and r.status<>'skipped_not_due'
    ) as last_cold_check_at,
    (
      (
        select max(r.checked_at)
        from public.os_snapshot_cold_retention_check_runs r
        where r.package_id=p.package_id
          and r.status<>'skipped_not_due'
      ) is null
      or (
        select max(r.checked_at)
        from public.os_snapshot_cold_retention_check_runs r
        where r.package_id=p.package_id
          and r.status<>'skipped_not_due'
      ) + make_interval(hours => p_cadence_hours) <= now()
    ) as due
  from public.os_snapshot_export_packages p
  where p.retention_tier='cold'
    and not p.qualification_eligible
    and not p.attestation_eligible
    and not p.production_relation_mutated
    and (
      (
        select max(r.checked_at)
        from public.os_snapshot_cold_retention_check_runs r
        where r.package_id=p.package_id
          and r.status<>'skipped_not_due'
      ) is null
      or (
        select max(r.checked_at)
        from public.os_snapshot_cold_retention_check_runs r
        where r.package_id=p.package_id
          and r.status<>'skipped_not_due'
      ) + make_interval(hours => p_cadence_hours) <= now()
    )
  order by p.created_at,p.package_id
  limit least(greatest(coalesce(p_limit,25),1),100);
end $$;

create or replace function public.record_snapshot_production_cold_head_schedule_phase43(
  p_actor_id uuid,
  p_idempotency_key text,
  p_cadence_hours integer,
  p_due_package_count integer,
  p_checked_package_count integer,
  p_skipped_package_count integer,
  p_status text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_snapshot_production_cold_head_schedules%rowtype;
  v_schedule_id uuid;
  v_evidence jsonb;
  v_hash text;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or coalesce(p_cadence_hours,0) not between 24 and 720
     or coalesce(p_due_package_count,-1)<0
     or coalesce(p_checked_package_count,-1)<0
     or coalesce(p_skipped_package_count,-1)<0
     or p_status not in ('completed','partial','skipped_none_due','failed')
     or not public.phase43_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 43 production cold HEAD schedule authorization or input failed';
  end if;
  if p_detail::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in cold HEAD schedule evidence';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase43-prod-cold:'||p_idempotency_key,0));

  select * into v_existing from public.os_snapshot_production_cold_head_schedules
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.status<>p_status
       or v_existing.due_package_count<>p_due_package_count
       or v_existing.checked_package_count<>p_checked_package_count then
      return jsonb_build_object(
        'ok',false,'replayed',true,'replay_conflict',true,
        'schedule_id',v_existing.schedule_id,
        'qualification_eligible',false
      );
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'schedule_id',v_existing.schedule_id,
      'status',v_existing.status,
      'qualification_eligible',false,
      'attestation_eligible',false
    );
  end if;

  v_evidence:=jsonb_build_object(
    'cadence_hours',p_cadence_hours,
    'checked_package_count',p_checked_package_count,
    'contract_version','phase43-v1',
    'due_package_count',p_due_package_count,
    'skipped_package_count',p_skipped_package_count,
    'status',p_status
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_snapshot_production_cold_head_schedules(
    idempotency_key,cadence_hours,due_package_count,checked_package_count,
    skipped_package_count,status,actor_id,evidence_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_idempotency_key,p_cadence_hours,p_due_package_count,p_checked_package_count,
    p_skipped_package_count,p_status,p_actor_id,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'adapter','https_head_v1',
      'destination_source','SNAPSHOT_RETENTION_DESTINATIONS'
    ),
    false,false,false
  ) returning schedule_id into v_schedule_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'schedule_id',v_schedule_id,
    'status',p_status,
    'cadence_hours',p_cadence_hours,
    'due_package_count',p_due_package_count,
    'checked_package_count',p_checked_package_count,
    'skipped_package_count',p_skipped_package_count,
    'evidence_sha256',v_hash,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace view public.os_snapshot_phase43_verify_cold_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_firm_wide_verify_catalog) as firm_wide_verify_keys,
  (select count(*) from public.os_snapshot_production_cold_head_schedules
    where scheduled_at>=now()-interval '30 days') as production_cold_schedules_30d,
  (select count(*) from public.os_snapshot_production_cold_head_schedules
    where scheduled_at>=now()-interval '30 days'
      and status='completed') as production_cold_completed_30d,
  (select max(scheduled_at) from public.os_snapshot_production_cold_head_schedules)
    as last_production_cold_at,
  (select count(*) from public.os_snapshot_export_packages
    where retention_tier='cold') as packages_cold,
  false as qualification_eligible,
  false as attestation_eligible,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase43_verify_cold_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'firm_wide_verify_keys',s.firm_wide_verify_keys,
    'production_cold_schedules_30d',s.production_cold_schedules_30d,
    'production_cold_completed_30d',s.production_cold_completed_30d,
    'last_production_cold_at',s.last_production_cold_at,
    'packages_cold',s.packages_cold,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase43-v1'
  )
  from public.os_snapshot_phase43_verify_cold_slo s;
$$;

alter table public.os_snapshot_production_cold_head_schedules enable row level security;

drop policy if exists "os_snapshot_prod_cold_sched_select"
  on public.os_snapshot_production_cold_head_schedules;
create policy "os_snapshot_prod_cold_sched_select"
  on public.os_snapshot_production_cold_head_schedules for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_production_cold_head_schedules,
  public.os_snapshot_firm_wide_verify_catalog,
  public.os_snapshot_phase43_verify_cold_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_production_cold_head_schedules
  from public,authenticated,service_role;

-- Packages remain non-qualifying; DML stays RPC-only.
revoke insert,update,delete,truncate on public.os_snapshot_export_packages
  from public,authenticated,service_role;

revoke all on function public.prevent_phase43_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.record_snapshot_production_cold_head_schedule_phase43(
  uuid,text,integer,integer,integer,integer,text,jsonb
) from public,authenticated;
revoke all on function public.list_due_cold_packages_phase43(integer,integer)
  from public,anon;
revoke all on function public.list_snapshot_firm_wide_verify_material_phase43(integer)
  from public,anon;
revoke all on function public.get_snapshot_phase43_verify_cold_report()
  from public,anon;

grant execute on function public.phase43_snapshot_safe_detail(jsonb),
  public.list_snapshot_firm_wide_verify_material_phase43(integer),
  public.list_due_cold_packages_phase43(integer,integer),
  public.get_snapshot_phase43_verify_cold_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.record_snapshot_production_cold_head_schedule_phase43(
  uuid,text,integer,integer,integer,integer,text,jsonb
) to service_role;
