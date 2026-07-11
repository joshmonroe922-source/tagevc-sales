-- Tage VC Entity Ops v1
-- Portfolio entity checklists, folders, documents, compliance renewals.
-- Run in Supabase SQL Editor after 0001–0003.
--
-- STORAGE (manual — Dashboard → Storage → New bucket):
--   Bucket name: entity-docs
--   Public: false (private)
--   Allowed MIME: application/pdf, images, office docs as needed
--   Then add policies so active sales_users can upload/read/delete under their paths.
--   Example policies (run after creating the bucket):
--
--   create policy "Sales users read entity-docs"
--     on storage.objects for select
--     using (bucket_id = 'entity-docs' and public.is_active_sales_user());
--   create policy "Sales users upload entity-docs"
--     on storage.objects for insert
--     with check (bucket_id = 'entity-docs' and public.is_active_sales_user());
--   create policy "Sales users update entity-docs"
--     on storage.objects for update
--     using (bucket_id = 'entity-docs' and public.is_active_sales_user())
--     with check (bucket_id = 'entity-docs' and public.is_active_sales_user());
--   create policy "Sales users delete entity-docs"
--     on storage.objects for delete
--     using (bucket_id = 'entity-docs' and public.is_active_sales_user());

-- ---------------------------------------------------------------------------
-- ops_entities
-- ---------------------------------------------------------------------------
create table if not exists public.ops_entities (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  entity_type   text not null default 'other'
                  check (entity_type in ('launch', 'acquire', 'operate', 'other')),
  status        text not null default 'active'
                  check (status in ('active', 'forming', 'acquired', 'dormant', 'closed')),
  lead_id       uuid references public.sales_leads (id) on delete set null,
  jurisdiction  text not null default '',
  formed_at     date,
  notes         text not null default '',
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists ops_entities_status_idx on public.ops_entities (status);
create index if not exists ops_entities_type_idx on public.ops_entities (entity_type);
create index if not exists ops_entities_lead_idx on public.ops_entities (lead_id);
create index if not exists ops_entities_created_at_idx on public.ops_entities (created_at desc);

alter table public.ops_entities enable row level security;

create or replace function public.set_ops_entities_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ops_entities_updated_at on public.ops_entities;
create trigger ops_entities_updated_at
  before update on public.ops_entities
  for each row execute function public.set_ops_entities_updated_at();

-- ---------------------------------------------------------------------------
-- Checklist templates (start-business / acquire-business)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  entity_type text not null default 'other'
                check (entity_type in ('launch', 'acquire', 'operate', 'other')),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.ops_checklist_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references public.ops_checklist_templates (id) on delete cascade,
  title        text not null,
  phase        text not null default 'general',
  sort_order   int not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists ops_checklist_template_items_tpl_idx
  on public.ops_checklist_template_items (template_id, sort_order);

alter table public.ops_checklist_templates enable row level security;
alter table public.ops_checklist_template_items enable row level security;

-- ---------------------------------------------------------------------------
-- Per-entity checklist instances
-- ---------------------------------------------------------------------------
create table if not exists public.ops_checklist_items (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  title         text not null,
  phase         text not null default 'general',
  status        text not null default 'todo'
                  check (status in ('todo', 'doing', 'done', 'na')),
  due_at        timestamptz,
  completed_at  timestamptz,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ops_checklist_items_entity_idx
  on public.ops_checklist_items (entity_id, sort_order);
create index if not exists ops_checklist_items_status_idx
  on public.ops_checklist_items (entity_id, status);

alter table public.ops_checklist_items enable row level security;

-- ---------------------------------------------------------------------------
-- Folders + documents (Supabase Storage path in storage_path)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_folders (
  id          uuid primary key default gen_random_uuid(),
  entity_id   uuid not null references public.ops_entities (id) on delete cascade,
  name        text not null,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  unique (entity_id, name)
);

create index if not exists ops_folders_entity_idx
  on public.ops_folders (entity_id, sort_order);

alter table public.ops_folders enable row level security;

create table if not exists public.ops_documents (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  folder_id     uuid references public.ops_folders (id) on delete set null,
  title         text not null,
  file_name     text not null default '',
  mime_type     text not null default '',
  storage_path  text not null default '',
  external_url  text not null default '',
  notes         text not null default '',
  uploaded_by   uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists ops_documents_entity_idx
  on public.ops_documents (entity_id, created_at desc);
create index if not exists ops_documents_folder_idx
  on public.ops_documents (folder_id);

alter table public.ops_documents enable row level security;

-- ---------------------------------------------------------------------------
-- Compliance / renewals
-- ---------------------------------------------------------------------------
create table if not exists public.ops_compliance_items (
  id                 uuid primary key default gen_random_uuid(),
  entity_id          uuid not null references public.ops_entities (id) on delete cascade,
  title              text not null,
  cadence            text not null default 'annual'
                       check (cadence in ('annual', 'monthly', 'one_time', 'custom')),
  next_due_at        date,
  last_completed_at  date,
  notes              text not null default '',
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists ops_compliance_items_due_idx
  on public.ops_compliance_items (active, next_due_at);
create index if not exists ops_compliance_items_entity_idx
  on public.ops_compliance_items (entity_id);

alter table public.ops_compliance_items enable row level security;

create or replace function public.set_ops_compliance_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ops_compliance_updated_at on public.ops_compliance_items;
create trigger ops_compliance_updated_at
  before update on public.ops_compliance_items
  for each row execute function public.set_ops_compliance_updated_at();

-- ---------------------------------------------------------------------------
-- Default folder names seed table (cloned onto each new entity)
-- ---------------------------------------------------------------------------
create table if not exists public.ops_default_folders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  sort_order  int not null default 0
);

alter table public.ops_default_folders enable row level security;

-- ---------------------------------------------------------------------------
-- RLS — active sales users CRUD all ops tables
-- ---------------------------------------------------------------------------
create policy "Sales users manage ops entities"
  on public.ops_entities for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users view checklist templates"
  on public.ops_checklist_templates for select
  using (public.is_active_sales_user());

create policy "Admins manage checklist templates"
  on public.ops_checklist_templates for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view checklist template items"
  on public.ops_checklist_template_items for select
  using (public.is_active_sales_user());

create policy "Admins manage checklist template items"
  on public.ops_checklist_template_items for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users manage checklist items"
  on public.ops_checklist_items for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users manage ops folders"
  on public.ops_folders for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users manage ops documents"
  on public.ops_documents for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users manage compliance items"
  on public.ops_compliance_items for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users view default folders"
  on public.ops_default_folders for select
  using (public.is_active_sales_user());

create policy "Admins manage default folders"
  on public.ops_default_folders for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

-- ---------------------------------------------------------------------------
-- Seed: default folder names
-- ---------------------------------------------------------------------------
insert into public.ops_default_folders (name, sort_order) values
  ('Articles', 10),
  ('Licenses', 20),
  ('Tax', 30),
  ('Contracts', 40),
  ('Diligence', 50),
  ('Banking', 60),
  ('Insurance', 70),
  ('IP', 80),
  ('HR', 90),
  ('Other', 100)
on conflict (name) do update set sort_order = excluded.sort_order;

-- ---------------------------------------------------------------------------
-- Seed: start-business + acquire-business checklist templates
-- ---------------------------------------------------------------------------
insert into public.ops_checklist_templates (slug, name, description, entity_type, active)
values
  (
    'start-business',
    'Start a business',
    'Formation checklist for launching a new entity (venture studio / Launch path).',
    'launch',
    true
  ),
  (
    'acquire-business',
    'Acquire a business',
    'Acquisition checklist from LOI through close and post-close integration.',
    'acquire',
    true
  )
on conflict (slug) do update
  set name = excluded.name,
      description = excluded.description,
      entity_type = excluded.entity_type,
      active = true;

do $$
declare
  v_start uuid;
  v_acq   uuid;
begin
  select id into v_start from public.ops_checklist_templates where slug = 'start-business';
  select id into v_acq from public.ops_checklist_templates where slug = 'acquire-business';

  delete from public.ops_checklist_template_items where template_id in (v_start, v_acq);

  insert into public.ops_checklist_template_items (template_id, title, phase, sort_order) values
    -- Start a business
    (v_start, 'Confirm business name availability', 'Formation', 10),
    (v_start, 'Choose entity type (LLC / Corp / other)', 'Formation', 20),
    (v_start, 'Select jurisdiction / state of formation', 'Formation', 30),
    (v_start, 'Draft / review operating agreement or bylaws', 'Formation', 40),
    (v_start, 'File formation documents with state', 'Formation', 50),
    (v_start, 'Obtain EIN from IRS', 'Formation', 60),
    (v_start, 'Open business bank account', 'Banking', 70),
    (v_start, 'Set up accounting / bookkeeping system', 'Banking', 80),
    (v_start, 'Register for state tax / sales tax if needed', 'Tax', 90),
    (v_start, 'Apply for required business licenses', 'Licenses', 100),
    (v_start, 'Obtain business insurance quotes', 'Insurance', 110),
    (v_start, 'Execute founder / equity agreements', 'Governance', 120),
    (v_start, 'Issue initial equity / membership interests', 'Governance', 130),
    (v_start, 'Adopt board / manager resolutions as needed', 'Governance', 140),
    (v_start, 'Set registered agent', 'Formation', 150),
    (v_start, 'Domain, email, and brand assets secured', 'Operations', 160),
    (v_start, 'Initial website / landing live if public-facing', 'Operations', 170),
    (v_start, 'Vendor / contractor agreements in place', 'Contracts', 180),
    (v_start, 'Calendar annual report / franchise tax due dates', 'Compliance', 190),
    (v_start, 'File formation docs in Entity Ops folders', 'Close-out', 200),

    -- Acquire a business
    (v_acq, 'Define acquisition thesis and target criteria', 'Sourcing', 10),
    (v_acq, 'Sign NDA with seller / broker', 'Sourcing', 20),
    (v_acq, 'Receive CIM / financial package', 'Diligence', 30),
    (v_acq, 'Build preliminary valuation model', 'Diligence', 40),
    (v_acq, 'Submit IOI / LOI', 'Deal', 50),
    (v_acq, 'Negotiate LOI terms (price, structure, exclusivity)', 'Deal', 60),
    (v_acq, 'Financial diligence (QoE / quality of earnings)', 'Diligence', 70),
    (v_acq, 'Legal diligence (contracts, litigation, IP)', 'Diligence', 80),
    (v_acq, 'Operational diligence (customers, vendors, key people)', 'Diligence', 90),
    (v_acq, 'Tax diligence and structure advice', 'Diligence', 100),
    (v_acq, 'Insurance / benefits review', 'Diligence', 110),
    (v_acq, 'Secure financing / capital commitment', 'Financing', 120),
    (v_acq, 'Draft / negotiate purchase agreement (APA / SPA)', 'Deal', 130),
    (v_acq, 'Negotiate employment / transition agreements', 'Deal', 140),
    (v_acq, 'Form or designate buying entity', 'Formation', 150),
    (v_acq, 'Obtain required third-party consents', 'Close', 160),
    (v_acq, 'Schedule and complete closing', 'Close', 170),
    (v_acq, 'Wire funds / equity consideration', 'Close', 180),
    (v_acq, 'Transfer licenses, permits, and contracts', 'Post-close', 190),
    (v_acq, 'Update banking, payroll, and accounting', 'Post-close', 200),
    (v_acq, 'Announce internally / externally as planned', 'Post-close', 210),
    (v_acq, 'File close binder docs in Entity Ops folders', 'Close-out', 220);
end $$;
