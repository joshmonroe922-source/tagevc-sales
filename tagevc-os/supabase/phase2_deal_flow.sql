-- Phase 2: VC Pipeline / Lead Tasks / Deal Active (future Supabase cutover)

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_id text not null unique,
  company_name text not null,
  website text,
  sector text,
  source text,
  source_detail text,
  stage text not null,
  priority text not null,
  owner text,
  next_action text,
  next_action_date date,
  thesis_fit text,
  score int,
  raise_stage text,
  check_size_k numeric,
  location text,
  path text,
  notes text,
  outcome text,
  deal_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.lead_tasks (
  id uuid primary key default gen_random_uuid(),
  task_id text not null unique,
  lead_id text not null references public.leads (lead_id),
  company_name text not null,
  process_stage text not null,
  title text not null,
  priority text not null,
  status text not null,
  owner text,
  due_date date,
  notes text,
  lib_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.deals (
  id uuid primary key default gen_random_uuid(),
  deal_id text not null unique,
  lead_id text references public.leads (lead_id),
  company_name text not null,
  entity_id text,
  exec_stage text not null,
  priority text not null,
  instrument text,
  premoney_m numeric,
  check_k numeric,
  ownership_pct numeric,
  counsel text,
  path text,
  outcome text,
  owner text,
  next_action text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists public.lead_process_library (
  lib_id text primary key,
  process_stage text not null,
  title text not null,
  default_priority text not null,
  owner_role text not null,
  what_good_looks_like text
);
