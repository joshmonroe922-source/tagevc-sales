-- Phase 81: IES multi-entity visibility + controlled write proposals.
-- Additive and idempotent. IES remains the sole GL.
-- IMPORTANT: this migration never drops or alters os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- Extend the phase-70 entity map into the canonical multi-entity company map.
alter table public.os_ies_entity_map
  add column if not exists display_name text,
  add column if not exists is_parent boolean not null default false,
  add column if not exists sort_order integer not null default 100,
  add column if not exists last_sync_at timestamptz,
  add column if not exists last_sync_status text,
  add column if not exists data_gaps jsonb not null default '[]'::jsonb;

alter table public.os_ies_entity_map
  drop constraint if exists os_ies_entity_map_last_sync_status_check;
alter table public.os_ies_entity_map
  add constraint os_ies_entity_map_last_sync_status_check
  check (
    last_sync_status is null
    or last_sync_status in ('ok', 'partial', 'failed', 'never')
  );

alter table public.os_ies_entity_map
  drop constraint if exists os_ies_entity_map_data_gaps_check;
alter table public.os_ies_entity_map
  add constraint os_ies_entity_map_data_gaps_check
  check (
    jsonb_typeof(data_gaps) = 'array'
    and pg_column_size(data_gaps) <= 8192
  );

-- AUTHORITATIVE IES company IDs (digit strings, no spaces). Locked 2026-07-25.
-- Re-apply last if a duplicate agent race occurs.
insert into public.os_ies_entity_map (
  entity_id,
  realm_id,
  ies_company_name,
  display_name,
  is_parent,
  sort_order,
  notes,
  is_active
) values
  (
    'ENT-FIRM',
    '9341457251412290',
    'Tage Venture Capital',
    'Tage Venture Capital',
    true,
    10,
    'Parent books: capital, SSC/holdco, and intercompany',
    true
  ),
  (
    'ENT-R619',
    '9341457251406251',
    'Recruit 619',
    'Recruit 619',
    false,
    20,
    'Stand-alone operating books',
    true
  ),
  (
    'ENT-SIGNENT',
    '9341457251424506',
    'Signent HR',
    'Signent HR',
    false,
    30,
    'Stand-alone operating books',
    true
  ),
  (
    'ENT-INDA',
    '9341457533727282',
    'Instant NDA',
    'Instant NDA',
    false,
    40,
    'Stand-alone operating books',
    true
  )
on conflict (entity_id) do update set
  realm_id = excluded.realm_id,
  ies_company_name = excluded.ies_company_name,
  display_name = excluded.display_name,
  is_parent = excluded.is_parent,
  sort_order = excluded.sort_order,
  notes = excluded.notes,
  is_active = true,
  updated_at = now();

create or replace view public.os_ies_company_map as
select
  realm_id as ies_company_id,
  ies_company_name,
  entity_id,
  display_name,
  is_parent,
  sort_order,
  is_active,
  last_sync_at,
  last_sync_status,
  data_gaps,
  updated_at
from public.os_ies_entity_map;

-- Explicit report snapshots. Payload is compact summary data, not a ledger.
create table if not exists public.os_ies_financial_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  realm_id text not null
    check (realm_id ~ '^[0-9A-Za-z-]{1,64}$'),
  report_type text not null
    check (report_type in ('profit_loss', 'balance_sheet', 'cash', 'ar_aging', 'ap_aging')),
  period_start date,
  period_end date,
  as_of date not null,
  currency text not null default 'USD'
    check (currency ~ '^[A-Z]{3}$'),
  payload jsonb not null default '{}'::jsonb,
  data_gaps jsonb not null default '[]'::jsonb,
  source_system text not null default 'ies'
    check (source_system = 'ies'),
  management_consolidation boolean not null default false,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint os_ies_financial_snapshot_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  constraint os_ies_financial_snapshot_gaps_check
    check (jsonb_typeof(data_gaps) = 'array' and pg_column_size(data_gaps) <= 8192),
  constraint os_ies_financial_snapshot_not_consolidated
    check (management_consolidation = false)
);

create index if not exists os_ies_financial_snapshots_lookup_idx
  on public.os_ies_financial_snapshots
  (entity_id, report_type, as_of desc, synced_at desc);

alter table public.os_ies_financial_snapshots enable row level security;
drop policy if exists os_ies_financial_snapshots_select
  on public.os_ies_financial_snapshots;
create policy os_ies_financial_snapshots_select
  on public.os_ies_financial_snapshots
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

