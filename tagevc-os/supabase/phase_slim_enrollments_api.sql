-- Slim EnrollmentService API support tables (idempotent).
-- Safe to re-run; matches ECC platform DDL subset. Does not enable sends/LIVE.
-- Apply manually before setting TAGE_ECC_LIVE=1 on Recruit 619.

create table if not exists public.ecc_entity_settings (
  entity_id text primary key,
  campaign_enabled boolean not null default true,
  kill_switch boolean not null default false,
  physical_address text,
  mutex_policy_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.ecc_journeys (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  name text not null,
  journey_type text not null default 'sequence',
  status text not null default 'draft',
  graph_json jsonb not null default '{"nodes":[],"edges":[]}'::jsonb,
  mutex_group text,
  default_delivery_plane text not null default 'auto',
  created_by uuid,
  owner_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ecc_journey_enrollments (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.ecc_journeys(id) on delete cascade,
  entity_id text not null,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  owner_id uuid,
  state text not null default 'active',
  entered_at timestamptz not null default now(),
  exited_at timestamptz,
  exit_reason text,
  source text not null default 'campaign_ui',
  current_node text,
  metadata_json jsonb not null default '{}'::jsonb
);

alter table public.ecc_journey_enrollments
  add column if not exists current_node text;
alter table public.ecc_journey_enrollments
  add column if not exists metadata_json jsonb not null default '{}'::jsonb;
