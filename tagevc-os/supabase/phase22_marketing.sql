-- Phase 22: Multichannel Marketing System foundation
-- Campaigns, content, social account metadata, schedule + generation jobs.
-- Entity-scoped (null entity_id = firm-wide Tage VC). Safe to re-run.
-- OAuth tokens are NOT stored in this phase.

-- ─── Campaigns ───────────────────────────────────────────────────────────────
create table if not exists public.os_marketing_campaigns (
  id uuid primary key default gen_random_uuid(),
  campaign_id text not null unique,
  name text not null,
  status text not null default 'draft',
  entity_id text references public.entities(entity_id),
  objective text,
  target_platforms jsonb not null default '[]'::jsonb,
  starts_at timestamptz,
  ends_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_marketing_campaigns_entity_idx
  on public.os_marketing_campaigns (entity_id);
create index if not exists os_marketing_campaigns_status_idx
  on public.os_marketing_campaigns (status);

-- ─── Content ─────────────────────────────────────────────────────────────────
create table if not exists public.os_marketing_content (
  id uuid primary key default gen_random_uuid(),
  content_id text not null unique,
  campaign_id text,
  entity_id text references public.entities(entity_id),
  kind text not null,
  platform text,
  title text not null,
  body text,
  status text not null default 'draft',
  ai_generated boolean not null default false,
  generation_meta jsonb,
  scheduled_at timestamptz,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_marketing_content_campaign_idx
  on public.os_marketing_content (campaign_id);
create index if not exists os_marketing_content_entity_idx
  on public.os_marketing_content (entity_id);
create index if not exists os_marketing_content_status_idx
  on public.os_marketing_content (status);

-- ─── Social accounts (metadata only; no secrets) ─────────────────────────────
create table if not exists public.os_marketing_social_accounts (
  id uuid primary key default gen_random_uuid(),
  account_id text not null unique,
  entity_id text references public.entities(entity_id),
  platform text not null,
  handle text not null,
  display_name text,
  status text not null default 'pending',
  external_account_id text,
  last_synced_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_marketing_accounts_entity_idx
  on public.os_marketing_social_accounts (entity_id);
create unique index if not exists os_marketing_accounts_platform_handle_entity_idx
  on public.os_marketing_social_accounts (platform, handle, (coalesce(entity_id, '')));

-- ─── Schedule jobs ───────────────────────────────────────────────────────────
create table if not exists public.os_marketing_schedule_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  content_id text not null,
  account_id text,
  entity_id text references public.entities(entity_id),
  status text not null default 'pending',
  scheduled_for timestamptz not null,
  attempts int not null default 0,
  last_error text,
  result jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_marketing_schedule_due_idx
  on public.os_marketing_schedule_jobs (status, scheduled_for);

-- ─── Generation jobs ─────────────────────────────────────────────────────────
create table if not exists public.os_marketing_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  entity_id text references public.entities(entity_id),
  campaign_id text,
  kind text not null,
  prompt text not null,
  status text not null default 'pending',
  result_content_ids jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_marketing_gen_entity_idx
  on public.os_marketing_generation_jobs (entity_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.os_marketing_campaigns enable row level security;
alter table public.os_marketing_content enable row level security;
alter table public.os_marketing_social_accounts enable row level security;
alter table public.os_marketing_schedule_jobs enable row level security;
alter table public.os_marketing_generation_jobs enable row level security;

drop policy if exists "os_mkt_campaigns_select" on public.os_marketing_campaigns;
drop policy if exists "os_mkt_campaigns_write" on public.os_marketing_campaigns;
create policy "os_mkt_campaigns_select"
  on public.os_marketing_campaigns for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_campaigns_write"
  on public.os_marketing_campaigns for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_mkt_content_select" on public.os_marketing_content;
drop policy if exists "os_mkt_content_write" on public.os_marketing_content;
create policy "os_mkt_content_select"
  on public.os_marketing_content for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_content_write"
  on public.os_marketing_content for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_mkt_accounts_select" on public.os_marketing_social_accounts;
drop policy if exists "os_mkt_accounts_write" on public.os_marketing_social_accounts;
create policy "os_mkt_accounts_select"
  on public.os_marketing_social_accounts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_accounts_write"
  on public.os_marketing_social_accounts for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_mkt_schedule_select" on public.os_marketing_schedule_jobs;
drop policy if exists "os_mkt_schedule_write" on public.os_marketing_schedule_jobs;
create policy "os_mkt_schedule_select"
  on public.os_marketing_schedule_jobs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_schedule_write"
  on public.os_marketing_schedule_jobs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_mkt_gen_select" on public.os_marketing_generation_jobs;
drop policy if exists "os_mkt_gen_write" on public.os_marketing_generation_jobs;
create policy "os_mkt_gen_select"
  on public.os_marketing_generation_jobs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_gen_write"
  on public.os_marketing_generation_jobs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

grant select, insert, update on public.os_marketing_campaigns to authenticated;
grant select, insert, update on public.os_marketing_content to authenticated;
grant select, insert, update on public.os_marketing_social_accounts to authenticated;
grant select, insert, update on public.os_marketing_schedule_jobs to authenticated;
grant select, insert, update on public.os_marketing_generation_jobs to authenticated;
