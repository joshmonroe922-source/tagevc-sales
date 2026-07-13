-- Email analytics for Resend-sent portal mail (opens, clicks, delivery).
-- Events arrive via the resend-webhook edge function (service role).
-- Open/click tracking must also be enabled on the Resend domain + webhook.

-- ---------------------------------------------------------------------------
-- Outbound messages we sent (or discovered via webhook)
-- ---------------------------------------------------------------------------
create table if not exists public.sales_email_messages (
  id              uuid primary key default gen_random_uuid(),
  resend_id       text not null unique,
  message_id      text,
  lead_id         uuid references public.sales_leads (id) on delete set null,
  source          text not null default 'unknown',
  -- source examples: intake_alert, drip_lead, drip_reminder, portal_tracked, auth, webhook
  from_address    text,
  to_addresses    text[] not null default '{}',
  subject         text not null default '',
  reply_to        text,
  tags            jsonb not null default '{}'::jsonb,
  status          text not null default 'sent',
  -- status: sent | delivered | delivery_delayed | bounced | complained | failed | suppressed
  open_count      integer not null default 0,
  click_count     integer not null default 0,
  first_opened_at timestamptz,
  last_opened_at  timestamptz,
  first_clicked_at timestamptz,
  last_clicked_at timestamptz,
  delivered_at    timestamptz,
  bounced_at      timestamptz,
  sent_by         uuid references public.sales_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint sales_email_messages_source_len check (char_length(source) between 1 and 60),
  constraint sales_email_messages_status_len check (char_length(status) between 1 and 40),
  constraint sales_email_messages_open_count_nonneg check (open_count >= 0),
  constraint sales_email_messages_click_count_nonneg check (click_count >= 0)
);

create index if not exists sales_email_messages_created_at_idx
  on public.sales_email_messages (created_at desc);

create index if not exists sales_email_messages_lead_id_idx
  on public.sales_email_messages (lead_id, created_at desc);

create index if not exists sales_email_messages_source_idx
  on public.sales_email_messages (source, created_at desc);

create index if not exists sales_email_messages_to_gin_idx
  on public.sales_email_messages using gin (to_addresses);

comment on table public.sales_email_messages is
  'Outbound emails sent via Resend (portal/drips/intake). Aggregates open/click counts from webhooks.';

-- ---------------------------------------------------------------------------
-- Individual Resend webhook events
-- ---------------------------------------------------------------------------
create table if not exists public.sales_email_events (
  id              uuid primary key default gen_random_uuid(),
  message_id      uuid references public.sales_email_messages (id) on delete cascade,
  resend_id       text not null,
  svix_id         text unique,
  event_type      text not null,
  -- email.sent | email.delivered | email.opened | email.clicked | email.bounced | …
  recipient       text,
  click_url       text,
  user_agent      text,
  ip_address      text,
  payload         jsonb not null default '{}'::jsonb,
  occurred_at     timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint sales_email_events_type_len check (char_length(event_type) between 1 and 80)
);

create index if not exists sales_email_events_message_id_idx
  on public.sales_email_events (message_id, occurred_at desc);

create index if not exists sales_email_events_resend_id_idx
  on public.sales_email_events (resend_id, occurred_at desc);

create index if not exists sales_email_events_type_idx
  on public.sales_email_events (event_type, occurred_at desc);

create index if not exists sales_email_events_occurred_at_idx
  on public.sales_email_events (occurred_at desc);

comment on table public.sales_email_events is
  'Raw Resend webhook events (opens, clicks, delivery). Deduped by svix_id when present.';

-- ---------------------------------------------------------------------------
-- RLS: sales users can read; writes only via service role (edge functions)
-- ---------------------------------------------------------------------------
alter table public.sales_email_messages enable row level security;
alter table public.sales_email_events enable row level security;

create policy "Sales users view email messages"
  on public.sales_email_messages for select
  to authenticated
  using (public.is_active_sales_user());

create policy "Sales users view email events"
  on public.sales_email_events for select
  to authenticated
  using (public.is_active_sales_user());
