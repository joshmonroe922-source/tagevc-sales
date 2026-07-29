-- Phase 87: Tage VC A&F core persistence
-- Workspace state, bank feed connections, attachment uploads, event bus,
-- audit trail, SOC2 controls catalog, loans.
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- A&F workspace state (survives redeploys; not the retired generic snapshots)
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_workspace (
  workspace_key text primary key default 'default'
    check (workspace_key ~ '^[a-z0-9][a-z0-9_-]{0,63}$'),
  payload jsonb not null default '{}'::jsonb,
  version int not null default 1 check (version >= 1),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  constraint os_af_workspace_payload_object
    check (jsonb_typeof(payload) = 'object')
);

alter table public.os_af_workspace enable row level security;

drop policy if exists os_af_workspace_select on public.os_af_workspace;
create policy os_af_workspace_select on public.os_af_workspace
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_workspace_write on public.os_af_workspace;
create policy os_af_workspace_write on public.os_af_workspace
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_workspace from public, anon;
grant select, insert, update on public.os_af_workspace to authenticated;
grant all on public.os_af_workspace to service_role;

-- ---------------------------------------------------------------------------
-- Bank / card feed OAuth connections (ENT-03 / ENT-04)
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_bank_connections (
  id uuid primary key default gen_random_uuid(),
  bank_account_id text not null
    check (bank_account_id ~ '^BA-[A-Z0-9-]{2,32}$'),
  entity_code text not null
    check (entity_code in ('TVC', 'R619', 'SHR', 'INDA', 'PERS')),
  provider text not null default 'stub'
    check (provider in ('plaid', 'mx', 'unit', 'teller', 'stub')),
  status text not null default 'not_connected'
    check (status in (
      'not_connected', 'pending', 'connected', 'error', 'revoked', 'stubbed'
    )),
  institution_name text,
  account_mask text,
  access_token_enc text,
  item_id text,
  last_sync_at timestamptz,
  last_error text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_account_id)
);

create index if not exists os_af_bank_conn_entity_idx
  on public.os_af_bank_connections (entity_code, status);

alter table public.os_af_bank_connections enable row level security;

drop policy if exists os_af_bank_conn_select on public.os_af_bank_connections;
create policy os_af_bank_conn_select on public.os_af_bank_connections
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_bank_conn_write on public.os_af_bank_connections;
create policy os_af_bank_conn_write on public.os_af_bank_connections
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_bank_connections from public, anon;
grant select, insert, update, delete on public.os_af_bank_connections
  to authenticated;
grant all on public.os_af_bank_connections to service_role;

-- ---------------------------------------------------------------------------
-- Invoice / go-live attachment file uploads (PDF store)
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_attachment_files (
  id uuid primary key default gen_random_uuid(),
  attachment_default_id text,
  entity_code text not null
    check (entity_code in ('TVC', 'R619', 'SHR', 'INDA', 'PERS', 'ORG')),
  document_type text not null,
  display_name text not null,
  file_name text not null,
  mime_type text not null default 'application/pdf',
  storage_path text not null,
  byte_size integer not null default 0 check (byte_size >= 0),
  sha256 text,
  uploaded_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  constraint os_af_attach_mime_check
    check (mime_type in (
      'application/pdf',
      'image/png',
      'image/jpeg',
      'application/octet-stream'
    ))
);

create index if not exists os_af_attach_entity_idx
  on public.os_af_attachment_files (entity_code, document_type);

alter table public.os_af_attachment_files enable row level security;

drop policy if exists os_af_attach_select on public.os_af_attachment_files;
create policy os_af_attach_select on public.os_af_attachment_files
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_attach_write on public.os_af_attachment_files;
create policy os_af_attach_write on public.os_af_attachment_files
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_attachment_files from public, anon;
grant select, insert, update, delete on public.os_af_attachment_files
  to authenticated;
grant all on public.os_af_attachment_files to service_role;

