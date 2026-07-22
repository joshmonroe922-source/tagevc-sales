-- Phase 42: production authenticity/settlement SLO snapshots on top of Phase 41
-- production ledgers (probes, settlement lag, corrections). Safe to re-run.
-- Depends on phase41_marketing_production_ledgers.sql.
-- Never mutates snapshot retirement tables.

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

-- ---------------------------------------------------------------------------
-- Append-only authenticity SLO snapshots (probe fail rates by source/profile/mode)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_authenticity_slo_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  ledger_profile text not null check (ledger_profile in ('production_v1','sandbox_v1')),
  authenticity_mode text not null check (authenticity_mode in
    ('hmac_sha256','request_id','signed_headers_v1','jwt_bearer_v1')),
  window_days integer not null check (window_days between 1 and 90),
  probe_count integer not null check (probe_count >= 0),
  fail_count integer not null check (fail_count >= 0 and fail_count <= probe_count),
  fail_rate numeric(8,4),
  severity text not null check (severity in
    ('healthy','warning','critical','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body'
  ]))
);

create index if not exists os_mkt_rev_auth_slo_entity_idx
  on public.os_marketing_revenue_authenticity_slo_snapshots
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_auth_slo_source_idx
  on public.os_marketing_revenue_authenticity_slo_snapshots
    (source_id, created_at desc);

alter table public.os_marketing_revenue_authenticity_slo_snapshots
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only settlement SLO snapshots (overdue/late rates)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_settlement_slo_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  window_days integer not null check (window_days between 1 and 90),
  evidence_count integer not null check (evidence_count >= 0),
  overdue_count integer not null check (overdue_count >= 0),
  settled_late_count integer not null check (settled_late_count >= 0),
  overdue_rate numeric(8,4),
  late_rate numeric(8,4),
  severity text not null check (severity in
    ('healthy','warning','critical','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body'
  ]))
);

create index if not exists os_mkt_rev_settle_slo_entity_idx
  on public.os_marketing_revenue_settlement_slo_snapshots
    (entity_id, created_at desc);

alter table public.os_marketing_revenue_settlement_slo_snapshots
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_authenticity_slo_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_authenticity_slo_snapshots from service_role;
  grant select on public.os_marketing_revenue_authenticity_slo_snapshots
    to service_role;

  revoke all on public.os_marketing_revenue_settlement_slo_snapshots
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_settlement_slo_snapshots from service_role;
  grant select on public.os_marketing_revenue_settlement_slo_snapshots
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase42_slo_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 42 SLO snapshots are append-only';
end;
$$;

drop trigger if exists os_mkt_rev_auth_slo_immutable
  on public.os_marketing_revenue_authenticity_slo_snapshots;
create trigger os_mkt_rev_auth_slo_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_authenticity_slo_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase42_slo_mutation();

drop trigger if exists os_mkt_rev_settle_slo_immutable
  on public.os_marketing_revenue_settlement_slo_snapshots;
create trigger os_mkt_rev_settle_slo_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_settlement_slo_snapshots
  for each statement
  execute function public.prevent_marketing_revenue_phase42_slo_mutation();

