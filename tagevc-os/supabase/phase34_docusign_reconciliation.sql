-- Phase 34: observe-only DocuSign envelope reconciliation and event dedupe.
-- Reconciliation never sends, voids, or changes recipients.

alter table public.os_docusign_events
  add column if not exists dedupe_key text,
  add column if not exists payload_sha256 text,
  add column if not exists occurred_at timestamptz,
  add column if not exists source text not null default 'application',
  add column if not exists processing_status text not null default 'recorded',
  add column if not exists processing_error text,
  add column if not exists processed_at timestamptz;

create unique index if not exists os_docusign_events_dedupe_unique
  on public.os_docusign_events (dedupe_key)
  where dedupe_key is not null;

create table if not exists public.os_docusign_envelopes (
  id uuid primary key default gen_random_uuid(),
  envelope_id text not null unique,
  operation_kind text not null default 'legacy',
  doc_id text,
  entity_id text references public.entities(entity_id),
  deal_id text,
  ticket_id text,
  lineage_id uuid references public.os_docusign_envelope_lineage(lineage_id),
  provider_status text,
  provider_status_at timestamptz,
  provider_observed_at timestamptz,
  local_document_status text,
  last_event_id text,
  reconciliation_state text not null default 'pending',
  issue_code text,
  last_error text,
  attempts integer not null default 0,
  last_reconciled_at timestamptz,
  next_reconcile_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_docusign_envelope_operation_check check (
    operation_kind in ('document_send', 'template_send', 'replacement',
      'connect_discovered', 'legacy')
  ),
  constraint os_docusign_envelope_reconcile_check check (
    reconciliation_state in ('pending', 'in_sync', 'repaired',
      'unmapped_expected', 'manual_review', 'provider_missing',
      'retry_wait', 'failed')
  )
);

create index if not exists os_docusign_envelope_reconcile_idx
  on public.os_docusign_envelopes
  (reconciliation_state, next_reconcile_at);
create index if not exists os_docusign_envelope_entity_idx
  on public.os_docusign_envelopes (entity_id, updated_at desc);
create index if not exists os_docusign_envelope_doc_idx
  on public.os_docusign_envelopes (doc_id);

create table if not exists public.os_docusign_reconciliation_runs (
  run_id uuid primary key default gen_random_uuid(),
  trigger_source text not null,
  status text not null default 'running',
  window_days integer not null,
  seen integer not null default 0,
  matched integer not null default 0,
  unmapped integer not null default 0,
  manual_review integer not null default 0,
  failed integer not null default 0,
  requested_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  error text,
  constraint os_docusign_reconcile_trigger_check
    check (trigger_source in ('cron', 'manual', 'webhook_recovery')),
  constraint os_docusign_reconcile_run_status_check
    check (status in ('running', 'completed', 'partial', 'failed'))
);

alter table public.os_docusign_envelopes enable row level security;
alter table public.os_docusign_reconciliation_runs enable row level security;

drop policy if exists "os_docusign_envelope_select"
  on public.os_docusign_envelopes;
create policy "os_docusign_envelope_select"
  on public.os_docusign_envelopes for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_docusign_reconcile_run_select"
  on public.os_docusign_reconciliation_runs;
create policy "os_docusign_reconcile_run_select"
  on public.os_docusign_reconciliation_runs for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_docusign_envelopes,
  public.os_docusign_reconciliation_runs to authenticated;
revoke insert, update, delete on public.os_docusign_envelopes,
  public.os_docusign_reconciliation_runs from authenticated;
