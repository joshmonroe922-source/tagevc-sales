-- Phase 41: production ledger profiles, expanded authenticity modes,
-- authenticity probe evidence, settlement-lag summary, and phase41 report.
-- Depends on phase40_marketing_authoritative_revenue.sql and
-- phase39_marketing_attribution_settlement.sql. Safe to re-run.

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

alter table public.os_marketing_revenue_sources
  add column if not exists ledger_profile text;
alter table public.os_marketing_revenue_sources
  add column if not exists ledger_kind text;

update public.os_marketing_revenue_sources
  set ledger_profile = 'sandbox_v1' where ledger_profile is null;
update public.os_marketing_revenue_sources
  set ledger_kind = 'ad_platform' where ledger_kind is null;

alter table public.os_marketing_revenue_sources
  alter column ledger_profile set default 'sandbox_v1';
alter table public.os_marketing_revenue_sources
  alter column ledger_kind set default 'ad_platform';
alter table public.os_marketing_revenue_sources
  alter column ledger_profile set not null;
alter table public.os_marketing_revenue_sources
  alter column ledger_kind set not null;

alter table public.os_marketing_revenue_sources
  drop constraint if exists os_marketing_revenue_sources_authenticity_mode_check;
alter table public.os_marketing_revenue_sources
  add constraint os_marketing_revenue_sources_authenticity_mode_check
  check (authenticity_mode in
    ('hmac_sha256','request_id','signed_headers_v1','jwt_bearer_v1'));

alter table public.os_marketing_revenue_sources
  drop constraint if exists os_marketing_revenue_sources_ledger_profile_check;
alter table public.os_marketing_revenue_sources
  add constraint os_marketing_revenue_sources_ledger_profile_check
  check (ledger_profile in ('production_v1','sandbox_v1'));

alter table public.os_marketing_revenue_sources
  drop constraint if exists os_marketing_revenue_sources_ledger_kind_check;
alter table public.os_marketing_revenue_sources
  add constraint os_marketing_revenue_sources_ledger_kind_check
  check (ledger_kind in ('ad_platform','production_ledger'));

create table if not exists public.os_marketing_revenue_authenticity_probes (
  probe_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  run_id uuid references public.os_marketing_revenue_pull_runs(run_id),
  entity_id text not null references public.entities(entity_id),
  authenticity_mode text not null check (authenticity_mode in
    ('hmac_sha256','request_id','signed_headers_v1','jwt_bearer_v1')),
  probe_result text not null check (probe_result in ('verified','failed')),
  page_number integer check (page_number is null or page_number between 1 and 10),
  request_id_sha256 text check (request_id_sha256 is null
    or request_id_sha256 ~ '^[0-9a-f]{64}$'),
  body_sha256 text check (body_sha256 is null or body_sha256 ~ '^[0-9a-f]{64}$'),
  header_digest_sha256 text check (header_digest_sha256 is null
    or header_digest_sha256 ~ '^[0-9a-f]{64}$'),
  claims_digest_sha256 text check (claims_digest_sha256 is null
    or claims_digest_sha256 ~ '^[0-9a-f]{64}$'),
  error_code text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (metadata - 'content_type' - 'alg' - 'kid' = '{}'::jsonb),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt'
  ]))
);

create index if not exists os_mkt_rev_probe_source_idx
  on public.os_marketing_revenue_authenticity_probes(source_id, created_at desc);
create index if not exists os_mkt_rev_probe_entity_idx
  on public.os_marketing_revenue_authenticity_probes(entity_id, created_at desc);

alter table public.os_marketing_revenue_authenticity_probes enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_authenticity_probes
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_authenticity_probes from service_role;
  grant select on public.os_marketing_revenue_authenticity_probes to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase41_probe_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Authenticity probe rows are immutable';
end;
$$;

drop trigger if exists os_mkt_rev_probe_immutable
  on public.os_marketing_revenue_authenticity_probes;
create trigger os_mkt_rev_probe_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_authenticity_probes
  for each statement
  execute function public.prevent_marketing_revenue_phase41_probe_mutation();

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
begin
  v_mode := coalesce(p_source->>'authenticity_mode','');
  v_profile := coalesce(nullif(p_source->>'ledger_profile',''),'sandbox_v1');
  v_kind := coalesce(nullif(p_source->>'ledger_kind',''),'ad_platform');
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

