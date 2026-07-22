-- Phase 40: signed export packages, external retention evidence, and durable
-- multi-hour canaries. This migration never mutates the production snapshot
-- relation and all synthetic evidence is explicitly non-qualifying.

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

create table if not exists public.os_snapshot_export_packages (
  package_id uuid primary key,
  entity_id text references public.entities(entity_id),
  phase39_manifest_id uuid not null
    references public.os_snapshot_export_manifests(manifest_id),
  idempotency_key text not null unique,
  contract_version text not null default 'phase40-v1',
  canonical_package jsonb not null,
  canonical_package_text text not null,
  package_sha256 text not null,
  signature_algorithm text not null,
  signature_key_id text not null,
  package_signature text not null,
  destination_key text not null,
  artifact_sha256 text not null,
  artifact_size_bytes bigint not null,
  retained_until timestamptz not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_export_package_contract_check
    check (contract_version='phase40-v1'),
  constraint os_snapshot_export_package_hash_check
    check (package_sha256 ~ '^[0-9a-f]{64}$'
      and artifact_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_export_package_signature_check
    check (signature_algorithm='hmac-sha256'
      and signature_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
      and package_signature ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_export_package_destination_check
    check (destination_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$'),
  constraint os_snapshot_export_package_artifact_check
    check (artifact_size_bytes between 1 and 1099511627776),
  constraint os_snapshot_export_package_retention_check
    check (retained_until>=created_at+interval '90 days'
      and retained_until<=created_at+interval '10 years'),
  constraint os_snapshot_export_package_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);
create index if not exists os_snapshot_export_package_latest_idx
  on public.os_snapshot_export_packages(entity_id,created_at desc,package_id desc);
create index if not exists os_snapshot_export_package_manifest_idx
  on public.os_snapshot_export_packages(phase39_manifest_id,created_at desc);

create table if not exists public.os_snapshot_retention_checks (
  check_id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.os_snapshot_export_packages(package_id),
  orchestration_id uuid,
  destination_key text not null,
  status text not null,
  checked_at timestamptz not null,
  expected_sha256 text not null,
  observed_sha256 text,
  expected_size_bytes bigint not null,
  observed_size_bytes bigint,
  retained_until timestamptz not null,
  http_status integer,
  evidence_sha256 text not null,
  error_code text,
  detail jsonb not null default '{}'::jsonb,
  recorded_at timestamptz not null default now(),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_retention_check_status_check
    check (status in ('verified','unavailable','missing','hash_mismatch','expired')),
  constraint os_snapshot_retention_check_hash_check check (
    expected_sha256 ~ '^[0-9a-f]{64}$'
    and (observed_sha256 is null or observed_sha256 ~ '^[0-9a-f]{64}$')
    and evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_retention_check_size_check check (
    expected_size_bytes between 1 and 1099511627776
    and (observed_size_bytes is null
      or observed_size_bytes between 0 and 1099511627776)),
  constraint os_snapshot_retention_check_http_check
    check (http_status is null or http_status between 100 and 599),
  constraint os_snapshot_retention_check_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_retention_check_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);
create index if not exists os_snapshot_retention_check_latest_idx
  on public.os_snapshot_retention_checks(package_id,checked_at desc,check_id desc);

create table if not exists public.os_snapshot_phase40_canary_definitions (
  definition_id text primary key,
  contract_version text not null default 'phase40-v1',
  min_duration_minutes integer not null,
  max_duration_minutes integer not null,
  min_step_interval_minutes integer not null,
  max_step_interval_minutes integer not null,
  max_steps integer not null,
  max_active_runs integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint os_snapshot_phase40_definition_contract_check
    check (contract_version='phase40-v1'),
  constraint os_snapshot_phase40_definition_bounds_check check (
    min_duration_minutes>=120
    and max_duration_minutes between min_duration_minutes and 1440
    and min_step_interval_minutes>=15
    and max_step_interval_minutes between min_step_interval_minutes and 120
    and max_steps between 2 and 97
    and max_active_runs between 1 and 4)
);
insert into public.os_snapshot_phase40_canary_definitions(
  definition_id,min_duration_minutes,max_duration_minutes,
  min_step_interval_minutes,max_step_interval_minutes,max_steps,max_active_runs
) values ('phase40-retention-soak-v1',120,1440,15,120,97,4)
on conflict (definition_id) do nothing;
do $$
begin
  if exists (
    select 1 from public.os_snapshot_phase40_canary_definitions
    where definition_id='phase40-retention-soak-v1'
      and (contract_version<>'phase40-v1' or min_duration_minutes<>120
        or max_duration_minutes<>1440 or min_step_interval_minutes<>15
        or max_step_interval_minutes<>120 or max_steps<>97
        or max_active_runs<>4)
  ) then
    raise exception 'Phase 40 canary definition drift requires reconciliation';
  end if;
end $$;

create table if not exists public.os_snapshot_phase40_orchestrations (
  orchestration_id uuid primary key default gen_random_uuid(),
  definition_id text not null
    references public.os_snapshot_phase40_canary_definitions(definition_id),
  package_id uuid not null references public.os_snapshot_export_packages(package_id),
  entity_id text references public.entities(entity_id),
  idempotency_key text not null unique,
  requested_by uuid not null references public.profiles(id),
  status text not null default 'scheduled',
  scheduled_for timestamptz not null,
  started_at timestamptz,
  deadline_at timestamptz not null,
  expires_at timestamptz not null,
  next_step_at timestamptz not null,
  step_interval_minutes integer not null,
  expected_step_count integer not null,
  completed_step_count integer not null default 0,
  lease_token_sha256 text,
  lease_generation bigint not null default 0,
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  completed_at timestamptz,
  abort_reason text,
  latest_evidence_sha256 text,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  created_at timestamptz not null default now(),
  constraint os_snapshot_phase40_orchestration_status_check
    check (status in ('scheduled','running','passed','failed','aborted','expired')),
  constraint os_snapshot_phase40_orchestration_schedule_check check (
    deadline_at>scheduled_for and expires_at>deadline_at
    and next_step_at>=scheduled_for),
  constraint os_snapshot_phase40_orchestration_step_check check (
    step_interval_minutes between 15 and 120
    and expected_step_count between 2 and 97
    and completed_step_count between 0 and expected_step_count),
  constraint os_snapshot_phase40_orchestration_lease_check check (
    (lease_token_sha256 is null or lease_token_sha256 ~ '^[0-9a-f]{64}$')
    and lease_generation>=0),
  constraint os_snapshot_phase40_orchestration_hash_check check (
    latest_evidence_sha256 is null
    or latest_evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_phase40_orchestration_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);
create index if not exists os_snapshot_phase40_orchestration_due_idx
  on public.os_snapshot_phase40_orchestrations(next_step_at,created_at)
  where status in ('scheduled','running');
create index if not exists os_snapshot_phase40_orchestration_latest_idx
  on public.os_snapshot_phase40_orchestrations(
    entity_id,created_at desc,orchestration_id desc);

alter table public.os_snapshot_retention_checks
  drop constraint if exists os_snapshot_retention_checks_orchestration_id_fkey;
alter table public.os_snapshot_retention_checks
  add constraint os_snapshot_retention_checks_orchestration_id_fkey
    foreign key (orchestration_id)
    references public.os_snapshot_phase40_orchestrations(orchestration_id);

create table if not exists public.os_snapshot_phase40_orchestration_steps (
  step_id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null
    references public.os_snapshot_phase40_orchestrations(orchestration_id),
  step_ordinal integer not null,
  lease_generation bigint not null,
  scheduled_at timestamptz not null,
  started_at timestamptz not null,
  completed_at timestamptz not null,
  retention_check_id uuid not null
    references public.os_snapshot_retention_checks(check_id),
  retention_status text not null,
  evidence_sha256 text not null,
  passed boolean not null,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_phase40_step_ordinal_check
    check (step_ordinal between 1 and 97),
  constraint os_snapshot_phase40_step_status_check
    check (retention_status in
      ('verified','unavailable','missing','hash_mismatch','expired')),
  constraint os_snapshot_phase40_step_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_phase40_step_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated),
  unique(orchestration_id,step_ordinal)
);
create index if not exists os_snapshot_phase40_step_timeline_idx
  on public.os_snapshot_phase40_orchestration_steps(
    orchestration_id,step_ordinal);

create table if not exists public.os_snapshot_phase40_events (
  event_id uuid primary key default gen_random_uuid(),
  orchestration_id uuid not null
    references public.os_snapshot_phase40_orchestrations(orchestration_id),
  event_type text not null,
  actor_id uuid references public.profiles(id),
  lease_generation bigint,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_phase40_event_type_check check (
    event_type in ('scheduled','lease_acquired','resumed','heartbeat',
      'step_recorded','passed','failed','aborted','expired','exact_replay')),
  constraint os_snapshot_phase40_event_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);
create index if not exists os_snapshot_phase40_event_timeline_idx
  on public.os_snapshot_phase40_events(
    orchestration_id,occurred_at,event_id);

create or replace function public.prevent_phase40_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;
drop trigger if exists os_snapshot_export_packages_immutable
  on public.os_snapshot_export_packages;
create trigger os_snapshot_export_packages_immutable before update or delete or truncate
  on public.os_snapshot_export_packages for each statement
  execute function public.prevent_phase40_immutable_change();
drop trigger if exists os_snapshot_retention_checks_immutable
  on public.os_snapshot_retention_checks;
create trigger os_snapshot_retention_checks_immutable before update or delete or truncate
  on public.os_snapshot_retention_checks for each statement
  execute function public.prevent_phase40_immutable_change();
drop trigger if exists os_snapshot_phase40_definitions_immutable
  on public.os_snapshot_phase40_canary_definitions;
create trigger os_snapshot_phase40_definitions_immutable before update or delete or truncate
  on public.os_snapshot_phase40_canary_definitions for each statement
  execute function public.prevent_phase40_immutable_change();
drop trigger if exists os_snapshot_phase40_steps_immutable
  on public.os_snapshot_phase40_orchestration_steps;
create trigger os_snapshot_phase40_steps_immutable before update or delete or truncate
  on public.os_snapshot_phase40_orchestration_steps for each statement
  execute function public.prevent_phase40_immutable_change();
drop trigger if exists os_snapshot_phase40_events_immutable
  on public.os_snapshot_phase40_events;
create trigger os_snapshot_phase40_events_immutable before update or delete or truncate
  on public.os_snapshot_phase40_events for each statement
  execute function public.prevent_phase40_immutable_change();
drop trigger if exists os_snapshot_phase40_runs_no_delete
  on public.os_snapshot_phase40_orchestrations;
create trigger os_snapshot_phase40_runs_no_delete before delete or truncate
  on public.os_snapshot_phase40_orchestrations for each statement
  execute function public.prevent_phase40_immutable_change();

create or replace function public.phase40_snapshot_actor_authorized(
  p_actor_id uuid,p_entity_id text
) returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles p
    where p.id=p_actor_id and p.active and p.role in ('visionary','admin')
      and (p_entity_id is null
        or exists (select 1 from public.entities e
          where e.entity_id=p_entity_id))
  )
$$;

create or replace function public.phase40_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

create or replace function public.create_snapshot_export_package_v1(
  p_package_id uuid,p_actor_id uuid,p_entity_id text,p_phase39_manifest_id uuid,
  p_idempotency_key text,p_canonical_package jsonb,p_canonical_package_text text,
  p_package_sha256 text,p_signature_algorithm text,p_signature_key_id text,
  p_package_signature text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_manifest public.os_snapshot_export_manifests%rowtype;
  v_existing public.os_snapshot_export_packages%rowtype;
  v_artifact jsonb;v_observation jsonb;v_destination text;
  v_artifact_sha text;v_size bigint;v_retained_until timestamptz;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,p_entity_id)
     or p_package_id is null
     or nullif(trim(p_idempotency_key),'') is null
     or coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or coalesce(p_package_sha256,'') !~ '^[0-9a-f]{64}$'
     or p_signature_algorithm is distinct from 'hmac-sha256'
     or coalesce(p_signature_key_id,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or coalesce(p_package_signature,'') !~ '^[0-9a-f]{64}$'
     or length(p_canonical_package_text)>65536
     or p_canonical_package_text::jsonb is distinct from p_canonical_package
     or public.os_sha256_hex(p_canonical_package_text)<>p_package_sha256
     or not public.phase40_safe_detail(p_canonical_package) then
    raise exception 'Phase 40 package authorization or canonical input failed';
  end if;
  select * into v_manifest from public.os_snapshot_export_manifests
    where manifest_id=p_phase39_manifest_id;
  if not found or v_manifest.entity_id is distinct from p_entity_id then
    raise exception 'Phase 39 manifest scope mismatch';
  end if;
  v_artifact:=p_canonical_package->'artifact';
  v_observation:=p_canonical_package->'phase39_manifest';
  v_destination:=v_artifact->>'destination_key';
  v_artifact_sha:=v_artifact->>'sha256';
  v_size:=nullif(v_artifact->>'size_bytes','')::bigint;
  v_retained_until:=nullif(v_artifact->>'retained_until','')::timestamptz;
  if p_canonical_package->>'contract_version' is distinct from 'phase40-v1'
     or p_canonical_package->>'package_id' is distinct from p_package_id::text
     or p_canonical_package->>'idempotency_key' is distinct from p_idempotency_key
     or p_canonical_package#>>'{governance,created_by}'
       is distinct from p_actor_id::text
     or (p_canonical_package#>>'{governance,entity_id}')
        is distinct from p_entity_id
     or coalesce((p_canonical_package#>>'{governance,qualification_eligible}')::boolean,true)
     or coalesce((p_canonical_package#>>'{governance,attestation_eligible}')::boolean,true)
     or coalesce((p_canonical_package#>>'{governance,production_relation_mutated}')::boolean,true)
     or v_observation->>'manifest_id'
       is distinct from v_manifest.manifest_id::text
     or nullif(v_observation->>'manifest_version','')::bigint
       is distinct from v_manifest.manifest_version
     or v_observation->>'manifest_sha256'
       is distinct from v_manifest.manifest_sha256
     or (v_manifest.valid_until>statement_timestamp()
       and v_observation->>'lifecycle_status' is distinct from 'valid')
     or (v_manifest.valid_until<=statement_timestamp()
       and v_observation->>'lifecycle_status' is distinct from 'expired')
     or (v_observation->>'currently_valid')::boolean is distinct from
       (v_manifest.lifecycle_status='valid'
         and statement_timestamp()>=v_manifest.valid_from
         and statement_timestamp()<v_manifest.valid_until)
     or nullif(v_observation->>'valid_from','')::timestamptz
       is distinct from v_manifest.valid_from
     or nullif(v_observation->>'valid_until','')::timestamptz
       is distinct from v_manifest.valid_until
     or nullif(v_observation->>'observed_at','') is null
     or nullif(v_observation->>'observed_at','')::timestamptz
       not between statement_timestamp()-interval '2 minutes'
         and statement_timestamp()+interval '30 seconds'
     or coalesce(v_destination,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,99}$'
     or coalesce(v_artifact_sha,'') !~ '^[0-9a-f]{64}$'
     or v_size is null
     or v_size not between 1 and 1099511627776
     or nullif(v_artifact->>'content_type','') is null
     or length(v_artifact->>'content_type') not between 3 and 200
     or coalesce(v_artifact->>'content_type','')
       !~ '^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,99}/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,99}$'
     or v_retained_until is null
     or v_retained_until<statement_timestamp()+interval '90 days'
     or v_retained_until>statement_timestamp()+interval '10 years' then
    raise exception 'Phase 40 package manifest binding failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase40-package:'||p_idempotency_key,0));
  select * into v_existing from public.os_snapshot_export_packages
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.package_sha256<>p_package_sha256
       or v_existing.package_signature<>p_package_signature
       or v_existing.signature_key_id<>p_signature_key_id then
      return jsonb_build_object('ok',false,'replayed',true,
        'replay_conflict',true,'package_id',v_existing.package_id);
    end if;
    return jsonb_build_object('ok',true,'replayed',true,
      'package_id',v_existing.package_id,
      'package_sha256',v_existing.package_sha256,
      'package_signature',v_existing.package_signature);
  end if;
  insert into public.os_snapshot_export_packages(
    package_id,entity_id,phase39_manifest_id,idempotency_key,
    canonical_package,canonical_package_text,package_sha256,
    signature_algorithm,signature_key_id,package_signature,destination_key,
    artifact_sha256,artifact_size_bytes,retained_until,created_by
  ) values (
    p_package_id,p_entity_id,p_phase39_manifest_id,p_idempotency_key,
    p_canonical_package,p_canonical_package_text,p_package_sha256,
    p_signature_algorithm,p_signature_key_id,p_package_signature,v_destination,
    v_artifact_sha,v_size,v_retained_until,p_actor_id);
  return jsonb_build_object('ok',true,'replayed',false,
    'package_id',p_package_id,'package_sha256',p_package_sha256,
    'package_signature',p_package_signature,'signature_key_id',p_signature_key_id);
end $$;

create or replace function public.record_snapshot_retention_check_v1(
  p_package_id uuid,p_orchestration_id uuid,p_status text,p_checked_at timestamptz,
  p_observed_sha256 text,p_observed_size_bytes bigint,p_http_status integer,
  p_error_code text,p_evidence_sha256 text,p_detail jsonb
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_package public.os_snapshot_export_packages%rowtype;v_check_id uuid;
begin
  select * into v_package from public.os_snapshot_export_packages
    where package_id=p_package_id;
  if not found
     or p_status not in ('verified','unavailable','missing','hash_mismatch','expired')
     or p_checked_at<now()-interval '10 minutes'
     or p_checked_at>now()+interval '2 minutes'
     or (p_observed_sha256 is not null
       and p_observed_sha256 !~ '^[0-9a-f]{64}$')
     or (p_observed_size_bytes is not null
       and p_observed_size_bytes not between 0 and 1099511627776)
     or (p_http_status is not null and p_http_status not between 100 and 599)
     or p_evidence_sha256 !~ '^[0-9a-f]{64}$'
     or not public.phase40_safe_detail(p_detail)
     or (p_status='verified' and (
       p_observed_sha256 is distinct from v_package.artifact_sha256
       or p_observed_size_bytes is distinct from v_package.artifact_size_bytes
       or v_package.retained_until<=p_checked_at))
     or (p_status='hash_mismatch'
       and p_observed_sha256 is not distinct from v_package.artifact_sha256
       and p_observed_size_bytes is not distinct from v_package.artifact_size_bytes)
     or (p_status='expired' and v_package.retained_until>p_checked_at) then
    raise exception 'Phase 40 retention evidence validation failed';
  end if;
  if p_orchestration_id is not null and not exists (
    select 1 from public.os_snapshot_phase40_orchestrations o
    where o.orchestration_id=p_orchestration_id
      and o.package_id=p_package_id
  ) then raise exception 'Retention orchestration/package mismatch'; end if;
  insert into public.os_snapshot_retention_checks(
    package_id,orchestration_id,destination_key,status,checked_at,
    expected_sha256,observed_sha256,expected_size_bytes,observed_size_bytes,
    retained_until,http_status,evidence_sha256,error_code,detail
  ) values (
    p_package_id,p_orchestration_id,v_package.destination_key,p_status,p_checked_at,
    v_package.artifact_sha256,p_observed_sha256,v_package.artifact_size_bytes,
    p_observed_size_bytes,v_package.retained_until,p_http_status,p_evidence_sha256,
    left(nullif(trim(p_error_code),''),100),p_detail
  ) returning check_id into v_check_id;
  return jsonb_build_object('ok',true,'check_id',v_check_id,
    'status',p_status,'evidence_sha256',p_evidence_sha256);
end $$;

create or replace function public.schedule_snapshot_phase40_canary_v1(
  p_actor_id uuid,p_entity_id text,p_package_id uuid,p_idempotency_key text,
  p_scheduled_for timestamptz,p_duration_minutes integer,
  p_step_interval_minutes integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_definition public.os_snapshot_phase40_canary_definitions%rowtype;
  v_package public.os_snapshot_export_packages%rowtype;
  v_existing public.os_snapshot_phase40_orchestrations%rowtype;
  v_run public.os_snapshot_phase40_orchestrations%rowtype;v_expected integer;
begin
  select * into v_definition from public.os_snapshot_phase40_canary_definitions
    where definition_id='phase40-retention-soak-v1' and active;
  select * into v_package from public.os_snapshot_export_packages
    where package_id=p_package_id;
  v_expected:=ceil(p_duration_minutes::numeric/p_step_interval_minutes)::integer+1;
  if not public.phase40_snapshot_actor_authorized(p_actor_id,p_entity_id)
     or v_package.package_id is null
     or v_package.entity_id is distinct from p_entity_id
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or p_scheduled_for<now()-interval '2 minutes'
     or p_scheduled_for>now()+interval '30 days'
     or p_duration_minutes not between v_definition.min_duration_minutes
       and v_definition.max_duration_minutes
     or p_step_interval_minutes not between
       v_definition.min_step_interval_minutes
       and v_definition.max_step_interval_minutes
     or v_package.retained_until<
       p_scheduled_for+make_interval(mins=>p_duration_minutes)
         +make_interval(mins=>greatest(30,p_step_interval_minutes*2))
     or v_expected>v_definition.max_steps then
    raise exception 'Phase 40 canary authorization or schedule bounds failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase40-schedule:'||p_idempotency_key,0));
  select * into v_existing from public.os_snapshot_phase40_orchestrations
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.package_id<>p_package_id
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.requested_by<>p_actor_id
       or v_existing.scheduled_for<>p_scheduled_for
       or v_existing.step_interval_minutes<>p_step_interval_minutes
       or v_existing.expected_step_count<>v_expected then
      return jsonb_build_object('ok',false,'replayed',true,
        'replay_conflict',true,'orchestration_id',v_existing.orchestration_id);
    end if;
    insert into public.os_snapshot_phase40_events(
      orchestration_id,event_type,actor_id,detail
    ) values (v_existing.orchestration_id,'exact_replay',p_actor_id,
      jsonb_build_object('status',v_existing.status));
    return jsonb_build_object('ok',true,'replayed',true,
      'orchestration_id',v_existing.orchestration_id,
      'status',v_existing.status,'expected_step_count',v_existing.expected_step_count);
  end if;
  insert into public.os_snapshot_phase40_orchestrations(
    definition_id,package_id,entity_id,idempotency_key,requested_by,
    scheduled_for,deadline_at,expires_at,next_step_at,step_interval_minutes,
    expected_step_count
  ) values (
    v_definition.definition_id,p_package_id,p_entity_id,p_idempotency_key,
    p_actor_id,p_scheduled_for,
    p_scheduled_for+make_interval(mins=>p_duration_minutes),
    p_scheduled_for+make_interval(mins=>p_duration_minutes)
      +make_interval(mins=>greatest(30,p_step_interval_minutes*2)),
    p_scheduled_for,p_step_interval_minutes,v_expected
  ) returning * into v_run;
  insert into public.os_snapshot_phase40_events(
    orchestration_id,event_type,actor_id,detail
  ) values (v_run.orchestration_id,'scheduled',p_actor_id,
    jsonb_build_object('scheduled_for',v_run.scheduled_for,
      'deadline_at',v_run.deadline_at,'expires_at',v_run.expires_at,
      'expected_step_count',v_expected));
  return jsonb_build_object('ok',true,'replayed',false,
    'orchestration_id',v_run.orchestration_id,'status',v_run.status,
    'expected_step_count',v_expected,'next_step_at',v_run.next_step_at);
end $$;

create or replace function public.expire_snapshot_phase40_canaries_v1()
returns integer language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_phase40_orchestrations%rowtype;v_count integer:=0;
begin
  for v_run in select * from public.os_snapshot_phase40_orchestrations
    where status in ('scheduled','running') and expires_at<=now()
    for update skip locked
  loop
    update public.os_snapshot_phase40_orchestrations set
      status='expired',completed_at=now(),abort_reason='orchestration_expired',
      lease_token_sha256=null,lease_expires_at=null
    where orchestration_id=v_run.orchestration_id;
    insert into public.os_snapshot_phase40_events(
      orchestration_id,event_type,actor_id,lease_generation,detail
    ) values (v_run.orchestration_id,'expired',v_run.requested_by,
      v_run.lease_generation,'{"reason":"orchestration_expired"}'::jsonb);
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.claim_snapshot_phase40_canaries_v1(
  p_lease_token text,p_limit integer
) returns setof public.os_snapshot_phase40_orchestrations
language plpgsql security definer set search_path=public as $$
declare v_definition public.os_snapshot_phase40_canary_definitions%rowtype;
  v_active integer;v_capacity integer;v_run record;
begin
  if p_lease_token !~ '^[0-9a-f]{64}$' or p_limit not between 1 and 4 then
    raise exception 'Phase 40 claim bounds failed';
  end if;
  perform public.expire_snapshot_phase40_canaries_v1();
  select * into v_definition from public.os_snapshot_phase40_canary_definitions
    where definition_id='phase40-retention-soak-v1' and active;
  perform pg_advisory_xact_lock(hashtextextended('phase40-global-claim',0));
  select count(*) into v_active
  from public.os_snapshot_phase40_orchestrations
  where status='running' and lease_expires_at>now();
  v_capacity:=least(p_limit,greatest(0,v_definition.max_active_runs-v_active));
  if v_capacity=0 then return; end if;
  for v_run in
    select orchestration_id,status,lease_generation
    from public.os_snapshot_phase40_orchestrations
    where status in ('scheduled','running')
      and scheduled_for<=now() and next_step_at<=now() and expires_at>now()
      and (lease_expires_at is null or lease_expires_at<=now())
    order by next_step_at,created_at for update skip locked limit v_capacity
  loop
    update public.os_snapshot_phase40_orchestrations set
      status='running',started_at=coalesce(started_at,now()),
      lease_token_sha256=public.os_sha256_hex(p_lease_token),
      lease_generation=lease_generation+1,
      lease_expires_at=now()+interval '5 minutes',heartbeat_at=now()
    where orchestration_id=v_run.orchestration_id;
    insert into public.os_snapshot_phase40_events(
      orchestration_id,event_type,actor_id,lease_generation,detail
    ) select orchestration_id,
      case when v_run.status='scheduled' then 'lease_acquired' else 'resumed' end,
      requested_by,lease_generation,
      jsonb_build_object('lease_expires_at',lease_expires_at)
    from public.os_snapshot_phase40_orchestrations
    where orchestration_id=v_run.orchestration_id;
    return query select * from public.os_snapshot_phase40_orchestrations
      where orchestration_id=v_run.orchestration_id;
  end loop;
end $$;

create or replace function public.heartbeat_snapshot_phase40_canary_v1(
  p_orchestration_id uuid,p_lease_token text,p_lease_generation bigint
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_phase40_orchestrations%rowtype;
begin
  update public.os_snapshot_phase40_orchestrations set
    heartbeat_at=now(),lease_expires_at=now()+interval '5 minutes'
  where orchestration_id=p_orchestration_id and status='running'
    and lease_generation=p_lease_generation
    and lease_token_sha256=public.os_sha256_hex(p_lease_token)
    and lease_expires_at>now() and expires_at>now()
  returning * into v_run;
  if not found then raise exception 'Phase 40 heartbeat lease or fence mismatch'; end if;
  insert into public.os_snapshot_phase40_events(
    orchestration_id,event_type,actor_id,lease_generation,detail
  ) values (p_orchestration_id,'heartbeat',v_run.requested_by,p_lease_generation,
    jsonb_build_object('lease_expires_at',v_run.lease_expires_at));
  return jsonb_build_object('ok',true,'lease_expires_at',v_run.lease_expires_at);
end $$;

create or replace function public.record_snapshot_phase40_step_v1(
  p_orchestration_id uuid,p_lease_token text,p_lease_generation bigint,
  p_retention_check_id uuid
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_phase40_orchestrations%rowtype;
  v_check public.os_snapshot_retention_checks%rowtype;v_ordinal integer;
  v_terminal text;v_passed boolean;
begin
  select * into v_run from public.os_snapshot_phase40_orchestrations
    where orchestration_id=p_orchestration_id for update;
  if not found or v_run.status<>'running'
     or v_run.lease_generation<>p_lease_generation
     or v_run.lease_token_sha256<>public.os_sha256_hex(p_lease_token)
     or v_run.lease_expires_at<=now() or v_run.expires_at<=now() then
    raise exception 'Phase 40 step lease, fence, or expiry mismatch';
  end if;
  select * into v_check from public.os_snapshot_retention_checks
    where check_id=p_retention_check_id
      and package_id=v_run.package_id
      and orchestration_id=p_orchestration_id;
  if not found then raise exception 'Phase 40 retention check mismatch'; end if;
  v_ordinal:=v_run.completed_step_count+1;
  if exists (select 1 from public.os_snapshot_phase40_orchestration_steps
      where orchestration_id=p_orchestration_id and step_ordinal=v_ordinal) then
    raise exception 'Phase 40 step ordinal already recorded';
  end if;
  v_passed:=v_check.status='verified';
  insert into public.os_snapshot_phase40_orchestration_steps(
    orchestration_id,step_ordinal,lease_generation,scheduled_at,started_at,
    completed_at,retention_check_id,retention_status,evidence_sha256,passed
  ) values (
    p_orchestration_id,v_ordinal,p_lease_generation,v_run.next_step_at,
    coalesce(v_run.heartbeat_at,now()),now(),p_retention_check_id,
    v_check.status,v_check.evidence_sha256,v_passed);
  v_terminal:=case
    when v_check.status in ('missing','hash_mismatch','expired') then 'failed'
    when v_passed and now()>=v_run.deadline_at
      and v_ordinal>=v_run.expected_step_count then 'passed'
    when v_ordinal>=v_run.expected_step_count then 'failed'
    else null end;
  update public.os_snapshot_phase40_orchestrations set
    completed_step_count=v_ordinal,latest_evidence_sha256=v_check.evidence_sha256,
    status=coalesce(v_terminal,'running'),
    completed_at=case when v_terminal is not null then now() else null end,
    abort_reason=case
      when v_terminal='failed' then
        case when not v_passed then 'retention_'||v_check.status
          else 'schedule_completed_before_deadline' end
      else null end,
    next_step_at=case when v_terminal is null then
      least(deadline_at,next_step_at+make_interval(mins=>step_interval_minutes))
      else next_step_at end,
    lease_token_sha256=null,lease_expires_at=null
  where orchestration_id=p_orchestration_id;
  insert into public.os_snapshot_phase40_events(
    orchestration_id,event_type,actor_id,lease_generation,detail
  ) values (p_orchestration_id,'step_recorded',v_run.requested_by,
    p_lease_generation,jsonb_build_object('step_ordinal',v_ordinal,
      'retention_status',v_check.status,'evidence_sha256',v_check.evidence_sha256));
  if v_terminal is not null then
    insert into public.os_snapshot_phase40_events(
      orchestration_id,event_type,actor_id,lease_generation,detail
    ) values (p_orchestration_id,v_terminal,v_run.requested_by,
      p_lease_generation,jsonb_build_object('step_ordinal',v_ordinal,
        'retention_status',v_check.status,'qualification_eligible',false,
        'attestation_eligible',false));
  end if;
  return jsonb_build_object('ok',true,'orchestration_id',p_orchestration_id,
    'status',coalesce(v_terminal,'running'),'step_ordinal',v_ordinal,
    'next_step_at',(select next_step_at
      from public.os_snapshot_phase40_orchestrations
      where orchestration_id=p_orchestration_id),
    'qualification_eligible',false,'attestation_eligible',false);
end $$;

create or replace function public.abort_snapshot_phase40_canary_v1(
  p_actor_id uuid,p_orchestration_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_phase40_orchestrations%rowtype;
begin
  select * into v_run from public.os_snapshot_phase40_orchestrations
    where orchestration_id=p_orchestration_id for update;
  if not found or not public.phase40_snapshot_actor_authorized(
      p_actor_id,v_run.entity_id)
     or v_run.status not in ('scheduled','running')
     or length(trim(coalesce(p_reason,''))) not between 8 and 500 then
    raise exception 'Phase 40 abort authorization, state, or reason failed';
  end if;
  update public.os_snapshot_phase40_orchestrations set
    status='aborted',completed_at=now(),abort_reason=trim(p_reason),
    lease_token_sha256=null,lease_expires_at=null
  where orchestration_id=p_orchestration_id;
  insert into public.os_snapshot_phase40_events(
    orchestration_id,event_type,actor_id,lease_generation,detail
  ) values (p_orchestration_id,'aborted',p_actor_id,v_run.lease_generation,
    jsonb_build_object('reason',trim(p_reason)));
  return jsonb_build_object('ok',true,'orchestration_id',p_orchestration_id,
    'status','aborted','qualification_eligible',false,
    'attestation_eligible',false);
end $$;

create or replace view public.os_snapshot_phase40_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_export_packages
    where created_at>=now()-interval '30 days') as packages_30d,
  (select count(*) from public.os_snapshot_retention_checks
    where status='verified'
      and checked_at>=now()-interval '30 days') as retention_verified_30d,
  (select count(*) from public.os_snapshot_retention_checks
    where status in ('missing','hash_mismatch','expired')
      and checked_at>=now()-interval '30 days') as retention_failures_30d,
  (select count(*) from public.os_snapshot_retention_checks
    where status='unavailable'
      and checked_at>=now()-interval '30 days') as retention_unavailable_30d,
  (select count(*) from public.os_snapshot_phase40_orchestrations
    where status='passed'
      and created_at>=now()-interval '30 days') as canaries_passed_30d,
  (select count(*) from public.os_snapshot_phase40_orchestrations
    where status in ('failed','expired')
      and created_at>=now()-interval '30 days') as canaries_failed_30d,
  (select count(*) from public.os_snapshot_phase40_orchestrations
    where status in ('scheduled','running')) as canaries_active,
  (select max(checked_at) from public.os_snapshot_retention_checks)
    as last_retention_check_at,
  (select max(completed_at) from public.os_snapshot_phase40_orchestrations
    where status='passed') as last_canary_passed_at,
  false as qualification_eligible,
  false as attestation_eligible,
  'synthetic_nonqualifying'::text as evidence_class;

alter table public.os_snapshot_export_packages enable row level security;
alter table public.os_snapshot_retention_checks enable row level security;
alter table public.os_snapshot_phase40_canary_definitions enable row level security;
alter table public.os_snapshot_phase40_orchestrations enable row level security;
alter table public.os_snapshot_phase40_orchestration_steps enable row level security;
alter table public.os_snapshot_phase40_events enable row level security;
drop policy if exists "os_snapshot_export_package_select"
  on public.os_snapshot_export_packages;
create policy "os_snapshot_export_package_select"
  on public.os_snapshot_export_packages for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_retention_check_select"
  on public.os_snapshot_retention_checks;
create policy "os_snapshot_retention_check_select"
  on public.os_snapshot_retention_checks for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase40_definition_select"
  on public.os_snapshot_phase40_canary_definitions;
create policy "os_snapshot_phase40_definition_select"
  on public.os_snapshot_phase40_canary_definitions for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase40_orchestration_select"
  on public.os_snapshot_phase40_orchestrations;
create policy "os_snapshot_phase40_orchestration_select"
  on public.os_snapshot_phase40_orchestrations for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase40_step_select"
  on public.os_snapshot_phase40_orchestration_steps;
create policy "os_snapshot_phase40_step_select"
  on public.os_snapshot_phase40_orchestration_steps for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_phase40_event_select"
  on public.os_snapshot_phase40_events;
create policy "os_snapshot_phase40_event_select"
  on public.os_snapshot_phase40_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_export_packages,
  public.os_snapshot_retention_checks,
  public.os_snapshot_phase40_canary_definitions,
  public.os_snapshot_phase40_orchestrations,
  public.os_snapshot_phase40_orchestration_steps,
  public.os_snapshot_phase40_events,
  public.os_snapshot_phase40_slo to authenticated;
revoke insert,update,delete,truncate on
  public.os_snapshot_export_packages,
  public.os_snapshot_retention_checks,
  public.os_snapshot_phase40_canary_definitions,
  public.os_snapshot_phase40_orchestrations,
  public.os_snapshot_phase40_orchestration_steps,
  public.os_snapshot_phase40_events
  from public,authenticated,service_role;
revoke all on function public.prevent_phase40_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.phase40_snapshot_actor_authorized(uuid,text)
  from public,authenticated,service_role;
revoke all on function public.phase40_safe_detail(jsonb)
  from public,authenticated,service_role;
revoke all on function public.create_snapshot_export_package_v1(
  uuid,uuid,text,uuid,text,jsonb,text,text,text,text,text)
  from public,authenticated;
revoke all on function public.record_snapshot_retention_check_v1(
  uuid,uuid,text,timestamptz,text,bigint,integer,text,text,jsonb)
  from public,authenticated;
revoke all on function public.schedule_snapshot_phase40_canary_v1(
  uuid,text,uuid,text,timestamptz,integer,integer)
  from public,authenticated;
revoke all on function public.expire_snapshot_phase40_canaries_v1()
  from public,authenticated;
revoke all on function public.claim_snapshot_phase40_canaries_v1(text,integer)
  from public,authenticated;
revoke all on function public.heartbeat_snapshot_phase40_canary_v1(
  uuid,text,bigint) from public,authenticated;
revoke all on function public.record_snapshot_phase40_step_v1(
  uuid,text,bigint,uuid) from public,authenticated;
revoke all on function public.abort_snapshot_phase40_canary_v1(uuid,uuid,text)
  from public,authenticated;
grant execute on function public.create_snapshot_export_package_v1(
  uuid,uuid,text,uuid,text,jsonb,text,text,text,text,text) to service_role;
grant execute on function public.record_snapshot_retention_check_v1(
  uuid,uuid,text,timestamptz,text,bigint,integer,text,text,jsonb) to service_role;
grant execute on function public.schedule_snapshot_phase40_canary_v1(
  uuid,text,uuid,text,timestamptz,integer,integer) to service_role;
grant execute on function public.expire_snapshot_phase40_canaries_v1()
  to service_role;
grant execute on function public.claim_snapshot_phase40_canaries_v1(text,integer)
  to service_role;
grant execute on function public.heartbeat_snapshot_phase40_canary_v1(
  uuid,text,bigint) to service_role;
grant execute on function public.record_snapshot_phase40_step_v1(
  uuid,text,bigint,uuid) to service_role;
grant execute on function public.abort_snapshot_phase40_canary_v1(uuid,uuid,text)
  to service_role;
