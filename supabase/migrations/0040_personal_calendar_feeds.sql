-- Personal / Google calendar ICS feeds (portal overlay).
-- Outlook "Add personal calendars" (Google OAuth in OWA) is NOT visible to Microsoft Graph.
-- Users paste a Google secret ICS URL (or any https .ics feed); the portal overlays it.

create table if not exists public.personal_calendar_feeds (
  id              uuid primary key default gen_random_uuid(),
  sales_user_id   uuid not null
                    references public.sales_users (id) on delete cascade,
  name            text not null default 'Personal',
  color           text,
  -- Encrypted ICS URL (AES-GCM via edge MS_TOKEN_ENCRYPTION_KEY). Never expose to clients.
  url_enc         text not null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists personal_calendar_feeds_user_idx
  on public.personal_calendar_feeds (sales_user_id);

comment on table public.personal_calendar_feeds is
  'Per-user ICS calendar subscriptions (e.g. Google secret address). Edge/service-role only.';

alter table public.personal_calendar_feeds enable row level security;
-- No client policies: edge functions use service role.
