-- Phase 41: SLO simulation exports (signed metadata digests, counterfactual
-- labeled) and owner coverage calendar views.
-- Apply after phase40_slo_governance.sql and phase40_slo_shared_services_hotfix.sql.

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

create table if not exists public.os_slo_simulation_exports (
  export_id uuid primary key default gen_random_uuid(),
  simulation_id uuid not null references public.os_slo_simulations(simulation_id),
  idempotency_key text not null unique,
  contract_version text not null default 'phase41-v1',
  counterfactual boolean not null default true,
  label text not null default 'COUNTERFACTUAL — no production state mutated',
  metadata jsonb not null,
  metadata_canonical_text text not null,
  metadata_digest text not null,
  signature_algorithm text not null,
  signature_key_id text not null,
  metadata_signature text not null,
  result_count integer not null,
  exported_by uuid not null references public.profiles(id),
  exported_at timestamptz not null default now(),
  constraint os_slo_sim_export_contract_check
    check (contract_version='phase41-v1'),
  constraint os_slo_sim_export_counterfactual_check
    check (counterfactual and label='COUNTERFACTUAL — no production state mutated'),
  constraint os_slo_sim_export_digest_check
    check (metadata_digest ~ '^[0-9a-f]{64}$'
      and metadata_signature ~ '^[0-9a-f]{64}$'),
  constraint os_slo_sim_export_signature_check
    check (signature_algorithm='hmac-sha256'
      and signature_key_id ~ '^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$'),
  constraint os_slo_sim_export_idempotency_check
    check (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_sim_export_result_bound
    check (result_count between 0 and 2160),
  constraint os_slo_sim_export_metadata_check
    check (jsonb_typeof(metadata)='object'
      and pg_column_size(metadata)<=8192
      and length(metadata_canonical_text) between 2 and 16384
      and (metadata->>'counterfactual')::boolean
      and metadata->>'label'='COUNTERFACTUAL — no production state mutated')
);

create index if not exists os_slo_sim_exports_sim_idx
  on public.os_slo_simulation_exports(simulation_id,exported_at desc);
create index if not exists os_slo_sim_exports_latest_idx
  on public.os_slo_simulation_exports(exported_at desc,export_id desc);

create table if not exists public.os_slo_simulation_export_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  export_id uuid not null references public.os_slo_simulation_exports(export_id),
  event_type text not null check(event_type in ('exported','replayed')),
  actor_id uuid references public.profiles(id),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_slo_sim_export_evidence_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create or replace function public.prevent_slo_phase41_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_sim_exports_append_only
  on public.os_slo_simulation_exports;
create trigger os_slo_sim_exports_append_only before update or delete
  on public.os_slo_simulation_exports for each row
  execute function public.prevent_slo_phase41_append_only();
drop trigger if exists os_slo_sim_exports_no_truncate
  on public.os_slo_simulation_exports;
create trigger os_slo_sim_exports_no_truncate before truncate
  on public.os_slo_simulation_exports for each statement
  execute function public.prevent_slo_phase41_append_only();
drop trigger if exists os_slo_sim_export_evidence_append_only
  on public.os_slo_simulation_export_evidence;
create trigger os_slo_sim_export_evidence_append_only before update or delete
  on public.os_slo_simulation_export_evidence for each row
  execute function public.prevent_slo_phase41_append_only();
drop trigger if exists os_slo_sim_export_evidence_no_truncate
  on public.os_slo_simulation_export_evidence;
create trigger os_slo_sim_export_evidence_no_truncate before truncate
  on public.os_slo_simulation_export_evidence for each statement
  execute function public.prevent_slo_phase41_append_only();

create or replace function public.phase41_slo_safe_metadata(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=8192
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

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
begin
  if not public.phase39_actor_authorized(p_actor_id,null,true) then
    raise exception 'Actor is not authorized to export SLO simulations';
  end if;
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
    return jsonb_build_object(
      'export_id',v_existing.export_id,
      'simulation_id',v_existing.simulation_id,
      'metadata_digest',v_existing.metadata_digest,
      'metadata_signature',v_existing.metadata_signature,
      'counterfactual',true,
      'label',v_existing.label,
      'replayed',true
    );
  end if;

  insert into public.os_slo_simulation_exports(
    simulation_id,idempotency_key,metadata,metadata_canonical_text,
    metadata_digest,signature_algorithm,signature_key_id,metadata_signature,
    result_count,exported_by
  ) values (
    p_simulation_id,p_idempotency_key,p_metadata,p_metadata_canonical_text,
    p_metadata_digest,p_signature_algorithm,p_signature_key_id,p_metadata_signature,
    v_result_count,p_actor_id
  ) returning export_id into v_export_id;

  insert into public.os_slo_simulation_export_evidence(
    export_id,event_type,actor_id,detail
  ) values (
    v_export_id,'exported',p_actor_id,
    jsonb_build_object(
      'counterfactual',true,
      'result_count',v_result_count,
      'metadata_digest',p_metadata_digest
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
    'replayed',false
  );
end $$;

-- Coverage calendar: day-bucketed owner windows for published policies.
-- Uses phase40_replacement_eligible (security definer) so security_invoker
-- callers never need revoked phase39_owner_authorized.
create or replace view public.os_slo_owner_coverage_calendar
with (security_invoker=true) as
select
  p.policy_id,
  p.service,
  p.metric_key,
  o.entity_id,
  o.owner_id,
  o.replacement_owner_id,
  o.effective_at,
  o.expires_at,
  d.coverage_day::date as coverage_day,
  (d.coverage_day::date >= o.effective_at::date
    and (o.expires_at is null or d.coverage_day::date < o.expires_at::date)
  ) as covered,
  (o.expires_at is not null
    and d.coverage_day::date = o.expires_at::date - 1) as expires_next_day,
  (o.replacement_owner_id is not null
    and public.phase40_replacement_eligible(o.replacement_owner_id,o.entity_id)
  ) as eligible_replacement_named,
  greatest(0,ceil(extract(epoch from(o.expires_at-now()))/86400))::integer
    as days_remaining
from public.os_slo_policies p
join public.os_slo_owners o
  on o.service=p.service
 and o.metric_key=p.metric_key
 and o.active
 and o.effective_at<=now()+interval '90 days'
 and (o.expires_at is null or o.expires_at>now()-interval '1 day')
cross join lateral generate_series(
  greatest(date_trunc('day',now()),date_trunc('day',o.effective_at)),
  least(
    date_trunc('day',now())+interval '89 days',
    coalesce(date_trunc('day',o.expires_at)-interval '1 day',
      date_trunc('day',now())+interval '89 days')
  ),
  interval '1 day'
) as d(coverage_day)
where p.lifecycle_status='published' and p.enabled and o.expires_at is not null;

create or replace function public.get_slo_owner_coverage_calendar_phase41(
  p_days_ahead integer default 90
)
returns table (
  policy_id uuid,
  service text,
  metric_key text,
  entity_id text,
  owner_id uuid,
  replacement_owner_id uuid,
  effective_at timestamptz,
  expires_at timestamptz,
  coverage_day date,
  covered boolean,
  expires_next_day boolean,
  eligible_replacement_named boolean,
  days_remaining integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.policy_id,c.service,c.metric_key,c.entity_id,c.owner_id,
    c.replacement_owner_id,c.effective_at,c.expires_at,c.coverage_day,
    c.covered,c.expires_next_day,c.eligible_replacement_named,c.days_remaining
  from public.os_slo_owner_coverage_calendar c
  where c.coverage_day < (current_date
    + make_interval(days => least(greatest(coalesce(p_days_ahead,90),1),90)))
  order by c.expires_at,c.coverage_day,c.policy_id
  limit 5000;
$$;

create or replace function public.get_slo_simulation_export_phase41(
  p_export_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v public.os_slo_simulation_exports%rowtype;
begin
  if not public.is_firm_wide_access() then
    raise exception 'Firm-wide access required to read SLO simulation exports';
  end if;
  select * into v from public.os_slo_simulation_exports where export_id=p_export_id;
  if not found then
    raise exception 'Simulation export was not found';
  end if;
  return jsonb_build_object(
    'export_id',v.export_id,
    'simulation_id',v.simulation_id,
    'contract_version',v.contract_version,
    'counterfactual',v.counterfactual,
    'label',v.label,
    'metadata',v.metadata,
    'metadata_digest',v.metadata_digest,
    'signature_algorithm',v.signature_algorithm,
    'signature_key_id',v.signature_key_id,
    'metadata_signature',v.metadata_signature,
    'result_count',v.result_count,
    'exported_at',v.exported_at
  );
end $$;

alter table public.os_slo_simulation_exports enable row level security;
alter table public.os_slo_simulation_export_evidence enable row level security;

drop policy if exists "os_slo_sim_exports_select"
  on public.os_slo_simulation_exports;
create policy "os_slo_sim_exports_select"
  on public.os_slo_simulation_exports for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_sim_export_evidence_select"
  on public.os_slo_simulation_export_evidence;
create policy "os_slo_sim_export_evidence_select"
  on public.os_slo_simulation_export_evidence for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_simulation_exports,
  public.os_slo_simulation_export_evidence,
  public.os_slo_owner_coverage_calendar
  to authenticated, service_role;
revoke insert,update,delete,truncate on public.os_slo_simulation_exports,
  public.os_slo_simulation_export_evidence
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase41_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.export_slo_simulation_phase41(
  text,uuid,jsonb,text,text,text,text,text,uuid
) from public,authenticated;
revoke all on function public.get_slo_owner_coverage_calendar_phase41(integer)
  from public,anon;
revoke all on function public.get_slo_simulation_export_phase41(uuid)
  from public,anon;

grant execute on function public.phase41_slo_safe_metadata(jsonb),
  public.get_slo_owner_coverage_calendar_phase41(integer),
  public.get_slo_simulation_export_phase41(uuid)
  to authenticated, service_role;
grant execute on function public.export_slo_simulation_phase41(
  text,uuid,jsonb,text,text,text,text,text,uuid
) to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
