-- Phase 36: paid reporting connection revisions, per-account coverage, and
-- currency-safe operational summaries.

alter table public.os_marketing_social_accounts
  add column if not exists paid_connection_revision bigint not null default 1;
alter table public.os_marketing_paid_sync_runs
  add column if not exists connection_revision bigint not null default 1,
  add column if not exists currency text;
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_sync_status_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_sync_status_check
  check (status in ('queued','leased','retry_wait','completed','failed','superseded'));
update public.os_marketing_paid_sync_runs set
  status = 'superseded', lease_token = null, lease_expires_at = null,
  worker_id = null, completed_at = coalesce(completed_at, now()),
  error_code = 'phase36_currency_snapshot_required', updated_at = now()
where currency is null and status in ('queued','leased','retry_wait');

create index if not exists os_mkt_paid_sync_fair_claim_idx
  on public.os_marketing_paid_sync_runs (status, next_attempt_at, queued_at, ad_account_id)
  where status in ('queued','retry_wait','leased');

-- A failed exact window may be deliberately requeued. Completed windows remain
-- immutable evidence for the same account connection revision.
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
         currency, status, account_type, scope_status, paid_connection_revision
  into v_account from public.os_marketing_social_accounts
  where account_id = p_ad_account_id for update;
  if not found or v_account.account_type <> 'paid_ads'
     or v_account.status <> 'connected' or v_account.scope_status <> 'healthy'
     or v_account.external_account_id is null
     or nullif(trim(v_account.currency), '') is null then
    raise exception 'Paid account is not eligible for metrics sync';
  end if;
  v_provider := case when v_account.platform = 'facebook' then 'meta_ads'
                     when v_account.platform = 'linkedin' then 'linkedin_ads'
                     else null end;
  if v_provider is null then raise exception 'Unsupported paid provider'; end if;
  select count(*) into v_campaign_count from public.os_marketing_campaigns
  where ad_account_id = p_ad_account_id and channel = 'paid'
    and external_campaign_id is not null;
  if v_campaign_count = 0 or v_campaign_count > 200 then
    raise exception 'Paid sync requires 1-200 externally bound campaigns';
  end if;
  v_key := 'paid-v2:' || p_ad_account_id || ':' ||
    v_account.paid_connection_revision || ':' || p_window_start || ':' || p_window_end;
  insert into public.os_marketing_paid_sync_runs (
    idempotency_key, ad_account_id, entity_id, provider, external_account_id,
    reporting_timezone, currency, connection_revision, window_start, window_end,
    purpose, trigger_source, requested_by, campaigns_requested
  ) values (
    v_key, p_ad_account_id, v_account.entity_id, v_provider,
    v_account.external_account_id,
    case when v_provider = 'linkedin_ads' then 'UTC'
         else coalesce(v_account.timezone, 'UTC') end,
    upper(v_account.currency), v_account.paid_connection_revision,
    p_window_start, p_window_end, p_purpose, p_trigger_source,
    p_requested_by, v_campaign_count
  ) on conflict (idempotency_key) do update set
    status = case when os_marketing_paid_sync_runs.status = 'failed'
      then 'queued' else os_marketing_paid_sync_runs.status end,
    attempts = case when os_marketing_paid_sync_runs.status = 'failed'
      then 0 else os_marketing_paid_sync_runs.attempts end,
    next_attempt_at = case when os_marketing_paid_sync_runs.status = 'failed'
      then null else os_marketing_paid_sync_runs.next_attempt_at end,
    completed_at = case when os_marketing_paid_sync_runs.status = 'failed'
      then null else os_marketing_paid_sync_runs.completed_at end,
    error_code = case when os_marketing_paid_sync_runs.status = 'failed'
      then null else os_marketing_paid_sync_runs.error_code end,
    error_detail = case when os_marketing_paid_sync_runs.status = 'failed'
      then null else os_marketing_paid_sync_runs.error_detail end,
    updated_at = now()
  returning run_id into v_run_id;
  return v_run_id;
end;
$$;

