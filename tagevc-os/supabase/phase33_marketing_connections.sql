-- Phase 33: entity-bound marketing connections, paid-account binding,
-- and resumable TikTok upload sessions. Safe to re-run.

alter table public.os_marketing_social_accounts
  add column if not exists account_type text not null default 'publisher',
  add column if not exists currency text,
  add column if not exists timezone text,
  add column if not exists capabilities jsonb not null default '{}'::jsonb,
  add column if not exists connection_meta jsonb not null default '{}'::jsonb,
  add column if not exists verified_at timestamptz;

alter table public.os_marketing_social_accounts
  drop constraint if exists os_marketing_account_type_check;
alter table public.os_marketing_social_accounts
  add constraint os_marketing_account_type_check
  check (account_type in ('publisher', 'paid_ads'));

create unique index if not exists os_mkt_provider_account_unique
  on public.os_marketing_social_accounts
  (platform, account_type, coalesce(entity_id, ''), external_account_id)
  where external_account_id is not null;

alter table public.os_marketing_campaigns
  add column if not exists ad_account_id text
  references public.os_marketing_social_accounts(account_id);

create index if not exists os_mkt_campaign_ad_account_idx
  on public.os_marketing_campaigns (ad_account_id, updated_at desc)
  where ad_account_id is not null;

create table if not exists public.os_marketing_oauth_states (
  state_hash text primary key,
  account_id text not null
    references public.os_marketing_social_accounts(account_id) on delete cascade,
  platform text not null,
  purpose text not null,
  entity_id text references public.entities(entity_id),
  actor_id uuid not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint os_mkt_oauth_state_purpose_check
    check (purpose in ('publisher', 'paid_ads'))
);

create index if not exists os_mkt_oauth_state_expiry_idx
  on public.os_marketing_oauth_states (expires_at)
  where consumed_at is null;

alter table public.os_marketing_oauth_states enable row level security;
-- Deliberately no authenticated grants/policies: callback state is service-only.

-- Token ciphertext is service-only. Sanitized account health is exposed through
-- os_marketing_social_accounts, never by selecting the vault table.
drop policy if exists "os_mkt_oauth_firm_select"
  on public.os_marketing_oauth_tokens;
revoke select on public.os_marketing_oauth_tokens from authenticated;

create table if not exists public.os_marketing_tiktok_uploads (
  upload_id uuid primary key default gen_random_uuid(),
  content_id text not null
    references public.os_marketing_content(content_id) on delete cascade,
  account_id text not null
    references public.os_marketing_social_accounts(account_id),
  entity_id text references public.entities(entity_id),
  job_id text,
  publish_id text not null,
  upload_url_cipher text not null,
  media_name text not null,
  media_type text not null,
  media_size bigint not null check (media_size > 0 and media_size <= 4294967296),
  chunk_size integer not null check (chunk_size > 0 and chunk_size <= 67108864),
  total_chunks integer not null check (total_chunks between 1 and 1000),
  uploaded_bytes bigint not null default 0,
  privacy_level text not null,
  disable_comment boolean not null default false,
  disable_duet boolean not null default false,
  disable_stitch boolean not null default false,
  creator_snapshot jsonb not null default '{}'::jsonb,
  status text not null default 'initialized',
  attempts integer not null default 0,
  last_error text,
  upload_url_expires_at timestamptz not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_mkt_tiktok_upload_status_check
    check (status in ('initialized', 'uploading', 'uploaded', 'processing', 'published', 'failed', 'expired'))
);

create index if not exists os_mkt_tiktok_upload_content_idx
  on public.os_marketing_tiktok_uploads (content_id, created_at desc);
create unique index if not exists os_mkt_tiktok_active_upload_idx
  on public.os_marketing_tiktok_uploads (content_id)
  where status in ('initialized', 'uploading', 'uploaded', 'processing');

alter table public.os_marketing_tiktok_uploads enable row level security;

drop policy if exists "os_mkt_tiktok_upload_select"
  on public.os_marketing_tiktok_uploads;
drop policy if exists "os_mkt_tiktok_upload_write"
  on public.os_marketing_tiktok_uploads;
create policy "os_mkt_tiktok_upload_select"
  on public.os_marketing_tiktok_uploads for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_tiktok_upload_write"
  on public.os_marketing_tiktok_uploads for all to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  )
  with check (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

grant select, insert, update on public.os_marketing_tiktok_uploads
  to authenticated;
