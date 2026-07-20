-- Phase 24: Marketing analytics + token refresh metadata, DocuSign storage paths, offboarding ticket link
-- Safe to re-run. Create storage bucket for signed PDFs (service role uploads).

-- ─── Marketing analytics events ──────────────────────────────────────────────
create table if not exists public.os_marketing_analytics_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  campaign_id text,
  content_id text,
  job_id text,
  account_id text,
  entity_id text references public.entities(entity_id),
  platform text,
  kind text not null,
  metrics jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists os_mkt_analytics_campaign_idx
  on public.os_marketing_analytics_events (campaign_id, occurred_at desc);
create index if not exists os_mkt_analytics_entity_idx
  on public.os_marketing_analytics_events (entity_id, occurred_at desc);
create index if not exists os_mkt_analytics_kind_idx
  on public.os_marketing_analytics_events (kind, occurred_at desc);

-- ─── OAuth token refresh metadata ────────────────────────────────────────────
alter table public.os_marketing_oauth_tokens
  add column if not exists last_refreshed_at timestamptz;
alter table public.os_marketing_oauth_tokens
  add column if not exists refresh_error text;
alter table public.os_marketing_oauth_tokens
  add column if not exists refresh_attempts int not null default 0;

-- ─── DocuSign signed files: prefer object storage ────────────────────────────
alter table public.os_docusign_signed_files
  add column if not exists storage_path text;
alter table public.os_docusign_signed_files
  add column if not exists size_bytes bigint;
alter table public.os_docusign_signed_files
  add column if not exists storage_error text;

-- ─── IT offboarding ↔ tickets ────────────────────────────────────────────────
alter table public.os_it_offboarding_runs
  add column if not exists ticket_id text;
alter table public.os_it_offboarding_runs
  add column if not exists source text not null default 'manual';
create index if not exists os_it_offboarding_ticket_idx
  on public.os_it_offboarding_runs (ticket_id)
  where ticket_id is not null;

-- ─── Storage bucket for signed DocuSign PDFs ─────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'docusign-signed',
  'docusign-signed',
  false,
  52428800,
  array['application/pdf', 'text/plain', 'application/octet-stream']
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Service role bypasses RLS; authenticated may read via signed URLs from app.
drop policy if exists "docusign_signed_storage_select" on storage.objects;
create policy "docusign_signed_storage_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'docusign-signed');

-- ─── RLS analytics ───────────────────────────────────────────────────────────
alter table public.os_marketing_analytics_events enable row level security;

drop policy if exists "os_mkt_analytics_select" on public.os_marketing_analytics_events;
create policy "os_mkt_analytics_select"
  on public.os_marketing_analytics_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

grant select, insert on public.os_marketing_analytics_events to authenticated;
