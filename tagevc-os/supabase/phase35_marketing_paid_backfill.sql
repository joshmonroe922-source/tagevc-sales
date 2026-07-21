-- Phase 35: leased, complete-window paid metrics backfills.

create table if not exists public.os_marketing_paid_sync_runs (
  run_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  ad_account_id text not null references public.os_marketing_social_accounts(account_id)
    on delete cascade,
  entity_id text references public.entities(entity_id),
  provider text not null,
  external_account_id text not null,
  reporting_timezone text not null,
  window_start date not null,
  window_end date not null,
  purpose text not null,
  trigger_source text not null,
  status text not null default 'queued',
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id text,
  attempts integer not null default 0,
  next_attempt_at timestamptz,
  pages_fetched integer not null default 0,
  campaigns_requested integer not null default 0,
  campaigns_seen integer not null default 0,
  rows_received integer not null default 0,
  rows_written integer not null default 0,
  response_sha256 text,
  provider_request_id text,
  error_code text,
  error_detail text,
  requested_by uuid,
  queued_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint os_mkt_paid_sync_provider_check
    check (provider in ('meta_ads', 'linkedin_ads')),
  constraint os_mkt_paid_sync_purpose_check
    check (purpose in ('bootstrap_90d', 'rolling_28d', 'manual')),
  constraint os_mkt_paid_sync_trigger_check
    check (trigger_source in ('cron', 'manual')),
  constraint os_mkt_paid_sync_status_check
    check (status in ('queued', 'leased', 'retry_wait', 'completed', 'failed')),
  constraint os_mkt_paid_sync_window_check
    check (window_end >= window_start and window_end - window_start between 0 and 6),
  constraint os_mkt_paid_sync_lease_check
    check ((lease_token is null) = (lease_expires_at is null))
);

create index if not exists os_mkt_paid_sync_claim_idx
  on public.os_marketing_paid_sync_runs (status, next_attempt_at, queued_at)
  where status in ('queued', 'retry_wait', 'leased');
create index if not exists os_mkt_paid_sync_account_idx
  on public.os_marketing_paid_sync_runs (ad_account_id, queued_at desc);
create index if not exists os_mkt_paid_sync_entity_idx
  on public.os_marketing_paid_sync_runs (entity_id, queued_at desc);

create table if not exists public.os_marketing_paid_sync_days (
  ad_account_id text not null references public.os_marketing_social_accounts(account_id)
    on delete cascade,
  metric_date date not null,
  entity_id text references public.entities(entity_id),
  provider text not null check (provider in ('meta_ads', 'linkedin_ads')),
  source_run_id uuid not null references public.os_marketing_paid_sync_runs(run_id),
  campaigns_requested integer not null check (campaigns_requested >= 0),
  rows_written integer not null check (rows_written >= 0),
  completed_at timestamptz not null default now(),
  primary key (ad_account_id, metric_date)
);
create index if not exists os_mkt_paid_sync_days_entity_idx
  on public.os_marketing_paid_sync_days (entity_id, metric_date desc);

alter table public.os_marketing_paid_metrics_daily
  add column if not exists last_sync_run_id uuid
    references public.os_marketing_paid_sync_runs(run_id),
  add column if not exists row_fingerprint text;
alter table public.os_marketing_social_accounts
  add column if not exists paid_metrics_status text not null default 'unknown',
  add column if not exists paid_metrics_data_through date,
  add column if not exists paid_metrics_last_complete_at timestamptz,
  add column if not exists paid_metrics_error text;
alter table public.os_marketing_social_accounts
  drop constraint if exists os_mkt_paid_metrics_status_check;
alter table public.os_marketing_social_accounts
  add constraint os_mkt_paid_metrics_status_check check (
    paid_metrics_status in ('unknown', 'backfilling', 'healthy', 'degraded', 'error')
  );

alter table public.os_marketing_paid_sync_runs enable row level security;
alter table public.os_marketing_paid_sync_days enable row level security;
drop policy if exists "os_mkt_paid_sync_run_select"
  on public.os_marketing_paid_sync_runs;
create policy "os_mkt_paid_sync_run_select" on public.os_marketing_paid_sync_runs
  for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_mkt_paid_sync_day_select"
  on public.os_marketing_paid_sync_days;
create policy "os_mkt_paid_sync_day_select" on public.os_marketing_paid_sync_days
  for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_marketing_paid_sync_runs,
  public.os_marketing_paid_sync_days to authenticated;