-- Atomically reset reporting state when the selected provider account changes.
create or replace function public.select_marketing_paid_account_v2(
  p_account_id text,
  p_external_account_id text,
  p_display_name text,
  p_currency text,
  p_timezone text,
  p_connection_meta jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_account record; v_changed boolean;
begin
  select account_id, external_account_id, currency, timezone,
    paid_connection_revision into v_account
  from public.os_marketing_social_accounts
  where account_id = p_account_id for update;
  if not found then raise exception 'Paid account not found'; end if;
  if nullif(trim(p_external_account_id),'') is null
     or nullif(trim(p_currency),'') is null then
    raise exception 'Provider account ID and currency are required';
  end if;
  v_changed :=
    v_account.external_account_id is distinct from p_external_account_id
    or upper(coalesce(v_account.currency,'')) is distinct from upper(p_currency)
    or coalesce(v_account.timezone,'UTC') is distinct from coalesce(p_timezone,'UTC');
  if v_changed then
    update public.os_marketing_paid_sync_runs set
      status = 'superseded', lease_token = null, lease_expires_at = null,
      worker_id = null, completed_at = coalesce(completed_at, now()),
      error_code = 'connection_reselected', updated_at = now()
    where ad_account_id = p_account_id
      and status in ('queued','leased','retry_wait');
    delete from public.os_marketing_paid_metrics_daily
      where ad_account_id = p_account_id;
    delete from public.os_marketing_paid_sync_days
      where ad_account_id = p_account_id;
  end if;
  update public.os_marketing_social_accounts set
    external_account_id = p_external_account_id,
    display_name = p_display_name,
    currency = upper(p_currency),
    timezone = p_timezone,
    connection_meta = coalesce(connection_meta, '{}'::jsonb) ||
      coalesce(p_connection_meta, '{}'::jsonb),
    paid_connection_revision = paid_connection_revision +
      case when v_changed then 1 else 0 end,
    paid_metrics_status = case when v_changed then 'unknown'
      else paid_metrics_status end,
    paid_metrics_data_through = case when v_changed then null
      else paid_metrics_data_through end,
    paid_metrics_last_complete_at = case when v_changed then null
      else paid_metrics_last_complete_at end,
    paid_metrics_error = case when v_changed then null else paid_metrics_error end,
    scope_status = 'healthy', scope_checked_at = now(), scope_error = null,
    status = 'connected', verified_at = now(), selected_at = now(),
    updated_at = now()
  where account_id = p_account_id;
  return jsonb_build_object('account_id', p_account_id,
    'connection_changed', v_changed);
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
  v_account public.os_marketing_social_accounts%rowtype;
  v_row jsonb;
  v_written integer := 0;
  v_date date;
  v_campaign record;
  v_account_id text;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Paid metric payload must be an array of at most 5000 rows';
  end if;
  select ad_account_id into v_account_id
  from public.os_marketing_paid_sync_runs where run_id = p_run_id;
  if not found then raise exception 'Paid sync run not found'; end if;
  select * into v_account from public.os_marketing_social_accounts
  where account_id = v_account_id for update;
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'leased'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at is null or v_run.lease_expires_at < now() then
    raise exception 'Paid sync lease mismatch or expired';
  end if;
  if not found or v_account.account_id is null
     or v_account.paid_connection_revision <> v_run.connection_revision
     or v_account.external_account_id is distinct from v_run.external_account_id
     or v_account.entity_id is distinct from v_run.entity_id then
    update public.os_marketing_paid_sync_runs set
      status = 'superseded', lease_token = null, lease_expires_at = null,
      worker_id = null, completed_at = now(),
      error_code = 'connection_revision_changed', updated_at = now()
    where run_id = p_run_id;
    return jsonb_build_object('run_id', p_run_id, 'status', 'superseded');
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
    v_run.reporting_timezone, v_run.currency, t.impressions, t.clicks, t.spend,
    t.conversions, t.provider_metrics, v_run.run_id, t.row_fingerprint, now()
  from tmp_paid_metrics t;
  get diagnostics v_written = row_count;
  for v_date in select generate_series(
    v_run.window_start, v_run.window_end, interval '1 day')::date
  loop
    insert into public.os_marketing_paid_sync_days (
      ad_account_id, metric_date, entity_id, provider, source_run_id,
      campaigns_requested, rows_written, completed_at
    ) values (
      v_run.ad_account_id, v_date, v_run.entity_id, v_run.provider, v_run.run_id,
      v_run.campaigns_requested,
      (select count(*) from tmp_paid_metrics where metric_date = v_date), now()
    ) on conflict (ad_account_id, metric_date) do update set
      entity_id = excluded.entity_id, provider = excluded.provider,
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
    paid_metrics_status = case when (
      select count(distinct metric_date)
      from public.os_marketing_paid_sync_days
      where ad_account_id = v_run.ad_account_id
        and metric_date between v_run.window_end - 89 and v_run.window_end
    ) >= 90 then 'healthy' else 'backfilling' end,
    paid_metrics_data_through = (
      select max(metric_date) from public.os_marketing_paid_sync_days
      where ad_account_id = v_run.ad_account_id
    ),
    paid_metrics_last_complete_at = now(), paid_metrics_error = null,
    last_synced_at = now(), updated_at = now()
  where account_id = v_run.ad_account_id
    and paid_connection_revision = v_run.connection_revision;
  return jsonb_build_object('run_id', v_run.run_id,
    'status', 'completed', 'rows_written', v_written);
end;
$$;

create or replace function public.get_marketing_paid_report(
  p_entity_id text,
  p_days integer
) returns jsonb
language sql stable security definer set search_path = public
as $$
with settings as (
  select least(greatest(p_days, 1), 90) as expected_days
),
eligible as (
  select a.account_id, a.entity_id, a.platform, a.display_name,
    a.external_account_id, upper(a.currency) as currency,
    a.paid_connection_revision,
    ((now() at time zone case
      when a.platform = 'linkedin' then 'UTC'
      when exists (select 1 from pg_timezone_names tz
        where tz.name = a.timezone) then a.timezone
      else 'UTC' end)::date - 1) as report_end,
    ((now() at time zone case
      when a.platform = 'linkedin' then 'UTC'
      when exists (select 1 from pg_timezone_names tz
        where tz.name = a.timezone) then a.timezone
      else 'UTC' end)::date -
      (select expected_days from settings)) as report_start
  from public.os_marketing_social_accounts a
  where a.account_type = 'paid_ads' and a.status = 'connected'
    and a.scope_status = 'healthy'
    and (p_entity_id is null or a.entity_id = p_entity_id)
),
coverage as (
  select e.account_id, count(distinct d.metric_date)::integer as covered_days,
    max(d.metric_date) as latest_covered_date
  from eligible e
  left join public.os_marketing_paid_sync_days d
    on d.ad_account_id = e.account_id
   and d.metric_date between e.report_start and e.report_end
  group by e.account_id
),
currency_totals as (
  select upper(m.currency) as currency,
    sum(m.impressions)::bigint as impressions,
    sum(m.clicks)::bigint as clicks,
    sum(m.spend)::numeric as spend,
    sum(coalesce(m.conversions,0))::numeric as conversions
  from public.os_marketing_paid_metrics_daily m
  join eligible e on e.account_id = m.ad_account_id
    and m.metric_date between e.report_start and e.report_end
  group by upper(m.currency)
),
account_rows as (
  select e.*, c.covered_days, c.latest_covered_date,
    s.expected_days,
    case when c.covered_days = s.expected_days then 'complete'
         when c.covered_days > 0 then 'partial' else 'unavailable' end
      as coverage_status
  from eligible e join coverage c using (account_id) cross join settings s
)
select jsonb_build_object(
  'expected_days', (select expected_days from settings),
  'overall_status', case
    when not exists (select 1 from account_rows) then 'unavailable'
    when every(coverage_status = 'complete') then 'complete'
    when bool_or(covered_days > 0) then 'partial'
    else 'unavailable' end,
  'accounts', coalesce((select jsonb_agg(to_jsonb(account_rows)
    order by entity_id, account_id) from account_rows), '[]'::jsonb),
  'currencies', coalesce((select jsonb_agg(to_jsonb(currency_totals)
    order by currency) from currency_totals), '[]'::jsonb)
)
from account_rows
limit 1;
$$;

create or replace function public.extend_marketing_paid_sync_lease(
  p_run_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 300
) returns timestamptz
language plpgsql security definer set search_path = public
as $$
declare v_expires timestamptz;
begin
  update public.os_marketing_paid_sync_runs set
    lease_expires_at = now() + make_interval(
      secs => least(greatest(p_lease_seconds,60),300)),
    updated_at = now()
  where run_id = p_run_id and status = 'leased'
    and lease_token = p_lease_token and lease_expires_at > now()
  returning lease_expires_at into v_expires;
  if v_expires is null then raise exception 'Paid sync lease was lost'; end if;
  return v_expires;
end;
$$;

revoke all on function public.select_marketing_paid_account_v2(text,text,text,text,text,jsonb)
  from public, authenticated;
revoke all on function public.get_marketing_paid_report(text,integer)
  from public;
revoke all on function public.extend_marketing_paid_sync_lease(uuid,uuid,integer)
  from public, authenticated;
grant execute on function public.select_marketing_paid_account_v2(text,text,text,text,text,jsonb)
  to service_role;
grant execute on function public.get_marketing_paid_report(text,integer)
  to service_role;
grant execute on function public.extend_marketing_paid_sync_lease(uuid,uuid,integer)
  to service_role;