-- ---------------------------------------------------------------------------
-- Optional production_v1 gate: HTTPS + production_ledger + strong authenticity
-- ---------------------------------------------------------------------------
create or replace function public.upsert_marketing_revenue_source(p_source jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_account record;
  v_source public.os_marketing_revenue_sources%rowtype;
  v_mode text;
  v_profile text;
  v_kind text;
  v_endpoint text;
begin
  v_mode := coalesce(p_source->>'authenticity_mode','');
  v_profile := coalesce(nullif(p_source->>'ledger_profile',''),'sandbox_v1');
  v_kind := coalesce(nullif(p_source->>'ledger_kind',''),'ad_platform');
  v_endpoint := coalesce(p_source->>'endpoint_url','');

  if (v_mode not in
        ('hmac_sha256','request_id','signed_headers_v1','jwt_bearer_v1'))
    or (v_profile not in ('production_v1','sandbox_v1'))
    or (v_kind not in ('ad_platform','production_ledger')) then
    raise exception 'Revenue source ledger or authenticity contract is invalid';
  end if;

  if (v_mode in ('hmac_sha256','signed_headers_v1','jwt_bearer_v1')
      and coalesce(p_source->>'signature_env_name','') = '') then
    raise exception 'Signature-backed authenticity modes require signature_env_name';
  end if;

  -- production_v1 gate (HTTPS already required by table check + URL shape here)
  if v_profile = 'production_v1' then
    if (v_endpoint !~ '^https://')
      or (v_kind is distinct from 'production_ledger')
      or (v_mode not in ('hmac_sha256','signed_headers_v1','jwt_bearer_v1')) then
      raise exception
        'production_v1 requires HTTPS, production_ledger, and strong authenticity';
    end if;
  end if;

  select account_id,entity_id,external_account_id,account_type,status,scope_status,
    case when platform='facebook' then 'meta_ads'
         when platform='linkedin' then 'linkedin_ads' end provider
  into v_account
  from public.os_marketing_social_accounts
  where account_id=p_source->>'ad_account_id' for share;

  if not found
    or v_account.account_type<>'paid_ads'
    or v_account.status<>'connected'
    or v_account.scope_status<>'healthy'
    or v_account.entity_id is distinct from p_source->>'entity_id'
    or v_account.external_account_id is distinct from p_source->>'external_account_id'
    or v_account.provider is distinct from p_source->>'provider' then
    raise exception 'Revenue source account/entity/provider binding mismatch';
  end if;

  insert into public.os_marketing_revenue_sources(
    source_key,display_name,entity_id,provider,ad_account_id,external_account_id,
    connector_kind,endpoint_url,credential_env_name,signature_env_name,
    authenticity_mode,ledger_profile,ledger_kind,config_status,updated_at)
  values(
    p_source->>'source_key',p_source->>'display_name',v_account.entity_id,
    v_account.provider,v_account.account_id,v_account.external_account_id,
    'authoritative_json_v1',p_source->>'endpoint_url',p_source->>'credential_env_name',
    nullif(p_source->>'signature_env_name',''),v_mode,v_profile,v_kind,
    coalesce(p_source->>'config_status','disabled'),now())
  on conflict(source_key) do update set
    display_name=excluded.display_name,
    endpoint_url=excluded.endpoint_url,
    credential_env_name=excluded.credential_env_name,
    signature_env_name=excluded.signature_env_name,
    authenticity_mode=excluded.authenticity_mode,
    ledger_profile=excluded.ledger_profile,
    ledger_kind=excluded.ledger_kind,
    config_status=excluded.config_status,
    updated_at=now()
  where os_marketing_revenue_sources.entity_id=excluded.entity_id
    and os_marketing_revenue_sources.ad_account_id=excluded.ad_account_id
  returning * into v_source;

  if not found then
    raise exception 'Source identity cannot be rebound';
  end if;
  return jsonb_build_object(
    'source_id',v_source.source_id,
    'source_key',v_source.source_key,
    'ledger_profile',v_source.ledger_profile,
    'ledger_kind',v_source.ledger_kind,
    'authenticity_mode',v_source.authenticity_mode);
end;
$$;

create or replace function public.phase42_authenticity_slo_severity(
  p_probe_count integer,
  p_fail_rate numeric)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_probe_count,0) = 0 then 'unknown'
    when p_fail_rate is null then 'unknown'
    when p_fail_rate >= 0.0500 then 'critical'
    when p_fail_rate >= 0.0100 then 'warning'
    else 'healthy'
  end;
$$;

create or replace function public.phase42_settlement_slo_severity(
  p_evidence_count integer,
  p_overdue_rate numeric,
  p_late_rate numeric)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_evidence_count,0) = 0 then 'unknown'
    when greatest(coalesce(p_overdue_rate,0), coalesce(p_late_rate,0)) >= 0.1500
      then 'critical'
    when greatest(coalesce(p_overdue_rate,0), coalesce(p_late_rate,0)) >= 0.0500
      then 'warning'
    else 'healthy'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Record SLO snapshots (authenticity + settlement) for an entity scope
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase42_slo_snapshots(
  p_entity_id text,
  p_days integer default 30,
  p_ledger_profile text default 'production_v1')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_profile text := coalesce(nullif(p_ledger_profile,''),'production_v1');
  v_auth_inserted integer := 0;
  v_settle_inserted integer := 0;
  v_row record;
  v_fail_rate numeric(8,4);
  v_severity text;
  v_hash text;
  v_overdue_rate numeric(8,4);
  v_late_rate numeric(8,4);
  v_evidence integer;
  v_overdue integer;
  v_late integer;
  v_settle_severity text;
  v_settle_hash text;
  v_entity text;
