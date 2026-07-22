-- Phase 46: dual-key cutover dual-acceptance evidence, on-call page routing,
-- and Stage 4e non-qualifying ops report.
-- Apply after phase45_snapshot_key_rotation_ops.sql when available.
-- Bootstraps Phase 45 rotation ledger + cutover helper if missing so this
-- migration is re-runnable when Phase 45 snapshot SQL was skipped.
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

create or replace function public.phase46_snapshot_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|private_key)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Phase 45 rotation ledger (required FK target)
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

-- Bootstrap Phase 45 cutover helper used by Phase 46 wrap.
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

revoke all on function public.complete_snapshot_ed25519_cutover_phase45(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.complete_snapshot_ed25519_cutover_phase45(uuid,uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Dual-key cutover acceptances (offline verify dual-acceptance evidence)
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- On-call page routes + delivery evidence for consecutive failure pages
-- ---------------------------------------------------------------------------
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
  ('ops_alerts','active',jsonb_build_object('contract_version','phase46-v1'),false,false,false),
  ('oncall','active',jsonb_build_object('contract_version','phase46-v1'),false,false,false)
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

create or replace function public.prevent_phase46_snapshot_immutable_change()
returns trigger language plpgsql as $$
begin raise exception '% is immutable',tg_table_name; end $$;

drop trigger if exists os_snapshot_cutover_acc_immutable
  on public.os_snapshot_ed25519_cutover_acceptances;
create trigger os_snapshot_cutover_acc_immutable
  before update or delete or truncate
  on public.os_snapshot_ed25519_cutover_acceptances for each statement
  execute function public.prevent_phase46_snapshot_immutable_change();

drop trigger if exists os_snapshot_oncall_del_immutable
  on public.os_snapshot_oncall_page_deliveries;
create trigger os_snapshot_oncall_del_immutable
  before update or delete or truncate
  on public.os_snapshot_oncall_page_deliveries for each statement
  execute function public.prevent_phase46_snapshot_immutable_change();

create or replace function public.prevent_phase46_oncall_route_delete()
returns trigger language plpgsql as $$
begin raise exception 'os_snapshot_oncall_page_routes deletes are forbidden'; end $$;
drop trigger if exists os_snapshot_oncall_route_no_delete
  on public.os_snapshot_oncall_page_routes;
create trigger os_snapshot_oncall_route_no_delete before delete
  on public.os_snapshot_oncall_page_routes for each row
  execute function public.prevent_phase46_oncall_route_delete();
drop trigger if exists os_snapshot_oncall_route_no_truncate
  on public.os_snapshot_oncall_page_routes;
create trigger os_snapshot_oncall_route_no_truncate before truncate
  on public.os_snapshot_oncall_page_routes for each statement
  execute function public.prevent_phase46_oncall_route_delete();

create or replace function public.record_snapshot_cutover_acceptance_phase46(
  p_actor_id uuid,
  p_rotation_id uuid,
  p_verifier_kind text,
  p_acceptance_sha256 text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot public.os_snapshot_ed25519_key_rotations%rowtype;
  v_existing public.os_snapshot_ed25519_cutover_acceptances%rowtype;
  v_acceptance_id uuid;
  v_distinct integer:=0;
  v_dual boolean:=false;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     or p_verifier_kind not in ('offline_script','admin','worker')
     or coalesce(p_acceptance_sha256,'') !~ '^[0-9a-f]{64}$'
     or not public.phase46_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 46 cutover acceptance authorization or input failed';
  end if;
  if coalesce(p_detail,'{}'::jsonb)::text ~* 'private_key' then
    raise exception 'Private key material is not allowed in cutover acceptance evidence';
  end if;

  select * into v_rot from public.os_snapshot_ed25519_key_rotations
    where rotation_id=p_rotation_id for update;
  if not found then
    raise exception 'Ed25519 rotation was not found';
  end if;
  if v_rot.status not in ('dual_active','cutover_complete') then
    raise exception 'Cutover acceptance requires dual_active or cutover_complete rotation';
  end if;

  select * into v_existing from public.os_snapshot_ed25519_cutover_acceptances
    where rotation_id=p_rotation_id and verifier_kind=p_verifier_kind;
  if found then
    select count(distinct a.verifier_kind) into v_distinct
    from public.os_snapshot_ed25519_cutover_acceptances a
    where a.rotation_id=p_rotation_id;
    v_dual:=v_distinct>=2;
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'acceptance_id',v_existing.acceptance_id,
      'rotation_id',v_existing.rotation_id,
      'verifier_kind',v_existing.verifier_kind,
      'dual_acceptance_complete',v_dual,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false
    );
  end if;

  insert into public.os_snapshot_ed25519_cutover_acceptances(
    rotation_id,verifier_kind,acceptance_sha256,
    previous_key_id,next_key_id,dual_acceptance_complete,detail,actor_id,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    p_rotation_id,p_verifier_kind,p_acceptance_sha256,
    v_rot.previous_key_id,v_rot.next_key_id,
    (
      select count(distinct a.verifier_kind)+1>=2
      from public.os_snapshot_ed25519_cutover_acceptances a
      where a.rotation_id=p_rotation_id
        and a.verifier_kind is distinct from p_verifier_kind
    ),
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'contract_version','phase46-v1',
      'verifier_kind',p_verifier_kind
    ),
    p_actor_id,false,false,false
  ) returning acceptance_id into v_acceptance_id;

  select count(distinct a.verifier_kind) into v_distinct
  from public.os_snapshot_ed25519_cutover_acceptances a
  where a.rotation_id=p_rotation_id;
  v_dual:=v_distinct>=2;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'acceptance_id',v_acceptance_id,
    'rotation_id',p_rotation_id,
    'verifier_kind',p_verifier_kind,
    'acceptance_sha256',p_acceptance_sha256,
    'previous_key_id',v_rot.previous_key_id,
    'next_key_id',v_rot.next_key_id,
    'dual_acceptance_complete',v_dual,
    'distinct_verifier_kinds',v_distinct,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

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

-- Completes cutover only when dual acceptance is complete (wraps phase45).
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
  v_complete jsonb;
begin
  if not public.phase40_snapshot_actor_authorized(p_actor_id,null) then
    raise exception 'Phase 46 ed25519 cutover authorization failed';
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

  v_complete:=public.complete_snapshot_ed25519_cutover_phase45(
    p_actor_id, p_rotation_id
  );

  return coalesce(v_complete,'{}'::jsonb)||jsonb_build_object(
    'dual_acceptance_complete',true,
    'contract_version','phase46-v1',
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false
  );
end $$;

create or replace function public.route_snapshot_oncall_page_phase46(
  p_actor_id uuid default null,
  p_destination_key text default 'oncall',
  p_window_key text default null,
  p_delivery_status text default 'delivered',
  p_response_code integer default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_route public.os_snapshot_oncall_page_routes%rowtype;
  v_existing public.os_snapshot_oncall_page_deliveries%rowtype;
  v_delivery_id uuid;
  v_dest text;
  v_window text;
  v_status text;
  v_hash text;
begin
  if p_actor_id is not null
     and not public.phase40_snapshot_actor_authorized(p_actor_id,null)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to route snapshot on-call pages';
  end if;

  v_dest:=coalesce(nullif(trim(p_destination_key),''),'oncall');
  if v_dest !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'On-call destination_key is invalid';
  end if;

  v_window:=coalesce(
    nullif(trim(p_window_key),''),
    'phase46:oncall:'||v_dest||':'||to_char(now() at time zone 'utc','YYYY-MM-DD')
  );
  if v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$' then
    raise exception 'On-call window_key is invalid';
  end if;

  v_status:=coalesce(nullif(trim(p_delivery_status),''),'delivered');
  if v_status not in (
       'delivered','failed','skipped_no_webhook','skipped_paused'
     )
     or not public.phase46_snapshot_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 46 on-call page route input failed';
  end if;

  select * into v_route from public.os_snapshot_oncall_page_routes
    where destination_key=v_dest for update;
  if not found then
    insert into public.os_snapshot_oncall_page_routes(
      destination_key,route_status,detail,
      qualification_eligible,attestation_eligible,production_relation_mutated
    ) values (
      v_dest,'active',
      jsonb_build_object('contract_version','phase46-v1','auto_created',true),
      false,false,false
    ) returning * into v_route;
  end if;

  if v_route.route_status<>'active' then
    v_status:='skipped_paused';
  end if;

  select * into v_existing from public.os_snapshot_oncall_page_deliveries
    where window_key=v_window;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'delivery_id',v_existing.delivery_id,
      'route_id',v_existing.route_id,
      'destination_key',v_dest,
      'window_key',v_existing.window_key,
      'delivery_status',v_existing.delivery_status,
      'qualification_eligible',false,
      'attestation_eligible',false,
      'production_relation_mutated',false
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase46-v1',
    'delivery_status',v_status,
    'destination_key',v_dest,
    'detail',coalesce(p_detail,'{}'::jsonb),
    'response_code',p_response_code,
    'window_key',v_window
  )::text);

  insert into public.os_snapshot_oncall_page_deliveries(
    route_id,window_key,delivery_status,response_code,evidence_sha256,detail,
    qualification_eligible,attestation_eligible,production_relation_mutated
  ) values (
    v_route.route_id,v_window,v_status,p_response_code,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'contract_version','phase46-v1',
      'routed_by',p_actor_id
    ),
    false,false,false
  ) returning delivery_id into v_delivery_id;

  if v_status='delivered' then
    update public.os_snapshot_oncall_page_routes
      set last_paged_at=now(),
          updated_at=now(),
          detail=coalesce(detail,'{}'::jsonb)||jsonb_build_object(
            'last_window_key',v_window,
            'contract_version','phase46-v1'
          )
      where route_id=v_route.route_id;
  end if;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'delivery_id',v_delivery_id,
    'route_id',v_route.route_id,
    'destination_key',v_dest,
    'window_key',v_window,
    'delivery_status',v_status,
    'response_code',p_response_code,
    'evidence_sha256',v_hash,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'contract_version','phase46-v1'
  );
