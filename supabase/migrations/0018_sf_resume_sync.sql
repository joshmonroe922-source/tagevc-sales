-- Salesforce resume sync cursor (Recruit 619 vault → SF).
-- Scaffold table; populated by salesforce-resume-sync edge function when run.

create table if not exists public.sf_resume_sync_items (
  id uuid primary key default gen_random_uuid(),
  drive_item_id text not null unique,
  drive_id text not null,
  file_name text,
  entity_id uuid references public.ops_entities (id) on delete set null,
  email_guess text,
  phone_guess text,
  name_guess text,
  parse_method text,
  needs_ocr boolean default false,
  sf_status text,
  sf_record_id text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sf_resume_sync_items_entity_idx
  on public.sf_resume_sync_items (entity_id);

alter table public.sf_resume_sync_items enable row level security;

-- Service role / edge only (no direct client policies).
drop policy if exists sf_resume_sync_items_admin_read on public.sf_resume_sync_items;
create policy sf_resume_sync_items_admin_read
  on public.sf_resume_sync_items
  for select
  to authenticated
  using (
    exists (
      select 1 from public.sales_users su
      where lower(su.email) = lower(auth.jwt() ->> 'email')
        and su.active = true
        and su.role = 'admin'
    )
  );

grant select on public.sf_resume_sync_items to authenticated;
grant all on public.sf_resume_sync_items to service_role;
