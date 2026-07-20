-- Phase 26: DocuSign template cache + IT onboarding runs
-- Safe to re-run. Does NOT drop os_store_snapshots.

-- ─── DocuSign templates (hub visibility) ─────────────────────────────────────
create table if not exists public.os_docusign_templates (
  id uuid primary key default gen_random_uuid(),
  template_id text not null unique,
  name text not null,
  description text,
  shared boolean not null default false,
  last_modified timestamptz,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists os_docusign_templates_name_idx
  on public.os_docusign_templates (name);

alter table public.os_docusign_templates enable row level security;

drop policy if exists "os_docusign_templates_select" on public.os_docusign_templates;
create policy "os_docusign_templates_select"
  on public.os_docusign_templates for select to authenticated
  using (true);

drop policy if exists "os_docusign_templates_write" on public.os_docusign_templates;
create policy "os_docusign_templates_write"
  on public.os_docusign_templates for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

grant select, insert, update, delete on public.os_docusign_templates to authenticated;

-- ─── IT onboarding (mirror offboarding) ──────────────────────────────────────
create table if not exists public.os_it_onboarding_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  user_id text not null,
  entity_id text references public.entities(entity_id),
  status text not null default 'open',
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  actor_id uuid,
  ticket_id text,
  source text not null default 'manual',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists os_it_onboarding_user_idx
  on public.os_it_onboarding_runs (user_id, created_at desc);
create index if not exists os_it_onboarding_ticket_idx
  on public.os_it_onboarding_runs (ticket_id)
  where ticket_id is not null;

alter table public.os_it_onboarding_runs enable row level security;

drop policy if exists "os_it_onboard_select" on public.os_it_onboarding_runs;
drop policy if exists "os_it_onboard_write" on public.os_it_onboarding_runs;
create policy "os_it_onboard_select"
  on public.os_it_onboarding_runs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_it_onboard_write"
  on public.os_it_onboarding_runs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

grant select, insert, update on public.os_it_onboarding_runs to authenticated;
