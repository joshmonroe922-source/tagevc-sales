-- 0011_r619_crm_alignment — Sheet 58 §4 P0 spine DDL (additive only)
-- Safe alongside SF backfill into r619_* tables. Do not drop or truncate.

-- ─── sf_id + external_ids on graph / product tables ───────────────────────────
alter table public.accounts
  add column if not exists sf_id text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb;

alter table public.contacts
  add column if not exists sf_id text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb,
  add column if not exists kind text
    check (kind is null or kind in ('client_contact', 'candidate')),
  add column if not exists subtype text
    check (subtype is null or subtype in ('dh', 'contractor', 'c2h')),
  add column if not exists geo_lat double precision,
  add column if not exists geo_lng double precision,
  add column if not exists skills text[] not null default '{}';

create unique index if not exists accounts_sf_id_uidx
  on public.accounts (sf_id)
  where sf_id is not null;

create unique index if not exists contacts_sf_id_uidx
  on public.contacts (sf_id)
  where sf_id is not null;

create index if not exists contacts_kind_idx
  on public.contacts (kind)
  where kind is not null;

-- ─── recruit_job_reqs desk fields ─────────────────────────────────────────────
alter table public.recruit_job_reqs
  add column if not exists sf_id text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb,
  add column if not exists owner_user_id uuid references public.user_profiles (id) on delete set null,
  add column if not exists employment_type text
    check (employment_type is null or employment_type in ('dh', 'contractor', 'c2h')),
  add column if not exists req_number text,
  add column if not exists description text,
  add column if not exists location text,
  add column if not exists geo_lat double precision,
  add column if not exists geo_lng double precision,
  add column if not exists req_skills text[] not null default '{}',
  add column if not exists opened_at timestamptz,
  add column if not exists closed_at timestamptz,
  add column if not exists capacity_coverage_pct numeric(5, 2);

create unique index if not exists recruit_job_reqs_sf_id_uidx
  on public.recruit_job_reqs (sf_id)
  where sf_id is not null;

create index if not exists recruit_job_reqs_owner_idx
  on public.recruit_job_reqs (org_id, owner_user_id);

-- Comfort VIEW for CRM naming (job_id in product copy)
create or replace view public.jobs as
  select * from public.recruit_job_reqs;

-- ─── recruit_submissions: full pipeline + UNIQUE(job, contact) ────────────────
alter table public.recruit_submissions
  add column if not exists sf_id text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb,
  add column if not exists contact_id uuid references public.contacts (id) on delete cascade,
  add column if not exists job_id uuid references public.recruit_job_reqs (id) on delete cascade,
  add column if not exists stage text not null default 'sourced',
  add column if not exists score numeric(5, 2),
  add column if not exists score_reasons jsonb not null default '[]'::jsonb,
  add column if not exists owner_user_id uuid references public.user_profiles (id) on delete set null,
  add column if not exists last_activity_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

-- Backfill aliases from stub columns
update public.recruit_submissions
set job_id = coalesce(job_id, job_req_id)
where job_id is null and job_req_id is not null;

update public.recruit_submissions s
set contact_id = c.contact_id
from public.recruit_candidates c
where s.contact_id is null
  and s.candidate_id = c.id;

-- Prefer contact+job uniqueness (sheet 58); keep legacy unique if both nulls absent
create unique index if not exists recruit_submissions_job_contact_uidx
  on public.recruit_submissions (org_id, job_id, contact_id)
  where job_id is not null and contact_id is not null;

create unique index if not exists recruit_submissions_sf_id_uidx
  on public.recruit_submissions (sf_id)
  where sf_id is not null;

create index if not exists recruit_submissions_org_stage_idx
  on public.recruit_submissions (org_id, stage);

drop trigger if exists recruit_submissions_set_updated_at on public.recruit_submissions;
create trigger recruit_submissions_set_updated_at
  before update on public.recruit_submissions
  for each row execute function public.spine_set_updated_at();

