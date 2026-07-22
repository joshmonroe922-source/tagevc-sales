-- Phase 42: SLO simulation export retention, audit access, and owner
-- succession proposals via existing Phase 40 owner fields.
-- Apply after phase41_slo_exports_coverage.sql.

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

alter table public.os_slo_simulation_exports
  add column if not exists retention_days integer,
  add column if not exists retained_until timestamptz;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public'
      and table_name='os_slo_simulation_exports'
      and column_name='retention_days'
      and is_nullable='YES'
  ) then
    alter table public.os_slo_simulation_exports
      disable trigger os_slo_sim_exports_append_only;
    update public.os_slo_simulation_exports
      set retention_days=90,
          retained_until=exported_at + interval '90 days'
    where retention_days is null or retained_until is null;
    alter table public.os_slo_simulation_exports
      alter column retention_days set default 90;
    alter table public.os_slo_simulation_exports
      alter column retention_days set not null;
    alter table public.os_slo_simulation_exports
      alter column retained_until set not null;
    alter table public.os_slo_simulation_exports
      enable trigger os_slo_sim_exports_append_only;
  end if;
end $$;

do $$ begin
  alter table public.os_slo_simulation_exports
    add constraint os_slo_sim_export_retention_bounds
    check (retention_days between 30 and 730
      and retained_until > exported_at);
exception when duplicate_object then null; end $$;