-- Draft/propose only. This table never moves money and does not itself call IES.
create table if not exists public.os_ies_write_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_type text not null
    check (proposal_type in ('journal_draft', 'invoice_draft', 'vendor_bill_draft', 'checklist_note')),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'proposed'
    check (status in ('proposed', 'approved', 'rejected', 'submitted', 'failed')),
  proposed_by uuid not null,
  proposed_at timestamptz not null default now(),
  approved_at timestamptz,
  submitted_at timestamptz,
  provider_reference text,
  failure_reason text,
  updated_at timestamptz not null default now(),
  constraint os_ies_write_proposal_payload_check
    check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 32768),
  constraint os_ies_write_proposal_no_money_actions
    check (
      lower(proposal_type) !~ '(payment|transfer|void|payroll|refund)'
      and lower(payload::text) !~ '"(payment|transfer|void|payroll|refund|money_movement)"'
    )
);

create table if not exists public.os_ies_write_proposal_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null references public.os_ies_write_proposals(proposal_id) on delete cascade,
  approver_id uuid not null,
  decision text not null check (decision in ('approved', 'rejected')),
  note text,
  decided_at timestamptz not null default now(),
  unique (proposal_id, approver_id)
);

create or replace function public.guard_ies_write_proposal_transition_phase81()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_approvals integer;
  v_rejections integer;
begin
  if old.status in ('submitted', 'failed', 'rejected') and new.status <> old.status then
    raise exception 'terminal IES proposal status cannot transition';
  end if;

  if new.status in ('approved', 'submitted') then
    select
      count(*) filter (where decision = 'approved'),
      count(*) filter (where decision = 'rejected')
    into v_approvals, v_rejections
    from public.os_ies_write_proposal_approvals
    where proposal_id = old.proposal_id;

    if v_rejections > 0 then
      raise exception 'rejected IES proposal cannot be approved or submitted';
    end if;
    if v_approvals < 2 then
      raise exception 'IES proposal requires two distinct human approvals';
    end if;
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    new.approved_at := now();
  end if;
  if new.status = 'submitted' and old.status <> 'submitted' then
    new.submitted_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists os_ies_write_proposal_transition_guard
  on public.os_ies_write_proposals;
create trigger os_ies_write_proposal_transition_guard
before update on public.os_ies_write_proposals
for each row execute function public.guard_ies_write_proposal_transition_phase81();

alter table public.os_ies_write_proposals enable row level security;
alter table public.os_ies_write_proposal_approvals enable row level security;

drop policy if exists os_ies_write_proposals_select on public.os_ies_write_proposals;
create policy os_ies_write_proposals_select
  on public.os_ies_write_proposals for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_ies_write_proposal_approvals_select
  on public.os_ies_write_proposal_approvals;
create policy os_ies_write_proposal_approvals_select
  on public.os_ies_write_proposal_approvals for select to authenticated
  using (
    exists (
      select 1 from public.os_ies_write_proposals p
      where p.proposal_id = proposal_id
        and (
          public.is_firm_wide_access()
          or public.can_access_entity(p.entity_id)
        )
    )
  );

revoke all on public.os_ies_financial_snapshots from public, anon;
revoke all on public.os_ies_write_proposals from public, anon;
revoke all on public.os_ies_write_proposal_approvals from public, anon;
grant select on public.os_ies_financial_snapshots to authenticated;
grant select on public.os_ies_write_proposals to authenticated;
grant select on public.os_ies_write_proposal_approvals to authenticated;
grant select on public.os_ies_company_map to authenticated;

-- Scope cached CFO briefings by company without changing the phase-79 role UI.
alter table public.os_csuite_briefings
  add column if not exists entity_id text
  check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$');

create index if not exists os_csuite_briefings_role_entity_as_of_idx
  on public.os_csuite_briefings (role, entity_id, as_of desc);

-- FINAL authoritative company-ID lock (wins duplicate-agent races).
-- Digit strings only; display names exact IES company names.
insert into public.os_ies_entity_map (
  entity_id, realm_id, ies_company_name, display_name, is_parent, sort_order, is_active, notes
) values
  ('ENT-FIRM', '9341457251412290', 'Tage Venture Capital', 'Tage Venture Capital', true, 10, true, 'Parent books: capital, SSC/holdco, and intercompany'),
  ('ENT-R619', '9341457251406251', 'Recruit 619', 'Recruit 619', false, 20, true, 'Stand-alone operating books'),
  ('ENT-SIGNENT', '9341457251424506', 'Signent HR', 'Signent HR', false, 30, true, 'Stand-alone operating books'),
  ('ENT-INDA', '9341457533727282', 'Instant NDA', 'Instant NDA', false, 40, true, 'Stand-alone operating books')
on conflict (entity_id) do update set
  realm_id = excluded.realm_id,
  ies_company_name = excluded.ies_company_name,
  display_name = excluded.display_name,
  is_parent = excluded.is_parent,
  sort_order = excluded.sort_order,
  is_active = true,
  notes = excluded.notes,
  updated_at = now();
