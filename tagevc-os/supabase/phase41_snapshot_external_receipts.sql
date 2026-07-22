-- Phase 41: externally verifiable signed export receipts (ed25519) and
-- warm|cold retention tiers. Snapshot packages remain non-qualifying.
-- NEVER mutates os_store_snapshots.
-- Apply after phase40_snapshot_retirement.sql.

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

alter table public.os_snapshot_export_packages
  add column if not exists retention_tier text;
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='os_snapshot_export_packages'
      and column_name='retention_tier'
      and is_nullable='YES'
  ) then
    -- Packages are statement-immutable; briefly disable only the package
    -- trigger so the one-time warm backfill can land, then restore it.
    alter table public.os_snapshot_export_packages
      disable trigger os_snapshot_export_packages_immutable;
    update public.os_snapshot_export_packages
      set retention_tier='warm'
    where retention_tier is null;
    alter table public.os_snapshot_export_packages
      alter column retention_tier set default 'warm';
    alter table public.os_snapshot_export_packages
      alter column retention_tier set not null;
    alter table public.os_snapshot_export_packages
      enable trigger os_snapshot_export_packages_immutable;
  end if;
end $$;
do $$ begin
  alter table public.os_snapshot_export_packages
    add constraint os_snapshot_export_package_tier_check
    check (retention_tier in ('warm','cold'));
exception when duplicate_object then null; end $$;

create table if not exists public.os_snapshot_external_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  package_id uuid not null
    references public.os_snapshot_export_packages(package_id),
  idempotency_key text not null unique,
  contract_version text not null default 'phase41-v1',
  retention_tier text not null,
  canonical_receipt jsonb not null,
  canonical_receipt_text text not null,
  receipt_sha256 text not null,
  signature_algorithm text not null,
  verify_key_id text not null,
  verify_public_key_spki_sha256 text not null,
  receipt_signature text not null,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_external_receipt_contract_check
    check (contract_version='phase41-v1'),
  constraint os_snapshot_external_receipt_tier_check
    check (retention_tier in ('warm','cold')),
  constraint os_snapshot_external_receipt_hash_check
    check (receipt_sha256 ~ '^[0-9a-f]{64}$'
      and verify_public_key_spki_sha256 ~ '^[0-9a-f]{64}$'
      and receipt_signature ~ '^[0-9a-f]{128}$'),
  constraint os_snapshot_external_receipt_signature_check
    check (signature_algorithm='ed25519'
      and verify_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_snapshot_external_receipt_idempotency_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_snapshot_external_receipt_detail_check
    check (jsonb_typeof(canonical_receipt)='object'
      and pg_column_size(canonical_receipt)<=8192
      and length(canonical_receipt_text) between 2 and 16384),
  constraint os_snapshot_external_receipt_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create index if not exists os_snapshot_external_receipt_package_idx
  on public.os_snapshot_external_receipts(package_id,created_at desc);
create index if not exists os_snapshot_external_receipt_tier_idx
  on public.os_snapshot_external_receipts(retention_tier,created_at desc);

create table if not exists public.os_snapshot_external_receipt_events (
  event_id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null
    references public.os_snapshot_external_receipts(receipt_id),
  event_type text not null
    check (event_type in ('created','replayed','verify_metadata_recorded')),
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_external_receipt_event_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_snapshot_external_receipt_event_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);

create or replace function public.prevent_phase41_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_external_receipts_immutable
  on public.os_snapshot_external_receipts;
create trigger os_snapshot_external_receipts_immutable
  before update or delete or truncate
  on public.os_snapshot_external_receipts for each statement
  execute function public.prevent_phase41_snapshot_immutable_change();
drop trigger if exists os_snapshot_external_receipt_events_immutable
  on public.os_snapshot_external_receipt_events;
create trigger os_snapshot_external_receipt_events_immutable
  before update or delete or truncate
  on public.os_snapshot_external_receipt_events for each statement
  execute function public.prevent_phase41_snapshot_immutable_change();

create or replace function public.phase41_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=8192
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- Packages are append-only/immutable after insert. Phase 41 binds retention_tier
-- at package creation by replacing the Phase 40 create RPC (same signature plus
-- tier read from canonical artifact.retention_tier).
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
  v_tier text;
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
  v_tier:=coalesce(nullif(v_artifact->>'retention_tier',''),'warm');
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
     or v_tier not in ('warm','cold')
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
     or v_retained_until>statement_timestamp()+interval '10 years'
     or (v_tier='cold'
       and v_retained_until<statement_timestamp()+interval '365 days') then
    raise exception 'Phase 40 package manifest binding failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase40-package:'||p_idempotency_key,0));
  select * into v_existing from public.os_snapshot_export_packages
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.package_sha256<>p_package_sha256
       or v_existing.package_signature<>p_package_signature
       or v_existing.signature_key_id<>p_signature_key_id
       or v_existing.retention_tier<>v_tier then
      return jsonb_build_object('ok',false,'replayed',true,
        'replay_conflict',true,'package_id',v_existing.package_id);
    end if;
    return jsonb_build_object('ok',true,'replayed',true,
      'package_id',v_existing.package_id,
      'package_sha256',v_existing.package_sha256,
      'package_signature',v_existing.package_signature,
      'retention_tier',v_existing.retention_tier,
      'qualification_eligible',false);
  end if;
  insert into public.os_snapshot_export_packages(
    package_id,entity_id,phase39_manifest_id,idempotency_key,
    canonical_package,canonical_package_text,package_sha256,
    signature_algorithm,signature_key_id,package_signature,destination_key,
    artifact_sha256,artifact_size_bytes,retained_until,created_by,
    retention_tier,qualification_eligible,attestation_eligible,
    production_relation_mutated
  ) values (
    p_package_id,p_entity_id,p_phase39_manifest_id,p_idempotency_key,
    p_canonical_package,p_canonical_package_text,p_package_sha256,
    p_signature_algorithm,p_signature_key_id,p_package_signature,v_destination,
    v_artifact_sha,v_size,v_retained_until,p_actor_id,
    v_tier,false,false,false);
  return jsonb_build_object('ok',true,'replayed',false,
    'package_id',p_package_id,'package_sha256',p_package_sha256,
    'package_signature',p_package_signature,'signature_key_id',p_signature_key_id,
    'retention_tier',v_tier,'qualification_eligible',false,
    'attestation_eligible',false);
