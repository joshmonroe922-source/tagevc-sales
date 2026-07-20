-- Phase 20: DocuSign Connect event audit (scaffolding)
-- Apply optionally; app does not require this until Phase 21+ real integration.
-- Mock webhook continues to write DocumentRecord + in-memory doc audits.

create table if not exists public.os_docusign_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  envelope_id text not null,
  status text not null,
  doc_id text,
  entity_id text references public.entities(entity_id),
  raw_payload jsonb,
  received_at timestamptz not null default now()
);

create index if not exists os_docusign_events_envelope_idx
  on public.os_docusign_events (envelope_id, received_at desc);

create index if not exists os_docusign_events_doc_idx
  on public.os_docusign_events (doc_id);

alter table public.os_docusign_events enable row level security;

drop policy if exists "os_docusign_events_scoped_select" on public.os_docusign_events;
create policy "os_docusign_events_scoped_select"
  on public.os_docusign_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

-- Inserts typically via service role / webhook handler
grant select on public.os_docusign_events to authenticated;
