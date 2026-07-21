-- Phase 37: durable provider-contract evidence and governed paid-sync recovery.

alter table public.os_marketing_paid_sync_runs
  add column if not exists contract_version text,
  add column if not exists validation_status text,
  add column if not exists validation_evidence jsonb,
  add column if not exists validation_evidence_sha256 text,
  add column if not exists error_class text,
  add column if not exists retry_disposition text,
  add column if not exists last_http_status integer,
  add column if not exists retry_after_seconds integer;
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_validation_status_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_validation_status_check check (
    validation_status is null or validation_status in
      ('pending','passed','failed')
  );
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_error_class_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_error_class_check check (
    error_class is null or error_class in
      ('contract','transport','provider_transient','provider_permanent',
       'authorization','configuration','persistence','lease')
  );
alter table public.os_marketing_paid_sync_runs
  drop constraint if exists os_mkt_paid_retry_disposition_check;
alter table public.os_marketing_paid_sync_runs
  add constraint os_mkt_paid_retry_disposition_check check (
    retry_disposition is null or retry_disposition in
      ('automatic','manual_after_correction','not_retryable','superseded')
  );

create table if not exists public.os_marketing_paid_contract_checks (
  check_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_marketing_paid_sync_runs(run_id),
  entity_id text references public.entities(entity_id),
  provider text not null,
  contract_version text not null,
  validation_status text not null,
  page_count integer not null,
  normalized_row_count integer not null,
  provider_request_id text,
  evidence jsonb not null,
  evidence_sha256 text not null,
  client_evidence_sha256 text,
  created_at timestamptz not null default now(),
  constraint os_mkt_contract_check_status check (
    validation_status in ('passed','failed')
  ),
  constraint os_mkt_contract_check_hash check (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
  ),
  unique (run_id, evidence_sha256)
);
create index if not exists os_mkt_contract_check_entity_idx
  on public.os_marketing_paid_contract_checks(entity_id, created_at desc);
alter table public.os_marketing_paid_contract_checks enable row level security;
drop policy if exists "os_mkt_contract_check_select"
  on public.os_marketing_paid_contract_checks;
create policy "os_mkt_contract_check_select"
  on public.os_marketing_paid_contract_checks for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_marketing_paid_contract_checks to authenticated;

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
  select count(*) into v_campaign_count from public.os_marketing_campaigns
  where ad_account_id = p_ad_account_id and channel = 'paid'
    and external_campaign_id is not null;
  if v_campaign_count = 0 or v_campaign_count > 200 then
    raise exception 'Paid sync requires 1-200 externally bound campaigns';
  end if;
  v_key := 'paid-v3:' || p_ad_account_id || ':' ||
    v_account.paid_connection_revision || ':' || p_window_start || ':' ||
    p_window_end;
  insert into public.os_marketing_paid_sync_runs (
    idempotency_key, ad_account_id, entity_id, provider, external_account_id,
    reporting_timezone, currency, connection_revision, window_start, window_end,
    purpose, trigger_source, requested_by, campaigns_requested,
    contract_version, validation_status
  ) values (
    v_key, p_ad_account_id, v_account.entity_id, v_provider,
    v_account.external_account_id,
    case when v_provider = 'linkedin_ads' then 'UTC'
      else coalesce(v_account.timezone,'UTC') end,
    upper(v_account.currency), v_account.paid_connection_revision,
    p_window_start, p_window_end, p_purpose, p_trigger_source, p_requested_by,
    v_campaign_count, 'phase37-v1', 'pending'
  ) on conflict (idempotency_key) do nothing
  returning * into v_run;
  v_created := found;
  if not found then
    select * into v_run from public.os_marketing_paid_sync_runs
    where idempotency_key = v_key;
  end if;
  return jsonb_build_object('run_id', v_run.run_id, 'status', v_run.status,
    'created', v_created,
    'disposition', case when v_created then 'created' else 'existing' end);
end;
$$;

