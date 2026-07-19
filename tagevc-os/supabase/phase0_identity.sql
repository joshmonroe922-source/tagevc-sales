-- Phase 0: Identity & Admin (M0)
-- Apply in Supabase SQL editor (or as a future migration in this app).

create extension if not exists "pgcrypto";

do $$ begin
  create type public.app_role as enum (
    'visionary',
    'partner',
    'associate',
    're_sourcer',
    'ma_associate',
    'coo',
    'sub_lead',
    'service_lead',
    'counsel_ops',
    'admin'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role public.app_role not null default 'associate',
  entity_id text,
  avatar_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.entities (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null unique,
  canonical_name text not null unique,
  legal_name text,
  type text not null,
  module text,
  parent_id text,
  status text not null default 'Active',
  industry text,
  qbe_key text,
  portfolio_id text,
  ops_lead text,
  board_lead text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.entities enable row level security;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    'associate'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create policy "profiles_select_own_or_admin"
  on public.profiles for select
  using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'visionary')
    )
  );

create policy "profiles_update_own_or_admin"
  on public.profiles for update
  using (
    auth.uid() = id
    or exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'visionary')
    )
  );

create policy "entities_authenticated_read"
  on public.entities for select
  to authenticated
  using (true);

create policy "entities_admin_write"
  on public.entities for all
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid() and p.role in ('admin', 'visionary', 'partner')
    )
  );
