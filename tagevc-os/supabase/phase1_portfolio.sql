-- Phase 1: Portfolio Active + monthly CORE P&L (for future Supabase cutover)

create table if not exists public.portfolio_companies (
  id uuid primary key default gen_random_uuid(),
  portfolio_id text not null unique,
  entity_id text not null references public.entities (entity_id),
  company_name text not null,
  deal_id text,
  path text,
  close_date date,
  coo_owner text,
  board_lead text,
  arr_k numeric not null default 0,
  mom_growth numeric,
  net_burn_k numeric not null default 0,
  runway_mo numeric,
  cash_k numeric not null default 0,
  health text not null check (health in ('On Track', 'Watch', 'At Risk', 'Critical')),
  top_risk text,
  next_milestone text,
  last_update date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entity_month_pnl (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities (entity_id),
  period text not null check (period ~ '^\d{4}-\d{2}$'),
  revenue_arr_k numeric not null default 0,
  cogs_k numeric not null default 0,
  opex_k numeric not null default 0,
  net_burn_k numeric not null default 0,
  ending_cash_k numeric not null default 0,
  is_firm boolean not null default false,
  unique (entity_id, period)
);

alter table public.portfolio_companies enable row level security;
alter table public.entity_month_pnl enable row level security;

create policy "portfolio_companies_authenticated_read"
  on public.portfolio_companies for select to authenticated using (true);

create policy "entity_month_pnl_authenticated_read"
  on public.entity_month_pnl for select to authenticated using (true);
