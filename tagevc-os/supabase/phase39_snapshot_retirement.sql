-- Phase 39: immutable export manifests and non-qualifying replay/concurrency canaries.
-- Depends on Phase 36 rollback lifecycle, Phase 37 transactional evidence, and
-- Phase 38 canonical evidence cycles. This migration contains no snapshot-store
-- relation DDL or DML; canaries operate only on Phase 39 evidence relations.

create table if not exists public.os_snapshot_export_manifests (
  manifest_id uuid primary key default gen_random_uuid(),
  entity_id text references public.entities(entity_id),
  idempotency_key text not null unique,
  manifest_version bigint not null,
  contract_version text not null default 'phase39-v1',
  lifecycle_status text not null default 'valid',
  valid_from timestamptz not null default now(),
  valid_until timestamptz not null,
  canonical_manifest jsonb not null,
  manifest_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint os_snapshot_export_manifest_contract_check
    check (contract_version='phase39-v1'),
  constraint os_snapshot_export_manifest_lifecycle_check
    check (lifecycle_status='valid'),
  constraint os_snapshot_export_manifest_hash_check
    check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_snapshot_export_manifest_validity_check
    check (valid_until>valid_from and valid_until<=valid_from+interval '90 days'),
  constraint os_snapshot_export_manifest_metadata_check
    check (jsonb_typeof(metadata)='object' and pg_column_size(metadata)<=4096),
  unique(entity_id,manifest_version)
);
create index if not exists os_snapshot_export_manifest_latest_idx
  on public.os_snapshot_export_manifests(entity_id,manifest_version desc);
create unique index if not exists os_snapshot_export_manifest_scope_version
  on public.os_snapshot_export_manifests(
    coalesce(entity_id,'__firm__'),manifest_version);