end $$;

create or replace function public.create_snapshot_external_receipt_v1(
  p_actor_id uuid,
  p_package_id uuid,
  p_idempotency_key text,
  p_canonical_receipt jsonb,
  p_canonical_receipt_text text,
  p_receipt_sha256 text,
  p_signature_algorithm text,
  p_verify_key_id text,
  p_verify_public_key_spki_sha256 text,
  p_receipt_signature text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_package public.os_snapshot_export_packages%rowtype;
  v_existing public.os_snapshot_external_receipts%rowtype;
  v_receipt_id uuid;
  v_tier text;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or p_signature_algorithm is distinct from 'ed25519'
     or coalesce(p_verify_key_id,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or coalesce(p_receipt_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_verify_public_key_spki_sha256,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_receipt_signature,'') !~ '^[0-9a-f]{128}$'
     or length(coalesce(p_canonical_receipt_text,'')) not between 2 and 16384
     or p_canonical_receipt_text::jsonb is distinct from p_canonical_receipt
     or public.os_sha256_hex(p_canonical_receipt_text)<>p_receipt_sha256
     or not public.phase41_snapshot_safe_detail(p_canonical_receipt)
  then
    raise exception 'Phase 41 external receipt authorization or digest failed';
  end if;

  select * into v_package from public.os_snapshot_export_packages
    where package_id=p_package_id for update;
  if not found then
    raise exception 'Export package was not found';
  end if;
  if v_package.qualification_eligible
     or v_package.attestation_eligible
     or v_package.production_relation_mutated then
    raise exception 'Receipts cannot qualify soak or attestation';
  end if;

  v_tier:=v_package.retention_tier;
  if p_canonical_receipt->>'contract_version' is distinct from 'phase41-v1'
     or p_canonical_receipt->>'package_id' is distinct from p_package_id::text
     or p_canonical_receipt->>'package_sha256'
       is distinct from v_package.package_sha256
     or p_canonical_receipt->>'artifact_sha256'
       is distinct from v_package.artifact_sha256
     or p_canonical_receipt->>'destination_key'
       is distinct from v_package.destination_key
     or p_canonical_receipt->>'retention_tier' is distinct from v_tier
     or p_canonical_receipt->>'idempotency_key' is distinct from p_idempotency_key
     or p_canonical_receipt->>'verify_key_id' is distinct from p_verify_key_id
     or p_canonical_receipt->>'verify_public_key_spki_sha256'
       is distinct from p_verify_public_key_spki_sha256
     or coalesce((p_canonical_receipt#>>'{governance,qualification_eligible}')::boolean,true)
     or coalesce((p_canonical_receipt#>>'{governance,attestation_eligible}')::boolean,true)
     or coalesce((p_canonical_receipt#>>'{governance,production_relation_mutated}')::boolean,true)
  then
    raise exception 'Phase 41 external receipt package binding failed';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase41-external-receipt:'||p_idempotency_key,0));

  select * into v_existing from public.os_snapshot_external_receipts
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.package_id<>p_package_id
       or v_existing.receipt_sha256<>p_receipt_sha256
       or v_existing.receipt_signature<>p_receipt_signature
       or v_existing.verify_key_id<>p_verify_key_id then
      return jsonb_build_object(
        'ok',false,'replayed',true,'replay_conflict',true,
        'receipt_id',v_existing.receipt_id,
        'qualification_eligible',false
      );
    end if;
    insert into public.os_snapshot_external_receipt_events(
      receipt_id,event_type,actor_id,detail
    ) values (
      v_existing.receipt_id,'replayed',p_actor_id,
      jsonb_build_object('retention_tier',v_existing.retention_tier)
    );
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'receipt_id',v_existing.receipt_id,
      'receipt_sha256',v_existing.receipt_sha256,
      'verify_key_id',v_existing.verify_key_id,
      'retention_tier',v_existing.retention_tier,
      'qualification_eligible',false,
      'attestation_eligible',false
    );
  end if;

  insert into public.os_snapshot_external_receipts(
    package_id,idempotency_key,retention_tier,canonical_receipt,
    canonical_receipt_text,receipt_sha256,signature_algorithm,verify_key_id,
    verify_public_key_spki_sha256,receipt_signature,created_by,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_package_id,p_idempotency_key,v_tier,p_canonical_receipt,
    p_canonical_receipt_text,p_receipt_sha256,'ed25519',p_verify_key_id,
    p_verify_public_key_spki_sha256,p_receipt_signature,p_actor_id,
    false,false,false
  ) returning receipt_id into v_receipt_id;

  insert into public.os_snapshot_external_receipt_events(
    receipt_id,event_type,actor_id,detail
  ) values (
    v_receipt_id,'created',p_actor_id,
    jsonb_build_object(
      'retention_tier',v_tier,
      'verify_key_id',p_verify_key_id,
      'qualification_eligible',false
    )
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'receipt_id',v_receipt_id,
    'package_id',p_package_id,
    'receipt_sha256',p_receipt_sha256,
    'verify_key_id',p_verify_key_id,
    'retention_tier',v_tier,
    'qualification_eligible',false,
    'attestation_eligible',false
  );
end $$;

create or replace view public.os_snapshot_phase41_receipt_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_external_receipts
    where created_at>=now()-interval '30 days') as receipts_30d,
  (select count(*) from public.os_snapshot_external_receipts
    where retention_tier='cold'
      and created_at>=now()-interval '30 days') as cold_receipts_30d,
  (select count(*) from public.os_snapshot_external_receipts
    where retention_tier='warm'
      and created_at>=now()-interval '30 days') as warm_receipts_30d,
  (select count(*) from public.os_snapshot_export_packages
    where retention_tier='cold') as packages_cold,
  (select count(*) from public.os_snapshot_export_packages
    where retention_tier='warm') as packages_warm,
  (select max(created_at) from public.os_snapshot_external_receipts)
    as last_receipt_at,
  false as qualification_eligible,
  false as attestation_eligible,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase41_receipt_slo()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'receipts_30d',s.receipts_30d,
    'cold_receipts_30d',s.cold_receipts_30d,
    'warm_receipts_30d',s.warm_receipts_30d,
    'packages_cold',s.packages_cold,
    'packages_warm',s.packages_warm,
    'last_receipt_at',s.last_receipt_at,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'evidence_class',s.evidence_class
  )
  from public.os_snapshot_phase41_receipt_slo s;
$$;

alter table public.os_snapshot_external_receipts enable row level security;
alter table public.os_snapshot_external_receipt_events enable row level security;

drop policy if exists "os_snapshot_external_receipt_select"
  on public.os_snapshot_external_receipts;
create policy "os_snapshot_external_receipt_select"
  on public.os_snapshot_external_receipts for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_external_receipt_event_select"
  on public.os_snapshot_external_receipt_events;
create policy "os_snapshot_external_receipt_event_select"
  on public.os_snapshot_external_receipt_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_external_receipts,
  public.os_snapshot_external_receipt_events,
  public.os_snapshot_phase41_receipt_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_external_receipts,
  public.os_snapshot_external_receipt_events
  from public,authenticated,service_role;

-- Package DML remains revoked; inserts/updates only via security definer RPCs.
revoke insert,update,delete,truncate on public.os_snapshot_export_packages
  from public,authenticated,service_role;

revoke all on function public.prevent_phase41_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.create_snapshot_external_receipt_v1(
  uuid,uuid,text,jsonb,text,text,text,text,text,text
) from public,authenticated;
revoke all on function public.get_snapshot_phase41_receipt_slo()
  from public,anon;
revoke all on function public.create_snapshot_export_package_v1(
  uuid,uuid,text,uuid,text,jsonb,text,text,text,text,text
) from public,authenticated;

grant execute on function public.phase41_snapshot_safe_detail(jsonb),
  public.get_snapshot_phase41_receipt_slo()
  to authenticated, service_role;
grant execute on function public.create_snapshot_external_receipt_v1(
    uuid,uuid,text,jsonb,text,text,text,text,text,text
  ),
  public.create_snapshot_export_package_v1(
    uuid,uuid,text,uuid,text,jsonb,text,text,text,text,text
  )
  to service_role;
