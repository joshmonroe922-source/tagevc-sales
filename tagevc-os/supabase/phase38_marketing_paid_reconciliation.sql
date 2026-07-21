-- Phase 38: authoritative provider-account totals and atomic paid reconciliation.

alter table public.os_marketing_paid_sync_runs
  add column if not exists provider_complete_days integer not null default 0,
  add column if not exists mapping_gap_days integer not null default 0,
  add column if not exists campaign_binding_sha256 text,
  add column if not exists provider_request_ids jsonb not null default '[]'::jsonb,
  add column if not exists reconciliation_status text;
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_phase38_counts_check,
  drop constraint if exists os_mkt_paid_binding_hash_check,
  drop constraint if exists os_mkt_paid_request_ids_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_phase38_counts_check check (
    provider_complete_days >= 0 and mapping_gap_days >= 0
  ),
  add constraint os_mkt_paid_binding_hash_check check (
    campaign_binding_sha256 is null
    or campaign_binding_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint os_mkt_paid_request_ids_check check (
    jsonb_typeof(provider_request_ids) = 'array'
  );
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_reconciliation_status_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_reconciliation_status_check check (
    reconciliation_status is null or reconciliation_status in
      ('pending','complete','mapping_gap','provider_inconsistent')
  );

alter table public.os_marketing_paid_sync_days
  add column if not exists provider_complete boolean not null default false,
  add column if not exists mapping_status text not null default 'unknown';
alter table public.os_marketing_paid_sync_days
  drop constraint if exists os_mkt_paid_day_mapping_status_check;
alter table public.os_marketing_paid_sync_days
  add constraint os_mkt_paid_day_mapping_status_check check (
    mapping_status in ('unknown','complete','gap')
  );

alter table public.os_marketing_paid_contract_checks
  add column if not exists provider_request_ids jsonb not null default '[]'::jsonb;
alter table public.os_marketing_paid_contract_checks
  drop constraint if exists os_mkt_contract_request_ids_check;
alter table public.os_marketing_paid_contract_checks
  add constraint os_mkt_contract_request_ids_check check (
    jsonb_typeof(provider_request_ids) = 'array'
  );

create table if not exists public.os_marketing_paid_account_metrics_daily (
  ad_account_id text not null
    references public.os_marketing_social_accounts(account_id) on delete cascade,
  metric_date date not null,
  entity_id text references public.entities(entity_id),
  provider text not null check (provider in ('meta_ads','linkedin_ads')),
  external_account_id text not null,
  reporting_timezone text not null,
  currency text not null,
  impressions bigint not null check (impressions >= 0),
  clicks bigint not null check (clicks >= 0),
  spend numeric(20,6) not null check (spend >= 0),
  conversions numeric(20,6) check (conversions is null or conversions >= 0),
  mapped_impressions bigint not null check (mapped_impressions >= 0),
  mapped_clicks bigint not null check (mapped_clicks >= 0),
  mapped_spend numeric(20,6) not null check (mapped_spend >= 0),
  mapped_conversions numeric(20,6),
  mapping_status text not null check (mapping_status in ('complete','gap')),
  source_run_id uuid not null
    references public.os_marketing_paid_sync_runs(run_id),
  last_synced_at timestamptz not null default now(),
  primary key (ad_account_id, metric_date)
);
create index if not exists os_mkt_paid_account_metric_entity_date_idx
  on public.os_marketing_paid_account_metrics_daily(entity_id, metric_date desc);
alter table public.os_marketing_paid_account_metrics_daily
  drop constraint if exists os_mkt_paid_account_mapped_conversions_check;
alter table public.os_marketing_paid_account_metrics_daily
  add constraint os_mkt_paid_account_mapped_conversions_check check (
    mapped_conversions is null or mapped_conversions >= 0
  );
alter table public.os_marketing_paid_account_metrics_daily enable row level security;
drop policy if exists "os_mkt_paid_account_metric_select"
  on public.os_marketing_paid_account_metrics_daily;
create policy "os_mkt_paid_account_metric_select"
  on public.os_marketing_paid_account_metrics_daily for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_marketing_paid_account_metrics_daily to authenticated;
revoke insert, update, delete on public.os_marketing_paid_account_metrics_daily
  from authenticated;

create or replace function public.clear_marketing_paid_account_metrics_on_revision()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.paid_connection_revision is distinct from old.paid_connection_revision
  then
    delete from public.os_marketing_paid_account_metrics_daily
    where ad_account_id = new.account_id;
  end if;
  return new;
end;
$$;
drop trigger if exists os_mkt_clear_account_metrics_on_revision
  on public.os_marketing_social_accounts;
create trigger os_mkt_clear_account_metrics_on_revision
after update of paid_connection_revision
on public.os_marketing_social_accounts
for each row execute function
  public.clear_marketing_paid_account_metrics_on_revision();

create or replace function public.enqueue_marketing_paid_sync_v3(
  p_ad_account_id text,
  p_window_start date,
  p_window_end date,
  p_purpose text,
  p_trigger_source text,
  p_requested_by uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_account record;
  v_provider text;
  v_key text;
  v_campaign_count integer;
  v_binding_sha text;
  v_run public.os_marketing_paid_sync_runs%rowtype;
  v_created boolean := false;
begin
  if p_window_end < p_window_start or p_window_end - p_window_start > 6 then
    raise exception 'Paid sync windows must contain 1-7 inclusive dates';
  end if;
  select account_id, entity_id, platform, external_account_id, timezone,
    currency, status, account_type, scope_status, paid_connection_revision
  into v_account from public.os_marketing_social_accounts
  where account_id = p_ad_account_id for update;
  if not found or v_account.account_type <> 'paid_ads'
     or v_account.status <> 'connected' or v_account.scope_status <> 'healthy'
     or nullif(v_account.external_account_id,'') is null
     or nullif(trim(v_account.currency),'') is null then
    raise exception 'Paid account is not eligible for metrics sync';
  end if;
  v_provider := case when v_account.platform = 'facebook' then 'meta_ads'
    when v_account.platform = 'linkedin' then 'linkedin_ads' end;
  if v_provider is null then raise exception 'Unsupported paid provider'; end if;
  select count(*),
    encode(digest(coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id',campaign_id,
      'external_campaign_id',external_campaign_id,
      'conversion_metric',conversion_metric,
      'entity_id',entity_id
    ) order by campaign_id),'[]'::jsonb)::text,'sha256'),'hex')
  into v_campaign_count,v_binding_sha
  from public.os_marketing_campaigns
  where ad_account_id = p_ad_account_id and channel = 'paid'
    and external_campaign_id is not null;
  if v_campaign_count = 0 or v_campaign_count > 200 then
    raise exception 'Paid sync requires 1-200 externally bound campaigns';
  end if;
  v_key := 'paid-v4:' || p_ad_account_id || ':' ||
    v_account.paid_connection_revision || ':' || v_binding_sha || ':' ||
    p_window_start || ':' || p_window_end;
  insert into public.os_marketing_paid_sync_runs (
    idempotency_key, ad_account_id, entity_id, provider, external_account_id,
    reporting_timezone, currency, connection_revision, window_start, window_end,
    purpose, trigger_source, requested_by, campaigns_requested,
    contract_version, validation_status, reconciliation_status,
    campaign_binding_sha256
  ) values (
    v_key, p_ad_account_id, v_account.entity_id, v_provider,
    v_account.external_account_id,
    case when v_provider = 'linkedin_ads' then 'UTC'
      else coalesce(v_account.timezone,'UTC') end,
    upper(v_account.currency), v_account.paid_connection_revision,
    p_window_start, p_window_end, p_purpose, p_trigger_source, p_requested_by,
    v_campaign_count, 'phase38-v2', 'pending', 'pending', v_binding_sha
  ) on conflict (idempotency_key) do nothing
  returning * into v_run;
  v_created := found;
  if not found then
    select * into v_run from public.os_marketing_paid_sync_runs
    where idempotency_key = v_key;
  end if;
  return jsonb_build_object('run_id',v_run.run_id,'status',v_run.status,
    'created',v_created,
    'disposition',case when v_created then 'created' else 'existing' end);