begin
  if v_profile not in ('production_v1','sandbox_v1') then
    raise exception 'Invalid ledger profile for Phase 42 SLO snapshots';
  end if;

  -- Authenticity probe fail rates by source / profile / mode
  for v_row in
    select s.source_id, s.entity_id, s.ledger_profile, s.authenticity_mode,
      count(p.probe_id)::integer as probe_count,
      count(p.probe_id) filter (where p.probe_result='failed')::integer as fail_count
    from public.os_marketing_revenue_sources s
    left join public.os_marketing_revenue_authenticity_probes p
      on p.source_id = s.source_id
      and p.created_at >= v_since
      and p.entity_id = s.entity_id
    where s.ledger_profile = v_profile
      and (p_entity_id is null or s.entity_id = p_entity_id)
    group by s.source_id, s.entity_id, s.ledger_profile, s.authenticity_mode
  loop
    v_fail_rate := case
      when v_row.probe_count = 0 then null
      else round((v_row.fail_count::numeric / v_row.probe_count::numeric), 4)
    end;
    v_severity := public.phase42_authenticity_slo_severity(
      v_row.probe_count, v_fail_rate);
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase42-v1',
      'kind','authenticity',
      'entity_id',v_row.entity_id,
      'source_id',v_row.source_id,
      'ledger_profile',v_row.ledger_profile,
      'authenticity_mode',v_row.authenticity_mode,
      'window_days',v_days,
      'probe_count',v_row.probe_count,
      'fail_count',v_row.fail_count,
      'fail_rate',v_fail_rate,
      'severity',v_severity
    )::text);

    insert into public.os_marketing_revenue_authenticity_slo_snapshots(
      entity_id,source_id,ledger_profile,authenticity_mode,window_days,
      probe_count,fail_count,fail_rate,severity,metrics_sha256,metadata)
    values (
      v_row.entity_id,v_row.source_id,v_row.ledger_profile,v_row.authenticity_mode,
      v_days,v_row.probe_count,v_row.fail_count,v_fail_rate,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase42-v1',
        'metric','authenticity_probe_fail_rate',
        'warning_threshold',0.0100,
        'critical_threshold',0.0500
      ));
    v_auth_inserted := v_auth_inserted + 1;
  end loop;

  -- Settlement overdue/late rates per entity with production sources in scope
  for v_entity in
    select distinct s.entity_id
    from public.os_marketing_revenue_sources s
    where s.ledger_profile = v_profile
      and (p_entity_id is null or s.entity_id = p_entity_id)
  loop
    v_evidence := 0;
    v_overdue := 0;
    v_late := 0;
    v_overdue_rate := null;
    v_late_rate := null;

    if to_regclass('public.os_marketing_paid_revenue_evidence') is not null then
      execute $q$
        with ranked as (
          select e.*, row_number() over (
            partition by lineage_key
            order by revision desc, received_at desc, evidence_id desc
          ) rn
          from public.os_marketing_paid_revenue_evidence e
          where e.entity_id = $1
            and e.revenue_occurred_at >= $2::timestamptz
            and e.source_payload_verified
            and e.evidence_contract_version = 'phase39-v2'
        ), current_evidence as (
          select *,
            case
              when settlement_status = 'settled'
                and expected_settlement_at is not null
                and settled_at > expected_settlement_at then 'settled_late'
              when settlement_status in ('pending','partial')
                and expected_settlement_at < now() then 'overdue'
              else 'other'
            end as lag_status
          from ranked where rn = 1
        )
        select count(*)::integer,
          count(*) filter (where lag_status='overdue')::integer,
          count(*) filter (where lag_status='settled_late')::integer
        from current_evidence
      $q$
      into v_evidence, v_overdue, v_late
      using v_entity, v_since;
    end if;

    v_overdue_rate := case
      when v_evidence = 0 then null
      else round((v_overdue::numeric / v_evidence::numeric), 4)
    end;
    v_late_rate := case
      when v_evidence = 0 then null
      else round((v_late::numeric / v_evidence::numeric), 4)
    end;
    v_settle_severity := public.phase42_settlement_slo_severity(
      v_evidence, v_overdue_rate, v_late_rate);
    v_settle_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase42-v1',
      'kind','settlement',
      'entity_id',v_entity,
      'window_days',v_days,
      'evidence_count',v_evidence,
      'overdue_count',v_overdue,
      'settled_late_count',v_late,
      'overdue_rate',v_overdue_rate,
      'late_rate',v_late_rate,
      'severity',v_settle_severity
    )::text);

    insert into public.os_marketing_revenue_settlement_slo_snapshots(
      entity_id,window_days,evidence_count,overdue_count,settled_late_count,
      overdue_rate,late_rate,severity,metrics_sha256,metadata)
    values (
      v_entity,v_days,v_evidence,v_overdue,v_late,
      v_overdue_rate,v_late_rate,v_settle_severity,v_settle_hash,
      jsonb_build_object(
        'contract_version','phase42-v1',
        'metric','settlement_overdue_late_rate',
        'warning_threshold',0.0500,
        'critical_threshold',0.1500,
        'ledger_profile',v_profile
      ));
    v_settle_inserted := v_settle_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase42-v1',
    'ledger_profile',v_profile,
    'window_days',v_days,
    'authenticity_snapshots',v_auth_inserted,
    'settlement_snapshots',v_settle_inserted,
    'entity_id',p_entity_id);
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: latest authenticity + settlement SLO snapshots for hub badges
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase42_slo_report(
  p_entity_id text,
  p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_auth jsonb;
  v_settle jsonb;
  v_worst_auth text := 'unknown';
  v_worst_settle text := 'unknown';
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'ledger_profile',l.ledger_profile,
      'authenticity_mode',l.authenticity_mode,
      'window_days',l.window_days,
      'probe_count',l.probe_count,
      'fail_count',l.fail_count,
      'fail_rate',l.fail_rate,
      'severity',l.severity,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.severity desc, l.source_id)
    from (
      select a.*,
        row_number() over (
          partition by a.source_id, a.authenticity_mode, a.ledger_profile
          order by a.created_at desc, a.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_authenticity_slo_snapshots a
      where a.created_at >= v_since
        and (p_entity_id is null or a.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb)
  into v_auth;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'snapshot_id',l.snapshot_id,
      'entity_id',l.entity_id,
      'window_days',l.window_days,
      'evidence_count',l.evidence_count,
      'overdue_count',l.overdue_count,
      'settled_late_count',l.settled_late_count,
      'overdue_rate',l.overdue_rate,
      'late_rate',l.late_rate,
      'severity',l.severity,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.severity desc, l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_settlement_slo_snapshots s
      where s.created_at >= v_since
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 50
  ), '[]'::jsonb)
  into v_settle;

  select coalesce((
    select case
      when bool_or(x.severity = 'critical') then 'critical'
      when bool_or(x.severity = 'warning') then 'warning'
      when bool_or(x.severity = 'healthy') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_auth,'[]'::jsonb))
      as x(severity text)
  ), 'unknown') into v_worst_auth;

  select coalesce((
    select case
      when bool_or(x.severity = 'critical') then 'critical'
      when bool_or(x.severity = 'warning') then 'warning'
      when bool_or(x.severity = 'healthy') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_settle,'[]'::jsonb))
      as x(severity text)
  ), 'unknown') into v_worst_settle;

  return jsonb_build_object(
    'version','phase42-v1',
    'window_days',v_days,
    'authenticity_severity',v_worst_auth,
    'settlement_severity',v_worst_settle,
    'overall_severity',(case
      when v_worst_auth = 'critical' or v_worst_settle = 'critical' then 'critical'
      when v_worst_auth = 'warning' or v_worst_settle = 'warning' then 'warning'
      when v_worst_auth = 'healthy' or v_worst_settle = 'healthy' then 'healthy'
      else 'unknown'
    end),
    'authenticity_snapshots',coalesce(v_auth,'[]'::jsonb),
    'settlement_snapshots',coalesce(v_settle,'[]'::jsonb),
    'thresholds',jsonb_build_object(
      'authenticity_fail_rate',jsonb_build_object(
        'warning',0.0100,'critical',0.0500),
      'settlement_rate',jsonb_build_object(
        'warning',0.0500,'critical',0.1500)
    ));
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase42_slo_mutation()
  from public, anon, authenticated;
revoke all on function public.phase42_authenticity_slo_severity(integer,numeric)
  from public, anon, authenticated;
revoke all on function public.phase42_settlement_slo_severity(integer,numeric,numeric)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase42_slo_snapshots(text,integer,text)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase42_slo_report(text,integer)
  from public, anon, authenticated;
revoke all on function public.upsert_marketing_revenue_source(jsonb)
  from public, anon, authenticated;

grant execute on function public.phase42_authenticity_slo_severity(integer,numeric)
  to authenticated, service_role;
grant execute on function public.phase42_settlement_slo_severity(integer,numeric,numeric)
  to authenticated, service_role;
grant execute on function public.record_marketing_revenue_phase42_slo_snapshots(text,integer,text)
  to service_role;
grant execute on function public.get_marketing_revenue_phase42_slo_report(text,integer)
  to authenticated, service_role;
grant execute on function public.upsert_marketing_revenue_source(jsonb)
  to service_role;
