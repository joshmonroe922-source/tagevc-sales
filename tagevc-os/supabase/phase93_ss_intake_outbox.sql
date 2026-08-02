-- Phase 93: Shared Services intake outbox (D06=C)
-- When ticket persists but inbound ledger upsert fails, enqueue for Tage retry.
-- Additive. Safe to re-run.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.os_ss_intake_outbox (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  recruit_ticket_id text not null,
  tage_ticket_id text not null,
  kind text not null default '',
  subject text not null default '',
  resource_type text,
  resource_id text,
  portal_url text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'done', 'failed')),
  attempts int not null default 0,
  last_error text not null default '',
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, recruit_ticket_id)
);

create index if not exists os_ss_intake_outbox_pending_idx
  on public.os_ss_intake_outbox (status, next_attempt_at)
  where status in ('pending', 'processing');

alter table public.os_ss_intake_outbox enable row level security;

drop policy if exists os_ss_intake_outbox_select on public.os_ss_intake_outbox;
create policy os_ss_intake_outbox_select on public.os_ss_intake_outbox
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

-- Writes via service role / persist client; authenticated read for ops visibility.
revoke all on public.os_ss_intake_outbox from public, anon;
grant select on public.os_ss_intake_outbox to authenticated;
grant select, insert, update, delete on public.os_ss_intake_outbox to service_role;
