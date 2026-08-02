-- C1 / 0004_employments_edges
create table if not exists public.employments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text,
  department text,
  is_current boolean not null default true,
  started_on date,
  ended_on date,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists employments_current_uidx
  on public.employments (contact_id, account_id)
  where is_current = true;

create index if not exists employments_account_idx on public.employments (account_id);
create index if not exists employments_contact_idx on public.employments (contact_id);

create table if not exists public.org_edges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  manager_contact_id uuid not null references public.contacts (id) on delete cascade,
  report_contact_id uuid not null references public.contacts (id) on delete cascade,
  relation text not null default 'reports_to',
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  confidence numeric(4, 3),
  rationale text,
  suggested_by text,
  confirmed_by uuid references public.user_profiles (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists org_edges_active_uidx
  on public.org_edges (account_id, report_contact_id, relation)
  where status in ('suggested', 'confirmed');

create index if not exists org_edges_account_idx on public.org_edges (account_id);

drop trigger if exists org_edges_set_updated_at on public.org_edges;
create trigger org_edges_set_updated_at
  before update on public.org_edges
  for each row execute function public.spine_set_updated_at();
