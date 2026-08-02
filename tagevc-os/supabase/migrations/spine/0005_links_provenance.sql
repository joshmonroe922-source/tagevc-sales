-- C1 / 0005_links_provenance — tenancy links + user-beats-agent provenance
create table if not exists public.account_org_links (
  account_id uuid not null references public.accounts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  visibility text not null default 'org'
    check (visibility in ('org', 'shared', 'network')),
  owner_user_id uuid references public.user_profiles (id) on delete set null,
  is_primary boolean not null default true,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (account_id, org_id)
);

create index if not exists account_org_links_org_idx
  on public.account_org_links (org_id);

create table if not exists public.contact_org_links (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  visibility text not null default 'org'
    check (visibility in ('org', 'shared', 'network')),
  owner_user_id uuid references public.user_profiles (id) on delete set null,
  is_primary boolean not null default true,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (contact_id, org_id)
);

create index if not exists contact_org_links_org_idx
  on public.contact_org_links (org_id);

create table if not exists public.field_provenance (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('account', 'contact')),
  entity_id uuid not null,
  field_name text not null,
  value text,
  source text not null,
  confidence numeric(4, 3),
  locked boolean not null default false,
  locked_by uuid references public.user_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_name)
);

create table if not exists public.contact_field_history (
  id bigserial primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  source text,
  at timestamptz not null default now()
);

create index if not exists contact_field_history_contact_idx
  on public.contact_field_history (contact_id, at desc);

create table if not exists public.suggested_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('account', 'contact')),
  entity_id uuid not null,
  field_name text not null,
  suggested_value text,
  confidence numeric(4, 3),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  rationale text,
  job_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles (id) on delete set null
);

create index if not exists suggested_updates_org_pending_idx
  on public.suggested_updates (org_id, status)
  where status = 'pending';
