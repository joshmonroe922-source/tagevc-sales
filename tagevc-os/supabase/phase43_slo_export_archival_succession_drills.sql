-- Phase 43: metadata-only archival for expired SLO simulation exports and
-- succession drills distinct from live Phase 42 succession proposals.
-- Does not delete append-only export rows; soft-hides archived from default list.
-- Apply after phase42_slo_export_retention_succession.sql.

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

create table if not exists public.os_slo_simulation_export_archival_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  export_id uuid not null
    references public.os_slo_simulation_exports(export_id),
  idempotency_key text not null unique,
  metadata_digest text not null,
  signature_key_id text not null,
  retained_until timestamptz not null,
  archived_by uuid not null references public.profiles(id),
  archived_at timestamptz not null default now(),
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  constraint os_slo_export_archival_idempotency_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_export_archival_digest_check
    check (metadata_digest ~ '^[0-9a-f]{64}$'
      and evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_export_archival_key_check
    check (signature_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_slo_export_archival_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_export_archival_export_unique unique (export_id)
);

create index if not exists os_slo_export_archival_archived_idx
  on public.os_slo_simulation_export_archival_receipts(archived_at desc);

create table if not exists public.os_slo_owner_succession_drills (
  drill_id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  ownership_id uuid references public.os_slo_owners(ownership_id),
  entity_id text,
  current_owner_id uuid not null references public.profiles(id),
  candidate_replacement_id uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  eligibility_ok boolean not null,
  drilled_by uuid not null references public.profiles(id),
  drilled_at timestamptz not null default now(),
  evidence_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  live_succession_mutated boolean not null default false,
  constraint os_slo_succession_drill_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_succession_drill_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_succession_drill_nonlive_check
    check (not live_succession_mutated)
);

create index if not exists os_slo_succession_drills_policy_idx
  on public.os_slo_owner_succession_drills(policy_id,drilled_at desc);

create or replace function public.prevent_slo_phase43_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_export_archival_append_only
  on public.os_slo_simulation_export_archival_receipts;
create trigger os_slo_export_archival_append_only before update or delete
  on public.os_slo_simulation_export_archival_receipts for each row
  execute function public.prevent_slo_phase43_append_only();
drop trigger if exists os_slo_export_archival_no_truncate
  on public.os_slo_simulation_export_archival_receipts;
create trigger os_slo_export_archival_no_truncate before truncate
  on public.os_slo_simulation_export_archival_receipts for each statement
  execute function public.prevent_slo_phase43_append_only();
drop trigger if exists os_slo_succession_drills_append_only
  on public.os_slo_owner_succession_drills;
create trigger os_slo_succession_drills_append_only before update or delete
  on public.os_slo_owner_succession_drills for each row
  execute function public.prevent_slo_phase43_append_only();
drop trigger if exists os_slo_succession_drills_no_truncate
  on public.os_slo_owner_succession_drills;
create trigger os_slo_succession_drills_no_truncate before truncate
  on public.os_slo_owner_succession_drills for each statement
  execute function public.prevent_slo_phase43_append_only();

create or replace function public.phase43_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- Soft-hide archived exports from the Phase 42 default list.
create or replace function public.list_slo_simulation_exports_phase42(
  p_actor_id uuid,
  p_include_expired boolean default false,
  p_limit integer default 50
)
returns table (
  export_id uuid,
  simulation_id uuid,
  counterfactual boolean,
  label text,
  metadata_digest text,
  signature_key_id text,
  result_count integer,
  retention_days integer,
  retained_until timestamptz,
  expired boolean,
  exported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     and not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list SLO simulation exports';
  end if;
  return query
  select
    e.export_id,e.simulation_id,e.counterfactual,e.label,e.metadata_digest,
    e.signature_key_id,e.result_count,e.retention_days,e.retained_until,
    (e.retained_until<=now()) as expired,e.exported_at
  from public.os_slo_simulation_exports e
  where (p_include_expired or e.retained_until>now())
    and not exists (
      select 1 from public.os_slo_simulation_export_archival_receipts a
      where a.export_id=e.export_id
    )
  order by e.exported_at desc,e.export_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.list_slo_simulation_exports_phase43(
  p_actor_id uuid,
  p_include_expired boolean default false,
  p_include_archived boolean default false,
  p_limit integer default 50
)
returns table (
  export_id uuid,
  simulation_id uuid,
  counterfactual boolean,
  label text,
  metadata_digest text,
  signature_key_id text,
  result_count integer,
  retention_days integer,
  retained_until timestamptz,
  expired boolean,
  archived boolean,
  exported_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     and not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to list SLO simulation exports';
  end if;
  return query
  select
    e.export_id,e.simulation_id,e.counterfactual,e.label,e.metadata_digest,
    e.signature_key_id,e.result_count,e.retention_days,e.retained_until,
    (e.retained_until<=now()) as expired,
    exists (
      select 1 from public.os_slo_simulation_export_archival_receipts a
      where a.export_id=e.export_id
    ) as archived,
    e.exported_at
  from public.os_slo_simulation_exports e
  where (p_include_expired or e.retained_until>now())
    and (
      p_include_archived
      or not exists (
        select 1 from public.os_slo_simulation_export_archival_receipts a
        where a.export_id=e.export_id
      )
    )
  order by e.exported_at desc,e.export_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.archive_slo_simulation_export_phase43(
  p_actor_id uuid,
  p_export_id uuid,
  p_idempotency_key text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export public.os_slo_simulation_exports%rowtype;
  v_existing public.os_slo_simulation_export_archival_receipts%rowtype;
  v_receipt_id uuid;
  v_evidence jsonb;
  v_hash text;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true)
     or coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or not public.phase43_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 43 export archival authorization or input failed';
  end if;

  select * into v_export from public.os_slo_simulation_exports
    where export_id=p_export_id for update;
  if not found then
    raise exception 'Simulation export was not found';
  end if;
  if v_export.retained_until>now() then
    raise exception 'Export is not yet expired for archival';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase43-slo-archive:'||p_idempotency_key,0));

  select * into v_existing from public.os_slo_simulation_export_archival_receipts
    where idempotency_key=p_idempotency_key or export_id=p_export_id
    limit 1;
  if found then
    if v_existing.export_id<>p_export_id
       or (v_existing.idempotency_key=p_idempotency_key
           and v_existing.metadata_digest<>v_export.metadata_digest) then
      return jsonb_build_object(
        'ok',false,'replayed',true,'replay_conflict',true,
        'receipt_id',v_existing.receipt_id
      );
    end if;
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'receipt_id',v_existing.receipt_id,
      'export_id',v_existing.export_id,
      'metadata_digest',v_existing.metadata_digest,
      'soft_hidden',true,
      'rows_deleted',false
    );
  end if;

  v_evidence:=jsonb_build_object(
    'contract_version','phase43-v1',
    'export_id',p_export_id,
    'metadata_digest',v_export.metadata_digest,
    'metadata_only',true,
    'retained_until',v_export.retained_until,
    'rows_deleted',false,
    'signature_key_id',v_export.signature_key_id
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_slo_simulation_export_archival_receipts(
    export_id,idempotency_key,metadata_digest,signature_key_id,retained_until,
    archived_by,evidence_sha256,detail
  ) values (
    p_export_id,p_idempotency_key,v_export.metadata_digest,v_export.signature_key_id,
    v_export.retained_until,p_actor_id,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object('metadata_only',true)
  ) returning receipt_id into v_receipt_id;

  insert into public.os_slo_simulation_export_audit_access(
    export_id,access_type,actor_id,detail
  ) values (
    p_export_id,'listed',p_actor_id,
    jsonb_build_object(
      'archival_receipt_id',v_receipt_id,
      'metadata_only',true,
      'soft_hidden',true
    )
  );

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'receipt_id',v_receipt_id,
    'export_id',p_export_id,
    'metadata_digest',v_export.metadata_digest,
    'signature_key_id',v_export.signature_key_id,
    'evidence_sha256',v_hash,
    'soft_hidden',true,
    'rows_deleted',false
  );
end $$;

create or replace function public.archive_expired_slo_simulation_exports_phase43(
  p_actor_id uuid,
  p_limit integer default 25
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_archived integer:=0;
  v_skipped integer:=0;
  v_results jsonb:= '[]'::jsonb;
  v_one jsonb;
  v_key text;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to archive expired SLO exports';
  end if;

  for v_row in
    select e.export_id
    from public.os_slo_simulation_exports e
    where e.retained_until<=now()
      and not exists (
        select 1 from public.os_slo_simulation_export_archival_receipts a
        where a.export_id=e.export_id
      )
    order by e.retained_until,e.export_id
    limit least(greatest(coalesce(p_limit,25),1),100)
  loop
    v_key:='phase43:archive:'||v_row.export_id::text;
    begin
      v_one:=public.archive_slo_simulation_export_phase43(
        p_actor_id,v_row.export_id,v_key,'{}'::jsonb);
      if coalesce((v_one->>'ok')::boolean,false) then
        v_archived:=v_archived+1;
      else
        v_skipped:=v_skipped+1;
      end if;
      v_results:=v_results||jsonb_build_array(v_one);
    exception when others then
      v_skipped:=v_skipped+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'ok',false,
        'export_id',v_row.export_id,
        'error','archival_failed'
      ));
    end;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'archived_count',v_archived,
    'skipped_count',v_skipped,
    'results',v_results,
    'rows_deleted',false
  );
