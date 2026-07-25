-- Phase 74: Dual-person personal credit (Josh/Lauren) + FICO-centric snapshots.
-- Additive on Phase 73. Safe to re-run. Does NOT touch os_store_snapshots.
-- Visionary-only RLS via is_visionary_role().

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Ensure helper exists (from phase73)
create or replace function public.is_visionary_role()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.role = 'visionary'
      and p.active = true
  );
$$;

grant execute on function public.is_visionary_role() to authenticated;

-- ---------------------------------------------------------------------------
-- Subjects (Josh / Lauren only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_personal_credit_subjects (
  id uuid primary key default gen_random_uuid(),
  person_key text not null unique
    check (person_key in ('josh_monroe', 'lauren_monroe')),
  display_name text not null,
  relationship text not null
    check (relationship in ('self', 'spouse')),
  consent_noted_at timestamptz,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.os_personal_credit_subjects (
  person_key, display_name, relationship, consent_noted_at, notes
)
values
  (
    'josh_monroe',
    'Josh Monroe',
    'self',
    now(),
    'Primary Visionary subject'
  ),
  (
    'lauren_monroe',
    'Lauren Monroe',
    'spouse',
    now(),
    'Household consent for personal financial management'
  )
on conflict (person_key) do update set
  display_name = excluded.display_name,
  relationship = excluded.relationship,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Snapshots (FICO 8/10-centric scores jsonb)
-- ---------------------------------------------------------------------------
create table if not exists public.os_personal_credit_snapshots (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null
    references public.os_personal_credit_subjects (id) on delete cascade,
  bureau text not null
    check (bureau in ('equifax', 'experian', 'transunion', 'tri_merge')),
  pulled_at timestamptz not null default now(),
  source text not null
    check (source in (
      'myfico', 'experian', 'equifax', 'annualcreditreport', 'other', 'manual_upload'
    )),
  report_date date,
  scores jsonb not null default '{}'::jsonb,
  summary jsonb not null default '{}'::jsonb,
  raw_storage_path text,
  parse_status text not null default 'pending'
    check (parse_status in (
      'pending', 'parsed', 'partial', 'failed', 'manual'
    )),
  parse_errors text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint os_pcs_scores_check
    check (jsonb_typeof(scores)='object' and pg_column_size(scores)<=8192),
  constraint os_pcs_summary_check
    check (jsonb_typeof(summary)='object' and pg_column_size(summary)<=8192)
);

create index if not exists os_pcs_subject_pulled_idx
  on public.os_personal_credit_snapshots (subject_id, pulled_at desc);
create index if not exists os_pcs_idempotent_idx
  on public.os_personal_credit_snapshots (subject_id, bureau, source, report_date)
  where report_date is not null;

-- ---------------------------------------------------------------------------
-- Tradelines / inquiries / public records / alerts / connections
-- ---------------------------------------------------------------------------
create table if not exists public.os_personal_credit_tradelines (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.os_personal_credit_snapshots (id) on delete cascade,
  creditor_name text not null default '',
  account_type text not null default '',
  responsibility text not null default '',
  open_date date,
  status text not null default '',
  balance numeric(14,2),
  credit_limit numeric(14,2),
  payment_history_summary text not null default '',
  months_reviewed integer,
  is_negative boolean not null default false,
  is_collection boolean not null default false,
  is_chargeoff boolean not null default false,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_pct_snapshot_idx
  on public.os_personal_credit_tradelines (snapshot_id);

create table if not exists public.os_personal_credit_inquiries (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.os_personal_credit_snapshots (id) on delete cascade,
  creditor_name text not null default '',
  inquiry_date date,
  inquiry_type text not null default 'hard'
    check (inquiry_type in ('hard', 'soft', 'unknown')),
  bureau text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.os_personal_credit_public_records (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null
    references public.os_personal_credit_snapshots (id) on delete cascade,
  record_type text not null default '',
  filed_date date,
  status text not null default '',
  amount numeric(14,2),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.os_personal_credit_alerts (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null
    references public.os_personal_credit_subjects (id) on delete cascade,
  snapshot_id uuid
    references public.os_personal_credit_snapshots (id) on delete set null,
  kind text not null
    check (kind in (
      'stale', 'score_change', 'utilization_spike', 'new_inquiry',
      'new_negative', 'parse_error', 'other'
    )),
  title text not null,
  detail jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists os_pca_subject_created_idx
  on public.os_personal_credit_alerts (subject_id, created_at desc)
  where acknowledged_at is null;

create table if not exists public.os_personal_credit_connections (
  id uuid primary key default gen_random_uuid(),
  subject_id uuid not null
    references public.os_personal_credit_subjects (id) on delete cascade,
  provider text not null
    check (provider in ('myfico', 'experian', 'equifax_myequifax', 'other')),
  status text not null default 'disconnected'
    check (status in ('connected_guided', 'stale', 'disconnected')),
  last_successful_pull_at timestamptz,
  vault_secret_ref text,
  notes text not null default '',
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (subject_id, provider)
);

-- Grok advisor thread (Visionary-only)
create table if not exists public.os_personal_credit_grok_messages (
  id uuid primary key default gen_random_uuid(),
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint os_pc_grok_content_len check (char_length(content) <= 32000)
);

create index if not exists os_pc_grok_created_idx
  on public.os_personal_credit_grok_messages (created_at asc);

-- Seed connection shells for both subjects × preferred providers
insert into public.os_personal_credit_connections (subject_id, provider, status, notes)
select s.id, p.provider, 'disconnected', p.notes
from public.os_personal_credit_subjects s
cross join (
  values
    ('myfico', 'Preferred for exact FICO 8 / 10 / Auto / Bankcard'),
    ('experian', 'Preferred for 3-bureau monitoring + alerts')
) as p(provider, notes)
on conflict (subject_id, provider) do nothing;

-- ---------------------------------------------------------------------------
-- RLS — Visionary only
-- ---------------------------------------------------------------------------
alter table public.os_personal_credit_subjects enable row level security;
alter table public.os_personal_credit_snapshots enable row level security;
alter table public.os_personal_credit_tradelines enable row level security;
alter table public.os_personal_credit_inquiries enable row level security;
alter table public.os_personal_credit_public_records enable row level security;
alter table public.os_personal_credit_alerts enable row level security;
alter table public.os_personal_credit_connections enable row level security;
alter table public.os_personal_credit_grok_messages enable row level security;

drop policy if exists os_pcs_subjects_all on public.os_personal_credit_subjects;
create policy os_pcs_subjects_all on public.os_personal_credit_subjects
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_snapshots_all on public.os_personal_credit_snapshots;
create policy os_pcs_snapshots_all on public.os_personal_credit_snapshots
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_tradelines_all on public.os_personal_credit_tradelines;
create policy os_pcs_tradelines_all on public.os_personal_credit_tradelines
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_inquiries_all on public.os_personal_credit_inquiries;
create policy os_pcs_inquiries_all on public.os_personal_credit_inquiries
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_public_records_all on public.os_personal_credit_public_records;
create policy os_pcs_public_records_all on public.os_personal_credit_public_records
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_alerts_all on public.os_personal_credit_alerts;
create policy os_pcs_alerts_all on public.os_personal_credit_alerts
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_connections_all on public.os_personal_credit_connections;
create policy os_pcs_connections_all on public.os_personal_credit_connections
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

drop policy if exists os_pcs_grok_all on public.os_personal_credit_grok_messages;
create policy os_pcs_grok_all on public.os_personal_credit_grok_messages
  for all to authenticated
  using (public.is_visionary_role())
  with check (public.is_visionary_role());

revoke all on public.os_personal_credit_subjects from public, anon;
revoke all on public.os_personal_credit_snapshots from public, anon;
revoke all on public.os_personal_credit_tradelines from public, anon;
revoke all on public.os_personal_credit_inquiries from public, anon;
revoke all on public.os_personal_credit_public_records from public, anon;
revoke all on public.os_personal_credit_alerts from public, anon;
revoke all on public.os_personal_credit_connections from public, anon;
revoke all on public.os_personal_credit_grok_messages from public, anon;

grant select, insert, update, delete on public.os_personal_credit_subjects to authenticated;
grant select, insert, update, delete on public.os_personal_credit_snapshots to authenticated;
grant select, insert, update, delete on public.os_personal_credit_tradelines to authenticated;
grant select, insert, update, delete on public.os_personal_credit_inquiries to authenticated;
grant select, insert, update, delete on public.os_personal_credit_public_records to authenticated;
grant select, insert, update, delete on public.os_personal_credit_alerts to authenticated;
grant select, insert, update, delete on public.os_personal_credit_connections to authenticated;
grant select, insert, update, delete on public.os_personal_credit_grok_messages to authenticated;

-- Private bucket for raw reports
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'credit-private',
  'credit-private',
  false,
  52428800,
  array[
    'application/pdf',
    'text/plain',
    'text/csv',
    'image/jpeg',
    'image/png',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "credit_private_storage_select" on storage.objects;
create policy "credit_private_storage_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'credit-private' and public.is_visionary_role());

drop policy if exists "credit_private_storage_insert" on storage.objects;
create policy "credit_private_storage_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'credit-private' and public.is_visionary_role());

comment on table public.os_personal_credit_subjects is
  'Phase 74: Josh Monroe + Lauren Monroe only. Visionary-only.';
comment on table public.os_personal_credit_snapshots is
  'Phase 74: FICO 8/10-centric score snapshots from myFICO/Experian guided import.';