end $$;

create or replace view public.os_snapshot_phase46_ops_slo
with (security_invoker=true) as
select
  (select count(*) from public.os_snapshot_ed25519_cutover_acceptances
    where created_at>=now()-interval '365 days') as cutover_acceptances_365d,
  (select count(*) from public.os_snapshot_ed25519_key_rotations r
    where r.status='dual_active'
      and public.snapshot_cutover_dual_acceptance_complete_phase46(r.rotation_id)
  ) as dual_acceptance_ready,
  (select count(*) from public.os_snapshot_ed25519_key_rotations
    where status='cutover_complete'
      and cutover_completed_at>=now()-interval '365 days') as cutovers_completed_365d,
  (select count(*) from public.os_snapshot_oncall_page_routes
    where route_status='active') as active_oncall_routes,
  (select count(*) from public.os_snapshot_oncall_page_deliveries
    where created_at>=now()-interval '30 days') as oncall_deliveries_30d,
  (select count(*) from public.os_snapshot_oncall_page_deliveries
    where created_at>=now()-interval '30 days'
      and delivery_status='delivered') as oncall_delivered_30d,
  false as qualification_eligible,
  false as attestation_eligible,
  false as production_relation_mutated,
  'synthetic_nonqualifying'::text as evidence_class;

create or replace function public.get_snapshot_phase46_ops_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'cutover_acceptances_365d',s.cutover_acceptances_365d,
    'dual_acceptance_ready',s.dual_acceptance_ready,
    'cutovers_completed_365d',s.cutovers_completed_365d,
    'active_oncall_routes',s.active_oncall_routes,
    'oncall_deliveries_30d',s.oncall_deliveries_30d,
    'oncall_delivered_30d',s.oncall_delivered_30d,
    'qualification_eligible',false,
    'attestation_eligible',false,
    'production_relation_mutated',false,
    'evidence_class',s.evidence_class,
    'contract_version','phase46-v1'
  )
  from public.os_snapshot_phase46_ops_slo s;