end;
$$;

drop function if exists public.complete_marketing_paid_sync_run_v3(
  uuid,uuid,jsonb,jsonb,integer,text,text,text,jsonb
);
create or replace function public.complete_marketing_paid_sync_run_v3(
  p_run_id uuid,
  p_lease_token uuid,
  p_rows jsonb,
  p_account_rows jsonb,
  p_pages_fetched integer,
  p_response_sha256 text,
  p_provider_request_id text,
  p_provider_request_ids jsonb,
  p_contract_version text,
  p_validation_evidence jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_marketing_paid_sync_runs%rowtype;
  v_account public.os_marketing_social_accounts%rowtype;
  v_row jsonb;
  v_date date;
  v_expected_dates integer;
  v_bound_count integer;
  v_binding_sha text;
  v_written integer := 0;
  v_gap_days integer := 0;
  v_evidence_sha text;
begin
  if jsonb_typeof(p_rows) <> 'array'
     or jsonb_typeof(p_account_rows) <> 'array'
     or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Paid reconciliation payloads must be bounded arrays';
  end if;
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'leased'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'Paid sync lease mismatch or expired';
  end if;
  select * into v_account from public.os_marketing_social_accounts
  where account_id = v_run.ad_account_id for update;
  if not found
     or v_account.paid_connection_revision <> v_run.connection_revision
     or v_account.external_account_id is distinct from v_run.external_account_id
     or v_account.entity_id is distinct from v_run.entity_id
     or (
       case when v_account.platform = 'facebook' then 'meta_ads'
            when v_account.platform = 'linkedin' then 'linkedin_ads'
            else null end
     ) is distinct from v_run.provider then
    update public.os_marketing_paid_sync_runs set
      status = 'superseded', lease_token = null, lease_expires_at = null,
      worker_id = null, completed_at = now(),
      error_code = 'connection_revision_changed',
      retry_disposition = 'superseded', updated_at = now()
    where run_id = p_run_id;
    return jsonb_build_object('run_id', p_run_id, 'status', 'superseded');
  end if;
  select count(*),
    encode(digest(coalesce(jsonb_agg(jsonb_build_object(
      'campaign_id',campaign_id,
      'external_campaign_id',external_campaign_id,
      'conversion_metric',conversion_metric,
      'entity_id',entity_id
    ) order by campaign_id),'[]'::jsonb)::text,'sha256'),'hex')
  into v_bound_count,v_binding_sha
  from public.os_marketing_campaigns
  where ad_account_id = v_run.ad_account_id and channel = 'paid'
    and external_campaign_id is not null;
  if v_bound_count <> v_run.campaigns_requested
     or v_binding_sha is distinct from v_run.campaign_binding_sha256 then
    update public.os_marketing_paid_sync_runs set
      status = 'superseded', lease_token = null, lease_expires_at = null,
      worker_id = null, completed_at = now(),
      error_code = 'campaign_binding_changed',
      retry_disposition = 'superseded', updated_at = now()
    where run_id = p_run_id;
    return jsonb_build_object('run_id',p_run_id,'status','superseded',
      'reason','campaign_binding_changed');
  end if;
  if p_contract_version <> 'phase38-v2'
     or p_response_sha256 !~ '^[0-9a-f]{64}$'
     or coalesce(p_validation_evidence->>'status','') <> 'passed'
     or p_validation_evidence->>'provider' <> v_run.provider
     or p_validation_evidence->>'external_account_id'
       <> v_run.external_account_id
     or p_validation_evidence->>'window_start' <> v_run.window_start::text
     or p_validation_evidence->>'window_end' <> v_run.window_end::text
     or p_validation_evidence->>'contract_version' <> p_contract_version
     or p_validation_evidence->>'response_sha256' <> p_response_sha256
     or jsonb_typeof(p_provider_request_ids) <> 'array'
     or p_validation_evidence->'provider_request_ids'
       is distinct from p_provider_request_ids
     or coalesce((p_validation_evidence->>'page_count')::integer,-1)
       <> p_pages_fetched
     or coalesce((p_validation_evidence->>'row_count')::integer,-1)
       <> jsonb_array_length(p_rows)
     or coalesce((p_validation_evidence->>'account_row_count')::integer,-1)
       <> jsonb_array_length(p_account_rows)
     then
    raise exception 'Provider reconciliation evidence is incomplete';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_provider_request_ids) r
    where jsonb_typeof(r.value) <> 'object'
      or coalesce(r.value->>'scope','') not in
        ('account','account_access','campaign')
      or coalesce(r.value->>'request_id','') = ''
      or jsonb_typeof(r.value->'provider_object_ids') <> 'array'
  ) then
    raise exception 'Provider request ID evidence is malformed';
  end if;

  create temporary table tmp_paid_metrics (
    campaign_id text, external_campaign_id text, metric_date date,
    impressions bigint, clicks bigint, spend numeric(20,6),
    conversions numeric(20,6), provider_metrics jsonb, row_fingerprint text,
    unique (campaign_id, metric_date)
  ) on commit drop;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row->>'campaign_id','') = ''
       or coalesce(v_row->>'external_campaign_id','') = ''
       or coalesce(v_row->>'metric_date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_row->>'impressions','') !~ '^\d+$'
       or coalesce(v_row->>'clicks','') !~ '^\d+$'
       or coalesce(v_row->>'spend','') !~ '^\d+(\.\d{1,6})?$'
       or (v_row->>'conversions' is not null
         and v_row->>'conversions' !~ '^\d+(\.\d{1,6})?$') then
      raise exception 'Malformed paid campaign metric row';
    end if;
    if not exists (
      select 1 from public.os_marketing_campaigns c
      where c.campaign_id = v_row->>'campaign_id'
        and c.ad_account_id = v_run.ad_account_id and c.channel = 'paid'
        and c.external_campaign_id = v_row->>'external_campaign_id'
        and c.entity_id is not distinct from v_run.entity_id
    ) then
      raise exception 'Metric row current campaign binding mismatch';
    end if;
    v_date := (v_row->>'metric_date')::date;
    if v_date < v_run.window_start or v_date > v_run.window_end then
      raise exception 'Metric date outside leased window';
    end if;
    insert into tmp_paid_metrics values (
      v_row->>'campaign_id', v_row->>'external_campaign_id', v_date,
      (v_row->>'impressions')::bigint, (v_row->>'clicks')::bigint,
      (v_row->>'spend')::numeric,
      case when v_row->>'conversions' is null then null
        else (v_row->>'conversions')::numeric end,
      coalesce(v_row->'provider_metrics','{}'::jsonb),
      v_row->>'row_fingerprint'
    );
  end loop;

  create temporary table tmp_paid_account (
    metric_date date primary key, impressions bigint, clicks bigint,
    spend numeric(20,6), conversions numeric(20,6),
    mapped_impressions bigint, mapped_clicks bigint,
    mapped_spend numeric(20,6), mapped_conversions numeric(20,6),
    mapping_status text
  ) on commit drop;
  for v_row in select value from jsonb_array_elements(p_account_rows)
  loop
    if coalesce(v_row->>'metric_date','') !~ '^\d{4}-\d{2}-\d{2}$'
       or coalesce(v_row->>'impressions','') !~ '^\d+$'
       or coalesce(v_row->>'clicks','') !~ '^\d+$'
       or coalesce(v_row->>'spend','') !~ '^\d+(\.\d{1,6})?$'
       or (v_row->>'conversions' is not null
         and v_row->>'conversions' !~ '^\d+(\.\d{1,6})?$') then
      raise exception 'Malformed provider account metric row';
    end if;
    v_date := (v_row->>'metric_date')::date;
    if v_date < v_run.window_start or v_date > v_run.window_end then
      raise exception 'Provider account date outside leased window';
    end if;
    insert into tmp_paid_account
    select v_date, (v_row->>'impressions')::bigint,
      (v_row->>'clicks')::bigint, (v_row->>'spend')::numeric,
      case when v_row->>'conversions' is null then null
        else (v_row->>'conversions')::numeric end,
      coalesce(sum(t.impressions),0)::bigint,
      coalesce(sum(t.clicks),0)::bigint,
      coalesce(sum(t.spend),0)::numeric(20,6),
      coalesce(sum(t.conversions),0)::numeric(20,6), 'complete'
    from tmp_paid_metrics t where t.metric_date = v_date;
  end loop;
  v_expected_dates := v_run.window_end - v_run.window_start + 1;
  if (select count(*) from tmp_paid_account) <> v_expected_dates
     or exists (
       select 1 from generate_series(v_run.window_start, v_run.window_end,
         interval '1 day') d
       where not exists (select 1 from tmp_paid_account a
         where a.metric_date = d::date)
     ) then
    raise exception 'Provider account totals must explicitly cover every date';
  end if;
  if exists (
    select 1 from tmp_paid_account
    where mapped_impressions > impressions or mapped_clicks > clicks
      or mapped_spend > spend
      or (conversions is not null and mapped_conversions > conversions)
  ) then
    raise exception 'Provider account totals are inconsistent with mapped sums';
  end if;
  update tmp_paid_account set mapping_status = 'gap'
  where mapped_impressions <> impressions or mapped_clicks <> clicks
    or mapped_spend <> spend
    or (conversions is not null and mapped_conversions <> conversions);
  select count(*) into v_gap_days from tmp_paid_account
  where mapping_status = 'gap';

  delete from public.os_marketing_paid_metrics_daily
  where ad_account_id = v_run.ad_account_id
    and metric_date between v_run.window_start and v_run.window_end;
  insert into public.os_marketing_paid_metrics_daily (
    campaign_id, ad_account_id, entity_id, provider, external_account_id,
    external_campaign_id, metric_date, reporting_timezone, currency,
    impressions, clicks, spend, conversions, provider_metrics,
    last_sync_run_id, row_fingerprint, last_synced_at
  )
  select t.campaign_id, v_run.ad_account_id, v_run.entity_id, v_run.provider,
    v_run.external_account_id, t.external_campaign_id, t.metric_date,
    v_run.reporting_timezone, v_run.currency, t.impressions, t.clicks, t.spend,
    t.conversions, t.provider_metrics, v_run.run_id, t.row_fingerprint, now()
  from tmp_paid_metrics t;
  get diagnostics v_written = row_count;

  delete from public.os_marketing_paid_account_metrics_daily
  where ad_account_id = v_run.ad_account_id
    and metric_date between v_run.window_start and v_run.window_end;
  insert into public.os_marketing_paid_account_metrics_daily (
    ad_account_id, metric_date, entity_id, provider, external_account_id,
    reporting_timezone, currency, impressions, clicks, spend, conversions,
    mapped_impressions, mapped_clicks, mapped_spend, mapped_conversions,
    mapping_status, source_run_id, last_synced_at
  )
  select v_run.ad_account_id, a.metric_date, v_run.entity_id, v_run.provider,
    v_run.external_account_id, v_run.reporting_timezone, v_run.currency,
    a.impressions, a.clicks, a.spend, a.conversions, a.mapped_impressions,
    a.mapped_clicks, a.mapped_spend, a.mapped_conversions, a.mapping_status,
    v_run.run_id, now()
  from tmp_paid_account a;

  insert into public.os_marketing_paid_sync_days (
    ad_account_id, metric_date, entity_id, provider, source_run_id,
    campaigns_requested, rows_written, completed_at,
    provider_complete, mapping_status
  )
  select v_run.ad_account_id, a.metric_date, v_run.entity_id, v_run.provider,
    v_run.run_id, v_run.campaigns_requested,
    (select count(*) from tmp_paid_metrics t where t.metric_date = a.metric_date),
    now(), true, a.mapping_status
  from tmp_paid_account a
  on conflict (ad_account_id, metric_date) do update set
    entity_id = excluded.entity_id, provider = excluded.provider,
    source_run_id = excluded.source_run_id,
    campaigns_requested = excluded.campaigns_requested,
    rows_written = excluded.rows_written, completed_at = excluded.completed_at,
    provider_complete = excluded.provider_complete,
    mapping_status = excluded.mapping_status;

  v_evidence_sha := encode(digest(p_validation_evidence::text,'sha256'),'hex');
  update public.os_marketing_paid_sync_runs set
    status = 'completed', lease_token = null, lease_expires_at = null,
    worker_id = null, pages_fetched = p_pages_fetched,
    campaigns_seen = (select count(distinct campaign_id) from tmp_paid_metrics),
    rows_received = jsonb_array_length(p_rows), rows_written = v_written,
    provider_complete_days = v_expected_dates, mapping_gap_days = v_gap_days,
    reconciliation_status = case when v_gap_days = 0 then 'complete'
      else 'mapping_gap' end,
    response_sha256 = p_response_sha256,
    provider_request_id = p_provider_request_id,
    provider_request_ids = p_provider_request_ids,
    contract_version = p_contract_version, validation_status = 'passed',
    validation_evidence = p_validation_evidence,
    validation_evidence_sha256 = v_evidence_sha,
    error_code = null, error_detail = null, error_class = null,
    retry_disposition = null, completed_at = now(), updated_at = now()
  where run_id = v_run.run_id;
  insert into public.os_marketing_paid_contract_checks (
    run_id, entity_id, provider, contract_version, validation_status,
    page_count, normalized_row_count, provider_request_id,
    provider_request_ids, evidence, evidence_sha256
  ) values (
    v_run.run_id, v_run.entity_id, v_run.provider, p_contract_version, 'passed',
    p_pages_fetched, jsonb_array_length(p_rows), p_provider_request_id,
    p_provider_request_ids, p_validation_evidence, v_evidence_sha
  ) on conflict (run_id, evidence_sha256) do nothing;
  update public.os_marketing_social_accounts set
    paid_metrics_status = case when (
      select count(distinct metric_date)
      from public.os_marketing_paid_sync_days
      where ad_account_id = v_run.ad_account_id and provider_complete
        and metric_date between v_run.window_end - 89 and v_run.window_end
    ) >= 90 then 'healthy' else 'backfilling' end,
    paid_metrics_data_through = (
      select max(metric_date) from public.os_marketing_paid_sync_days
      where ad_account_id = v_run.ad_account_id and provider_complete
    ),
    paid_metrics_last_complete_at = now(), paid_metrics_error = null,
    last_synced_at = now(), updated_at = now()
  where account_id = v_run.ad_account_id
    and paid_connection_revision = v_run.connection_revision;
  return jsonb_build_object('run_id', v_run.run_id, 'status', 'completed',
    'rows_written', v_written, 'mapping_gap_days', v_gap_days,
    'evidence_sha256', v_evidence_sha);
end;
$$;

create or replace function public.fail_marketing_paid_sync_run_v2(
  p_run_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_retry_after_seconds integer,
  p_error_code text,
  p_error_detail text,
  p_error_class text,
  p_http_status integer default null,
  p_validation_evidence jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  v_run public.os_marketing_paid_sync_runs%rowtype;
  v_current public.os_marketing_paid_sync_runs%rowtype;
  v_evidence jsonb := coalesce(p_validation_evidence,'{}'::jsonb);
  v_request_ids jsonb;
  v_hash text;
begin
  v_request_ids := case
    when jsonb_typeof(v_evidence->'provider_request_ids') = 'array'
      then v_evidence->'provider_request_ids'
    else '[]'::jsonb end;
  if p_error_class not in (
    'contract','transport','provider_transient','provider_permanent',
    'authorization','configuration','persistence','lease'
  ) then raise exception 'Invalid paid-sync error class'; end if;
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'leased'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at is null or v_run.lease_expires_at <= now() then
    raise exception 'Paid sync lease mismatch';
  end if;
  v_result := public.fail_marketing_paid_sync_run(
    p_run_id,p_lease_token,p_retryable,p_retry_after_seconds,
    p_error_code,p_error_detail
  );
  select * into v_current from public.os_marketing_paid_sync_runs
  where run_id = p_run_id;
  v_hash := encode(digest(v_evidence::text,'sha256'),'hex');
  update public.os_marketing_paid_sync_runs set
    error_class = p_error_class,
    retry_disposition = case
      when v_current.status = 'retry_wait' then 'automatic'
      when p_error_class in ('authorization','configuration','contract')
        then 'manual_after_correction'
      else 'not_retryable' end,
    last_http_status = p_http_status,
    retry_after_seconds = case when p_retryable
      then least(greatest(p_retry_after_seconds,60),21600) end,
    validation_status = case when p_error_class = 'contract'
      then 'failed' else validation_status end,
    validation_evidence = v_evidence,
    validation_evidence_sha256 = v_hash,
    provider_request_ids = v_request_ids,
    reconciliation_status = case
      when p_error_code like 'provider_%'
        or p_error_code like '%account_total%'
        or p_error_code like '%pagination%'
      then 'provider_inconsistent' else reconciliation_status end,
    updated_at = now()
  where run_id = p_run_id;
  insert into public.os_marketing_paid_contract_checks (
    run_id,entity_id,provider,contract_version,validation_status,page_count,
    normalized_row_count,provider_request_id,provider_request_ids,
    evidence,evidence_sha256
  ) values (
    p_run_id,v_run.entity_id,v_run.provider,'phase38-v2','failed',0,0,null,
    v_request_ids,v_evidence,v_hash
  ) on conflict (run_id,evidence_sha256) do nothing;
  return v_result || jsonb_build_object('evidence_sha256',v_hash);
end;
$$;

create or replace function public.get_marketing_paid_report_v2(
  p_entity_id text,
  p_days integer
) returns jsonb
language sql stable security definer set search_path = public
as $$
with settings as (
  select least(greatest(p_days,1),90) as expected_days
),
eligible as (
  select a.account_id, a.entity_id, a.display_name,
    upper(a.currency) as currency,
    ((now() at time zone case when a.platform = 'linkedin' then 'UTC'
      when exists (select 1 from pg_timezone_names z where z.name = a.timezone)
        then a.timezone else 'UTC' end)::date - 1) as report_end
  from public.os_marketing_social_accounts a
  where a.account_type = 'paid_ads' and a.status = 'connected'
    and a.scope_status = 'healthy'
    and (p_entity_id is null or a.entity_id = p_entity_id)
),
metrics as (
  select m.* from public.os_marketing_paid_account_metrics_daily m
  join eligible e on e.account_id = m.ad_account_id
  cross join settings s
  where m.metric_date between e.report_end - (s.expected_days - 1)
    and e.report_end
),
account_totals as (
  select ad_account_id,
    sum(impressions)::bigint as authoritative_impressions,
    sum(clicks)::bigint as authoritative_clicks,
    sum(spend)::numeric as authoritative_spend,
    case when bool_and(conversions is null) then null
      else sum(coalesce(conversions,0))::numeric end
      as authoritative_conversions,
    sum(mapped_impressions)::bigint as mapped_impressions,
    sum(mapped_clicks)::bigint as mapped_clicks,
    sum(mapped_spend)::numeric as mapped_spend,
    case when bool_and(mapped_conversions is null) then null
      else sum(coalesce(mapped_conversions,0))::numeric end
      as mapped_conversions
  from metrics group by ad_account_id
),
account_rows as (
  select e.account_id, e.entity_id, e.display_name, e.currency,
    count(d.metric_date)::integer as covered_days,
    count(d.metric_date) filter (where d.mapping_status = 'complete')::integer
      as mapping_complete_days,
    count(d.metric_date) filter (where d.mapping_status = 'gap')::integer
      as mapping_gap_days,
    max(d.metric_date) as latest_covered_date,
    s.expected_days,
    coalesce(t.authoritative_impressions,0) as authoritative_impressions,
    coalesce(t.authoritative_clicks,0) as authoritative_clicks,
    coalesce(t.authoritative_spend,0) as authoritative_spend,
    t.authoritative_conversions,
    coalesce(t.mapped_impressions,0) as mapped_impressions,
    coalesce(t.mapped_clicks,0) as mapped_clicks,
    coalesce(t.mapped_spend,0) as mapped_spend,
    t.mapped_conversions,
    coalesce(t.authoritative_impressions,0)
      - coalesce(t.mapped_impressions,0) as delta_impressions,
    coalesce(t.authoritative_clicks,0)
      - coalesce(t.mapped_clicks,0) as delta_clicks,
    coalesce(t.authoritative_spend,0)
      - coalesce(t.mapped_spend,0) as delta_spend,
    case when t.authoritative_conversions is null then null
      else t.authoritative_conversions - coalesce(t.mapped_conversions,0) end
      as delta_conversions,
    case when count(d.metric_date) = s.expected_days then 'complete'
      when count(d.metric_date) > 0 then 'partial' else 'unavailable' end
      as coverage_status
  from eligible e cross join settings s
  left join public.os_marketing_paid_sync_days d
    on d.ad_account_id = e.account_id and d.provider_complete
    and d.metric_date between e.report_end - (s.expected_days - 1)
      and e.report_end
  left join account_totals t on t.ad_account_id = e.account_id
  group by e.account_id,e.entity_id,e.display_name,e.currency,s.expected_days,
    t.authoritative_impressions,t.authoritative_clicks,t.authoritative_spend,
    t.authoritative_conversions,t.mapped_impressions,t.mapped_clicks,
    t.mapped_spend,t.mapped_conversions
),
currency_totals as (
  select upper(currency) as currency, sum(impressions)::bigint as impressions,
    sum(clicks)::bigint as clicks, sum(spend)::numeric as spend,
    sum(coalesce(conversions,0))::numeric as conversions
  from metrics group by upper(currency)
),
daily as (
  select metric_date as day, sum(impressions)::bigint as impressions,
    sum(clicks)::bigint as clicks, sum(spend)::numeric as spend,
    sum(coalesce(conversions,0))::numeric as conversions
  from metrics group by metric_date
)
select jsonb_build_object(
  'version','phase38-v2',
  'expected_days',(select expected_days from settings),
  'overall_status',case
    when not exists (select 1 from account_rows) then 'unavailable'
    when (select every(coverage_status = 'complete') from account_rows)
      and exists (select 1 from account_rows where mapping_gap_days > 0)
      then 'complete_with_mapping_gaps'
    when (select every(coverage_status = 'complete') from account_rows)
      then 'complete'
    when exists (select 1 from account_rows where covered_days > 0)
      then 'partial' else 'unavailable' end,
  'accounts',coalesce((select jsonb_agg(to_jsonb(a) order by entity_id,account_id)
    from account_rows a),'[]'::jsonb),
  'currencies',coalesce((select jsonb_agg(to_jsonb(c) order by currency)
    from currency_totals c),'[]'::jsonb),
  'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day)
    from daily d),'[]'::jsonb)
);
$$;

revoke all on function public.complete_marketing_paid_sync_run_v3(
  uuid,uuid,jsonb,jsonb,integer,text,text,jsonb,text,jsonb
) from public, authenticated;
revoke all on function public.enqueue_marketing_paid_sync_v3(
  text,date,date,text,text,uuid
) from public, authenticated;
revoke all on function public.fail_marketing_paid_sync_run_v2(
  uuid,uuid,boolean,integer,text,text,text,integer,jsonb
) from public, authenticated;
revoke all on function public.get_marketing_paid_report_v2(text,integer)
  from public;
revoke all on function public.clear_marketing_paid_account_metrics_on_revision()
  from public, authenticated;
grant execute on function public.enqueue_marketing_paid_sync_v3(
  text,date,date,text,text,uuid
) to service_role;
grant execute on function public.complete_marketing_paid_sync_run_v3(
  uuid,uuid,jsonb,jsonb,integer,text,text,jsonb,text,jsonb
) to service_role;
grant execute on function public.fail_marketing_paid_sync_run_v2(
  uuid,uuid,boolean,integer,text,text,text,integer,jsonb
) to service_role;
grant execute on function public.get_marketing_paid_report_v2(text,integer)
  to service_role;
