-- Phase 40: authoritative revenue connectors, canonical ingestion, corrections,
-- completeness, and descriptive attribution-model comparison.
-- Depends on phase39_marketing_attribution_settlement.sql. Safe to re-run.

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


create table if not exists public.os_marketing_revenue_sources (
  source_id uuid primary key default gen_random_uuid(),
  source_key text not null unique check (source_key ~ '^[a-z0-9][a-z0-9_-]{2,63}$'),
  display_name text not null,
  entity_id text not null references public.entities(entity_id),
  provider text not null check (provider in ('meta_ads','linkedin_ads')),
  ad_account_id text not null references public.os_marketing_social_accounts(account_id),
  external_account_id text not null,
  connector_kind text not null check (connector_kind = 'authoritative_json_v1'),
  endpoint_url text not null check (endpoint_url ~ '^https://'),
  credential_env_name text not null check (credential_env_name ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  signature_env_name text check (signature_env_name is null or signature_env_name ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  authenticity_mode text not null check (authenticity_mode in ('hmac_sha256','request_id')),
  config_status text not null default 'disabled'
    check (config_status in ('disabled','ready','invalid')),
  authenticity_status text not null default 'unchecked'
    check (authenticity_status in ('unchecked','verified','failed')),
  transform_version text not null default 'phase40-canonical-v1',
  checkpoint_cursor text,
  checkpoint_at timestamptz,
  next_pull_at timestamptz not null default now(),
  last_error_code text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_marketing_revenue_source_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  source_campaign_id text not null,
  campaign_id text not null references public.os_marketing_campaigns(campaign_id),
  entity_id text not null references public.entities(entity_id),
  ad_account_id text not null references public.os_marketing_social_accounts(account_id),
  external_account_id text not null,
  external_campaign_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (source_id, source_campaign_id)
);

create table if not exists public.os_marketing_revenue_pull_runs (
  run_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  entity_id text not null references public.entities(entity_id),
  ad_account_id text not null,
  transform_version text not null,
  start_cursor text,
  end_cursor text,
  window_start timestamptz not null,
  window_end timestamptz not null,
  status text not null default 'queued'
    check (status in ('queued','leased','retry_wait','completed','failed','superseded')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id text,
  pages_fetched integer not null default 0 check (pages_fetched between 0 and 10),
  expected_records integer check (expected_records between 0 and 500),
  observed_records integer not null default 0 check (observed_records between 0 and 500),
  inserted_records integer not null default 0,
  staged_corrections integer not null default 0,
  late_records integer not null default 0,
  request_ids jsonb not null default '[]'::jsonb,
  receipt_chain_sha256 text,
  error_code text,
  error_detail text,
  queued_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  check (window_end >= window_start and window_end <= window_start + interval '31 days'),
  check (jsonb_typeof(request_ids) = 'array')
);

create table if not exists public.os_marketing_revenue_raw_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_marketing_revenue_pull_runs(run_id),
  page_number integer not null check (page_number between 1 and 10),
  request_id text not null,
  fetched_at timestamptz not null,
  http_status integer not null check (http_status between 200 and 599),
  body_bytes integer not null check (body_bytes between 0 and 1048576),
  body_sha256 text not null check (body_sha256 ~ '^[0-9a-f]{64}$'),
  authenticity_mode text not null,
  authenticity_verified boolean not null,
  cursor_in_sha256 text,
  cursor_out_sha256 text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (run_id, page_number),
  check (jsonb_typeof(metadata) = 'object'),
  check (metadata - 'content_type' = '{}'::jsonb),
  check (not (metadata ?| array['authorization','cookie','set-cookie','token','secret','signature']))
);

create table if not exists public.os_marketing_revenue_allocations (
  allocation_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  source_record_id text not null,
  revenue_event_id text not null,
  source_revision integer not null check (source_revision between 1 and 10000),
  supersedes_allocation_id uuid references public.os_marketing_revenue_allocations(allocation_id),
  correction_status text not null check (correction_status in ('original','approved')),
  correction_reason text,
  entity_id text not null references public.entities(entity_id),
  ad_account_id text not null,
  campaign_id text not null references public.os_marketing_campaigns(campaign_id),
  external_account_id text not null,
  external_campaign_id text not null,
  source_campaign_id text not null,
  cohort_key text not null,
  cohort_window_start timestamptz not null,
  cohort_window_end timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  amount_micros bigint not null check (amount_micros >= 0),
  attribution_model text not null check (attribution_model in
    ('first_touch','last_touch','linear','position_based','provider_reported')),
  attribution_window_days integer not null check (attribution_window_days between 1 and 90),
  transform_version text not null,
  source_recorded_at timestamptz not null,
  source_payload_sha256 text not null check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  binding_sha256 text not null check (binding_sha256 ~ '^[0-9a-f]{64}$'),
  canonical_sha256 text not null check (canonical_sha256 ~ '^[0-9a-f]{64}$'),
  source_run_id uuid not null references public.os_marketing_revenue_pull_runs(run_id),
  received_at timestamptz not null default now(),
  unique (source_id, source_record_id, revenue_event_id, attribution_model,
    cohort_key, source_revision),
  check (cohort_window_end >= cohort_window_start),
  check ((source_revision = 1 and supersedes_allocation_id is null and correction_status = 'original')
    or (source_revision > 1 and supersedes_allocation_id is not null and correction_status = 'approved'))
);

create table if not exists public.os_marketing_revenue_corrections (
  correction_id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  source_run_id uuid not null references public.os_marketing_revenue_pull_runs(run_id),
  supersedes_allocation_id uuid not null references public.os_marketing_revenue_allocations(allocation_id),
  proposed_revision integer not null,
  proposed_row jsonb not null,
  proposed_canonical_sha256 text not null check (proposed_canonical_sha256 ~ '^[0-9a-f]{64}$'),
  reason text not null check (length(reason) between 10 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_reason text,
  created_at timestamptz not null default now(),
  unique (supersedes_allocation_id, proposed_revision)
);

create index if not exists os_mkt_rev_alloc_report_idx on
  public.os_marketing_revenue_allocations(entity_id, cohort_window_start desc, currency);
create index if not exists os_mkt_rev_run_claim_idx on
  public.os_marketing_revenue_pull_runs(status,next_attempt_at,queued_at);

alter table public.os_marketing_revenue_sources enable row level security;
alter table public.os_marketing_revenue_source_bindings enable row level security;
alter table public.os_marketing_revenue_pull_runs enable row level security;
alter table public.os_marketing_revenue_raw_receipts enable row level security;
alter table public.os_marketing_revenue_allocations enable row level security;
alter table public.os_marketing_revenue_corrections enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'os_marketing_revenue_sources','os_marketing_revenue_source_bindings',
    'os_marketing_revenue_pull_runs','os_marketing_revenue_raw_receipts',
    'os_marketing_revenue_allocations','os_marketing_revenue_corrections'
  ] loop
    execute format('revoke all on public.%I from public, anon, authenticated',t);
    execute format('revoke insert, update, delete, truncate, references, trigger on public.%I from service_role',t);
    execute format('grant select on public.%I to service_role',t);
  end loop;
end $$;

create or replace function public.prevent_marketing_revenue_phase40_mutation()
returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin raise exception 'Canonical revenue and receipt rows are immutable'; end $$;
drop trigger if exists os_mkt_rev_allocation_immutable on public.os_marketing_revenue_allocations;
create trigger os_mkt_rev_allocation_immutable before update or delete or truncate
  on public.os_marketing_revenue_allocations for each statement
  execute function public.prevent_marketing_revenue_phase40_mutation();
drop trigger if exists os_mkt_rev_receipt_immutable on public.os_marketing_revenue_raw_receipts;
create trigger os_mkt_rev_receipt_immutable before update or delete or truncate
  on public.os_marketing_revenue_raw_receipts for each statement
  execute function public.prevent_marketing_revenue_phase40_mutation();

create or replace function public.upsert_marketing_revenue_source(p_source jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare v_account record; v_source public.os_marketing_revenue_sources%rowtype;
begin
  select account_id,entity_id,external_account_id,account_type,status,scope_status,
    case when platform='facebook' then 'meta_ads' when platform='linkedin' then 'linkedin_ads' end provider
  into v_account from public.os_marketing_social_accounts
  where account_id=p_source->>'ad_account_id' for share;
  if not found or v_account.account_type<>'paid_ads' or v_account.status<>'connected'
    or v_account.scope_status<>'healthy' or v_account.entity_id is distinct from p_source->>'entity_id'
    or v_account.external_account_id is distinct from p_source->>'external_account_id'
    or v_account.provider is distinct from p_source->>'provider' then
    raise exception 'Revenue source account/entity/provider binding mismatch';
  end if;
  insert into public.os_marketing_revenue_sources(
    source_key,display_name,entity_id,provider,ad_account_id,external_account_id,
    connector_kind,endpoint_url,credential_env_name,signature_env_name,
    authenticity_mode,config_status,updated_at)
  values(p_source->>'source_key',p_source->>'display_name',v_account.entity_id,
    v_account.provider,v_account.account_id,v_account.external_account_id,
    'authoritative_json_v1',p_source->>'endpoint_url',p_source->>'credential_env_name',
    nullif(p_source->>'signature_env_name',''),p_source->>'authenticity_mode',
    coalesce(p_source->>'config_status','disabled'),now())
  on conflict(source_key) do update set display_name=excluded.display_name,
    endpoint_url=excluded.endpoint_url,credential_env_name=excluded.credential_env_name,
    signature_env_name=excluded.signature_env_name,authenticity_mode=excluded.authenticity_mode,
    config_status=excluded.config_status,updated_at=now()
  where os_marketing_revenue_sources.entity_id=excluded.entity_id
    and os_marketing_revenue_sources.ad_account_id=excluded.ad_account_id
  returning * into v_source;
  if not found then raise exception 'Source identity cannot be rebound'; end if;
  return jsonb_build_object('source_id',v_source.source_id,'source_key',v_source.source_key);
end $$;

create or replace function public.bind_marketing_revenue_campaign(
  p_source_id uuid,p_source_campaign_id text,p_campaign_id text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare s record; c record; v_hash text;
begin
  select * into s from public.os_marketing_revenue_sources where source_id=p_source_id for share;
  select * into c from public.os_marketing_campaigns where campaign_id=p_campaign_id for share;
  if not found or c.channel<>'paid' or c.entity_id is distinct from s.entity_id
    or c.ad_account_id is distinct from s.ad_account_id
    or c.external_campaign_id is null or c.ad_platform is distinct from s.provider then
    raise exception 'Revenue source campaign binding mismatch';
  end if;
  v_hash:=public.os_sha256_hex(jsonb_build_object('source_id',s.source_id,'entity_id',s.entity_id,
    'ad_account_id',s.ad_account_id,'external_account_id',s.external_account_id,
    'source_campaign_id',p_source_campaign_id,'campaign_id',c.campaign_id,
    'external_campaign_id',c.external_campaign_id,'currency',upper(
      (select currency from public.os_marketing_social_accounts where account_id=s.ad_account_id)
    ))::text);
  insert into public.os_marketing_revenue_source_bindings(source_id,source_campaign_id,
    campaign_id,entity_id,ad_account_id,external_account_id,external_campaign_id,currency,binding_sha256)
  values(s.source_id,p_source_campaign_id,c.campaign_id,s.entity_id,s.ad_account_id,
    s.external_account_id,c.external_campaign_id,upper((select currency from
    public.os_marketing_social_accounts where account_id=s.ad_account_id)),v_hash)
  on conflict(source_id,source_campaign_id) do update set active=true
  where os_marketing_revenue_source_bindings.binding_sha256=excluded.binding_sha256;
  if not found then raise exception 'Existing source campaign identity cannot be rebound'; end if;
  return jsonb_build_object('binding_sha256',v_hash);
end $$;

create or replace function public.enqueue_due_marketing_revenue_pulls(p_limit integer default 10)
returns integer language plpgsql security definer set search_path = public, extensions as $$
declare s record; n integer:=0; v_start timestamptz; v_end timestamptz;
begin
  for s in select * from public.os_marketing_revenue_sources
    where config_status='ready' and next_pull_at<=now()
    order by next_pull_at for update skip locked limit least(greatest(p_limit,1),20)
  loop
    v_end:=date_trunc('hour',now()); v_start:=greatest(coalesce(s.checkpoint_at,v_end-interval '1 day'),v_end-interval '31 days');
    insert into public.os_marketing_revenue_pull_runs(idempotency_key,source_id,entity_id,
      ad_account_id,transform_version,start_cursor,window_start,window_end)
    values(public.os_sha256_hex(jsonb_build_array(s.source_id,s.checkpoint_cursor,v_start,v_end,
      s.transform_version)::text),s.source_id,s.entity_id,s.ad_account_id,
      s.transform_version,s.checkpoint_cursor,v_start,v_end)
    on conflict(idempotency_key) do nothing;
    if found then n:=n+1; end if;
    update public.os_marketing_revenue_sources set next_pull_at=now()+interval '15 minutes',
      updated_at=now() where source_id=s.source_id;
  end loop;
  return n;
end $$;

create or replace function public.claim_marketing_revenue_pull_runs(
  p_worker_id text,p_limit integer default 1,p_lease_seconds integer default 180)
returns setof public.os_marketing_revenue_pull_runs
language plpgsql security definer set search_path = public, extensions as $$
begin
  return query update public.os_marketing_revenue_pull_runs r set status='leased',
    worker_id=p_worker_id,lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,60),300)),
    attempts=attempts+1,updated_at=now()
  where run_id in (select run_id from public.os_marketing_revenue_pull_runs
    where status in ('queued','retry_wait') and next_attempt_at<=now()
      and attempts<5 order by queued_at for update skip locked
      limit least(greatest(p_limit,1),5))
  returning r.*;
end $$;

create or replace function public.heartbeat_marketing_revenue_pull(
  p_run_id uuid,p_lease_token uuid,p_lease_seconds integer default 180)
returns boolean language plpgsql security definer set search_path = public, extensions as $$
begin
  update public.os_marketing_revenue_pull_runs set
    lease_expires_at=now()+make_interval(secs=>least(greatest(p_lease_seconds,60),300)),
    updated_at=now()
  where run_id=p_run_id and status='leased' and lease_token=p_lease_token
    and lease_expires_at>now();
  return found;
end $$;

create or replace function public.complete_marketing_revenue_pull(
  p_run_id uuid,p_lease_token uuid,p_pages jsonb,p_rows jsonb,
  p_end_cursor text,p_expected_records integer)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.os_marketing_revenue_pull_runs%rowtype; s record; x jsonb; b record;
  prev public.os_marketing_revenue_allocations%rowtype; v_canonical jsonb;
  corr public.os_marketing_revenue_corrections%rowtype;
  v_hash text; v_receipt_chain text; inserted_count integer:=0;
  staged_count integer:=0; late_count integer:=0; page_count integer;
begin
  if jsonb_typeof(p_pages)<>'array' or jsonb_typeof(p_rows)<>'array'
    or jsonb_array_length(p_pages) not between 1 and 10
    or jsonb_array_length(p_rows)>500 or p_expected_records not between 0 and 500 then
    raise exception 'Revenue pull completion payload exceeds contract bounds';
  end if;
  select * into r from public.os_marketing_revenue_pull_runs where run_id=p_run_id for update;
  if not found or r.status<>'leased' or r.lease_token is distinct from p_lease_token
    or r.lease_expires_at<=now() then raise exception 'Revenue pull lease mismatch or expired'; end if;
  select * into s from public.os_marketing_revenue_sources where source_id=r.source_id for update;
  if s.config_status<>'ready' or s.transform_version is distinct from r.transform_version then
    update public.os_marketing_revenue_pull_runs set status='superseded',completed_at=now(),
      lease_token=null,lease_expires_at=null,worker_id=null,error_code='source_config_changed'
      where run_id=r.run_id;
    return jsonb_build_object('status','superseded');
  end if;
  page_count:=jsonb_array_length(p_pages);
  if exists(select 1 from jsonb_array_elements(p_pages) p where
    coalesce(p->>'request_id','')='' or coalesce(p->>'body_sha256','')!~'^[0-9a-f]{64}$'
    or coalesce((p->>'authenticity_verified')::boolean,false)=false
    or jsonb_typeof(coalesce(p->'metadata','{}'::jsonb))<>'object'
    or coalesce(p->'metadata','{}'::jsonb)-'content_type'<>'{}'::jsonb
    or coalesce(p->'metadata','{}'::jsonb) ?| array['authorization','cookie','set-cookie','token','secret','signature'])
    then raise exception 'Receipt metadata or authenticity evidence is invalid'; end if;
  for x in select value from jsonb_array_elements(p_pages) loop
    insert into public.os_marketing_revenue_raw_receipts(run_id,page_number,request_id,
      fetched_at,http_status,body_bytes,body_sha256,authenticity_mode,
      authenticity_verified,cursor_in_sha256,cursor_out_sha256,metadata)
    values(r.run_id,(x->>'page_number')::integer,x->>'request_id',
      (x->>'fetched_at')::timestamptz,(x->>'http_status')::integer,
      (x->>'body_bytes')::integer,x->>'body_sha256',s.authenticity_mode,true,
      nullif(x->>'cursor_in_sha256',''),nullif(x->>'cursor_out_sha256',''),
      coalesce(x->'metadata','{}'::jsonb));
  end loop;
  v_receipt_chain:=public.os_sha256_hex(p_pages::text);
  for x in select value from jsonb_array_elements(p_rows) loop
    if coalesce(x->>'entity_id','')<>s.entity_id
      or coalesce(x->>'ad_account_id','')<>s.ad_account_id
      or coalesce(x->>'external_account_id','')<>s.external_account_id
      or coalesce(x->>'amount_micros','')!~'^\d{1,18}$'
      or coalesce(x->>'currency','')!~'^[A-Z]{3}$'
      or coalesce(x->>'source_payload_sha256','')!~'^[0-9a-f]{64}$'
      or coalesce(x->>'attribution_model','') not in
        ('first_touch','last_touch','linear','position_based','provider_reported')
      or (x->>'source_recorded_at')::timestamptz>now()+interval '5 minutes'
      or (x->>'source_recorded_at')::timestamptz<r.window_start-interval '90 days'
      then raise exception 'Canonical revenue row contract is invalid'; end if;
    select * into b from public.os_marketing_revenue_source_bindings
      where source_id=s.source_id and source_campaign_id=x->>'source_campaign_id' and active for share;
    if not found or b.entity_id<>x->>'entity_id' or b.ad_account_id<>x->>'ad_account_id'
      or b.external_account_id<>x->>'external_account_id'
      or b.external_campaign_id<>x->>'external_campaign_id'
      or b.currency<>x->>'currency' then raise exception 'Canonical row identity/currency binding mismatch'; end if;
    v_canonical:=jsonb_build_object('source_id',s.source_id,'source_record_id',x->>'source_record_id',
      'revenue_event_id',x->>'revenue_event_id','source_revision',(x->>'source_revision')::integer,
      'entity_id',b.entity_id,'ad_account_id',b.ad_account_id,'campaign_id',b.campaign_id,
      'external_account_id',b.external_account_id,'external_campaign_id',b.external_campaign_id,
      'source_campaign_id',b.source_campaign_id,'cohort_key',x->>'cohort_key',
      'cohort_window_start',(x->>'cohort_window_start')::timestamptz,
      'cohort_window_end',(x->>'cohort_window_end')::timestamptz,
      'currency',b.currency,'amount_micros',(x->>'amount_micros')::bigint,
      'attribution_model',x->>'attribution_model',
      'attribution_window_days',(x->>'attribution_window_days')::integer,
      'transform_version',r.transform_version,'source_recorded_at',(x->>'source_recorded_at')::timestamptz,
      'source_payload_sha256',x->>'source_payload_sha256','binding_sha256',b.binding_sha256);
    v_hash:=public.os_sha256_hex(v_canonical::text);
    perform pg_advisory_xact_lock(hashtextextended(concat(s.source_id,':',x->>'source_record_id',
      ':',x->>'revenue_event_id',':',x->>'attribution_model',':',x->>'cohort_key'),40));
    select * into prev from public.os_marketing_revenue_allocations where source_id=s.source_id
      and source_record_id=x->>'source_record_id' and revenue_event_id=x->>'revenue_event_id'
      and attribution_model=x->>'attribution_model' and cohort_key=x->>'cohort_key'
      order by source_revision desc limit 1;
    if (x->>'source_revision')::integer=1 and not found then
      insert into public.os_marketing_revenue_allocations(source_id,source_record_id,revenue_event_id,
        source_revision,correction_status,entity_id,ad_account_id,campaign_id,external_account_id,
        external_campaign_id,source_campaign_id,cohort_key,cohort_window_start,cohort_window_end,
        currency,amount_micros,attribution_model,attribution_window_days,transform_version,
        source_recorded_at,source_payload_sha256,binding_sha256,canonical_sha256,source_run_id)
      values(s.source_id,x->>'source_record_id',x->>'revenue_event_id',1,'original',b.entity_id,
        b.ad_account_id,b.campaign_id,b.external_account_id,b.external_campaign_id,b.source_campaign_id,
        x->>'cohort_key',(x->>'cohort_window_start')::timestamptz,
        (x->>'cohort_window_end')::timestamptz,b.currency,(x->>'amount_micros')::bigint,
        x->>'attribution_model',(x->>'attribution_window_days')::integer,r.transform_version,
        (x->>'source_recorded_at')::timestamptz,x->>'source_payload_sha256',
        b.binding_sha256,v_hash,r.run_id) on conflict do nothing;
      if found then inserted_count:=inserted_count+1; end if;
    elsif found and (x->>'source_revision')::integer=prev.source_revision then
      if prev.canonical_sha256<>v_hash then raise exception 'Source replay changed canonical content'; end if;
    elsif found and (x->>'source_revision')::integer=prev.source_revision+1
      and length(coalesce(x->>'correction_reason','')) between 10 and 500 then
      insert into public.os_marketing_revenue_corrections(source_id,source_run_id,
        supersedes_allocation_id,proposed_revision,proposed_row,proposed_canonical_sha256,reason)
      values(s.source_id,r.run_id,prev.allocation_id,(x->>'source_revision')::integer,
        v_canonical,v_hash,x->>'correction_reason') on conflict do nothing;
      if found then
        staged_count:=staged_count+1;
      else
        select * into corr from public.os_marketing_revenue_corrections
          where supersedes_allocation_id=prev.allocation_id
            and proposed_revision=(x->>'source_revision')::integer;
        if not found or corr.proposed_canonical_sha256<>v_hash then
          raise exception 'Correction replay changed canonical content';
        end if;
      end if;
    else raise exception 'Source revision is non-contiguous or lacks correction reason'; end if;
    if (x->>'source_recorded_at')::timestamptz>r.window_end+interval '24 hours' then late_count:=late_count+1; end if;
  end loop;
  update public.os_marketing_revenue_pull_runs set status='completed',end_cursor=p_end_cursor,
    pages_fetched=page_count,expected_records=p_expected_records,
    observed_records=jsonb_array_length(p_rows),inserted_records=inserted_count,
    staged_corrections=staged_count,late_records=late_count,
    request_ids=(select jsonb_agg(p->>'request_id' order by (p->>'page_number')::int)
      from jsonb_array_elements(p_pages) p),receipt_chain_sha256=v_receipt_chain,
    lease_token=null,lease_expires_at=null,worker_id=null,completed_at=now(),updated_at=now()
    where run_id=r.run_id;
  update public.os_marketing_revenue_sources set checkpoint_cursor=p_end_cursor,
    checkpoint_at=r.window_end,authenticity_status='verified',last_error_code=null,
    updated_at=now() where source_id=s.source_id;
  return jsonb_build_object('status','completed','inserted',inserted_count,
    'staged_corrections',staged_count,'receipt_chain_sha256',v_receipt_chain);
end $$;

create or replace function public.approve_marketing_revenue_correction(
  p_correction_id uuid,p_actor_id uuid,p_decision text,p_review_reason text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare c public.os_marketing_revenue_corrections%rowtype; p public.os_marketing_revenue_allocations%rowtype;
  x jsonb; a uuid;
begin
  if p_decision not in ('approved','rejected') or length(p_review_reason) not between 10 and 500
    then raise exception 'Correction review decision requires a reason'; end if;
  select * into c from public.os_marketing_revenue_corrections where correction_id=p_correction_id for update;
  if not found or c.status<>'pending' then raise exception 'Correction is not pending'; end if;
  select * into p from public.os_marketing_revenue_allocations
    where allocation_id=c.supersedes_allocation_id for share;
  if p.source_revision+1<>c.proposed_revision then raise exception 'Correction lineage is stale'; end if;
  if p_decision='approved' then
    x:=c.proposed_row;
    insert into public.os_marketing_revenue_allocations(source_id,source_record_id,revenue_event_id,
      source_revision,supersedes_allocation_id,correction_status,correction_reason,entity_id,
      ad_account_id,campaign_id,external_account_id,external_campaign_id,source_campaign_id,
      cohort_key,cohort_window_start,cohort_window_end,currency,amount_micros,attribution_model,
      attribution_window_days,transform_version,source_recorded_at,source_payload_sha256,
      binding_sha256,canonical_sha256,source_run_id)
    values(c.source_id,x->>'source_record_id',x->>'revenue_event_id',c.proposed_revision,
      p.allocation_id,'approved',c.reason,x->>'entity_id',x->>'ad_account_id',
      x->>'campaign_id',x->>'external_account_id',x->>'external_campaign_id',
      x->>'source_campaign_id',x->>'cohort_key',(x->>'cohort_window_start')::timestamptz,
      (x->>'cohort_window_end')::timestamptz,x->>'currency',(x->>'amount_micros')::bigint,
      x->>'attribution_model',(x->>'attribution_window_days')::integer,x->>'transform_version',
      (x->>'source_recorded_at')::timestamptz,x->>'source_payload_sha256',
      x->>'binding_sha256',c.proposed_canonical_sha256,c.source_run_id) returning allocation_id into a;
  end if;
  update public.os_marketing_revenue_corrections set status=p_decision,reviewed_by=p_actor_id,
    reviewed_at=now(),review_reason=p_review_reason where correction_id=c.correction_id;
  return jsonb_build_object('status',p_decision,'allocation_id',a);
end $$;

create or replace function public.fail_marketing_revenue_pull(
  p_run_id uuid,p_lease_token uuid,p_retryable boolean,p_error_code text,p_error_detail text)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare r public.os_marketing_revenue_pull_runs%rowtype;
begin
  select * into r from public.os_marketing_revenue_pull_runs where run_id=p_run_id for update;
  if not found or r.status<>'leased' or r.lease_token is distinct from p_lease_token
    then raise exception 'Revenue pull lease mismatch'; end if;
  update public.os_marketing_revenue_pull_runs set
    status=case when p_retryable and attempts<5 then 'retry_wait' else 'failed' end,
    next_attempt_at=now()+make_interval(secs=>least(3600,60*(2^least(attempts,5))::int)),
    lease_token=null,lease_expires_at=null,worker_id=null,error_code=left(p_error_code,100),
    error_detail=left(p_error_detail,1000),completed_at=case when p_retryable and attempts<5 then null else now() end,
    updated_at=now() where run_id=r.run_id;
  update public.os_marketing_revenue_sources set authenticity_status=
    case when p_error_code='authenticity_failed' then 'failed' else authenticity_status end,
    last_error_code=left(p_error_code,100),last_error_at=now(),updated_at=now()
    where source_id=r.source_id;
  return jsonb_build_object('status',case when p_retryable and r.attempts<5 then 'retry_wait' else 'failed' end);
end $$;

create or replace function public.get_marketing_revenue_phase40_report(
  p_entity_id text,p_days integer)
returns jsonb language sql stable security definer set search_path = public, extensions as $$
with cfg as (
  select least(greatest(coalesce(p_days,30),1),90) days,now()-make_interval(days=>least(greatest(coalesce(p_days,30),1),90)) since
), latest as (
  select a.*,row_number() over(partition by source_id,source_record_id,revenue_event_id,
    attribution_model,cohort_key order by source_revision desc,received_at desc) rn
  from public.os_marketing_revenue_allocations a,cfg
  where (p_entity_id is null or a.entity_id=p_entity_id) and a.cohort_window_start>=cfg.since
), current_rows as (select * from latest where rn=1),
source_rows as (
  select s.source_id,s.source_key,s.display_name,s.config_status,s.authenticity_status,
    s.checkpoint_at,count(r.run_id)::int run_count,
    coalesce(sum(r.expected_records),0)::int expected_records,
    coalesce(sum(r.observed_records),0)::int observed_records,
    coalesce(sum(r.late_records),0)::int late_records,
    coalesce(sum(r.staged_corrections),0)::int staged_corrections,
    count(r.run_id) filter(where r.status='failed')::int failed_runs,
    case when count(r.run_id) filter(where r.status='failed')>0 then 'failed'
      when coalesce(sum(r.expected_records),0)=coalesce(sum(r.observed_records),0)
        and count(r.run_id)>0 then 'complete'
      when coalesce(sum(r.observed_records),0)>coalesce(sum(r.expected_records),0)
        then 'denominator_inconsistent'
      when count(r.run_id)>0 then 'incomplete' else 'unavailable' end reconciliation_status
  from public.os_marketing_revenue_sources s cross join cfg
  left join public.os_marketing_revenue_pull_runs r on r.source_id=s.source_id and r.queued_at>=cfg.since
  where p_entity_id is null or s.entity_id=p_entity_id
  group by s.source_id,s.source_key,s.display_name,s.config_status,s.authenticity_status,s.checkpoint_at
), model_sets as (
  select cohort_key,cohort_window_start,cohort_window_end,currency,
    attribution_window_days,attribution_model,count(distinct revenue_event_id)::int event_count,
    public.os_sha256_hex(
      coalesce(jsonb_agg(distinct revenue_event_id order by revenue_event_id),
        '[]'::jsonb)::text) event_set_sha256
  from current_rows group by cohort_key,cohort_window_start,cohort_window_end,
    currency,attribution_window_days,attribution_model
), aligned as (
  select cohort_key,cohort_window_start,cohort_window_end,currency,
    attribution_window_days,count(*)::int model_count,min(event_count)::int event_count
  from model_sets group by cohort_key,cohort_window_start,cohort_window_end,
    currency,attribution_window_days
  having count(*)>=2 and count(distinct event_set_sha256)=1
), comparisons as (
  select a.cohort_key,a.cohort_window_start,a.cohort_window_end,a.currency,
    a.attribution_window_days,a.model_count,a.event_count,c.attribution_model,
    sum(c.amount_micros)::text amount_micros
  from aligned a join current_rows c using(cohort_key,cohort_window_start,cohort_window_end,currency,attribution_window_days)
  group by a.cohort_key,a.cohort_window_start,a.cohort_window_end,a.currency,
    a.attribution_window_days,a.model_count,a.event_count,c.attribution_model
  order by a.cohort_window_start desc,a.cohort_key,c.attribution_model limit 200
)
select jsonb_build_object('version','phase40-v1','comparison_semantics',
  'descriptive allocations on aligned cohorts/windows/currencies; differences do not establish causality',
  'expected_records',(select coalesce(sum(expected_records),0) from source_rows),
  'observed_records',(select coalesce(sum(observed_records),0) from source_rows),
  'completeness_percent',(select case when coalesce(sum(expected_records),0)=0 then null
    else round(100.0*sum(observed_records)/sum(expected_records),2) end from source_rows),
  'late_records',(select coalesce(sum(late_records),0) from source_rows),
  'pending_corrections',(select count(*) from public.os_marketing_revenue_corrections c
    join public.os_marketing_revenue_sources s using(source_id)
    where c.status='pending' and (p_entity_id is null or s.entity_id=p_entity_id)),
  'approved_corrections',(select count(*) from current_rows where source_revision>1),
  'sources',coalesce((select jsonb_agg(to_jsonb(s) order by source_key) from source_rows s),'[]'::jsonb),
  'model_comparisons',coalesce((select jsonb_agg(to_jsonb(c)) from comparisons c),'[]'::jsonb));
$$;

revoke all on function public.prevent_marketing_revenue_phase40_mutation() from public,anon,authenticated;
revoke all on function public.upsert_marketing_revenue_source(jsonb) from public,anon,authenticated;
revoke all on function public.bind_marketing_revenue_campaign(uuid,text,text) from public,anon,authenticated;
revoke all on function public.enqueue_due_marketing_revenue_pulls(integer) from public,anon,authenticated;
revoke all on function public.claim_marketing_revenue_pull_runs(text,integer,integer) from public,anon,authenticated;
revoke all on function public.heartbeat_marketing_revenue_pull(uuid,uuid,integer) from public,anon,authenticated;
revoke all on function public.complete_marketing_revenue_pull(uuid,uuid,jsonb,jsonb,text,integer) from public,anon,authenticated;
revoke all on function public.fail_marketing_revenue_pull(uuid,uuid,boolean,text,text) from public,anon,authenticated;
revoke all on function public.approve_marketing_revenue_correction(uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.get_marketing_revenue_phase40_report(text,integer) from public,anon,authenticated;
grant execute on function public.upsert_marketing_revenue_source(jsonb) to service_role;
grant execute on function public.bind_marketing_revenue_campaign(uuid,text,text) to service_role;
grant execute on function public.enqueue_due_marketing_revenue_pulls(integer) to service_role;
grant execute on function public.claim_marketing_revenue_pull_runs(text,integer,integer) to service_role;
grant execute on function public.heartbeat_marketing_revenue_pull(uuid,uuid,integer) to service_role;
grant execute on function public.complete_marketing_revenue_pull(uuid,uuid,jsonb,jsonb,text,integer) to service_role;
grant execute on function public.fail_marketing_revenue_pull(uuid,uuid,boolean,text,text) to service_role;
grant execute on function public.approve_marketing_revenue_correction(uuid,uuid,text,text) to service_role;
grant execute on function public.get_marketing_revenue_phase40_report(text,integer) to service_role;
