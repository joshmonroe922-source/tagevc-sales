-- Phase 29: Paid media campaign stubs + SLA assignee + hardware warranty
-- Safe to re-run. Does NOT drop os_store_snapshots.

-- ─── Marketing paid campaign stubs ───────────────────────────────────────────
alter table public.os_marketing_campaigns
  add column if not exists channel text not null default 'organic';
alter table public.os_marketing_campaigns
  add column if not exists budget_k numeric;
alter table public.os_marketing_campaigns
  add column if not exists ad_platform text;
alter table public.os_marketing_campaigns
  add column if not exists external_campaign_id text;

alter table public.os_marketing_content
  add column if not exists approval_assignee text;

create index if not exists os_mkt_campaigns_channel_idx
  on public.os_marketing_campaigns (channel, status);

-- ─── IT hardware warranty ────────────────────────────────────────────────────
alter table public.os_it_hardware_assets
  add column if not exists warranty_ends_at date;

create index if not exists os_it_hw_warranty_idx
  on public.os_it_hardware_assets (warranty_ends_at)
  where warranty_ends_at is not null;
