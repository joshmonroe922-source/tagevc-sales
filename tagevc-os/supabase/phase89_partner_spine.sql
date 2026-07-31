-- Phase 89: Partner platform spine (registry · per-entity enablement ·
-- Technology contracts · Marketing presence · event bus · commission stubs).
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots.
-- New entities inherit via provision_partner_spine_for_entity().

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Catalog (firm-wide definitions; UI also seeds from TypeScript catalog)
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_catalog (
  partner_key text primary key
    check (partner_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  name text not null,
  category text not null,
  owner_function text not null
    check (owner_function in (
      'IT', 'HR', 'Finance', 'Marketing', 'Legal', 'Recruiting', 'Shared'
    )),
  summary text not null default '',
  manage_href text not null default '/shared-services/it/technology',
  docs_path text not null default 'docs/PARTNER_SPINE.md',
  scope_mode text not null default 'all_entities',
  supports_import boolean not null default false,
  supports_webhook boolean not null default false,
  supports_auto_provision boolean not null default false,
  bi_signals jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.os_partner_catalog (
  partner_key, name, category, owner_function, summary, manage_href, docs_path,
  scope_mode, supports_import, supports_webhook, supports_auto_provision, bi_signals
) values
  ('dialpad', 'Dialpad', 'communications', 'IT',
   'Phone + SMS + AI', '/shared-services/it/technology#dialpad', 'docs/PARTNER_SPINE.md#dialpad',
   'all_entities', true, true, true, '["call_volume","sms_volume"]'::jsonb),
  ('verified_first', 'Verified First', 'screening', 'HR',
   'BG + drug screens', '/shared-services/hr/screening', 'docs/VERIFIED_FIRST_SCREENING_SPINE.md',
   'all_entities', false, true, false, '["orders_pending","orders_clear"]'::jsonb),
  ('mybasepay', 'MyBasePay', 'eor', 'HR',
   'Employer of Record — R619 first', '/shared-services/it/technology#mybasepay', 'docs/PARTNER_SPINE.md#mybasepay',
   'recruit_first', true, true, true, '["active_eor_workers"]'::jsonb),
  ('apollo', 'Apollo', 'data', 'Shared',
   'Contact/company DB', '/shared-services/it/technology#apollo', 'docs/PARTNER_SPINE.md#apollo',
   'all_entities', true, false, false, '["contacts_imported"]'::jsonb),
  ('gusto', 'Gusto', 'payroll', 'Finance',
   'Payroll + commissions', '/shared-services/af', 'docs/PARTNER_SPINE.md#gusto',
   'all_entities', true, true, true, '["payroll_runs","commission_queued"]'::jsonb),
  ('docusign', 'DocuSign', 'esignature', 'Legal',
   'Org e-sign', '/shared-services/legal/docusign', 'docs/PARTNER_SPINE.md#docusign',
   'all_entities', true, true, false, '["envelopes_completed"]'::jsonb),
  ('linkedin_recruiter', 'LinkedIn Recruiter', 'recruiting', 'Recruiting',
   'Two-way sync scaffold', '/shared-services/it/technology#linkedin_recruiter', 'docs/PARTNER_SPINE.md#linkedin-recruiter',
   'all_entities', true, false, false, '["candidates_synced"]'::jsonb),
  ('appcast', 'Appcast', 'job_publish', 'Recruiting',
   'Job publishing', '/shared-services/it/technology#appcast', 'docs/PARTNER_SPINE.md#appcast',
   'all_entities', true, true, false, '["jobs_published","applies_inbound"]'::jsonb),
  ('google_business', 'Google Business Profile', 'marketing_presence', 'Marketing',
   'Per-entity GBP', '/shared-services/marketing/presence#google_business', 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
   'marketing_all_entities', true, false, true, '["reviews","insights_views"]'::jsonb),
  ('google_analytics', 'Google Analytics (GA4)', 'analytics', 'Marketing',
   'Per-entity GA4', '/shared-services/marketing/presence#google_analytics', 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
   'marketing_all_entities', true, false, true, '["sessions","conversions"]'::jsonb),
  ('linkedin_company_pages', 'LinkedIn Company Pages', 'marketing_presence', 'Marketing',
   'Per-entity LinkedIn Business pages', '/shared-services/marketing/presence#linkedin_company_pages', 'docs/PARTNER_SPINE.md#google-business-analytics-linkedin',
   'marketing_all_entities', true, false, true, '["followers","engagement"]'::jsonb)
on conflict (partner_key) do update set
  name = excluded.name,
  category = excluded.category,
  owner_function = excluded.owner_function,
  summary = excluded.summary,
  manage_href = excluded.manage_href,
  docs_path = excluded.docs_path,
  scope_mode = excluded.scope_mode,
  supports_import = excluded.supports_import,
  supports_webhook = excluded.supports_webhook,
  supports_auto_provision = excluded.supports_auto_provision,
  bi_signals = excluded.bi_signals,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Per-entity enablement
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_entity_enablements (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null references public.os_partner_catalog(partner_key),
  entity_id text not null references public.entities(entity_id),
  enabled boolean not null default true,
  status text not null default 'scaffold'
    check (status in (
      'not_configured', 'scaffold', 'configured', 'live', 'degraded', 'disabled'
    )),
  external_account_ref text,
  config_meta jsonb not null default '{}'::jsonb,
  notes text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (partner_key, entity_id)
);

create index if not exists os_partner_enable_entity_idx
  on public.os_partner_entity_enablements (entity_id, partner_key);

-- ---------------------------------------------------------------------------
-- Technology contracts / payments / expirations
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null references public.os_partner_catalog(partner_key),
  entity_id text references public.entities(entity_id),
  vendor_name text not null,
  contract_title text not null,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'expiring', 'expired', 'cancelled')),
  starts_on date,
  ends_on date,
  renewal_on date,
  payment_cadence text,
  payment_amount numeric,
  payment_currency text not null default 'USD',
  storage_path text,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_partner_contracts_ends_idx
  on public.os_partner_contracts (ends_on)
  where status in ('active', 'expiring');

