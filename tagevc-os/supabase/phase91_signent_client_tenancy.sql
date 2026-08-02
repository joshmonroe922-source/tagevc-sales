-- Phase 91: Signent client tenancy (empty) — D02=A
-- client_org_id + RLS seams. No fake client seed rows.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Signent client organizations (empty until real paying clients)
-- ---------------------------------------------------------------------------
create table if not exists public.os_signent_client_orgs (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text not null default '',
  status text not null default 'prospect'
    check (status in (
      'prospect', 'active', 'paused', 'churned', 'archived'
    )),
  portal_url text,
  logo_document_id uuid,
  sales_owner_profile_id uuid,
  ops_owner_profile_id uuid,
  purchased_product_keys text[] not null default '{}',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_signent_client_orgs_status_idx
  on public.os_signent_client_orgs (status);

alter table public.os_signent_client_orgs enable row level security;

drop policy if exists os_signent_client_orgs_select on public.os_signent_client_orgs;
create policy os_signent_client_orgs_select on public.os_signent_client_orgs
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity('ENT-SIGNENT')
  );

drop policy if exists os_signent_client_orgs_write on public.os_signent_client_orgs;
create policy os_signent_client_orgs_write on public.os_signent_client_orgs
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity('ENT-SIGNENT')
  )
  with check (
    public.is_firm_wide_access()
    or public.can_access_entity('ENT-SIGNENT')
  );

revoke all on public.os_signent_client_orgs from public, anon;
grant select, insert, update, delete on public.os_signent_client_orgs to authenticated;

create or replace function public.set_os_signent_client_orgs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists os_signent_client_orgs_updated_at on public.os_signent_client_orgs;
create trigger os_signent_client_orgs_updated_at
  before update on public.os_signent_client_orgs
  for each row execute function public.set_os_signent_client_orgs_updated_at();

-- ---------------------------------------------------------------------------
-- HRIS employees / runs: optional client_org_id (Signent clients only)
-- ---------------------------------------------------------------------------
alter table public.os_hris_employees
  add column if not exists client_org_id uuid
    references public.os_signent_client_orgs (id) on delete set null;

create index if not exists os_hris_employees_client_org_idx
  on public.os_hris_employees (client_org_id)
  where client_org_id is not null;

-- Soft check: client_org_id only meaningful under ENT-SIGNENT
comment on column public.os_hris_employees.client_org_id is
  'Signent client workforce segmentation. Null for operating entity employees. Only set when entity_id = ENT-SIGNENT.';

alter table public.os_hris_process_runs
  add column if not exists client_org_id uuid
    references public.os_signent_client_orgs (id) on delete set null;

create index if not exists os_hris_process_runs_client_org_idx
  on public.os_hris_process_runs (client_org_id)
  where client_org_id is not null;

-- Tighten employee RLS: Signent client rows require entity access + (firm-wide or matching client scope later)
-- Keep existing entity policies; client_org filter enforced in app until client-scoped roles exist.