create or replace function public.record_marketing_revenue_authenticity_probe(
  p_probe jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  s record;
  v_id uuid;
  v_meta jsonb;
begin
  select * into s
  from public.os_marketing_revenue_sources
  where source_id=(p_probe->>'source_id')::uuid for share;
  if not found then
    raise exception 'Authenticity probe source was not found';
  end if;
  if coalesce(p_probe->>'authenticity_mode','') is distinct from s.authenticity_mode then
    raise exception 'Authenticity probe mode does not match source configuration';
  end if;
  if coalesce(p_probe->>'probe_result','') not in ('verified','failed') then
    raise exception 'Authenticity probe result is invalid';
  end if;
  if coalesce(p_probe->>'entity_id','') is distinct from s.entity_id then
    raise exception 'Authenticity probe entity scope mismatch';
  end if;

  v_meta := coalesce(p_probe->'metadata','{}'::jsonb);
  if jsonb_typeof(v_meta)<>'object'
    or v_meta - 'content_type' - 'alg' - 'kid' <> '{}'::jsonb
    or v_meta ?| array[
      'authorization','cookie','set-cookie','token','secret','signature','jwt'
    ] then
    raise exception 'Authenticity probe metadata is invalid';
  end if;

  insert into public.os_marketing_revenue_authenticity_probes(
    source_id,run_id,entity_id,authenticity_mode,probe_result,page_number,
    request_id_sha256,body_sha256,header_digest_sha256,claims_digest_sha256,
    error_code,metadata)
  values(
    s.source_id,
    nullif(p_probe->>'run_id','')::uuid,
    s.entity_id,
    s.authenticity_mode,
    p_probe->>'probe_result',
    nullif(p_probe->>'page_number','')::integer,
    nullif(p_probe->>'request_id_sha256',''),
    nullif(p_probe->>'body_sha256',''),
    nullif(p_probe->>'header_digest_sha256',''),
    nullif(p_probe->>'claims_digest_sha256',''),
    left(nullif(p_probe->>'error_code',''),100),
    v_meta)
  returning probe_id into v_id;

  return jsonb_build_object('probe_id',v_id,'probe_result',p_probe->>'probe_result');
end;
$$;

create or replace function public.get_marketing_revenue_settlement_lag_phase41(
  p_entity_id text,
  p_days integer)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(days => least(greatest(coalesce(p_days,30),1),90));
  v_result jsonb;
begin
  if to_regclass('public.os_marketing_paid_revenue_evidence') is null then
    return jsonb_build_object(
      'available',false,
      'overdue_count',0,
      'settled_late_count',0,
      'max_lag_days',null,
      'average_lag_days',null,
      'by_status','[]'::jsonb);
  end if;

  execute $q$
    with ranked as (
      select e.*, row_number() over (
        partition by lineage_key
        order by revision desc, received_at desc, evidence_id desc
      ) rn
      from public.os_marketing_paid_revenue_evidence e
      where ($1::text is null or e.entity_id = $1)
        and e.revenue_occurred_at >= $2::timestamptz
        and e.source_payload_verified
        and e.evidence_contract_version = 'phase39-v2'
    ), current_evidence as (
      select *,
        case
          when settlement_status = 'settled'
            and expected_settlement_at is not null
            and settled_at > expected_settlement_at then 'settled_late'
          when settlement_status = 'settled' then 'settled_on_time'
          when settlement_status in ('pending','partial')
            and expected_settlement_at < now() then 'overdue'
          when settlement_status = 'reversed' then 'reversed'
          else 'pending'
        end as lag_status,
        case
          when settled_at is not null and expected_settlement_at is not null
            then greatest(0, ceil(extract(epoch from
              (settled_at - expected_settlement_at)) / 86400.0))::integer
          when expected_settlement_at is not null and expected_settlement_at < now()
            then greatest(0, ceil(extract(epoch from
              (now() - expected_settlement_at)) / 86400.0))::integer
          else null
        end as settlement_lag_days
      from ranked where rn = 1
    ), lag_rows as (
      select lag_status,
        count(*)::integer as evidence_count,
        max(settlement_lag_days)::integer as max_lag_days,
        round(avg(settlement_lag_days),2) as average_lag_days
      from current_evidence
      group by lag_status
      order by lag_status
      limit 10
    )
    select jsonb_build_object(
      'available',true,
      'overdue_count',(select count(*)::integer from current_evidence
        where lag_status='overdue'),
      'settled_late_count',(select count(*)::integer from current_evidence
        where lag_status='settled_late'),
      'max_lag_days',(select max(settlement_lag_days) from current_evidence),
      'average_lag_days',(select round(avg(settlement_lag_days),2)
        from current_evidence),
      'by_status',coalesce((select jsonb_agg(to_jsonb(l) order by lag_status)
        from lag_rows l),'[]'::jsonb)
    )
  $q$
  into v_result
  using p_entity_id, v_since;

  return coalesce(v_result, jsonb_build_object(
    'available',true,
    'overdue_count',0,
    'settled_late_count',0,
    'max_lag_days',null,
    'average_lag_days',null,
    'by_status','[]'::jsonb,
    'window_days',v_days));
end;
$$;

create or replace function public.get_marketing_revenue_phase41_report(
  p_entity_id text,
  p_days integer)
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $$
with cfg as (
  select least(greatest(coalesce(p_days,30),1),90) days,
    now()-make_interval(days=>least(greatest(coalesce(p_days,30),1),90)) since
), latest as (
  select a.*, row_number() over(
    partition by source_id,source_record_id,revenue_event_id,
      attribution_model,cohort_key
    order by source_revision desc, received_at desc) rn
  from public.os_marketing_revenue_allocations a, cfg
  where (p_entity_id is null or a.entity_id=p_entity_id)
    and a.cohort_window_start>=cfg.since
), current_rows as (
  select * from latest where rn=1
), source_rows as (
  select s.source_id,s.source_key,s.display_name,s.config_status,
    s.authenticity_status,s.authenticity_mode,s.ledger_profile,s.ledger_kind,
    s.checkpoint_at,count(r.run_id)::int run_count,
    coalesce(sum(r.expected_records),0)::int expected_records,
    coalesce(sum(r.observed_records),0)::int observed_records,
    coalesce(sum(r.late_records),0)::int late_records,
    coalesce(sum(r.staged_corrections),0)::int staged_corrections,
    count(r.run_id) filter(where r.status='failed')::int failed_runs,
    case
      when count(r.run_id) filter(where r.status='failed')>0 then 'failed'
      when coalesce(sum(r.expected_records),0)=coalesce(sum(r.observed_records),0)
        and count(r.run_id)>0 then 'complete'
      when coalesce(sum(r.observed_records),0)>coalesce(sum(r.expected_records),0)
        then 'denominator_inconsistent'
      when count(r.run_id)>0 then 'incomplete'
      else 'unavailable'
    end reconciliation_status
  from public.os_marketing_revenue_sources s
  cross join cfg
  left join public.os_marketing_revenue_pull_runs r
    on r.source_id=s.source_id and r.queued_at>=cfg.since
  where p_entity_id is null or s.entity_id=p_entity_id
  group by s.source_id,s.source_key,s.display_name,s.config_status,
    s.authenticity_status,s.authenticity_mode,s.ledger_profile,s.ledger_kind,
    s.checkpoint_at
), mode_rows as (
  select authenticity_mode,
    count(*)::int source_count,
    count(*) filter (where authenticity_status='verified')::int verified_count,
    count(*) filter (where authenticity_status='failed')::int failed_count,
    count(*) filter (where authenticity_status='unchecked')::int unchecked_count
  from public.os_marketing_revenue_sources
  where p_entity_id is null or entity_id=p_entity_id
  group by authenticity_mode
  order by authenticity_mode
), pending_queue as (
  select c.correction_id,c.source_id,s.source_key,s.entity_id,c.proposed_revision,
    c.reason,c.proposed_canonical_sha256,c.created_at,
    left(coalesce(c.proposed_row->>'revenue_event_id',''),200) revenue_event_id,
    left(coalesce(c.proposed_row->>'attribution_model',''),64) attribution_model,
    left(coalesce(c.proposed_row->>'currency',''),3) currency,
    coalesce(c.proposed_row->>'amount_micros','0') amount_micros
  from public.os_marketing_revenue_corrections c
  join public.os_marketing_revenue_sources s using(source_id)
  where c.status='pending'
    and (p_entity_id is null or s.entity_id=p_entity_id)
  order by c.created_at asc
  limit 100
), model_sets as (
  select cohort_key,cohort_window_start,cohort_window_end,currency,
    attribution_window_days,attribution_model,
    count(distinct revenue_event_id)::int event_count,
    public.os_sha256_hex(
      coalesce(jsonb_agg(distinct revenue_event_id order by revenue_event_id),
        '[]'::jsonb)::text) event_set_sha256
  from current_rows
  group by cohort_key,cohort_window_start,cohort_window_end,
    currency,attribution_window_days,attribution_model
), aligned as (
  select cohort_key,cohort_window_start,cohort_window_end,currency,
    attribution_window_days,count(*)::int model_count,min(event_count)::int event_count
  from model_sets
  group by cohort_key,cohort_window_start,cohort_window_end,
    currency,attribution_window_days
  having count(*)>=2 and count(distinct event_set_sha256)=1
), comparisons as (
  select a.cohort_key,a.cohort_window_start,a.cohort_window_end,a.currency,
    a.attribution_window_days,a.model_count,a.event_count,c.attribution_model,
    sum(c.amount_micros)::text amount_micros
  from aligned a
  join current_rows c using(
    cohort_key,cohort_window_start,cohort_window_end,currency,attribution_window_days)
  group by a.cohort_key,a.cohort_window_start,a.cohort_window_end,a.currency,
    a.attribution_window_days,a.model_count,a.event_count,c.attribution_model
  order by a.cohort_window_start desc,a.cohort_key,c.attribution_model
  limit 200
)
select jsonb_build_object(
  'version','phase41-v1',
  'comparison_semantics',
    'descriptive allocations on aligned cohorts/windows/currencies; differences do not establish causality',
  'expected_records',(select coalesce(sum(expected_records),0) from source_rows),
  'observed_records',(select coalesce(sum(observed_records),0) from source_rows),
  'completeness_percent',(select case
    when coalesce(sum(expected_records),0)=0 then null
    else round(100.0*sum(observed_records)/sum(expected_records),2)
  end from source_rows),
  'late_records',(select coalesce(sum(late_records),0) from source_rows),
  'pending_corrections',(select count(*) from pending_queue),
  'approved_corrections',(select count(*) from current_rows where source_revision>1),
  'authenticity_modes',coalesce(
    (select jsonb_agg(to_jsonb(m) order by authenticity_mode) from mode_rows m),
    '[]'::jsonb),
  'pending_correction_queue',coalesce(
    (select jsonb_agg(to_jsonb(q) order by created_at) from pending_queue q),
    '[]'::jsonb),
  'settlement_lag',
    public.get_marketing_revenue_settlement_lag_phase41(p_entity_id,p_days),
  'sources',coalesce(
    (select jsonb_agg(to_jsonb(s) order by source_key) from source_rows s),
    '[]'::jsonb),
  'model_comparisons',coalesce(
    (select jsonb_agg(to_jsonb(c)) from comparisons c),
    '[]'::jsonb));
$$;

revoke all on function public.prevent_marketing_revenue_phase41_probe_mutation()
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_authenticity_probe(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_settlement_lag_phase41(text,integer)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase41_report(text,integer)
  from public, anon, authenticated;
revoke all on function public.upsert_marketing_revenue_source(jsonb)
  from public, anon, authenticated;

grant execute on function public.record_marketing_revenue_authenticity_probe(jsonb)
  to service_role;
grant execute on function public.get_marketing_revenue_settlement_lag_phase41(text,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase41_report(text,integer)
  to authenticated, service_role;
grant execute on function public.upsert_marketing_revenue_source(jsonb)
  to service_role;
grant execute on function public.bind_marketing_revenue_campaign(uuid,text,text)
  to service_role;
grant execute on function public.approve_marketing_revenue_correction(uuid,uuid,text,text)
  to service_role;
