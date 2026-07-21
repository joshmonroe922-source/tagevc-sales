-- Phase 34: provider account selection and typed daily paid analytics.
-- Safe to re-run.

alter table public.os_marketing_social_accounts
  add column if not exists scope_status text not null default 'unknown',
  add column if not exists scope_checked_at timestamptz,
  add column if not exists scope_error text,
  add column if not exists selected_at timestamptz;

alter table public.os_marketing_social_accounts
  drop constraint if exists os_mkt_scope_status_check;
alter table public.os_marketing_social_accounts
  add constraint os_mkt_scope_status_check
  check (scope_status in ('unknown', 'healthy', 'missing', 'error'));

alter table public.os_marketing_campaigns
  add column if not exists conversion_metric text;

create unique index if not exists os_mkt_paid_campaign_binding_unique
  on public.os_marketing_campaigns (ad_account_id, external_campaign_id)
  where channel = 'paid' and ad_account_id is not null
    and external_campaign_id is not null;

create table if not exists public.os_marketing_paid_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null
    references public.os_marketing_campaigns(campaign_id) on delete cascade,
  ad_account_id text not null
    references public.os_marketing_social_accounts(account_id) on delete cascade,
  entity_id text references public.entities(entity_id),
  provider text not null,
  external_account_id text not null,
  external_campaign_id text not null,
  metric_date date not null,
  reporting_timezone text not null default 'UTC',
  currency text not null,
  impressions bigint not null default 0 check (impressions >= 0),
  clicks bigint not null default 0 check (clicks >= 0),
  spend numeric(20,6) not null default 0 check (spend >= 0),
  conversions numeric(20,6) check (conversions is null or conversions >= 0),
  provider_metrics jsonb not null default '{}'::jsonb,
  first_synced_at timestamptz not null default now(),
  last_synced_at timestamptz not null default now(),
  constraint os_mkt_paid_metric_provider_check
    check (provider in ('meta_ads', 'linkedin_ads')),
  unique (ad_account_id, campaign_id, metric_date)
);

create index if not exists os_mkt_paid_metric_entity_date_idx
  on public.os_marketing_paid_metrics_daily (entity_id, metric_date desc);
create index if not exists os_mkt_paid_metric_campaign_date_idx
  on public.os_marketing_paid_metrics_daily (campaign_id, metric_date desc);
create index if not exists os_mkt_paid_metric_account_date_idx
  on public.os_marketing_paid_metrics_daily (ad_account_id, metric_date desc);

alter table public.os_marketing_paid_metrics_daily enable row level security;
drop policy if exists "os_mkt_paid_metric_select"
  on public.os_marketing_paid_metrics_daily;
create policy "os_mkt_paid_metric_select"
  on public.os_marketing_paid_metrics_daily for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_marketing_paid_metrics_daily to authenticated;
revoke insert, update, delete on public.os_marketing_paid_metrics_daily
  from authenticated;

create or replace function public.validate_marketing_paid_campaign_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_account record;
  v_expected_platform text;
begin
  if new.channel <> 'paid' then return new; end if;
  if new.ad_account_id is null or new.external_campaign_id is null
     or trim(new.external_campaign_id) = '' then
    raise exception 'Paid campaign requires ad account and external campaign ID';
  end if;
  select account_type, status, platform, entity_id into v_account
  from public.os_marketing_social_accounts
  where account_id = new.ad_account_id;
  if not found then raise exception 'Paid ad account not found'; end if;
  v_expected_platform := case
    when new.ad_platform = 'meta_ads' then 'facebook'
    when new.ad_platform = 'linkedin_ads' then 'linkedin'
    else null
  end;
  if v_account.account_type <> 'paid_ads'
     or v_account.status <> 'connected'
     or v_expected_platform is null
     or v_account.platform <> v_expected_platform
     or v_account.entity_id is distinct from new.entity_id then
    raise exception 'Paid campaign/ad account provider or entity mismatch';
  end if;
  return new;
end;
$$;

drop trigger if exists os_mkt_paid_campaign_binding_trigger
  on public.os_marketing_campaigns;
create trigger os_mkt_paid_campaign_binding_trigger
before insert or update of channel, ad_account_id, ad_platform,
  external_campaign_id, entity_id
on public.os_marketing_campaigns
for each row execute function public.validate_marketing_paid_campaign_binding();