create or replace function public.enqueue_marketing_paid_sync(
  p_ad_account_id text,
  p_window_start date,
  p_window_end date,
  p_purpose text,
  p_trigger_source text,
  p_requested_by uuid default null
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_account record;
  v_run_id uuid;
  v_provider text;
  v_key text;
  v_campaign_count integer;
begin
  if p_window_end < p_window_start or p_window_end - p_window_start > 6 then
    raise exception 'Paid sync windows must contain 1-7 inclusive dates';
  end if;
  select account_id, entity_id, platform, external_account_id, timezone,
         status, account_type, scope_status
  into v_account from public.os_marketing_social_accounts
  where account_id = p_ad_account_id for update;
  if not found or v_account.account_type <> 'paid_ads'
     or v_account.status <> 'connected' or v_account.scope_status <> 'healthy'
     or v_account.external_account_id is null then
    raise exception 'Paid account is not eligible for metrics sync';
  end if;
  v_provider := case when v_account.platform = 'facebook' then 'meta_ads'
                     when v_account.platform = 'linkedin' then 'linkedin_ads'
                     else null end;
  if v_provider is null then raise exception 'Unsupported paid provider'; end if;
  select count(*) into v_campaign_count from public.os_marketing_campaigns
  where ad_account_id = p_ad_account_id and channel = 'paid';
  if v_campaign_count = 0 or v_campaign_count > 200 then
    raise exception 'Paid sync requires 1-200 bound campaigns';
  end if;
  v_key := 'paid-v1:' || p_ad_account_id || ':' || p_window_start || ':' || p_window_end;
  insert into public.os_marketing_paid_sync_runs (
    idempotency_key, ad_account_id, entity_id, provider, external_account_id,
    reporting_timezone, window_start, window_end, purpose, trigger_source,
    requested_by, campaigns_requested
  ) values (
    v_key, p_ad_account_id, v_account.entity_id, v_provider,
    v_account.external_account_id, coalesce(v_account.timezone, 'UTC'),
    p_window_start, p_window_end, p_purpose, p_trigger_source,
    p_requested_by, v_campaign_count
  ) on conflict (idempotency_key) do update
    set updated_at = public.os_marketing_paid_sync_runs.updated_at
  returning run_id into v_run_id;
  update public.os_marketing_social_accounts set
    paid_metrics_status = 'backfilling', paid_metrics_error = null,
    updated_at = now()
  where account_id = p_ad_account_id;
  return v_run_id;
end;
$$;

create or replace function public.claim_marketing_paid_sync_runs(
  p_worker_id text,
  p_limit integer default 2,
  p_lease_seconds integer default 180
) returns setof public.os_marketing_paid_sync_runs
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with due as (
    select run_id from public.os_marketing_paid_sync_runs
    where (
      status = 'queued'
      or (status = 'retry_wait' and coalesce(next_attempt_at, now()) <= now())
      or (status = 'leased' and lease_expires_at < now())
    ) and attempts < 5
    order by queued_at
    for update skip locked
    limit least(greatest(p_limit, 1), 5)
  )
  update public.os_marketing_paid_sync_runs r set
    status = 'leased', lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds, 60), 300)),
    worker_id = p_worker_id, attempts = r.attempts + 1,
    started_at = coalesce(r.started_at, now()), updated_at = now()
  from due where r.run_id = due.run_id returning r.*;
end;
$$;