end $$;

-- Drill only: never mutates os_slo_owners / os_slo_policies replacement fields.
create or replace function public.run_slo_owner_succession_drill_phase43(
  p_actor_id uuid,
  p_policy_id uuid,
  p_entity_id text,
  p_candidate_replacement_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.os_slo_policies%rowtype;
  v_owner public.os_slo_owners%rowtype;
  v_eligible boolean;
  v_drill_id uuid;
  v_evidence jsonb;
  v_hash text;
begin
  if not public.phase39_actor_authorized(p_actor_id,p_entity_id,true) then
    raise exception 'Actor is not authorized to run SLO succession drills';
  end if;
  select * into v_policy from public.os_slo_policies
    where policy_id=p_policy_id;
  if not found or v_policy.lifecycle_status<>'published' or not v_policy.enabled then
    raise exception 'Published policy was not found for succession drill';
  end if;
  if v_policy.owner_entity_id is distinct from p_entity_id then
    raise exception 'Succession drill entity scope mismatch';
  end if;
  select * into v_owner from public.os_slo_owners
    where service=v_policy.service
      and metric_key=v_policy.metric_key
      and entity_id is not distinct from p_entity_id
      and active
      and effective_at<=now()
      and (expires_at is null or expires_at>now())
    order by assigned_at desc
    limit 1;
  if not found then
    raise exception 'Active ownership was not found for succession drill';
  end if;
  if v_owner.expires_at is null then
    raise exception 'Succession drill requires expiring owner coverage';
  end if;
  if p_candidate_replacement_id is null
     or p_candidate_replacement_id=v_owner.owner_id then
    raise exception 'Candidate replacement is invalid for succession drill';
  end if;

  v_eligible:=public.phase40_replacement_eligible(
    p_candidate_replacement_id,p_entity_id);

  v_evidence:=jsonb_build_object(
    'candidate_replacement_id',p_candidate_replacement_id,
    'contract_version','phase43-v1',
    'current_owner_id',v_owner.owner_id,
    'drill',true,
    'eligibility_ok',v_eligible,
    'expires_at',v_owner.expires_at,
    'live_succession_mutated',false,
    'ownership_id',v_owner.ownership_id,
    'policy_id',v_policy.policy_id
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_slo_owner_succession_drills(
    policy_id,ownership_id,entity_id,current_owner_id,candidate_replacement_id,
    expires_at,eligibility_ok,drilled_by,evidence_sha256,detail,
    live_succession_mutated
  ) values (
    v_policy.policy_id,v_owner.ownership_id,p_entity_id,v_owner.owner_id,
    p_candidate_replacement_id,v_owner.expires_at,v_eligible,p_actor_id,v_hash,
    jsonb_build_object(
      'days_remaining',
      greatest(0,ceil(extract(epoch from(v_owner.expires_at-now()))/86400))::integer,
      'distinct_from','propose_slo_owner_succession_phase42'
    ),
    false
  ) returning drill_id into v_drill_id;

  return jsonb_build_object(
    'ok',true,
    'drill_id',v_drill_id,
    'policy_id',v_policy.policy_id,
    'ownership_id',v_owner.ownership_id,
    'candidate_replacement_id',p_candidate_replacement_id,
    'eligibility_ok',v_eligible,
    'expires_at',v_owner.expires_at,
    'evidence_sha256',v_hash,
    'live_succession_mutated',false,
    'distinct_from','propose_slo_owner_succession_phase42'
  );
end $$;

create or replace function public.get_slo_phase43_archival_drill_report()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'archived_exports',
      (select count(*) from public.os_slo_simulation_export_archival_receipts),
    'archived_30d',
      (select count(*) from public.os_slo_simulation_export_archival_receipts
        where archived_at>=now()-interval '30 days'),
    'expired_unarchived',
      (select count(*) from public.os_slo_simulation_exports e
        where e.retained_until<=now()
          and not exists (
            select 1 from public.os_slo_simulation_export_archival_receipts a
            where a.export_id=e.export_id
          )),
    'succession_drills_30d',
      (select count(*) from public.os_slo_owner_succession_drills
        where drilled_at>=now()-interval '30 days'),
    'eligible_drills_30d',
      (select count(*) from public.os_slo_owner_succession_drills
        where drilled_at>=now()-interval '30 days' and eligibility_ok),
    'live_succession_mutated',false,
    'rows_deleted',false,
    'contract_version','phase43-v1'
  );
$$;

alter table public.os_slo_simulation_export_archival_receipts enable row level security;
alter table public.os_slo_owner_succession_drills enable row level security;

drop policy if exists "os_slo_export_archival_select"
  on public.os_slo_simulation_export_archival_receipts;
create policy "os_slo_export_archival_select"
  on public.os_slo_simulation_export_archival_receipts for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_succession_drills_select"
  on public.os_slo_owner_succession_drills;
create policy "os_slo_succession_drills_select"
  on public.os_slo_owner_succession_drills for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));

