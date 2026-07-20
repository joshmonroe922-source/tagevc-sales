-- Phase 28: Marketing SLA escalation + DocuSign CoC email log
-- Safe to re-run. Does NOT drop os_store_snapshots.

-- ─── Marketing approval escalation stamp ─────────────────────────────────────
alter table public.os_marketing_content
  add column if not exists approval_escalated_at timestamptz;

create index if not exists os_mkt_content_sla_overdue_idx
  on public.os_marketing_content (status, approval_due_at)
  where status = 'review' and approval_due_at is not null;

-- ─── DocuSign CoC email audit ────────────────────────────────────────────────
create table if not exists public.os_docusign_coc_emails (
  id uuid primary key default gen_random_uuid(),
  envelope_id text not null,
  doc_id text,
  recipients text[] not null default '{}',
  emailed_count int not null default 0,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists os_docusign_coc_emails_env_idx
  on public.os_docusign_coc_emails (envelope_id, created_at desc);

alter table public.os_docusign_coc_emails enable row level security;

drop policy if exists "os_docusign_coc_emails_select" on public.os_docusign_coc_emails;
drop policy if exists "os_docusign_coc_emails_write" on public.os_docusign_coc_emails;
create policy "os_docusign_coc_emails_select"
  on public.os_docusign_coc_emails for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_docusign_coc_emails_write"
  on public.os_docusign_coc_emails for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

grant select, insert on public.os_docusign_coc_emails to authenticated;