create table if not exists public.os_snapshot_export_manifest_events (
  event_id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null
    references public.os_snapshot_export_manifests(manifest_id),
  event_type text not null,
  actor_id uuid not null references public.profiles(id),
  manifest_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_export_manifest_event_type_check
    check (event_type in ('created','exact_replay','replay_conflict',
      'validity_observed')),
  constraint os_snapshot_export_manifest_event_hash_check
    check (manifest_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.os_snapshot_export_manifest_events
  drop constraint if exists os_snapshot_export_manifest_event_type_check;
alter table public.os_snapshot_export_manifest_events
  add constraint os_snapshot_export_manifest_event_type_check
    check (event_type in ('created','exact_replay','replay_conflict',
      'validity_observed'));
create index if not exists os_snapshot_export_manifest_event_idx
  on public.os_snapshot_export_manifest_events(manifest_id,occurred_at,event_id);

create table if not exists public.os_snapshot_canary_definitions (
  definition_id text primary key,
  contract_version text not null default 'phase39-v1',
  canary_kind text not null,
  expected_step_count integer not null,
  exact_expected_outcomes jsonb not null,
  max_duration_seconds integer not null,
  max_concurrency integer not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint os_snapshot_canary_definition_kind_check
    check (canary_kind in ('replay','concurrency')),
  constraint os_snapshot_canary_definition_contract_check
    check (contract_version='phase39-v1'),
  constraint os_snapshot_canary_definition_bounds_check
    check (max_duration_seconds between 1 and 300
      and max_concurrency between 1 and 8
      and expected_step_count between 1 and 8)
);
insert into public.os_snapshot_canary_definitions(
  definition_id,canary_kind,expected_step_count,exact_expected_outcomes,
  max_duration_seconds,max_concurrency
) values
  ('phase39-replay-v1','replay',2,
    '{"canonical_first_write":{"accepted":true},"exact_replay":{"replayed":true,"input_matched":true}}',
    300,2),
  ('phase39-concurrency-v1','concurrency',8,
    '{"lease":{"winners":1},"bounds":{"max_concurrency":8},"terminal":{"status":"passed"}}',
    300,8)
on conflict (definition_id) do nothing;
insert into public.os_snapshot_canary_definitions(
  definition_id,canary_kind,expected_step_count,exact_expected_outcomes,
  max_duration_seconds,max_concurrency
) values
  ('phase39-replay-v2','replay',2,
    '{"atomic_probe":{"inserted":1,"exact_replay":1},"canonical_hashes":1,"terminal":{"status":"passed"}}',
    300,2),
  ('phase39-concurrency-v2','concurrency',8,
    '{"atomic_probe":{"inserted":1,"exact_replay":"concurrency_minus_one"},"canonical_hashes":1,"terminal":{"status":"passed"}}',
    300,8)
on conflict (definition_id) do nothing;
do $$
begin
  if exists (
    select 1 from public.os_snapshot_canary_definitions
    where (definition_id='phase39-replay-v1' and (
      canary_kind<>'replay' or expected_step_count<>2
      or max_duration_seconds<>300 or max_concurrency<>2
      or exact_expected_outcomes<>
        '{"canonical_first_write":{"accepted":true},"exact_replay":{"replayed":true,"input_matched":true}}'::jsonb
    )) or (definition_id='phase39-concurrency-v1' and (
      canary_kind<>'concurrency' or expected_step_count<>8
      or max_duration_seconds<>300 or max_concurrency<>8
      or exact_expected_outcomes<>
        '{"lease":{"winners":1},"bounds":{"max_concurrency":8},"terminal":{"status":"passed"}}'::jsonb
    )) or (definition_id='phase39-replay-v2' and (
      canary_kind<>'replay' or expected_step_count<>2
      or max_duration_seconds<>300 or max_concurrency<>2
      or exact_expected_outcomes<>
        '{"atomic_probe":{"inserted":1,"exact_replay":1},"canonical_hashes":1,"terminal":{"status":"passed"}}'::jsonb
    )) or (definition_id='phase39-concurrency-v2' and (
      canary_kind<>'concurrency' or expected_step_count<>8
      or max_duration_seconds<>300 or max_concurrency<>8
      or exact_expected_outcomes<>
        '{"atomic_probe":{"inserted":1,"exact_replay":"concurrency_minus_one"},"canonical_hashes":1,"terminal":{"status":"passed"}}'::jsonb
    ))
  ) then
    raise exception 'Phase 39 canary definition drift requires reconciliation';
  end if;
end $$;

create table if not exists public.os_snapshot_canary_runs (
  run_id uuid primary key default gen_random_uuid(),
  definition_id text not null
    references public.os_snapshot_canary_definitions(definition_id),
  entity_id text references public.entities(entity_id),
  idempotency_key text not null unique,
  requested_by uuid not null references public.profiles(id),
  requested_duration_seconds integer not null,
  requested_concurrency integer not null,
  status text not null default 'leased',
  lease_token_sha256 text not null,
  lease_generation bigint not null default 1,
  lease_expires_at timestamptz not null,
  deadline_at timestamptz not null,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  abort_reason text,
  evidence_sha256 text,
  qualification_eligible boolean not null default false,
  attestation_eligible boolean not null default false,
  production_relation_mutated boolean not null default false,
  constraint os_snapshot_canary_run_status_check
    check (status in ('leased','running','passed','failed','aborted','expired')),
  constraint os_snapshot_canary_run_bounds_check
    check (requested_duration_seconds between 1 and 300
      and requested_concurrency between 1 and 8),
  constraint os_snapshot_canary_run_hash_check
    check (lease_token_sha256 ~ '^[0-9a-f]{64}$'
      and (evidence_sha256 is null or evidence_sha256 ~ '^[0-9a-f]{64}$')),
  constraint os_snapshot_canary_nonqualifying_check
    check (not qualification_eligible and not attestation_eligible
      and not production_relation_mutated)
);
alter table public.os_snapshot_canary_runs
  add column if not exists lease_generation bigint not null default 1;
create index if not exists os_snapshot_canary_run_latest_idx
  on public.os_snapshot_canary_runs(definition_id,started_at desc,run_id desc);

create table if not exists public.os_snapshot_canary_steps (
  step_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_snapshot_canary_runs(run_id),
  step_ordinal integer not null,
  step_name text not null,
  expected jsonb not null,
  observed jsonb not null,
  expected_sha256 text not null,
  observed_sha256 text not null,
  passed boolean not null,
  recorded_at timestamptz not null default now(),
  constraint os_snapshot_canary_step_ordinal_check check (step_ordinal between 1 and 8),
  constraint os_snapshot_canary_step_hash_check check (
    expected_sha256 ~ '^[0-9a-f]{64}$' and observed_sha256 ~ '^[0-9a-f]{64}$'),
  unique(run_id,step_ordinal)
);
create index if not exists os_snapshot_canary_step_run_idx
  on public.os_snapshot_canary_steps(run_id,step_ordinal);

create table if not exists public.os_snapshot_canary_replay_probes (
  probe_key text primary key,
  canonical_sha256 text not null,
  winner_run_id uuid not null references public.os_snapshot_canary_runs(run_id),
  created_at timestamptz not null default now(),
  constraint os_snapshot_canary_probe_hash_check
    check (canonical_sha256 ~ '^[0-9a-f]{64}$')
);

create table if not exists public.os_snapshot_canary_events (
  event_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_snapshot_canary_runs(run_id),
  event_type text not null,
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_canary_event_type_check check (
    event_type in ('lease_acquired','started','step_recorded','exact_replay',
      'replay_conflict','passed','failed','aborted','expired'))
);
alter table public.os_snapshot_canary_events
  drop constraint if exists os_snapshot_canary_event_type_check;
alter table public.os_snapshot_canary_events
  add constraint os_snapshot_canary_event_type_check check (
    event_type in ('lease_acquired','started','step_recorded','exact_replay',
      'replay_conflict','passed','failed','aborted','expired'));
create index if not exists os_snapshot_canary_event_idx
  on public.os_snapshot_canary_events(run_id,occurred_at,event_id);

create or replace function public.prevent_phase39_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;
drop trigger if exists os_snapshot_export_manifest_immutable
  on public.os_snapshot_export_manifests;
create trigger os_snapshot_export_manifest_immutable before update or delete
  on public.os_snapshot_export_manifests for each row
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_export_manifest_events_immutable
  on public.os_snapshot_export_manifest_events;
create trigger os_snapshot_export_manifest_events_immutable before update or delete
  on public.os_snapshot_export_manifest_events for each row
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_steps_immutable
  on public.os_snapshot_canary_steps;
create trigger os_snapshot_canary_steps_immutable before update or delete
  on public.os_snapshot_canary_steps for each row
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_events_immutable
  on public.os_snapshot_canary_events;
create trigger os_snapshot_canary_events_immutable before update or delete
  on public.os_snapshot_canary_events for each row
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_export_manifest_no_truncate
  on public.os_snapshot_export_manifests;
create trigger os_snapshot_export_manifest_no_truncate before truncate
  on public.os_snapshot_export_manifests for each statement
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_export_manifest_events_no_truncate
  on public.os_snapshot_export_manifest_events;
create trigger os_snapshot_export_manifest_events_no_truncate before truncate
  on public.os_snapshot_export_manifest_events for each statement
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_definitions_immutable
  on public.os_snapshot_canary_definitions;
create trigger os_snapshot_canary_definitions_immutable
  before update or delete or truncate on public.os_snapshot_canary_definitions
  for each statement execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_steps_no_truncate
  on public.os_snapshot_canary_steps;
create trigger os_snapshot_canary_steps_no_truncate before truncate
  on public.os_snapshot_canary_steps for each statement
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_events_no_truncate
  on public.os_snapshot_canary_events;
create trigger os_snapshot_canary_events_no_truncate before truncate
  on public.os_snapshot_canary_events for each statement
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_probes_immutable
  on public.os_snapshot_canary_replay_probes;
create trigger os_snapshot_canary_probes_immutable
  before update or delete or truncate on public.os_snapshot_canary_replay_probes
  for each statement execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_runs_no_delete
  on public.os_snapshot_canary_runs;
create trigger os_snapshot_canary_runs_no_delete before delete
  on public.os_snapshot_canary_runs for each row
  execute function public.prevent_phase39_immutable_change();
drop trigger if exists os_snapshot_canary_runs_no_truncate
  on public.os_snapshot_canary_runs;
create trigger os_snapshot_canary_runs_no_truncate before truncate
  on public.os_snapshot_canary_runs for each statement
  execute function public.prevent_phase39_immutable_change();

create or replace function public.phase39_snapshot_actor_authorized(
  p_actor_id uuid,p_entity_id text
) returns boolean language sql stable security definer set search_path=public as $$
  select exists (
    select 1 from public.profiles p
    where p.id=p_actor_id and p.active and p.role in ('visionary','admin')
      and (p_entity_id is null or exists (
        select 1 from public.entities e where e.entity_id=p_entity_id
      ))
  )
$$;

create or replace function public.phase39_metadata_safe(p_metadata jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_metadata)='object'
    and pg_column_size(p_metadata)<=4096
    and p_metadata::text !~* '"[^"]*(payload|secret|token|password|authorization|cookie)[^"]*"\s*:'
    and p_metadata::text !~* '"[[:space:]]*(bearer[[:space:]]+|eyj[a-z0-9_-]*\.)'
    and not exists (
      select 1 from jsonb_object_keys(p_metadata) as metadata_keys(metadata_key)
      where metadata_key not in ('purpose','requested_from','code_revision','ticket_id',
        'note','environment')
    )
    and not exists (
      select 1 from jsonb_each(p_metadata) as metadata_values(metadata_key,metadata_value)
      where jsonb_typeof(metadata_value)<>'string'
        or length(metadata_value#>>'{}')>200
        or metadata_value#>>'{}' ~ '^[[:space:]]*(\{|\[)'
        or metadata_value#>>'{}' ~*
          '(-----BEGIN|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
        or metadata_value#>>'{}' ~ '[-A-Za-z0-9_+/]{80,}={0,2}'
    )
$$;

create or replace function public.phase39_build_snapshot_manifest(
  p_manifest_id uuid,p_manifest_version bigint,p_actor_id uuid,p_entity_id text,
  p_idempotency_key text,p_valid_from timestamptz,p_valid_until timestamptz,
  p_metadata jsonb
) returns jsonb language sql volatile security definer set search_path=public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'contract_version','phase39-v1','manifest_id',p_manifest_id,
    'manifest_version',p_manifest_version,'idempotency_key',p_idempotency_key,
    'created_by',p_actor_id,
    'scope',jsonb_build_object('entity_id',p_entity_id),
    'lifecycle',jsonb_build_object('status','valid','valid_from',p_valid_from,
      'valid_until',p_valid_until,'valid_now',
      statement_timestamp()>=p_valid_from and statement_timestamp()<p_valid_until),
    'evidence_cycles',coalesce((
      select jsonb_agg(jsonb_build_object('cycle_id',cycle_id,
        'canonical_sha256',canonical_sha256,'evidence_sha256',evidence_sha256,
        'status',status,'evidence_valid',evidence_valid,
        'invalidated_at',invalidated_at,'invalidation_reason',invalidation_reason,
        'currently_valid',status='completed' and evidence_valid
          and conflict_count=0 and evidence_sha256 is not null)
        order by observed_at desc,cycle_id desc)
      from (select cycle_id,canonical_sha256,evidence_sha256,status,evidence_valid,
          invalidated_at,invalidation_reason,conflict_count,observed_at
        from public.os_snapshot_evidence_cycles
        order by observed_at desc,cycle_id desc limit 20) c),'[]'::jsonb),
    'drill_runs',coalesce((
      select jsonb_agg(jsonb_build_object('drill_run_id',drill_run_id,
        'evidence_sha256',evidence_sha256,'status',status,
        'evidence_valid',evidence_valid,'invalidated_at',invalidated_at,
        'invalidation_reason',invalidation_reason,'completed_at',completed_at,
        'currently_valid',status='passed' and evidence_valid
          and evidence_sha256 is not null)
        order by started_at desc,drill_run_id desc)
      from (select drill_run_id,evidence_sha256,status,evidence_valid,
          invalidated_at,invalidation_reason,completed_at,started_at
        from public.os_snapshot_drill_runs
        order by started_at desc,drill_run_id desc limit 20) d),'[]'::jsonb),
    'rollback_rehearsals',coalesce((
      select jsonb_agg(jsonb_build_object('drill_run_id',drill_run_id,
        'manifest_sha256',manifest_sha256,
        'evidence_bundle_sha256',evidence_bundle_sha256,'status',status,
        'valid_until',valid_until,'invalidated_at',invalidated_at,
        'invalidation_reason',invalidation_reason,'row_version',row_version,
        'currently_valid',status='attested' and valid_until>statement_timestamp()
          and invalidated_at is null and evidence_bundle_sha256 is not null)
        order by created_at desc,drill_run_id desc)
      from (select drill_run_id,manifest_sha256,evidence_bundle_sha256,status,
          valid_until,invalidated_at,invalidation_reason,row_version,created_at
        from public.os_snapshot_rollback_rehearsals
        order by created_at desc,drill_run_id desc limit 20) r),'[]'::jsonb),
    'soak_epochs',coalesce((
      select jsonb_agg(jsonb_build_object('epoch_id',epoch_id,'status',status,
        'config_fingerprint',config_fingerprint,'qualified_at',qualified_at,
        'last_observed_at',last_observed_at,'currently_valid',status='qualified')
        order by created_at desc,epoch_id desc)
      from (select epoch_id,status,config_fingerprint,qualified_at,
          last_observed_at,created_at from public.os_snapshot_soak_epochs
        order by created_at desc,epoch_id desc limit 10) s),'[]'::jsonb),
    'retirement_events',coalesce((
      select jsonb_agg(jsonb_build_object('event_id',event_id,'stage',stage,
        'retired_table_name',retired_table_name,'occurred_at',occurred_at,
        'is_latest',event_id=(select event_id
          from public.os_snapshot_retirement_events
          order by occurred_at desc,event_id desc limit 1))
        order by occurred_at desc,event_id desc)
      from (select event_id,stage,retired_table_name,occurred_at
        from public.os_snapshot_retirement_events
        order by occurred_at desc,event_id desc limit 20) e),'[]'::jsonb),
    'metadata',p_metadata
  ))
$$;

create or replace function public.create_snapshot_export_manifest_v1(
  p_actor_id uuid,p_entity_id text,p_idempotency_key text,p_metadata jsonb,
  p_valid_until timestamptz
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_existing public.os_snapshot_export_manifests%rowtype;
  v_manifest_id uuid;v_version bigint;v_valid_from timestamptz;
  v_canonical jsonb;v_sha text;v_row record;
begin
  if not public.phase39_snapshot_actor_authorized(p_actor_id,p_entity_id)
     or nullif(trim(p_idempotency_key),'') is null
     or length(p_idempotency_key)>200
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or p_valid_until is null
     or not coalesce(public.phase39_metadata_safe(p_metadata),false) then
    raise exception 'Phase 39 manifest authorization or input validation failed';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase39-manifest:'||coalesce(p_entity_id,'firm'),0));
  select * into v_existing from public.os_snapshot_export_manifests
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.entity_id is distinct from p_entity_id
       or v_existing.created_by<>p_actor_id
       or v_existing.metadata is distinct from p_metadata
       or v_existing.valid_until is distinct from p_valid_until then
      insert into public.os_snapshot_export_manifest_events(
        manifest_id,event_type,actor_id,manifest_sha256,detail
      ) values (v_existing.manifest_id,'replay_conflict',p_actor_id,
        v_existing.manifest_sha256,
        jsonb_build_object('reason','input_mismatch'));
      return jsonb_build_object('ok',false,'manifest_id',v_existing.manifest_id,
        'replayed',true,'replay_conflict',true,'reason','input_mismatch');
    end if;
    v_canonical:=public.phase39_build_snapshot_manifest(
      v_existing.manifest_id,v_existing.manifest_version,p_actor_id,p_entity_id,
      p_idempotency_key,v_existing.valid_from,p_valid_until,p_metadata);
    v_sha:=encode(digest(v_canonical::text,'sha256'),'hex');
    if v_canonical is distinct from v_existing.canonical_manifest
       or v_sha<>v_existing.manifest_sha256 then
      insert into public.os_snapshot_export_manifest_events(
        manifest_id,event_type,actor_id,manifest_sha256,detail
      ) values (v_existing.manifest_id,'replay_conflict',p_actor_id,
        v_existing.manifest_sha256,jsonb_build_object(
          'reason','current_evidence_or_validity_changed',
          'incoming_canonical_sha256',v_sha));
      return jsonb_build_object('ok',false,'manifest_id',v_existing.manifest_id,
        'replayed',true,'replay_conflict',true,
        'reason','current_evidence_or_validity_changed',
        'retained_sha256',v_existing.manifest_sha256,
        'incoming_sha256',v_sha);
    end if;
    insert into public.os_snapshot_export_manifest_events(
      manifest_id,event_type,actor_id,manifest_sha256,detail
    ) values (v_existing.manifest_id,'exact_replay',p_actor_id,
      v_existing.manifest_sha256,'{"input_matched":true,"evidence_current":true}'::jsonb);
    return jsonb_build_object('ok',true,'manifest_id',v_existing.manifest_id,
      'manifest_version',v_existing.manifest_version,
      'manifest_sha256',v_existing.manifest_sha256,
      'valid_until',v_existing.valid_until,'replayed',true,
      'canonical_manifest',v_existing.canonical_manifest);
  end if;
  if p_valid_until<=statement_timestamp()
     or p_valid_until>statement_timestamp()+interval '90 days' then
    raise exception 'Phase 39 manifest validity window is outside policy';
  end if;
  if not exists (
    select 1 from public.os_snapshot_evidence_cycles
      where canonical_sha256 ~ '^[0-9a-f]{64}$'
    union all
    select 1 from public.os_snapshot_drill_runs
      where evidence_sha256 ~ '^[0-9a-f]{64}$'
    union all
    select 1 from public.os_snapshot_rollback_rehearsals
      where evidence_bundle_sha256 ~ '^[0-9a-f]{64}$'
  ) then
    raise exception 'Phase 39 manifest requires hash-bearing snapshot evidence';
  end if;
  select coalesce(max(manifest_version),0)+1 into v_version
  from public.os_snapshot_export_manifests
  where entity_id is not distinct from p_entity_id;
  v_manifest_id:=gen_random_uuid();
  v_valid_from:=statement_timestamp();
  v_canonical:=public.phase39_build_snapshot_manifest(
    v_manifest_id,v_version,p_actor_id,p_entity_id,p_idempotency_key,
    v_valid_from,p_valid_until,p_metadata);
  -- PostgreSQL jsonb text is canonical for object key order; the digest binds
  -- all exported IDs, hashes, lifecycle state, scope, actor, and validity.
  v_sha:=encode(digest(v_canonical::text,'sha256'),'hex');
  insert into public.os_snapshot_export_manifests(
    manifest_id,entity_id,idempotency_key,manifest_version,valid_from,valid_until,
    canonical_manifest,manifest_sha256,metadata,created_by
  ) values (v_manifest_id,p_entity_id,p_idempotency_key,v_version,v_valid_from,
    p_valid_until,v_canonical,v_sha,p_metadata,p_actor_id) returning * into v_row;
  insert into public.os_snapshot_export_manifest_events(
    manifest_id,event_type,actor_id,manifest_sha256,detail
  ) values (v_row.manifest_id,'created',p_actor_id,v_sha,
    jsonb_build_object('manifest_version',v_version,'canonicalized_in_db',true));
  return jsonb_build_object('ok',true,'manifest_id',v_row.manifest_id,
    'manifest_version',v_version,'manifest_sha256',v_sha,
    'valid_until',p_valid_until,'replayed',false,
    'canonical_manifest',v_canonical);
end $$;

create or replace function public.expire_snapshot_canary_runs_v1()
returns integer language plpgsql security definer set search_path=public as $$
declare v_count integer:=0;v_run public.os_snapshot_canary_runs%rowtype;
  v_evidence jsonb;v_sha text;
begin
  for v_run in
    select * from public.os_snapshot_canary_runs
    where status in ('leased','running')
      and (lease_expires_at<=now() or deadline_at<=now())
    for update skip locked
  loop
    v_evidence:=jsonb_build_object('contract_version','phase39-v1',
      'run_id',v_run.run_id,'definition_id',v_run.definition_id,
      'status','expired','reason','lease_or_deadline_expired',
      'lease_generation',v_run.lease_generation,
      'requested_duration_seconds',v_run.requested_duration_seconds,
      'requested_concurrency',v_run.requested_concurrency,
      'started_at',v_run.started_at,'deadline_at',v_run.deadline_at,
      'qualification_eligible',false,'attestation_eligible',false,
      'production_relation_mutated',false,
      'steps',coalesce((select jsonb_agg(jsonb_build_object(
        'ordinal',step_ordinal,'name',step_name,
        'expected_sha256',expected_sha256,'observed_sha256',observed_sha256,
        'passed',passed) order by step_ordinal)
        from public.os_snapshot_canary_steps
        where run_id=v_run.run_id),'[]'::jsonb));
    v_sha:=encode(digest(v_evidence::text,'sha256'),'hex');
    update public.os_snapshot_canary_runs set status='expired',
      completed_at=now(),abort_reason='lease_or_deadline_expired',
      evidence_sha256=v_sha where run_id=v_run.run_id;
    insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
      values(v_run.run_id,'expired',v_run.requested_by,
        jsonb_build_object('reason','lease_or_deadline_expired',
          'evidence_sha256',v_sha,'lease_generation',v_run.lease_generation));
    v_count:=v_count+1;
  end loop;
  return v_count;
end $$;

create or replace function public.begin_snapshot_canary_run_v1(
  p_actor_id uuid,p_entity_id text,p_canary_kind text,p_idempotency_key text,
  p_duration_seconds integer,p_concurrency integer,p_lease_token text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_definition public.os_snapshot_canary_definitions%rowtype;
  v_existing public.os_snapshot_canary_runs%rowtype;v_run record;v_token_sha text;
begin
  perform public.expire_snapshot_canary_runs_v1();
  if not public.phase39_snapshot_actor_authorized(p_actor_id,p_entity_id)
     or p_canary_kind not in ('replay','concurrency')
     or nullif(trim(p_idempotency_key),'') is null or length(p_idempotency_key)>200
     or p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or p_duration_seconds not between 1 and 300
     or p_concurrency not between 1 and 8
     or (p_canary_kind='replay' and p_concurrency<>2)
     or (p_canary_kind='concurrency' and p_concurrency<2)
     or p_lease_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Phase 39 canary authorization or bounds failed';
  end if;
  select * into v_definition from public.os_snapshot_canary_definitions
  where definition_id='phase39-'||p_canary_kind||'-v2' and active;
  if not found or p_duration_seconds>v_definition.max_duration_seconds
     or p_concurrency>v_definition.max_concurrency then
    raise exception 'Canary definition unavailable or requested bounds exceed policy';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase39-canary:'||p_idempotency_key,0));
  select * into v_existing from public.os_snapshot_canary_runs
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.definition_id<>v_definition.definition_id
       or v_existing.entity_id is distinct from p_entity_id
       or v_existing.requested_by<>p_actor_id
       or v_existing.requested_duration_seconds<>p_duration_seconds
       or v_existing.requested_concurrency<>p_concurrency then
      insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
        values(v_existing.run_id,'replay_conflict',p_actor_id,
          '{"reason":"input_mismatch"}'::jsonb);
      return jsonb_build_object('ok',false,'run_id',v_existing.run_id,
        'status',v_existing.status,'replayed',true,'replay_conflict',true,
        'reason','input_mismatch');
    end if;
    insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
      values(v_existing.run_id,'exact_replay',p_actor_id,
        jsonb_build_object('status',v_existing.status));
    return jsonb_build_object('run_id',v_existing.run_id,
      'status',v_existing.status,'evidence_sha256',v_existing.evidence_sha256,
      'lease_generation',v_existing.lease_generation,'replayed',true);
  end if;
  v_token_sha:=encode(digest(p_lease_token,'sha256'),'hex');
  insert into public.os_snapshot_canary_runs(
    definition_id,entity_id,idempotency_key,requested_by,
    requested_duration_seconds,requested_concurrency,status,
    lease_token_sha256,lease_expires_at,deadline_at
  ) values (
    v_definition.definition_id,p_entity_id,p_idempotency_key,p_actor_id,
    p_duration_seconds,p_concurrency,'running',v_token_sha,
    now()+make_interval(secs=>p_duration_seconds),
    now()+make_interval(secs=>p_duration_seconds)
  ) returning * into v_run;
  insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
    values(v_run.run_id,'lease_acquired',p_actor_id,
      jsonb_build_object('lease_expires_at',v_run.lease_expires_at,
        'deadline_at',v_run.deadline_at,'concurrency',p_concurrency));
  return jsonb_build_object('run_id',v_run.run_id,'status','running',
    'deadline_at',v_run.deadline_at,
    'lease_generation',v_run.lease_generation,'replayed',false);
end $$;

drop function if exists public.record_snapshot_canary_step_v1(
  uuid,text,integer,text,jsonb,jsonb,text,text,boolean);
create or replace function public.record_snapshot_canary_step_v1(
  p_run_id uuid,p_lease_token text,p_lease_generation bigint,
  p_step_ordinal integer
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_canary_runs%rowtype;
  v_definition public.os_snapshot_canary_definitions%rowtype;
  v_existing_step public.os_snapshot_canary_steps%rowtype;
  v_probe_key text;v_probe_sha text;v_retained_sha text;v_outcome text;
  v_expected jsonb;v_observed jsonb;v_expected_sha text;v_observed_sha text;
  v_inserted integer;v_passed boolean;
begin
  select * into v_run from public.os_snapshot_canary_runs
    where run_id=p_run_id for key share;
  if not found or v_run.status<>'running'
     or v_run.lease_token_sha256<>encode(digest(p_lease_token,'sha256'),'hex')
     or v_run.lease_generation<>p_lease_generation
     or v_run.lease_expires_at<=now() or v_run.deadline_at<=now()
     or p_step_ordinal not between 1 and v_run.requested_concurrency then
    raise exception 'Canary step lease, fence, deadline, or ordinal mismatch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'phase39-step:'||p_run_id::text||':'||p_step_ordinal::text,0));
  select * into v_existing_step from public.os_snapshot_canary_steps
    where run_id=p_run_id and step_ordinal=p_step_ordinal;
  if found then
    insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
      values(p_run_id,'exact_replay',v_run.requested_by,
        jsonb_build_object('step_ordinal',p_step_ordinal,
          'lease_generation',p_lease_generation));
    return jsonb_build_object('run_id',p_run_id,
      'step_ordinal',p_step_ordinal,'outcome',v_existing_step.observed->>'outcome',
      'passed',v_existing_step.passed,'replayed',true);
  end if;
  select * into v_definition from public.os_snapshot_canary_definitions
    where definition_id=v_run.definition_id;
  v_probe_key:='phase39-atomic-replay:'||p_run_id::text;
  v_probe_sha:=encode(digest(jsonb_build_object(
    'contract_version','phase39-v1','definition_id',v_run.definition_id,
    'run_id',p_run_id,'idempotency_key',v_run.idempotency_key,
    'entity_id',v_run.entity_id)::text,'sha256'),'hex');
  insert into public.os_snapshot_canary_replay_probes(
    probe_key,canonical_sha256,winner_run_id
  ) values (v_probe_key,v_probe_sha,p_run_id)
  on conflict (probe_key) do nothing;
  get diagnostics v_inserted=row_count;
  select canonical_sha256 into v_retained_sha
    from public.os_snapshot_canary_replay_probes where probe_key=v_probe_key;
  if v_retained_sha is distinct from v_probe_sha then
    raise exception 'Atomic replay probe canonical conflict';
  end if;
  v_outcome:=case when v_inserted=1 then 'inserted' else 'exact_replay' end;
  if v_definition.canary_kind='replay' then
    v_expected:=jsonb_build_object('outcome',
      case when p_step_ordinal=1 then 'inserted' else 'exact_replay' end,
      'canonical_sha256',v_probe_sha);
    v_passed:=v_outcome=(v_expected->>'outcome');
  else
    v_expected:=jsonb_build_object(
      'allowed_outcomes',jsonb_build_array('inserted','exact_replay'),
      'canonical_sha256',v_probe_sha,'atomic_unique_key',true);
    v_passed:=v_outcome in ('inserted','exact_replay');
  end if;
  v_observed:=jsonb_build_object('outcome',v_outcome,
    'canonical_sha256',v_retained_sha,'atomic_unique_key',true);
  v_expected_sha:=encode(digest(v_expected::text,'sha256'),'hex');
  v_observed_sha:=encode(digest(v_observed::text,'sha256'),'hex');
  insert into public.os_snapshot_canary_steps(
    run_id,step_ordinal,step_name,expected,observed,
    expected_sha256,observed_sha256,passed
  ) values (p_run_id,p_step_ordinal,
    case when v_definition.canary_kind='replay'
      then case when p_step_ordinal=1 then 'canonical_first_write'
        else 'exact_replay' end
      else 'atomic_contender_'||p_step_ordinal::text end,
    v_expected,v_observed,v_expected_sha,v_observed_sha,v_passed);
  insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
    values(p_run_id,'step_recorded',v_run.requested_by,
      jsonb_build_object('ordinal',p_step_ordinal,'outcome',v_outcome,
        'passed',v_passed,'observed_sha256',v_observed_sha,
        'lease_generation',p_lease_generation));
  return jsonb_build_object('run_id',p_run_id,'step_ordinal',p_step_ordinal,
    'outcome',v_outcome,'passed',v_passed);
end $$;

drop function if exists public.finish_snapshot_canary_run_v1(uuid,text,text);
create or replace function public.finish_snapshot_canary_run_v1(
  p_run_id uuid,p_lease_token text,p_lease_generation bigint,p_abort_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_run public.os_snapshot_canary_runs%rowtype;
  v_definition public.os_snapshot_canary_definitions%rowtype;
  v_count integer;v_failed integer;v_status text;v_evidence jsonb;v_sha text;
  v_contract_failed boolean;
begin
  select * into v_run from public.os_snapshot_canary_runs
    where run_id=p_run_id for update;
  if not found
     or v_run.lease_token_sha256<>encode(digest(p_lease_token,'sha256'),'hex')
     or v_run.lease_generation<>p_lease_generation then
    raise exception 'Canary finish lease or fence mismatch';
  end if;
  if v_run.status in ('passed','failed','aborted','expired') then
    insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
      values(p_run_id,'exact_replay',v_run.requested_by,
        jsonb_build_object('terminal_status',v_run.status,
          'lease_generation',p_lease_generation));
    return jsonb_build_object('run_id',p_run_id,'status',v_run.status,
      'evidence_sha256',v_run.evidence_sha256,'replayed',true,
      'qualification_eligible',false,'attestation_eligible',false);
  end if;
  if v_run.status<>'running' then
    raise exception 'Canary finish state mismatch';
  end if;
  select * into v_definition from public.os_snapshot_canary_definitions
    where definition_id=v_run.definition_id;
  select count(*),count(*) filter(where not passed) into v_count,v_failed
    from public.os_snapshot_canary_steps where run_id=p_run_id;
  if v_definition.canary_kind='replay' then
    select count(*)<>2
      or count(*) filter(where step_ordinal=1
        and step_name='canonical_first_write'
        and observed->>'outcome'='inserted')<>1
      or count(*) filter(where step_ordinal=2 and step_name='exact_replay'
        and observed->>'outcome'='exact_replay')<>1
      or count(distinct observed->>'canonical_sha256')<>1
    into v_contract_failed
    from public.os_snapshot_canary_steps where run_id=p_run_id;
  else
    select count(*)<>v_run.requested_concurrency
      or count(*) filter(where observed->>'outcome'='inserted')<>1
      or count(*) filter(where observed->>'outcome'='exact_replay')
        <>v_run.requested_concurrency-1
      or count(distinct observed->>'canonical_sha256')<>1
    into v_contract_failed
    from public.os_snapshot_canary_steps where run_id=p_run_id;
  end if;
  v_status:=case
    when v_run.deadline_at<=now() or v_run.lease_expires_at<=now() then 'expired'
    when nullif(trim(p_abort_reason),'') is not null then 'aborted'
    when v_failed>0 or v_contract_failed or
      (v_definition.canary_kind='replay' and v_count<>2) or
      (v_definition.canary_kind='concurrency'
        and v_count<>v_run.requested_concurrency) then 'failed'
    else 'passed' end;
  v_evidence:=jsonb_build_object(
    'contract_version','phase39-v1','run_id',p_run_id,
    'definition_id',v_run.definition_id,'status',v_status,
    'lease_generation',v_run.lease_generation,
    'requested_duration_seconds',v_run.requested_duration_seconds,
    'requested_concurrency',v_run.requested_concurrency,
    'started_at',v_run.started_at,'deadline_at',v_run.deadline_at,
    'abort_reason',case when v_status='aborted'
      then left(nullif(trim(p_abort_reason),''),500) end,
    'qualification_eligible',false,'attestation_eligible',false,
    'production_relation_mutated',false,
    'steps',coalesce((select jsonb_agg(jsonb_build_object(
      'ordinal',step_ordinal,'name',step_name,'expected_sha256',expected_sha256,
      'observed_sha256',observed_sha256,'passed',passed) order by step_ordinal)
      from public.os_snapshot_canary_steps where run_id=p_run_id),'[]'::jsonb));
  v_sha:=encode(digest(v_evidence::text,'sha256'),'hex');
  update public.os_snapshot_canary_runs set status=v_status,completed_at=now(),
    abort_reason=left(nullif(trim(p_abort_reason),''),500),evidence_sha256=v_sha
    where run_id=p_run_id;
  insert into public.os_snapshot_canary_events(run_id,event_type,actor_id,detail)
    values(p_run_id,v_status,v_run.requested_by,
      jsonb_build_object('evidence_sha256',v_sha,'step_count',v_count,
        'failed_steps',v_failed));
  return jsonb_build_object('run_id',p_run_id,'status',v_status,
    'evidence_sha256',v_sha,'step_count',v_count,
    'qualification_eligible',false,'attestation_eligible',false);
end $$;

create or replace view public.os_snapshot_phase39_slo
with (security_invoker=true) as
select d.definition_id,d.canary_kind,
  'synthetic_nonqualifying'::text as evidence_class,
  false as qualification_eligible,
  count(r.run_id) filter(where r.started_at>=now()-interval '30 days') as runs_30d,
  count(r.run_id) filter(where r.status='passed'
    and r.evidence_sha256 is not null
    and not r.qualification_eligible and not r.attestation_eligible
    and not r.production_relation_mutated
    and r.started_at>=now()-interval '30 days') as passed_30d,
  count(r.run_id) filter(where r.status in ('passed','failed','aborted','expired')
    and r.evidence_sha256 is null
    and r.started_at>=now()-interval '30 days') as integrity_failures_30d,
  max(r.completed_at) filter(where r.status='passed') as last_passed_at,
  max(r.completed_at) filter(where r.status in ('failed','aborted','expired'))
    as last_unhealthy_at,
  percentile_cont(0.95) within group(order by
    extract(epoch from (r.completed_at-r.started_at)))
    filter(where r.completed_at is not null
      and r.evidence_sha256 is not null
      and r.started_at>=now()-interval '30 days') as duration_p95_seconds
from public.os_snapshot_canary_definitions d
left join public.os_snapshot_canary_runs r on r.definition_id=d.definition_id
where d.definition_id in ('phase39-replay-v2','phase39-concurrency-v2')
group by d.definition_id,d.canary_kind;

create or replace view public.os_snapshot_export_manifest_status
with (security_invoker=true) as
select manifest_id,entity_id,manifest_version,manifest_sha256,
  case when valid_until<=now() then 'expired' else lifecycle_status end
    as lifecycle_status,
  valid_from,valid_until,created_at
from public.os_snapshot_export_manifests;

alter table public.os_snapshot_export_manifests enable row level security;
alter table public.os_snapshot_export_manifest_events enable row level security;
alter table public.os_snapshot_canary_definitions enable row level security;
alter table public.os_snapshot_canary_runs enable row level security;
alter table public.os_snapshot_canary_steps enable row level security;
alter table public.os_snapshot_canary_events enable row level security;
alter table public.os_snapshot_canary_replay_probes enable row level security;
drop policy if exists "os_snapshot_export_manifest_select"
  on public.os_snapshot_export_manifests;
create policy "os_snapshot_export_manifest_select"
  on public.os_snapshot_export_manifests for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_export_manifest_event_select"
  on public.os_snapshot_export_manifest_events;
create policy "os_snapshot_export_manifest_event_select"
  on public.os_snapshot_export_manifest_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_canary_definition_select"
  on public.os_snapshot_canary_definitions;
create policy "os_snapshot_canary_definition_select"
  on public.os_snapshot_canary_definitions for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_canary_run_select"
  on public.os_snapshot_canary_runs;
create policy "os_snapshot_canary_run_select"
  on public.os_snapshot_canary_runs for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_canary_step_select"
  on public.os_snapshot_canary_steps;
create policy "os_snapshot_canary_step_select"
  on public.os_snapshot_canary_steps for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_canary_event_select"
  on public.os_snapshot_canary_events;
create policy "os_snapshot_canary_event_select"
  on public.os_snapshot_canary_events for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_snapshot_canary_probe_select"
  on public.os_snapshot_canary_replay_probes;
create policy "os_snapshot_canary_probe_select"
  on public.os_snapshot_canary_replay_probes for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_snapshot_export_manifests,
  public.os_snapshot_export_manifest_events,
  public.os_snapshot_canary_definitions,public.os_snapshot_canary_runs,
  public.os_snapshot_canary_steps,public.os_snapshot_canary_events,
  public.os_snapshot_canary_replay_probes,
  public.os_snapshot_phase39_slo,
  public.os_snapshot_export_manifest_status to authenticated;
revoke insert,update,delete,truncate on
  public.os_snapshot_export_manifests,
  public.os_snapshot_export_manifest_events,
  public.os_snapshot_canary_definitions,
  public.os_snapshot_canary_runs,
  public.os_snapshot_canary_steps,
  public.os_snapshot_canary_events,
  public.os_snapshot_canary_replay_probes
  from public,authenticated,service_role;
revoke all on function public.phase39_snapshot_actor_authorized(uuid,text)
  from public,authenticated,service_role;
revoke all on function public.phase39_metadata_safe(jsonb)
  from public,authenticated,service_role;
revoke all on function public.phase39_build_snapshot_manifest(
  uuid,bigint,uuid,text,text,timestamptz,timestamptz,jsonb)
  from public,authenticated,service_role;
revoke all on function public.prevent_phase39_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.create_snapshot_export_manifest_v1(
  uuid,text,text,jsonb,timestamptz) from public,authenticated;
revoke all on function public.begin_snapshot_canary_run_v1(
  uuid,text,text,text,integer,integer,text) from public,authenticated;
revoke all on function public.record_snapshot_canary_step_v1(
  uuid,text,bigint,integer) from public,authenticated;
revoke all on function public.finish_snapshot_canary_run_v1(
  uuid,text,bigint,text) from public,authenticated;
revoke all on function public.expire_snapshot_canary_runs_v1()
  from public,authenticated;
grant execute on function public.create_snapshot_export_manifest_v1(
  uuid,text,text,jsonb,timestamptz) to service_role;
grant execute on function public.begin_snapshot_canary_run_v1(
  uuid,text,text,text,integer,integer,text) to service_role;
grant execute on function public.record_snapshot_canary_step_v1(
  uuid,text,bigint,integer) to service_role;
grant execute on function public.finish_snapshot_canary_run_v1(
  uuid,text,bigint,text) to service_role;
grant execute on function public.expire_snapshot_canary_runs_v1()
  to service_role;