grant select on public.os_slo_simulation_export_archival_receipts,
  public.os_slo_owner_succession_drills
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_simulation_export_archival_receipts,
  public.os_slo_owner_succession_drills
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase43_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.archive_slo_simulation_export_phase43(
  uuid,uuid,text,jsonb
) from public,authenticated;
revoke all on function public.archive_expired_slo_simulation_exports_phase43(
  uuid,integer
) from public,authenticated;
revoke all on function public.run_slo_owner_succession_drill_phase43(
  uuid,uuid,text,uuid
) from public,authenticated;
revoke all on function public.list_slo_simulation_exports_phase43(
  uuid,boolean,boolean,integer
) from public,anon;
revoke all on function public.get_slo_phase43_archival_drill_report()
  from public,anon;

grant execute on function public.phase43_slo_safe_detail(jsonb),
  public.list_slo_simulation_exports_phase42(uuid,boolean,integer),
  public.list_slo_simulation_exports_phase43(uuid,boolean,boolean,integer),
  public.get_slo_phase43_archival_drill_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.archive_slo_simulation_export_phase43(
  uuid,uuid,text,jsonb
),
  public.archive_expired_slo_simulation_exports_phase43(uuid,integer),
  public.run_slo_owner_succession_drill_phase43(uuid,uuid,text,uuid)
  to service_role;
