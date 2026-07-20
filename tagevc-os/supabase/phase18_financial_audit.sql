-- Phase 18: Financial edit audit log (append-only)
-- Apply after phase14_portfolio_entity.sql / phase17_entity_rls.sql

create table if not exists public.os_financial_audits (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null unique,
  entity_id text not null references public.entities(entity_id),
  portfolio_id text references public.portfolio_companies(portfolio_id),
  period text not null,
  actor_id uuid,
  actor_email text,
  patch jsonb not null default '{}'::jsonb,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_financial_audits_entity_idx
  on public.os_financial_audits (entity_id, created_at desc);

alter table public.os_financial_audits enable row level security;

drop policy if exists "os_financial_audits_scoped_select" on public.os_financial_audits;
drop policy if exists "os_financial_audits_scoped_insert" on public.os_financial_audits;

create policy "os_financial_audits_scoped_select"
  on public.os_financial_audits for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));

-- Inserts via service role / firm-wide app; authenticated may insert for accessible entities
create policy "os_financial_audits_scoped_insert"
  on public.os_financial_audits for insert to authenticated
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

grant select, insert on public.os_financial_audits to authenticated;
