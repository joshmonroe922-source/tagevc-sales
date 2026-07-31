-- Phase 89: Partner platform spine — registry, per-entity bindings, vendor
-- contracts/payments, marketing presence (GBP / GA4 / LinkedIn Company),
-- event bus, BI signals, Gusto commission stubs.
-- Safe to re-run. Does not invent credentials.

-- ---------------------------------------------------------------------------
-- Catalog (code is source of truth; table mirrors for admin/SQL joins)
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_catalog (
  partner_key text primary key,
  label text not null,
  owner_ss text not null,
  scope text not null,
  status text not null default 'scaffolded'
    check (status in ('live', 'scaffolded', 'planned')),
  summary text not null default '',
  docs_path text,
  bi_feed boolean not null default true,
  import_supported boolean not null default false,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.os_partner_catalog
  (partner_key, label, owner_ss, scope, status, summary, docs_path, bi_feed, import_supported)
values
  ('dialpad', 'Dialpad', 'IT', 'all_entities', 'scaffolded',
   'Phone + SMS + AI', 'docs/PARTNER_SPINE.md#dialpad', true, true),
  ('verified_first', 'Verified First', 'HR', 'all_entities', 'live',
   'Background + drug screens', 'docs/VERIFIED_FIRST_SCREENING_SPINE.md', true, false),
  ('mybasepay', 'MyBasePay', 'HR', 'contractor_placements', 'scaffolded',
   'Employer of Record', 'docs/PARTNER_SPINE.md#mybasepay', true, true),
  ('apollo', 'Apollo', 'Marketing', 'all_entities', 'scaffolded',
   'Contact/company database', 'docs/PARTNER_SPINE.md#apollo', true, true),
  ('gusto', 'Gusto', 'Finance', 'internal_employees', 'scaffolded',
   'Payroll + commissions', 'docs/PARTNER_SPINE.md#gusto', true, true),
  ('docusign', 'DocuSign', 'Legal', 'all_entities', 'live',
   'E-signature org accounts', 'docs/PARTNER_SPINE.md#docusign', true, true),
  ('linkedin_recruiter', 'LinkedIn Recruiter', 'Recruiting', 'recruit_primary', 'scaffolded',
   'Two-way recruiter sync', 'docs/PARTNER_SPINE.md#linkedin-recruiter', true, true),
  ('appcast', 'Appcast', 'Recruiting', 'all_entities', 'live',
   'Job publishing', 'docs/PARTNER_SPINE.md#appcast', true, true),
  ('google_business', 'Google Business Profile', 'Marketing', 'all_entities', 'scaffolded',
   'Local presence pages', 'docs/PARTNER_SPINE.md#google-business', true, true),
  ('google_analytics', 'Google Analytics (GA4)', 'Marketing', 'all_entities', 'scaffolded',
   'GA4 properties', 'docs/PARTNER_SPINE.md#google-analytics', true, true),
  ('linkedin_company', 'LinkedIn Company Pages', 'Marketing', 'all_entities', 'scaffolded',
   'Company page presence', 'docs/PARTNER_SPINE.md#linkedin-company', true, true)
on conflict (partner_key) do update set
  label = excluded.label,
  owner_ss = excluded.owner_ss,
  scope = excluded.scope,
  status = excluded.status,
  summary = excluded.summary,
  docs_path = excluded.docs_path,
  bi_feed = excluded.bi_feed,
  import_supported = excluded.import_supported,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Per-entity enablement (new entities inherit via ensureEntityPartnerBindings)
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_entity_bindings (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null
    references public.os_partner_catalog(partner_key) on delete cascade,
  entity_id text not null references public.entities(entity_id),
  enabled boolean not null default true,
  status text not null default 'scaffolded'
    check (status in ('not_configured', 'scaffolded', 'configured', 'live', 'error', 'disabled')),
  external_account_id text,
  config jsonb not null default '{}'::jsonb,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_key, entity_id)
);