-- ---------------------------------------------------------------------------
-- Marketing presence (GBP · GA4 · LinkedIn Company) — Marketing-owned
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_presence_properties (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  kind text not null
    check (kind in (
      'google_business', 'google_analytics', 'linkedin_company_pages'
    )),
  display_name text not null,
  external_id text,
  property_url text,
  status text not null default 'scaffold'
    check (status in (
      'not_configured', 'scaffold', 'configured', 'live', 'degraded', 'disabled'
    )),
  config_meta jsonb not null default '{}'::jsonb,
  last_imported_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (entity_id, kind)
);

create index if not exists os_mkt_presence_entity_idx
  on public.os_marketing_presence_properties (entity_id, kind);

-- ---------------------------------------------------------------------------
-- Event bus for BI / webhooks / imports
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_events (
  id uuid primary key default gen_random_uuid(),
  partner_key text not null references public.os_partner_catalog(partner_key),
  entity_id text references public.entities(entity_id),
  event_type text not null,
  external_id text,
  direction text not null default 'inbound'
    check (direction in ('inbound', 'outbound', 'internal')),
  payload jsonb not null default '{}'::jsonb,
  bi_relevant boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists os_partner_events_partner_idx
  on public.os_partner_events (partner_key, created_at desc);
create index if not exists os_partner_events_bi_idx
  on public.os_partner_events (bi_relevant, created_at desc)
  where bi_relevant = true;

-- ---------------------------------------------------------------------------
-- Gusto commission queue stubs
-- ---------------------------------------------------------------------------
create table if not exists public.os_partner_commission_queue (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  invoice_id text not null,
  user_profile_id uuid,
  user_external_id text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'USD',
  status text not null default 'queued'
    check (status in ('queued', 'pushed_stub', 'failed', 'cancelled')),
  source text not null default 'invoice_paid',
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_partner_commission_status_idx
  on public.os_partner_commission_queue (status, created_at desc);

-- ---------------------------------------------------------------------------
-- Provision helper — call when creating a new OS entity
-- ---------------------------------------------------------------------------
create or replace function public.provision_partner_spine_for_entity(
  p_entity_id text,
  p_display_name text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
  v_label text := coalesce(nullif(trim(p_display_name), ''), p_entity_id);
  r record;
begin
  for r in select partner_key from public.os_partner_catalog where active loop
    insert into public.os_partner_entity_enablements (
      partner_key, entity_id, enabled, status, config_meta
    ) values (
      r.partner_key,
      p_entity_id,
      case
        when r.partner_key = 'mybasepay' then (p_entity_id = 'ENT-R619')
        else true
      end,
      'scaffold',
      jsonb_build_object('provisioned_by', 'partner-spine-v1')
    )
    on conflict (partner_key, entity_id) do nothing;
    v_count := v_count + 1;
  end loop;

  insert into public.os_marketing_presence_properties (
    entity_id, kind, display_name, status, config_meta
  ) values
    (p_entity_id, 'google_business', v_label || ' — Google Business Profile', 'scaffold',
      jsonb_build_object('provisioned_by', 'partner-spine-v1')),
    (p_entity_id, 'google_analytics', v_label || ' — GA4 property', 'scaffold',
      jsonb_build_object('provisioned_by', 'partner-spine-v1')),
    (p_entity_id, 'linkedin_company_pages', v_label || ' — LinkedIn Company Page', 'scaffold',
      jsonb_build_object('provisioned_by', 'partner-spine-v1'))
  on conflict (entity_id, kind) do nothing;

  return v_count;
end;
$$;

grant execute on function public.provision_partner_spine_for_entity(text, text)
  to authenticated, service_role;

-- Seed enablements + presence for known operating entities
do $$
declare
  e text;
  names text[] := array['ENT-FIRM', 'ENT-R619', 'ENT-SIGNENT', 'ENT-INDA'];
  labels text[] := array[
    'Tage Venture Capital', 'Recruit 619', 'Signent HR', 'Instant NDA'
  ];
  i int;
begin
  for i in 1 .. array_length(names, 1) loop
    begin
      perform public.provision_partner_spine_for_entity(names[i], labels[i]);
    exception when foreign_key_violation then
      -- entity row may not exist yet in some envs
      null;
    when others then
      null;
    end;
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.os_partner_catalog enable row level security;
alter table public.os_partner_entity_enablements enable row level security;
alter table public.os_partner_contracts enable row level security;
alter table public.os_marketing_presence_properties enable row level security;
alter table public.os_partner_events enable row level security;
alter table public.os_partner_commission_queue enable row level security;

drop policy if exists "os_partner_catalog_select" on public.os_partner_catalog;
create policy "os_partner_catalog_select"
  on public.os_partner_catalog for select to authenticated
  using (true);

drop policy if exists "os_partner_enable_select" on public.os_partner_entity_enablements;
drop policy if exists "os_partner_enable_write" on public.os_partner_entity_enablements;
create policy "os_partner_enable_select"
  on public.os_partner_entity_enablements for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
create policy "os_partner_enable_write"
  on public.os_partner_entity_enablements for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists "os_partner_contracts_select" on public.os_partner_contracts;
drop policy if exists "os_partner_contracts_write" on public.os_partner_contracts;
create policy "os_partner_contracts_select"
  on public.os_partner_contracts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_partner_contracts_write"
  on public.os_partner_contracts for all to authenticated
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
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

drop policy if exists "os_partner_events_select" on public.os_partner_events;
create policy "os_partner_events_select"
  on public.os_partner_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists "os_partner_commission_select" on public.os_partner_commission_queue;
create policy "os_partner_commission_select"
  on public.os_partner_commission_queue for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

grant select on public.os_partner_catalog to authenticated;
grant select, insert, update on public.os_partner_entity_enablements to authenticated;
grant select, insert, update on public.os_partner_contracts to authenticated;
grant select, insert, update on public.os_marketing_presence_properties to authenticated;
grant select, insert on public.os_partner_events to authenticated;
grant select, insert, update on public.os_partner_commission_queue to authenticated;

grant select, insert, update, delete on public.os_partner_catalog to service_role;
grant all on public.os_partner_entity_enablements to service_role;
grant all on public.os_partner_contracts to service_role;
grant all on public.os_marketing_presence_properties to service_role;
grant all on public.os_partner_events to service_role;
grant all on public.os_partner_commission_queue to service_role;

comment on table public.os_partner_catalog is
  'Phase 89 partner spine catalog — inherited by every OS entity.';
comment on function public.provision_partner_spine_for_entity(text, text) is
  'Seeds partner enablements + Marketing presence slots for a new entity.';
