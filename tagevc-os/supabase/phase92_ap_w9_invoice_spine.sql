-- Phase 92: AP vendor bridge + W-9 campaign + invoice inbox seams (D05)
-- Additive. No mailbox credentials. Empty until Josh wires inbound email.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- VM → AP durable link (auto-create on Active)
create table if not exists public.os_af_ap_vendors (
  id uuid primary key default gen_random_uuid(),
  af_vendor_key text not null unique,
  vm_vendor_id uuid,
  entity_code text not null
    check (entity_code in ('TVC', 'R619', 'SHR', 'INDA', 'MULTI')),
  name text not null,
  email text not null default '',
  status text not null default 'Active'
    check (status in ('Invited', 'Active', 'Blocked')),
  tax_status text not null default 'w9_missing'
    check (tax_status in ('w9_on_file', 'w9_missing', 'exempt', 'foreign')),
  eligible_1099 boolean not null default true,
  invoice_inbox_alias text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_af_ap_vendors_vm_idx
  on public.os_af_ap_vendors (vm_vendor_id)
  where vm_vendor_id is not null;
create index if not exists os_af_ap_vendors_entity_idx
  on public.os_af_ap_vendors (entity_code, status);

alter table public.os_af_ap_vendors enable row level security;

drop policy if exists os_af_ap_vendors_all on public.os_af_ap_vendors;
create policy os_af_ap_vendors_all on public.os_af_ap_vendors
  for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(
    case entity_code
      when 'TVC' then 'ENT-FIRM'
      when 'R619' then 'ENT-R619'
      when 'SHR' then 'ENT-SIGNENT'
      when 'INDA' then 'ENT-INDA'
      else 'ENT-FIRM'
    end
  ))
  with check (public.is_firm_wide_access() or public.can_access_entity(
    case entity_code
      when 'TVC' then 'ENT-FIRM'
      when 'R619' then 'ENT-R619'
      when 'SHR' then 'ENT-SIGNENT'
      when 'INDA' then 'ENT-INDA'
      else 'ENT-FIRM'
    end
  ));

revoke all on public.os_af_ap_vendors from public, anon;
grant select, insert, update, delete on public.os_af_ap_vendors to authenticated;

-- W-9 per vendor × tax year
create table if not exists public.os_af_vendor_w9 (
  id uuid primary key default gen_random_uuid(),
  ap_vendor_id uuid not null
    references public.os_af_ap_vendors (id) on delete cascade,
  tax_year int not null
    check (tax_year >= 2020 and tax_year <= 2100),
  status text not null default 'outstanding'
    check (status in (
      'outstanding', 'requested', 'received', 'ai_exception', 'complete', 'waived'
    )),
  document_id uuid,
  document_path text,
  requested_at timestamptz,
  received_at timestamptz,
  completed_at timestamptz,
  last_reminder_at timestamptz,
  reminder_count int not null default 0,
  ai_review jsonb not null default '{}'::jsonb,
  exception_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (ap_vendor_id, tax_year)
);

create index if not exists os_af_vendor_w9_status_idx
  on public.os_af_vendor_w9 (tax_year, status);

alter table public.os_af_vendor_w9 enable row level security;

drop policy if exists os_af_vendor_w9_all on public.os_af_vendor_w9;
create policy os_af_vendor_w9_all on public.os_af_vendor_w9
  for all to authenticated
  using (
    exists (
      select 1 from public.os_af_ap_vendors v
      where v.id = ap_vendor_id
    )
  )
  with check (
    exists (
      select 1 from public.os_af_ap_vendors v
      where v.id = ap_vendor_id
    )
  );

revoke all on public.os_af_vendor_w9 from public, anon;
grant select, insert, update, delete on public.os_af_vendor_w9 to authenticated;

-- Inbound invoice drafts from entity mailboxes
create table if not exists public.os_af_inbound_invoices (
  id uuid primary key default gen_random_uuid(),
  entity_code text not null
    check (entity_code in ('TVC', 'R619', 'SHR', 'INDA')),
  ap_vendor_id uuid references public.os_af_ap_vendors (id) on delete set null,
  cadence text not null default 'one_time'
    check (cadence in ('one_time', 'recurring')),
  status text not null default 'draft'
    check (status in (
      'draft', 'pending_approval', 'approved', 'paid', 'rejected', 'parse_error'
    )),
  amount_cents bigint,
  currency text not null default 'USD',
  invoice_date date,
  due_date date,
  external_message_id text,
  from_email text,
  subject text,
  attachment_path text,
  raw_meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_af_inbound_invoices_entity_idx
  on public.os_af_inbound_invoices (entity_code, status);

alter table public.os_af_inbound_invoices enable row level security;

drop policy if exists os_af_inbound_invoices_all on public.os_af_inbound_invoices;
create policy os_af_inbound_invoices_all on public.os_af_inbound_invoices
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_inbound_invoices from public, anon;
grant select, insert, update, delete on public.os_af_inbound_invoices to authenticated;
