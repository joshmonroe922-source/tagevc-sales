-- Phase 5b: library document refs for journey send_envelope nodes
create table if not exists public.ecc_library_document_refs (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  library_document_id text not null,
  title text not null default '',
  allow_email_attach boolean not null default false,
  created_at timestamptz not null default now(),
  unique(entity_id, library_document_id)
);
create index if not exists ecc_library_document_refs_entity_idx
  on public.ecc_library_document_refs(entity_id);

alter table public.ecc_library_document_refs enable row level security;
do $$ begin
  create policy ecc_library_document_refs_select on public.ecc_library_document_refs
    for select to authenticated
    using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
exception when others then null; end $$;

-- Default library doc hint on brand kit / settings (optional)
-- brand_kit_json.default_library_document_id
