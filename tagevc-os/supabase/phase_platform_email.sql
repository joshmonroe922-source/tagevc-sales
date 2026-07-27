-- Platform email (entity-scoped) for Tage OS + all subsidiary portals.
-- Additive / idempotent. Does not drop legacy sales_email_* tables.
-- Canonical copy: keep in sync with recruit619-portal/supabase/phase_platform_email.sql

create table if not exists public.os_platform_email_campaigns (
  id              uuid primary key default gen_random_uuid(),
  entity_id       text not null,
  name            text not null default '',
  created_by      uuid,
  status          text not null default 'draft',
  tags            jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint os_platform_email_campaigns_status_len
    check (char_length(status) between 1 and 40)
);

create index if not exists os_platform_email_campaigns_entity_idx
  on public.os_platform_email_campaigns (entity_id, created_at desc);

create table if not exists public.os_platform_email_messages (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            text not null,
  provider             text not null default 'graph',
  source               text not null default 'unknown',
  resend_id            text,
  tracking_token       text,
  from_address         text,
  to_addresses         text[] not null default '{}',
  subject              text not null default '',
  status               text not null default 'sent',
  open_count           integer not null default 0,
  click_count          integer not null default 0,
  first_opened_at      timestamptz,
  last_opened_at       timestamptz,
  first_clicked_at     timestamptz,
  last_clicked_at      timestamptz,
  delivered_at         timestamptz,
  bounced_at           timestamptz,
  sent_by_profile_id   uuid,
  campaign_id          uuid references public.os_platform_email_campaigns (id) on delete set null,
  tags                 jsonb not null default '{}'::jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint os_platform_email_messages_provider_check
    check (provider in ('resend', 'graph')),
  constraint os_platform_email_messages_id_present
    check (resend_id is not null or tracking_token is not null),
  constraint os_platform_email_messages_open_nonneg check (open_count >= 0),
  constraint os_platform_email_messages_click_nonneg check (click_count >= 0)
);

create unique index if not exists os_platform_email_messages_resend_uidx
  on public.os_platform_email_messages (resend_id)
  where resend_id is not null;

create unique index if not exists os_platform_email_messages_token_uidx
  on public.os_platform_email_messages (tracking_token)
  where tracking_token is not null;

create index if not exists os_platform_email_messages_entity_idx
  on public.os_platform_email_messages (entity_id, created_at desc);

create index if not exists os_platform_email_messages_campaign_idx
  on public.os_platform_email_messages (campaign_id, created_at desc);

create table if not exists public.os_platform_email_events (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid references public.os_platform_email_messages (id) on delete cascade,
  entity_id       text not null,
  event_type      text not null,
  tracking_token  text,
  resend_id       text,
  recipient       text,
  click_url       text,
  user_agent      text,
  ip_address      text,
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now()
);

create index if not exists os_platform_email_events_message_idx
  on public.os_platform_email_events (message_id, occurred_at desc);

create index if not exists os_platform_email_events_token_idx
  on public.os_platform_email_events (tracking_token, occurred_at desc);

create index if not exists os_platform_email_events_entity_idx
  on public.os_platform_email_events (entity_id, occurred_at desc);

alter table public.os_platform_email_campaigns enable row level security;
alter table public.os_platform_email_messages enable row level security;
alter table public.os_platform_email_events enable row level security;

comment on table public.os_platform_email_messages is
  'Platform outbound email (Graph or Resend) scoped by entity_id for Tage + subsidiaries.';

-- Authenticated read for analytics UIs. Writes use service_role (bypasses RLS)
-- via mail-tracking / send APIs — do not grant broad authenticated write.
do $$ begin
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_platform_email_messages'
      and policyname = 'os_platform_email_messages_auth_select'
  ) then
    create policy os_platform_email_messages_auth_select
      on public.os_platform_email_messages
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_platform_email_events'
      and policyname = 'os_platform_email_events_auth_select'
  ) then
    create policy os_platform_email_events_auth_select
      on public.os_platform_email_events
      for select to authenticated using (true);
  end if;
  if not exists (
    select 1 from pg_policies
    where tablename = 'os_platform_email_campaigns'
      and policyname = 'os_platform_email_campaigns_auth_select'
  ) then
    create policy os_platform_email_campaigns_auth_select
      on public.os_platform_email_campaigns
      for select to authenticated using (true);
  end if;
end $$;
