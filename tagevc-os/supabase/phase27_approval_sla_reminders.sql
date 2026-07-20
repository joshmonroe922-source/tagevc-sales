-- Phase 27: Marketing approval SLA + DocuSign reminder jobs
-- Safe to re-run. Does NOT drop os_store_snapshots.

-- ─── Marketing approval SLA ──────────────────────────────────────────────────
alter table public.os_marketing_content
  add column if not exists approval_due_at timestamptz;
alter table public.os_marketing_content
  add column if not exists approval_ticket_id text;

create index if not exists os_mkt_content_approval_due_idx
  on public.os_marketing_content (status, approval_due_at)
  where status = 'review';

-- ─── DocuSign scheduled reminders ────────────────────────────────────────────
create table if not exists public.os_docusign_reminder_jobs (
  id uuid primary key default gen_random_uuid(),
  job_id text not null unique,
  envelope_id text not null,
  doc_id text,
  entity_id text references public.entities(entity_id),
  status text not null default 'pending',
  scheduled_for timestamptz not null,
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_docusign_reminder_due_idx
  on public.os_docusign_reminder_jobs (status, scheduled_for);

alter table public.os_docusign_reminder_jobs enable row level security;

drop policy if exists "os_docusign_reminder_select" on public.os_docusign_reminder_jobs;
drop policy if exists "os_docusign_reminder_write" on public.os_docusign_reminder_jobs;
create policy "os_docusign_reminder_select"
  on public.os_docusign_reminder_jobs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_docusign_reminder_write"
  on public.os_docusign_reminder_jobs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

grant select, insert, update on public.os_docusign_reminder_jobs to authenticated;