create or replace function public.complete_marketing_paid_sync_run_v2(
  p_run_id uuid,
  p_lease_token uuid,
  p_rows jsonb,
  p_pages_fetched integer,
  p_response_sha256 text,
  p_provider_request_id text,
  p_contract_version text,
  p_validation_evidence jsonb,
  p_validation_evidence_sha256 text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_marketing_paid_sync_runs%rowtype;
  v_result jsonb;
  v_expected_hash text;
begin
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'leased'
     or v_run.lease_token is distinct from p_lease_token then
    raise exception 'Paid sync lease mismatch';
  end if;
  if p_contract_version <> 'phase37-v1'
     or coalesce(p_validation_evidence->>'status','') <> 'passed'
     or coalesce((p_validation_evidence->>'page_count')::integer,-1)
       <> p_pages_fetched
     or coalesce((p_validation_evidence->>'row_count')::integer,-1)
       <> jsonb_array_length(p_rows)
     or p_validation_evidence->>'provider' <> v_run.provider
     or p_validation_evidence->>'window_start' <> v_run.window_start::text
     or p_validation_evidence->>'window_end' <> v_run.window_end::text
     or p_validation_evidence->>'contract_version' <> p_contract_version
     or p_validation_evidence->>'response_sha256' <> p_response_sha256
     or p_validation_evidence->>'provider_request_id'
       is distinct from p_provider_request_id then
    raise exception 'Provider contract evidence is incomplete';
  end if;
  v_expected_hash := encode(digest(p_validation_evidence::text,'sha256'),'hex');
  if p_validation_evidence_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Client contract evidence hash is invalid';
  end if;
  v_result := public.complete_marketing_paid_sync_run(
    p_run_id, p_lease_token, p_rows, p_pages_fetched, p_response_sha256,
    p_provider_request_id
  );
  if coalesce(v_result->>'status','') = 'completed' then
    update public.os_marketing_paid_sync_runs set
      contract_version = p_contract_version, validation_status = 'passed',
      validation_evidence = p_validation_evidence,
      validation_evidence_sha256 = v_expected_hash,
      error_class = null, retry_disposition = null
    where run_id = p_run_id;
    insert into public.os_marketing_paid_contract_checks (
      run_id, entity_id, provider, contract_version, validation_status,
      page_count, normalized_row_count, provider_request_id, evidence,
      evidence_sha256, client_evidence_sha256
    ) values (
      p_run_id, v_run.entity_id, v_run.provider, p_contract_version, 'passed',
      p_pages_fetched, jsonb_array_length(p_rows), p_provider_request_id,
      p_validation_evidence, v_expected_hash, p_validation_evidence_sha256
    ) on conflict (run_id, evidence_sha256) do nothing;
  end if;
  return v_result;
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
  v_hash text;
begin
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
    p_run_id, p_lease_token, p_retryable, p_retry_after_seconds,
    p_error_code, p_error_detail
  );
  select * into v_current from public.os_marketing_paid_sync_runs
  where run_id = p_run_id;
  v_hash := encode(digest(coalesce(p_validation_evidence,'{}')::text,'sha256'),'hex');
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
    validation_evidence = coalesce(p_validation_evidence, validation_evidence),
    updated_at = now()
  where run_id = p_run_id;
  insert into public.os_marketing_paid_contract_checks (
    run_id,entity_id,provider,contract_version,validation_status,page_count,
    normalized_row_count,provider_request_id,evidence,evidence_sha256
  ) values (
    p_run_id,v_run.entity_id,v_run.provider,'phase37-v1','failed',0,0,null,
    coalesce(p_validation_evidence,'{}'),v_hash
  ) on conflict (run_id,evidence_sha256) do nothing;
  return v_result;
end;
$$;

create or replace function public.retry_marketing_paid_sync_run(
  p_run_id uuid,
  p_actor_id uuid,
  p_reason text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_run public.os_marketing_paid_sync_runs%rowtype;
begin
  select * into v_run from public.os_marketing_paid_sync_runs
  where run_id = p_run_id for update;
  if not found or v_run.status <> 'failed'
     or v_run.retry_disposition <> 'manual_after_correction'
     or p_actor_id is null or length(trim(coalesce(p_reason,''))) < 15 then
    raise exception 'Paid sync is not eligible for governed retry';
  end if;
  update public.os_marketing_paid_sync_runs set
    status = 'queued', attempts = 0, next_attempt_at = null,
    completed_at = null, error_code = null, error_detail = null,
    error_class = null, retry_disposition = null, validation_status = 'pending',
    validation_evidence = jsonb_build_object(
      'retry_reason', trim(p_reason), 'retried_by', p_actor_id,
      'retried_at', now()), updated_at = now()
  where run_id = p_run_id;
  return jsonb_build_object('run_id', p_run_id, 'status', 'queued');
end;
$$;

revoke all on function public.enqueue_marketing_paid_sync_v3(text,date,date,text,text,uuid)
  from public, authenticated;
revoke all on function public.complete_marketing_paid_sync_run_v2(uuid,uuid,jsonb,integer,text,text,text,jsonb,text)
  from public, authenticated;
revoke all on function public.fail_marketing_paid_sync_run_v2(uuid,uuid,boolean,integer,text,text,text,integer,jsonb)
  from public, authenticated;
revoke all on function public.retry_marketing_paid_sync_run(uuid,uuid,text)
  from public, authenticated;
grant execute on function public.enqueue_marketing_paid_sync_v3(text,date,date,text,text,uuid)
  to service_role;
grant execute on function public.complete_marketing_paid_sync_run_v2(uuid,uuid,jsonb,integer,text,text,text,jsonb,text)
  to service_role;
grant execute on function public.fail_marketing_paid_sync_run_v2(uuid,uuid,boolean,integer,text,text,text,integer,jsonb)
  to service_role;
grant execute on function public.retry_marketing_paid_sync_run(uuid,uuid,text)
  to service_role;