-- ─── recruit_placements (missing DDL — place + MBP) ───────────────────────────
create table if not exists public.recruit_placements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete restrict,
  job_id uuid references public.recruit_job_reqs (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  submission_id uuid references public.recruit_submissions (id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'ended', 'fell_off', 'guaranteed')),
  employment_type text
    check (employment_type is null or employment_type in ('dh', 'contractor', 'c2h')),
  start_date date,
  end_date date,
  pay_rate numeric(12, 2),
  bill_rate numeric(12, 2),
  fee_amount numeric(12, 2),
  work_state text,
  external_worker_id text,
  sf_id text,
  external_ids jsonb not null default '{}'::jsonb,
  burden_snapshot jsonb not null default '{}'::jsonb,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists recruit_placements_sf_id_uidx
  on public.recruit_placements (sf_id)
  where sf_id is not null;

create index if not exists recruit_placements_org_idx
  on public.recruit_placements (org_id, status);

create index if not exists recruit_placements_contact_idx
  on public.recruit_placements (contact_id);

drop trigger if exists recruit_placements_set_updated_at on public.recruit_placements;
create trigger recruit_placements_set_updated_at
  before update on public.recruit_placements
  for each row execute function public.spine_set_updated_at();

alter table public.recruit_placements enable row level security;

drop policy if exists recruit_placements_all on public.recruit_placements;
create policy recruit_placements_all on public.recruit_placements
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

grant select, insert, update, delete on public.recruit_placements to authenticated;

-- ─── activities: My Day / timeline parents ────────────────────────────────────
alter table public.activities
  add column if not exists sf_id text,
  add column if not exists external_ids jsonb not null default '{}'::jsonb,
  add column if not exists due_at timestamptz,
  add column if not exists completed_at timestamptz,
  add column if not exists job_id uuid references public.recruit_job_reqs (id) on delete set null,
  add column if not exists placement_id uuid references public.recruit_placements (id) on delete set null,
  add column if not exists channel text,
  add column if not exists is_task boolean not null default false,
  add column if not exists title text;

create index if not exists activities_due_idx
  on public.activities (org_id, due_at)
  where due_at is not null and completed_at is null;

create index if not exists activities_job_idx
  on public.activities (job_id)
  where job_id is not null;

-- ─── files (resumes / generated docs) ─────────────────────────────────────────
create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  path text not null,
  bucket text not null default 'resumes',
  content_type text,
  byte_size bigint,
  original_name text,
  contact_id uuid references public.contacts (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  job_id uuid references public.recruit_job_reqs (id) on delete set null,
  kind text not null default 'resume',
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, path)
);

create index if not exists files_org_contact_idx
  on public.files (org_id, contact_id);

alter table public.files enable row level security;

drop policy if exists files_all on public.files;
create policy files_all on public.files
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

grant select, insert, update, delete on public.files to authenticated;

-- ─── agent_run_log (CRM agents — immutable insert) ────────────────────────────
create table if not exists public.agent_run_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  agent_name text not null,
  event_type text,
  input_ref jsonb not null default '{}'::jsonb,
  output_ref jsonb not null default '{}'::jsonb,
  reasoning text,
  confidence numeric(4, 3),
  autonomy_tier text
    check (autonomy_tier is null or autonomy_tier in ('suggest', 'assist', 'delegate', 'automate')),
  human_decision text
    check (human_decision is null or human_decision in ('accept', 'edit', 'dismiss', 'na')),
  created_at timestamptz not null default now()
);

create index if not exists agent_run_log_org_idx
  on public.agent_run_log (org_id, created_at desc);

alter table public.agent_run_log enable row level security;

drop policy if exists agent_run_log_insert on public.agent_run_log;
create policy agent_run_log_insert on public.agent_run_log
  for insert to authenticated
  with check (public.fn_has_org(org_id));

drop policy if exists agent_run_log_select on public.agent_run_log;
create policy agent_run_log_select on public.agent_run_log
  for select using (public.fn_has_org(org_id) or public.fn_is_tage_admin());

grant select, insert on public.agent_run_log to authenticated;

create table if not exists public.agent_suggestions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'edited', 'dismissed')),
  run_id uuid references public.agent_run_log (id) on delete set null,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);

create index if not exists agent_suggestions_org_pending_idx
  on public.agent_suggestions (org_id, status)
  where status = 'pending';

alter table public.agent_suggestions enable row level security;

drop policy if exists agent_suggestions_all on public.agent_suggestions;
create policy agent_suggestions_all on public.agent_suggestions
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

grant select, insert, update, delete on public.agent_suggestions to authenticated;