create index if not exists os_partner_bindings_entity_idx
  on public.os_partner_entity_bindings (entity_id, partner_key);

-- Seed firm + known subsidiaries with scaffolded bindings
insert into public.os_partner_entity_bindings (partner_key, entity_id, enabled, status)
select c.partner_key, e.entity_id, true, 'scaffolded'
from public.os_partner_catalog c
cross join (
  select unnest(array['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA']) as entity_id
) e
where exists (select 1 from public.entities ent where ent.entity_id = e.entity_id)
on conflict (partner_key, entity_id) do nothing;

-- MyBasePay: implement at Recruit 619 first — keep others enabled=false scaffold
update public.os_partner_entity_bindings
set enabled = false, updated_at = now()
where partner_key = 'mybasepay'
  and entity_id <> 'ENT-R619';

-- ---------------------------------------------------------------------------
-- Technology: vendor contracts + payments
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_vendor_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null
    references public.os_partner_catalog(partner_key) on delete cascade,
  entity_id text references public.entities(entity_id),
  vendor_name text not null,
  contract_title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'expired', 'cancelled', 'renewal_due')),
  starts_on date,
  ends_on date,
  amount_cents bigint,
  currency text not null default 'USD',
  payment_cadence text,
  document_path text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_partner_contracts_expiry_idx
  on public.os_partner_vendor_contracts (ends_on)
  where ends_on is not null;

create table if not exists public.os_partner_vendor_payments (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null
    references public.os_partner_vendor_contracts(id) on delete cascade,
  paid_on date not null,
  amount_cents bigint not null,
  currency text not null default 'USD',
  reference text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists os_partner_payments_contract_idx
  on public.os_partner_vendor_payments (contract_id, paid_on desc);

-- ---------------------------------------------------------------------------
-- Marketing presence: GBP / GA4 / LinkedIn Company Pages (all entities)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_presence_properties (
  id uuid primary key default gen_random_uuid(),
  kind text not null
    check (kind in ('google_business', 'google_analytics', 'linkedin_company')),
  entity_id text not null references public.entities(entity_id),
  label text not null,
  external_id text,
  status text not null default 'scaffolded'
    check (status in ('not_configured', 'scaffolded', 'configured', 'live', 'error', 'disabled')),
  config jsonb not null default '{}'::jsonb,
  last_import_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, entity_id)
);

insert into public.os_marketing_presence_properties (kind, entity_id, label, status)
select k.kind, e.entity_id,
  e.entity_id || ' · ' || replace(k.kind, '_', ' '),
  'scaffolded'
from (
  select unnest(array['google_business', 'google_analytics', 'linkedin_company']) as kind
) k
cross join (
  select unnest(array['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA']) as entity_id
) e
where exists (select 1 from public.entities ent where ent.entity_id = e.entity_id)
on conflict (kind, entity_id) do nothing;

