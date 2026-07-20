-- Phase 20: Hardware, software & licensing tracking (scaffolding)
-- Apply optionally; UI is stubbed until Phase 21+.
-- Entity-scoped for subsidiary usage; firm-wide roles see all.

create table if not exists public.os_it_hardware_assets (
  id uuid primary key default gen_random_uuid(),
  asset_id text not null unique,
  kind text not null,
  status text not null default 'in_stock',
  entity_id text references public.entities(entity_id),
  assigned_user_id uuid,
  serial_number text,
  model text,
  notes text,
  purchased_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_it_software_licenses (
  id uuid primary key default gen_random_uuid(),
  license_id text not null unique,
  product_name text not null,
  vendor text,
  status text not null default 'active',
  seat_count int,
  seats_used int,
  entity_id text references public.entities(entity_id),
  renewal_date date,
  cost_k numeric,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_it_assignment_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  kind text not null,
  asset_id text,
  license_id text,
  user_id uuid,
  entity_id text references public.entities(entity_id),
  actor_id uuid,
  note text,
  created_at timestamptz not null default now()
);

create index if not exists os_it_hardware_entity_idx
  on public.os_it_hardware_assets (entity_id);
create index if not exists os_it_licenses_entity_idx
  on public.os_it_software_licenses (entity_id);

alter table public.os_it_hardware_assets enable row level security;
alter table public.os_it_software_licenses enable row level security;
alter table public.os_it_assignment_events enable row level security;

drop policy if exists "os_it_hardware_scoped_select" on public.os_it_hardware_assets;
drop policy if exists "os_it_hardware_scoped_write" on public.os_it_hardware_assets;
create policy "os_it_hardware_scoped_select"
  on public.os_it_hardware_assets for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_it_hardware_scoped_write"
  on public.os_it_hardware_assets for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_it_licenses_scoped_select" on public.os_it_software_licenses;
drop policy if exists "os_it_licenses_scoped_write" on public.os_it_software_licenses;
create policy "os_it_licenses_scoped_select"
  on public.os_it_software_licenses for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_it_licenses_scoped_write"
  on public.os_it_software_licenses for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_it_events_scoped_select" on public.os_it_assignment_events;
create policy "os_it_events_scoped_select"
  on public.os_it_assignment_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

grant select, insert, update on public.os_it_hardware_assets to authenticated;
grant select, insert, update on public.os_it_software_licenses to authenticated;
grant select, insert on public.os_it_assignment_events to authenticated;