$$;

alter table public.os_snapshot_ed25519_cutover_acceptances enable row level security;
alter table public.os_snapshot_oncall_page_routes enable row level security;
alter table public.os_snapshot_oncall_page_deliveries enable row level security;

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

grant select on public.os_snapshot_ed25519_cutover_acceptances,
  public.os_snapshot_oncall_page_routes,
  public.os_snapshot_oncall_page_deliveries,
  public.os_snapshot_phase46_ops_slo
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_snapshot_ed25519_cutover_acceptances,
  public.os_snapshot_oncall_page_routes,
  public.os_snapshot_oncall_page_deliveries
  from public,authenticated,service_role;

revoke all on function public.prevent_phase46_snapshot_immutable_change()
  from public,authenticated,service_role;
revoke all on function public.prevent_phase46_oncall_route_delete()
  from public,authenticated,service_role;
revoke all on function public.record_snapshot_cutover_acceptance_phase46(
  uuid,uuid,text,text,jsonb
) from public,authenticated;
revoke all on function public.complete_snapshot_ed25519_cutover_phase46(uuid,uuid)
  from public,authenticated;
revoke all on function public.route_snapshot_oncall_page_phase46(
  uuid,text,text,text,integer,jsonb
) from public,authenticated;
revoke all on function public.snapshot_cutover_dual_acceptance_complete_phase46(uuid)
  from public,anon;
revoke all on function public.get_snapshot_phase46_ops_report()
  from public,anon;

grant execute on function public.phase46_snapshot_safe_detail(jsonb),
  public.snapshot_cutover_dual_acceptance_complete_phase46(uuid),
  public.get_snapshot_phase46_ops_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.record_snapshot_cutover_acceptance_phase46(
  uuid,uuid,text,text,jsonb
),
  public.complete_snapshot_ed25519_cutover_phase46(uuid,uuid),
  public.route_snapshot_oncall_page_phase46(uuid,text,text,text,integer,jsonb)
  to service_role;