-- ---------------------------------------------------------------------------
-- Event bus + BI signals
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_events (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null
    references public.os_partner_catalog(partner_key) on delete cascade,
  entity_id text references public.entities(entity_id),
  kind text not null
    check (kind in ('webhook', 'import', 'provision', 'revoke', 'commission_push', 'sync', 'bi_signal')),
  status text not null default 'received'
    check (status in ('received', 'processed', 'failed', 'ignored')),
  external_id text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_partner_events_partner_idx
  on public.os_partner_events (partner_key, created_at desc);

create table if not exists public.os_partner_bi_signals (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null
    references public.os_partner_catalog(partner_key) on delete cascade,
  entity_id text references public.entities(entity_id),
  metric_key text not null,
  metric_label text not null,
  value_num numeric,
  value_text text,
  observed_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb
);

create index if not exists os_partner_bi_signals_obs_idx
  on public.os_partner_bi_signals (observed_at desc);

-- ---------------------------------------------------------------------------
-- Gusto commission stubs (invoice paid → payroll)
-- ---------------------------------------------------------------------------
create table if not exists public.os_gusto_commission_stubs (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  user_id uuid,
  invoice_id text,
  commission_cents bigint not null,
  currency text not null default 'USD',
  status text not null default 'calculated'
    check (status in ('calculated', 'pending_push', 'pushed', 'failed', 'waived')),
  gusto_ref text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_gusto_comm_entity_idx
  on public.os_gusto_commission_stubs (entity_id, status, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.os_partner_catalog enable row level security;
alter table public.os_partner_entity_bindings enable row level security;
alter table public.os_partner_vendor_contracts enable row level security;
alter table public.os_partner_vendor_payments enable row level security;
alter table public.os_marketing_presence_properties enable row level security;
alter table public.os_partner_events enable row level security;
alter table public.os_partner_bi_signals enable row level security;
alter table public.os_gusto_commission_stubs enable row level security;

drop policy if exists "os_partner_catalog_select" on public.os_partner_catalog;
create policy "os_partner_catalog_select"
  on public.os_partner_catalog for select to authenticated
  using (true);

drop policy if exists "os_partner_bindings_select" on public.os_partner_entity_bindings;
drop policy if exists "os_partner_bindings_write" on public.os_partner_entity_bindings;
create policy "os_partner_bindings_select"
  on public.os_partner_entity_bindings for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
create policy "os_partner_bindings_write"
  on public.os_partner_entity_bindings for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists "os_partner_contracts_select" on public.os_partner_vendor_contracts;
drop policy if exists "os_partner_contracts_write" on public.os_partner_vendor_contracts;
create policy "os_partner_contracts_select"
  on public.os_partner_vendor_contracts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_partner_contracts_write"
  on public.os_partner_vendor_contracts for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists "os_partner_payments_select" on public.os_partner_vendor_payments;
drop policy if exists "os_partner_payments_write" on public.os_partner_vendor_payments;
create policy "os_partner_payments_select"
  on public.os_partner_vendor_payments for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_partner_vendor_contracts c
      where c.id = contract_id
        and (c.entity_id is null or public.can_access_entity(c.entity_id))
    )
  );
create policy "os_partner_payments_write"
  on public.os_partner_vendor_payments for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists "os_mkt_presence_select" on public.os_marketing_presence_properties;
drop policy if exists "os_mkt_presence_write" on public.os_marketing_presence_properties;
create policy "os_mkt_presence_select"
  on public.os_marketing_presence_properties for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_presence_write"
  on public.os_marketing_presence_properties for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

drop policy if exists "os_partner_events_select" on public.os_partner_events;
create policy "os_partner_events_select"
  on public.os_partner_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists "os_partner_bi_select" on public.os_partner_bi_signals;
create policy "os_partner_bi_select"
  on public.os_partner_bi_signals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists "os_gusto_comm_select" on public.os_gusto_commission_stubs;
drop policy if exists "os_gusto_comm_write" on public.os_gusto_commission_stubs;
create policy "os_gusto_comm_select"
  on public.os_gusto_commission_stubs for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
create policy "os_gusto_comm_write"
  on public.os_gusto_commission_stubs for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

grant select on public.os_partner_catalog to authenticated;
grant select, insert, update on public.os_partner_entity_bindings to authenticated;
grant select, insert, update on public.os_partner_vendor_contracts to authenticated;
grant select, insert on public.os_partner_vendor_payments to authenticated;
grant select, insert, update on public.os_marketing_presence_properties to authenticated;
grant select on public.os_partner_events to authenticated;
grant select on public.os_partner_bi_signals to authenticated;
grant select, insert, update on public.os_gusto_commission_stubs to authenticated;

comment on table public.os_partner_catalog is
  'Phase 89 partner spine catalog — code catalog.ts is canonical; SQL mirror for joins.';
comment on table public.os_marketing_presence_properties is
  'Marketing Shared Services: Google Business, GA4, LinkedIn Company Pages per entity.';