create or replace function public.complete_marketing_paid_sync_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_rows jsonb,
  p_pages_fetched integer,
  p_response_sha256 text,
  p_provider_request_id text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_marketing_paid_sync_runs%rowtype;
  v_row jsonb;
  v_written integer := 0;
  v_date date;
  v_campaign record;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Paid metric payload must be an array of at most 5000 rows';
  end if;
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'leased'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at < now() then
    raise exception 'Paid sync lease mismatch or expired';
  end if;
  create temporary table tmp_paid_metrics (
    campaign_id text, external_campaign_id text, metric_date date,
    impressions bigint, clicks bigint, spend numeric, conversions numeric,
    provider_metrics jsonb, row_fingerprint text,
    unique (campaign_id, metric_date)
  ) on commit drop;
  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    select campaign_id, external_campaign_id into v_campaign
    from public.os_marketing_campaigns
    where campaign_id = v_row->>'campaign_id'
      and ad_account_id = v_run.ad_account_id
      and external_campaign_id = v_row->>'external_campaign_id';
    if not found then raise exception 'Metric row campaign binding mismatch'; end if;
    v_date := (v_row->>'metric_date')::date;
    if v_date < v_run.window_start or v_date > v_run.window_end then
      raise exception 'Metric date outside leased window';
    end if;
    insert into tmp_paid_metrics values (
      v_campaign.campaign_id, v_campaign.external_campaign_id, v_date,
      greatest(coalesce((v_row->>'impressions')::bigint, 0), 0),
      greatest(coalesce((v_row->>'clicks')::bigint, 0), 0),
      greatest(coalesce((v_row->>'spend')::numeric, 0), 0),
      case when v_row->>'conversions' is null then null
           else greatest((v_row->>'conversions')::numeric, 0) end,
      coalesce(v_row->'provider_metrics', '{}'::jsonb),
      v_row->>'row_fingerprint'
    );
  end loop;
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
    v_run.reporting_timezone, a.currency, t.impressions, t.clicks, t.spend,
    t.conversions, t.provider_metrics, v_run.run_id, t.row_fingerprint, now()
  from tmp_paid_metrics t
  join public.os_marketing_social_accounts a on a.account_id = v_run.ad_account_id;
  get diagnostics v_written = row_count;
  for v_date in select generate_series(v_run.window_start, v_run.window_end, interval '1 day')::date
  loop
    insert into public.os_marketing_paid_sync_days (
      ad_account_id, metric_date, entity_id, provider, source_run_id,
      campaigns_requested, rows_written, completed_at
    ) values (
      v_run.ad_account_id, v_date, v_run.entity_id, v_run.provider, v_run.run_id,
      v_run.campaigns_requested,
      (select count(*) from tmp_paid_metrics where metric_date = v_date), now()
    ) on conflict (ad_account_id, metric_date) do update set
      source_run_id = excluded.source_run_id,
      campaigns_requested = excluded.campaigns_requested,
      rows_written = excluded.rows_written,
      completed_at = excluded.completed_at;
  end loop;
  update public.os_marketing_paid_sync_runs set
    status = 'completed', lease_token = null, lease_expires_at = null,
    worker_id = null, pages_fetched = p_pages_fetched,
    campaigns_seen = (select count(distinct campaign_id) from tmp_paid_metrics),
    rows_received = jsonb_array_length(p_rows), rows_written = v_written,
    response_sha256 = p_response_sha256,
    provider_request_id = p_provider_request_id,
    completed_at = now(), updated_at = now(), error_code = null,
    error_detail = null
  where run_id = v_run.run_id;
  update public.os_marketing_social_accounts set
    paid_metrics_status = 'healthy',
    paid_metrics_data_through = greatest(paid_metrics_data_through, v_run.window_end),
    paid_metrics_last_complete_at = now(), paid_metrics_error = null,
    last_synced_at = now(), updated_at = now()
  where account_id = v_run.ad_account_id;
  return jsonb_build_object('run_id', v_run.run_id, 'rows_written', v_written);
end;
$$;

create or replace function public.fail_marketing_paid_sync_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_retryable boolean,
  p_retry_after_seconds integer,
  p_error_code text,
  p_error_detail text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_run public.os_marketing_paid_sync_runs%rowtype;
begin
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.lease_token is distinct from p_lease_token then
    raise exception 'Paid sync lease mismatch';
  end if;
  update public.os_marketing_paid_sync_runs set
    status = case when p_retryable and attempts < 5 then 'retry_wait' else 'failed' end,
    next_attempt_at = case when p_retryable and attempts < 5 then
      now() + make_interval(secs => least(greatest(p_retry_after_seconds, 300), 21600))
      else null end,
    lease_token = null, lease_expires_at = null, worker_id = null,
    error_code = left(p_error_code, 100), error_detail = left(p_error_detail, 500),
    completed_at = case when not p_retryable or attempts >= 5 then now() else null end,
    updated_at = now()
  where run_id = p_run_id;
  update public.os_marketing_social_accounts set
    paid_metrics_status = case when p_retryable and v_run.attempts < 5
      then 'degraded' else 'error' end,
    paid_metrics_error = left(p_error_code || ': ' || p_error_detail, 500),
    updated_at = now()
  where account_id = v_run.ad_account_id;
  return jsonb_build_object('run_id', p_run_id, 'retryable', p_retryable);
end;
$$;

revoke all on function public.enqueue_marketing_paid_sync(text,date,date,text,text,uuid)
  from public, authenticated;
revoke all on function public.claim_marketing_paid_sync_runs(text,integer,integer)
  from public, authenticated;
revoke all on function public.complete_marketing_paid_sync_run(uuid,uuid,jsonb,integer,text,text)
  from public, authenticated;
revoke all on function public.fail_marketing_paid_sync_run(uuid,uuid,boolean,integer,text,text)
  from public, authenticated;
grant execute on function public.enqueue_marketing_paid_sync(text,date,date,text,text,uuid)
  to service_role;
grant execute on function public.claim_marketing_paid_sync_runs(text,integer,integer)
  to service_role;
grant execute on function public.complete_marketing_paid_sync_run(uuid,uuid,jsonb,integer,text,text)
  to service_role;
grant execute on function public.fail_marketing_paid_sync_run(uuid,uuid,boolean,integer,text,text)
  to service_role;
