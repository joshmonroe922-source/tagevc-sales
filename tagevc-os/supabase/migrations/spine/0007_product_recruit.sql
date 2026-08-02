-- C11 / 0007_product_recruit — Recruit product tables on shared graph
create table if not exists public.recruit_job_reqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null,
  status text not null default 'open',
  -- USER-owned field: workers must never update without explicit human API
  hiring_manager_contact_id uuid references public.contacts (id) on delete set null,
  hiring_manager_locked boolean not null default true,
  created_by uuid references public.user_profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recruit_job_reqs_org_idx
  on public.recruit_job_reqs (org_id, status);

create index if not exists recruit_job_reqs_account_idx
  on public.recruit_job_reqs (account_id);

drop trigger if exists recruit_job_reqs_set_updated_at on public.recruit_job_reqs;
create trigger recruit_job_reqs_set_updated_at
  before update on public.recruit_job_reqs
  for each row execute function public.spine_set_updated_at();

create table if not exists public.recruit_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status text not null default 'sourced',
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, contact_id)
);

create table if not exists public.recruit_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_req_id uuid not null references public.recruit_job_reqs (id) on delete cascade,
  candidate_id uuid not null references public.recruit_candidates (id) on delete cascade,
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  notes text,
  unique (job_req_id, candidate_id)
);
