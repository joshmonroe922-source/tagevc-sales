-- Phase 33: durable, idempotent DocuSign replacement lineage.

create table if not exists public.os_docusign_envelope_lineage (
  lineage_id uuid primary key default gen_random_uuid(),
  request_id text not null unique,
  source_envelope_id text not null,
  replacement_envelope_id text,
  source_doc_id text,
  entity_id text references public.entities(entity_id),
  deal_id text,
  ticket_id text,
  template_id text not null,
  role_map jsonb not null default '[]'::jsonb,
  replacement_reason text,
  status text not null default 'requested',
  actor_id uuid,
  actor_email text,
  error text,
  requested_at timestamptz not null default now(),
  created_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint os_docusign_lineage_status_check
    check (status in ('requested', 'created', 'failed', 'reconciled')),
  constraint os_docusign_lineage_distinct_check
    check (
      replacement_envelope_id is null
      or replacement_envelope_id <> source_envelope_id
    )
);

create unique index if not exists os_docusign_lineage_replacement_unique
  on public.os_docusign_envelope_lineage (replacement_envelope_id)
  where replacement_envelope_id is not null;
create unique index if not exists os_docusign_lineage_active_source_unique
  on public.os_docusign_envelope_lineage (source_envelope_id)
  where status in ('requested', 'created');
create index if not exists os_docusign_lineage_entity_idx
  on public.os_docusign_envelope_lineage (entity_id, requested_at desc);

alter table public.os_docusign_envelope_lineage enable row level security;

drop policy if exists "os_docusign_lineage_select"
  on public.os_docusign_envelope_lineage;
drop policy if exists "os_docusign_lineage_write"
  on public.os_docusign_envelope_lineage;
create policy "os_docusign_lineage_select"
  on public.os_docusign_envelope_lineage for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_docusign_lineage_write"
  on public.os_docusign_envelope_lineage for all to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  )
  with check (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

grant select, insert, update on public.os_docusign_envelope_lineage
  to authenticated;