-- Storage bucket for A&F PDFs (idempotent)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'af-attachments',
  'af-attachments',
  false,
  15728640,
  array['application/pdf', 'image/png', 'image/jpeg']
)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Event bus (OS ↔ A&F) — idempotent by event_id
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_events (
  event_id uuid primary key,
  event_type text not null,
  occurred_at timestamptz not null default now(),
  entity_code text
    check (entity_code is null or entity_code in (
      'TVC', 'R619', 'SHR', 'INDA', 'PERS', 'ORG', 'CONSOL'
    )),
  source_system text not null default 'af',
  direction text not null default 'internal'
    check (direction in ('inbound', 'outbound', 'internal')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'processed'
    check (status in ('queued', 'processed', 'failed', 'dead_letter')),
  error_message text,
  created_at timestamptz not null default now(),
  constraint os_af_events_payload_object
    check (jsonb_typeof(payload) = 'object')
);

create index if not exists os_af_events_type_idx
  on public.os_af_events (event_type, occurred_at desc);
create index if not exists os_af_events_entity_idx
  on public.os_af_events (entity_code, occurred_at desc);

alter table public.os_af_events enable row level security;

drop policy if exists os_af_events_select on public.os_af_events;
create policy os_af_events_select on public.os_af_events
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_events_insert on public.os_af_events;
create policy os_af_events_insert on public.os_af_events
  for insert to authenticated
  with check (public.is_firm_wide_access());

revoke all on public.os_af_events from public, anon;
grant select, insert on public.os_af_events to authenticated;
grant all on public.os_af_events to service_role;

-- ---------------------------------------------------------------------------
-- Immutable audit trail
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_audit_log (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  actor_id uuid,
  actor_label text,
  entity_code text,
  action text not null,
  ref_type text,
  ref_id text,
  detail jsonb not null default '{}'::jsonb,
  constraint os_af_audit_detail_object
    check (jsonb_typeof(detail) = 'object')
);

create index if not exists os_af_audit_occurred_idx
  on public.os_af_audit_log (occurred_at desc);
create index if not exists os_af_audit_entity_idx
  on public.os_af_audit_log (entity_code, occurred_at desc);

alter table public.os_af_audit_log enable row level security;

drop policy if exists os_af_audit_select on public.os_af_audit_log;
create policy os_af_audit_select on public.os_af_audit_log
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_audit_insert on public.os_af_audit_log;
create policy os_af_audit_insert on public.os_af_audit_log
  for insert to authenticated
  with check (public.is_firm_wide_access());

-- Append-only
create or replace function public.reject_af_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'os_af_audit_log is append-only';
end;
$$;

drop trigger if exists os_af_audit_immutable on public.os_af_audit_log;
create trigger os_af_audit_immutable
  before update or delete on public.os_af_audit_log
  for each row execute function public.reject_af_audit_mutation();

revoke all on public.os_af_audit_log from public, anon;
grant select, insert on public.os_af_audit_log to authenticated;
grant all on public.os_af_audit_log to service_role;

-- ---------------------------------------------------------------------------
-- SOC2-oriented control catalog
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_controls (
  control_id text primary key
    check (control_id ~ '^CTL-[A-Z0-9-]{2,32}$'),
  domain text not null,
  title text not null,
  description text not null default '',
  sod_relevant boolean not null default false,
  status text not null default 'Implemented'
    check (status in (
      'Not started', 'In progress', 'Implemented', 'Monitor', 'Gap'
    )),
  evidence_href text,
  updated_at timestamptz not null default now()
);

alter table public.os_af_controls enable row level security;

drop policy if exists os_af_controls_select on public.os_af_controls;
create policy os_af_controls_select on public.os_af_controls
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_controls_write on public.os_af_controls;
create policy os_af_controls_write on public.os_af_controls
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_controls from public, anon;
grant select, insert, update on public.os_af_controls to authenticated;
grant all on public.os_af_controls to service_role;

insert into public.os_af_controls (control_id, domain, title, description, sod_relevant, status)
values
  ('CTL-AF-01', 'Access', 'RBAC matrix enforced', 'Roles × capabilities from Spec - RBAC Matrix', true, 'Implemented'),
  ('CTL-AF-02', 'SoD', 'Prepare ≠ Approve+Pay', 'Same user cannot prepare and approve+pay a payment batch', true, 'Implemented'),
  ('CTL-AF-03', 'Change', 'Immutable audit log', 'os_af_audit_log append-only with triggers', false, 'Implemented'),
  ('CTL-AF-04', 'Availability', 'Go-live gates production', 'Send/pay blocked until ORG+ENT required steps Done', false, 'Implemented'),
  ('CTL-AF-05', 'Confidentiality', 'Attachment bucket private', 'af-attachments storage not public', false, 'Implemented'),
  ('CTL-AF-06', 'Processing', 'Idempotent webhooks', 'event_id primary key on os_af_events', false, 'Implemented'),
  ('CTL-AF-07', 'IC', 'IC eliminations on consol', 'Due From 141x ↔ Due To 2450 eliminated in NW', false, 'Implemented'),
  ('CTL-AF-08', 'Banking', 'Feed connect evidence', 'ENT-03 bank feed OAuth + test import recorded', false, 'In progress')
on conflict (control_id) do update set
  domain = excluded.domain,
  title = excluded.title,
  description = excluded.description,
  sod_relevant = excluded.sod_relevant,
  status = excluded.status,
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Loans (amortization engine persistence)
-- ---------------------------------------------------------------------------
create table if not exists public.os_af_loans (
  id text primary key,
  entity_code text not null
    check (entity_code in ('TVC', 'R619', 'SHR', 'INDA', 'PERS')),
  name text not null,
  loan_type text not null default 'Term',
  principal numeric(18,2) not null check (principal > 0),
  annual_rate numeric(9,6) not null check (annual_rate >= 0),
  term_months integer not null check (term_months > 0),
  start_date date not null,
  payment_frequency text not null default 'monthly'
    check (payment_frequency in ('monthly', 'quarterly')),
  extra_payment numeric(18,2) not null default 0 check (extra_payment >= 0),
  gl_liability text not null default '2500',
  status text not null default 'Active'
    check (status in ('Active', 'Paid Off', 'Refinanced', 'Default')),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_af_loans enable row level security;

drop policy if exists os_af_loans_select on public.os_af_loans;
create policy os_af_loans_select on public.os_af_loans
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_af_loans_write on public.os_af_loans;
create policy os_af_loans_write on public.os_af_loans
  for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_af_loans from public, anon;
grant select, insert, update, delete on public.os_af_loans to authenticated;
grant all on public.os_af_loans to service_role;

insert into public.os_af_loans (
  id, entity_code, name, loan_type, principal, annual_rate, term_months, start_date, extra_payment, gl_liability
) values
  ('LOAN-TVC-01', 'TVC', 'Acquisition facility', 'Term', 500000, 0.0725, 60, '2025-01-01', 0, '2500'),
  ('LOAN-R619-01', 'R619', 'Working capital LOC', 'Line of Credit', 75000, 0.095, 36, '2025-06-01', 500, '2500'),
  ('LOAN-INDA-01', 'INDA', 'Software capitalization note', 'Related-Party', 14000, 0.05, 24, '2026-01-01', 0, '2300')
on conflict (id) do nothing;
