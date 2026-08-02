-- C1 / 0001_tenancy — organizations, user_profiles, memberships
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_id uuid references public.organizations (id) on delete set null,
  kind text not null check (kind in ('parent', 'subsidiary')),
  branding jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{
    "enrichment_enabled": true,
    "waterfall_pdl": true,
    "waterfall_hunter": true,
    "zoominfo_enabled": false,
    "site_research_enabled": true,
    "hierarchy_enabled": true,
    "copilot_enabled": true,
    "signature_mining_enabled": false,
    "auto_expand_employees": true,
    "auto_expand_peers": false
  }'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  icp_title_patterns text[] not null default '{}',
  auto_expand_employees boolean not null default true,
  auto_expand_cap int not null default 75
    check (auto_expand_cap >= 0 and auto_expand_cap <= 500),
  auto_expand_peers boolean not null default false,
  monthly_enrichment_budget_usd numeric(12,2) not null default 500,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  entra_oid text not null unique,
  email text not null,
  display_name text,
  avatar_url text,
  is_tage_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role text not null check (role in ('member', 'org_admin', 'billing')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (org_id);