create table if not exists public.os_slo_simulation_export_audit_access (
  access_id uuid primary key default gen_random_uuid(),
  export_id uuid not null
    references public.os_slo_simulation_exports(export_id),
  access_type text not null
    check (access_type in ('listed','viewed','downloaded','replayed','succession_proposed')),
  actor_id uuid not null references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  accessed_at timestamptz not null default now(),
  constraint os_slo_sim_export_audit_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_sim_export_audit_export_idx
  on public.os_slo_simulation_export_audit_access(export_id,accessed_at desc);
create index if not exists os_slo_sim_export_audit_actor_idx
  on public.os_slo_simulation_export_audit_access(actor_id,accessed_at desc);

create table if not exists public.os_slo_owner_succession_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  ownership_id uuid not null references public.os_slo_owners(ownership_id),
  policy_id uuid not null references public.os_slo_policies(policy_id),
  entity_id text,
  current_owner_id uuid not null references public.profiles(id),
  replacement_owner_id uuid not null references public.profiles(id),
  expires_at timestamptz not null,
  proposed_by uuid not null references public.profiles(id),
  proposed_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb,
  constraint os_slo_succession_proposal_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_succession_proposals_owner_idx
  on public.os_slo_owner_succession_proposals(ownership_id,proposed_at desc);

create or replace function public.prevent_slo_phase42_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_sim_export_audit_append_only
  on public.os_slo_simulation_export_audit_access;
create trigger os_slo_sim_export_audit_append_only before update or delete
  on public.os_slo_simulation_export_audit_access for each row
  execute function public.prevent_slo_phase42_append_only();
drop trigger if exists os_slo_sim_export_audit_no_truncate
  on public.os_slo_simulation_export_audit_access;
create trigger os_slo_sim_export_audit_no_truncate before truncate
  on public.os_slo_simulation_export_audit_access for each statement
  execute function public.prevent_slo_phase42_append_only();
drop trigger if exists os_slo_succession_proposals_append_only
  on public.os_slo_owner_succession_proposals;
create trigger os_slo_succession_proposals_append_only before update or delete
  on public.os_slo_owner_succession_proposals for each row
  execute function public.prevent_slo_phase42_append_only();
drop trigger if exists os_slo_succession_proposals_no_truncate
  on public.os_slo_owner_succession_proposals;
create trigger os_slo_succession_proposals_no_truncate before truncate
  on public.os_slo_owner_succession_proposals for each statement
  execute function public.prevent_slo_phase42_append_only();

create or replace function public.phase42_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- Bind retention at export insert time (append-only; no later mutation).
create or replace function public.export_slo_simulation_phase41(
  p_idempotency_key text,
  p_simulation_id uuid,
  p_metadata jsonb,
  p_metadata_canonical_text text,
  p_metadata_digest text,
  p_signature_algorithm text,
  p_signature_key_id text,
  p_metadata_signature text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sim public.os_slo_simulations%rowtype;
  v_existing public.os_slo_simulation_exports%rowtype;
  v_export_id uuid;
  v_result_count integer;
  v_severity_summary jsonb;
  v_result_digest text;
  v_retention_days integer;
  v_retained_until timestamptz;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to export SLO simulations';
  end if;
  v_retention_days:=coalesce(nullif(p_metadata->>'retention_days','')::integer,90);
  if coalesce(p_idempotency_key,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or p_idempotency_key ~ '[A-Za-z0-9_-]{80,}'
     or p_signature_algorithm is distinct from 'hmac-sha256'
     or coalesce(p_signature_key_id,'')
       !~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'
     or coalesce(p_metadata_digest,'') !~ '^[0-9a-f]{64}$'
     or coalesce(p_metadata_signature,'') !~ '^[0-9a-f]{64}$'
     or length(coalesce(p_metadata_canonical_text,'')) not between 2 and 16384
     or p_metadata_canonical_text::jsonb is distinct from p_metadata
     or public.os_sha256_hex(p_metadata_canonical_text)<>p_metadata_digest
     or not public.phase41_slo_safe_metadata(p_metadata)
     or coalesce((p_metadata->>'counterfactual')::boolean,false) is not true
     or p_metadata->>'label'
       is distinct from 'COUNTERFACTUAL — no production state mutated'
     or p_metadata->>'contract_version' is distinct from 'phase41-v1'
     or p_metadata->>'simulation_id' is distinct from p_simulation_id::text
     or v_retention_days not between 30 and 730
  then
    raise exception 'SLO simulation export authorization or digest failed';
  end if;

  select * into v_sim from public.os_slo_simulations
    where simulation_id=p_simulation_id for update;
  if not found then
    raise exception 'Simulation was not found';
  end if;
  if v_sim.status<>'completed' or not v_sim.counterfactual then
    raise exception 'Only completed counterfactual simulations can be exported';
  end if;

  select count(*)::integer,
    jsonb_build_object(
      'healthy',count(*) filter (where counterfactual_severity='healthy'),
      'warning',count(*) filter (where counterfactual_severity='warning'),
      'critical',count(*) filter (where counterfactual_severity='critical'),
      'unknown',count(*) filter (where counterfactual_severity='unknown')
    ),
    public.os_sha256_hex(coalesce(string_agg(
      public.os_sha256_hex(
        source_evaluation_id::text||'|'||
        (floor(extract(epoch from evaluation_bucket)*1000))::bigint::text||'|'||
        historical_severity||'|'||counterfactual_severity
      ),
      ',' order by evaluation_bucket,source_evaluation_id
    ),''))
  into v_result_count,v_severity_summary,v_result_digest
  from public.os_slo_simulation_results
  where simulation_id=p_simulation_id;

  if nullif(p_metadata->>'result_count','')::integer is distinct from v_result_count
     or p_metadata->'severity_summary' is distinct from v_severity_summary
     or p_metadata->>'result_digest' is distinct from v_result_digest
     or p_metadata->>'draft_policy_id' is distinct from v_sim.draft_policy_id::text
     or p_metadata->>'source_policy_id' is distinct from v_sim.source_policy_id::text
  then
    raise exception 'Export metadata does not bind completed simulation results';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'phase41-slo-export:'||p_idempotency_key,0));

  select * into v_existing from public.os_slo_simulation_exports
    where idempotency_key=p_idempotency_key;
  if found then
    if v_existing.simulation_id<>p_simulation_id
       or v_existing.metadata_digest<>p_metadata_digest
       or v_existing.metadata_signature<>p_metadata_signature
       or v_existing.signature_key_id<>p_signature_key_id then
      raise exception 'Idempotency key belongs to another export';
    end if;
    insert into public.os_slo_simulation_export_evidence(
      export_id,event_type,actor_id,detail
    ) values (
      v_existing.export_id,'replayed',p_actor_id,
      jsonb_build_object('counterfactual',true,'replayed',true)
    );
    insert into public.os_slo_simulation_export_audit_access(
      export_id,access_type,actor_id,detail
    ) values (
      v_existing.export_id,'replayed',p_actor_id,
      jsonb_build_object('idempotency_key',p_idempotency_key)
    );
    return jsonb_build_object(
      'export_id',v_existing.export_id,
      'simulation_id',v_existing.simulation_id,
      'metadata_digest',v_existing.metadata_digest,
      'metadata_signature',v_existing.metadata_signature,
      'counterfactual',true,
      'label',v_existing.label,
      'retention_days',v_existing.retention_days,
      'retained_until',v_existing.retained_until,
      'replayed',true
    );
  end if;

  v_retained_until:=now()+make_interval(days=>v_retention_days);

  insert into public.os_slo_simulation_exports(
    simulation_id,idempotency_key,metadata,metadata_canonical_text,
    metadata_digest,signature_algorithm,signature_key_id,metadata_signature,
    result_count,exported_by,retention_days,retained_until
  ) values (
    p_simulation_id,p_idempotency_key,p_metadata,p_metadata_canonical_text,
    p_metadata_digest,p_signature_algorithm,p_signature_key_id,p_metadata_signature,
    v_result_count,p_actor_id,v_retention_days,v_retained_until
  ) returning export_id into v_export_id;

  insert into public.os_slo_simulation_export_evidence(
    export_id,event_type,actor_id,detail
  ) values (
    v_export_id,'exported',p_actor_id,
    jsonb_build_object(
      'counterfactual',true,
      'result_count',v_result_count,
      'metadata_digest',p_metadata_digest,
      'retention_days',v_retention_days
    )
  );

  return jsonb_build_object(
    'export_id',v_export_id,
    'simulation_id',p_simulation_id,
    'metadata_digest',p_metadata_digest,
    'metadata_signature',p_metadata_signature,
    'signature_key_id',p_signature_key_id,
    'result_count',v_result_count,
    'counterfactual',true,
    'label','COUNTERFACTUAL — no production state mutated',
    'retention_days',v_retention_days,
    'retained_until',v_retained_until,
    'replayed',false
  );
end $$;

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
  where p_include_expired or e.retained_until>now()
  order by e.exported_at desc,e.export_id desc
  limit least(greatest(coalesce(p_limit,50),1),200);
end $$;

create or replace function public.record_slo_export_audit_access_phase42(
  p_actor_id uuid,
  p_export_id uuid,
  p_access_type text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_export public.os_slo_simulation_exports%rowtype;
  v_access_id uuid;
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to audit-access SLO exports';
  end if;
  if p_access_type not in ('listed','viewed','downloaded','replayed')
     or not public.phase42_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'SLO export audit access validation failed';
  end if;
  select * into v_export from public.os_slo_simulation_exports
    where export_id=p_export_id;
  if not found then
    raise exception 'Simulation export was not found';
  end if;
  insert into public.os_slo_simulation_export_audit_access(
    export_id,access_type,actor_id,detail
  ) values (
    p_export_id,p_access_type,p_actor_id,coalesce(p_detail,'{}'::jsonb)
  ) returning access_id into v_access_id;
  return jsonb_build_object(
    'ok',true,
    'access_id',v_access_id,
    'export_id',p_export_id,
    'access_type',p_access_type,
    'retained_until',v_export.retained_until,
    'expired',v_export.retained_until<=now()
  );
end $$;

create or replace function public.propose_slo_owner_succession_phase42(
  p_actor_id uuid,
  p_policy_id uuid,
  p_entity_id text,
  p_replacement_owner_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_policy public.os_slo_policies%rowtype;
  v_owner public.os_slo_owners%rowtype;
  v_proposal_id uuid;
  v_successor uuid;
begin
  if not public.phase39_actor_authorized(p_actor_id,p_entity_id,true) then
    raise exception 'Actor is not authorized to propose SLO succession';
  end if;
  select * into v_policy from public.os_slo_policies
    where policy_id=p_policy_id for update;
  if not found or v_policy.lifecycle_status<>'published' or not v_policy.enabled then
    raise exception 'Published policy was not found for succession';
  end if;
  if v_policy.owner_entity_id is distinct from p_entity_id then
    raise exception 'Succession entity scope mismatch';
  end if;
  select * into v_owner from public.os_slo_owners
    where service=v_policy.service
      and metric_key=v_policy.metric_key
      and entity_id is not distinct from p_entity_id
      and active
      and effective_at<=now()
      and (expires_at is null or expires_at>now())
    order by assigned_at desc
    limit 1
    for update;
  if not found then
    raise exception 'Active ownership was not found for succession';
  end if;
  if v_owner.expires_at is null then
    raise exception 'Succession requires expiring owner coverage';
  end if;
  if p_replacement_owner_id is null
     or p_replacement_owner_id=v_owner.owner_id
     or not public.phase40_replacement_eligible(p_replacement_owner_id,p_entity_id)
  then
    raise exception 'Replacement owner is not eligible for succession';
  end if;

  update public.os_slo_owners
    set replacement_owner_id=p_replacement_owner_id
  where ownership_id=v_owner.ownership_id;

  update public.os_slo_policies
    set replacement_owner_id=p_replacement_owner_id
  where policy_id=v_policy.policy_id;

  select ownership_id into v_successor from public.os_slo_owners
    where service=v_owner.service
      and metric_key=v_owner.metric_key
      and entity_id is not distinct from v_owner.entity_id
      and owner_id=p_replacement_owner_id
      and effective_at=v_owner.expires_at
      and not active
    order by assigned_at desc
    limit 1;
  if v_successor is null then
    insert into public.os_slo_owners(
      service,metric_key,entity_id,owner_id,active,assigned_by,effective_at,note
    ) values (
      v_owner.service,v_owner.metric_key,v_owner.entity_id,p_replacement_owner_id,
      false,p_actor_id,v_owner.expires_at,'Phase 42 proposed succession'
    ) returning ownership_id into v_successor;
  end if;

  insert into public.os_slo_owner_succession_proposals(
    ownership_id,policy_id,entity_id,current_owner_id,replacement_owner_id,
    expires_at,proposed_by,detail
  ) values (
    v_owner.ownership_id,v_policy.policy_id,p_entity_id,v_owner.owner_id,
    p_replacement_owner_id,v_owner.expires_at,p_actor_id,
    jsonb_build_object(
      'successor_ownership_id',v_successor,
      'days_remaining',greatest(0,ceil(extract(epoch from(v_owner.expires_at-now()))/86400))::integer
    )
  ) returning proposal_id into v_proposal_id;

  return jsonb_build_object(
    'ok',true,
    'proposal_id',v_proposal_id,
    'ownership_id',v_owner.ownership_id,
    'policy_id',v_policy.policy_id,
    'replacement_owner_id',p_replacement_owner_id,
    'expires_at',v_owner.expires_at,
    'successor_ownership_id',v_successor
  );
end $$;

alter table public.os_slo_simulation_export_audit_access enable row level security;
alter table public.os_slo_owner_succession_proposals enable row level security;

drop policy if exists "os_slo_sim_export_audit_select"
  on public.os_slo_simulation_export_audit_access;
create policy "os_slo_sim_export_audit_select"
  on public.os_slo_simulation_export_audit_access for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_succession_proposals_select"
  on public.os_slo_owner_succession_proposals;
create policy "os_slo_succession_proposals_select"
  on public.os_slo_owner_succession_proposals for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));

grant select on public.os_slo_simulation_export_audit_access,
  public.os_slo_owner_succession_proposals
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_simulation_export_audit_access,
  public.os_slo_owner_succession_proposals
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase42_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.export_slo_simulation_phase41(
  text,uuid,jsonb,text,text,text,text,text,uuid
) from public,authenticated;
revoke all on function public.list_slo_simulation_exports_phase42(uuid,boolean,integer)
  from public,anon;
revoke all on function public.record_slo_export_audit_access_phase42(uuid,uuid,text,jsonb)
  from public,authenticated;
revoke all on function public.propose_slo_owner_succession_phase42(uuid,uuid,text,uuid)
  from public,authenticated;

grant execute on function public.phase42_slo_safe_detail(jsonb),
  public.list_slo_simulation_exports_phase42(uuid,boolean,integer),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.export_slo_simulation_phase41(
  text,uuid,jsonb,text,text,text,text,text,uuid
),
  public.record_slo_export_audit_access_phase42(uuid,uuid,text,jsonb),
  public.propose_slo_owner_succession_phase42(uuid,uuid,text,uuid)
  to service_role;
