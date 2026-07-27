-- Phase 78: Account credit / payment-worthiness checks (counterparty).
-- Additive. Does NOT touch os_store_snapshots, personal credit, or SSC tables.
-- Policy: Due Upon Receipt first; credit check is manual manager+ tool when negotiating NET.
-- Self-entity business credit (Phase 73/75) is separate — this is OTHER companies (clients).

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Who may run / view account credit checks
-- Visionary + business-credit finance roles OR Recruit manager+ on ENT-R619
-- ---------------------------------------------------------------------------
create or replace function public.can_run_account_credit_check(p_entity_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.active = true
      and (
        -- Firm finance / Visionary (any entity they can access)
        p.role in ('visionary', 'admin', 'service_lead', 'counsel_ops', 'coo')
        or (
          -- Recruit manager+ for Recruit accounts only
          p_entity_id = 'ENT-R619'
          and p.role in (
            'visionary', 'admin', 'partner', 'coo', 'sub_lead',
            'service_lead', 'counsel_ops'
          )
        )
      )
  );
$$;

grant execute on function public.can_run_account_credit_check(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Checks table
-- ---------------------------------------------------------------------------
create table if not exists public.os_account_credit_checks (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  account_ref_type text not null
    check (account_ref_type in (
      'recruit_account',
      'instantnda_customer',
      'signent_client',
      'tage_counterparty'
    )),
  -- Internal uuid when available; otherwise stable text id stored as uuid-shaped or use identifiers
  account_ref_id uuid not null,
  account_display_name text not null default '',
  account_identifiers jsonb not null default '{}'::jsonb
    check (jsonb_typeof(account_identifiers) = 'object'),
  status text not null default 'requested'
    check (status in (
      'requested', 'in_progress', 'completed', 'thin_file', 'failed', 'waived'
    )),
  bureaus_requested text[] not null default '{dnb,experian_business,equifax_business}',
  risk_band text
    check (risk_band is null or risk_band in (
      'low', 'medium', 'high', 'unknown'
    )),
  scores jsonb not null default '{}'::jsonb
    check (jsonb_typeof(scores) = 'object'),
  summary jsonb not null default '{}'::jsonb
    check (jsonb_typeof(summary) = 'object'),
  suggested_terms text
    check (suggested_terms is null or suggested_terms in (
      'due_upon_receipt', 'prepaid', 'net_15', 'net_30', 'net_45', 'custom'
    )),
  suggested_credit_limit numeric,
  recommendation_notes text not null default '',
  raw_storage_paths jsonb not null default '{}'::jsonb
    check (jsonb_typeof(raw_storage_paths) = 'object'),
  source text not null default 'guided_export'
    check (source in ('manual_upload', 'guided_export', 'api_future')),
  requested_by uuid references public.profiles (id),
  requested_at timestamptz not null default now(),
  completed_at timestamptz,
  waiver_reason text,
  waived_by uuid references public.profiles (id),
  waived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_acc_credit_ref_idx
  on public.os_account_credit_checks (account_ref_type, account_ref_id, requested_at desc);
create index if not exists os_acc_credit_entity_idx
  on public.os_account_credit_checks (entity_id, requested_at desc);
create index if not exists os_acc_credit_status_idx
  on public.os_account_credit_checks (entity_id, status, requested_at desc);

alter table public.os_account_credit_checks enable row level security;

drop policy if exists os_acc_credit_select on public.os_account_credit_checks;
create policy os_acc_credit_select on public.os_account_credit_checks
  for select to authenticated
  using (
    public.can_run_account_credit_check(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_acc_credit_insert on public.os_account_credit_checks;
create policy os_acc_credit_insert on public.os_account_credit_checks
  for insert to authenticated
  with check (
    public.can_run_account_credit_check(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists os_acc_credit_update on public.os_account_credit_checks;
create policy os_acc_credit_update on public.os_account_credit_checks
  for update to authenticated
  using (
    public.can_run_account_credit_check(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  )
  with check (
    public.can_run_account_credit_check(entity_id)
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- No delete for non-visionary — soft history. Visionary may delete via service role if needed.
revoke all on public.os_account_credit_checks from public, anon;
grant select, insert, update on public.os_account_credit_checks to authenticated;

-- ---------------------------------------------------------------------------
-- Storage: account-credit/{entity_id}/… under credit-private
-- ---------------------------------------------------------------------------
drop policy if exists "credit_private_account_select" on storage.objects;
create policy "credit_private_account_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'credit-private'
    and name like 'account-credit/%'
    and public.can_run_account_credit_check(
      split_part(name, '/', 2)
    )
  );

drop policy if exists "credit_private_account_insert" on storage.objects;
create policy "credit_private_account_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'credit-private'
    and name like 'account-credit/%'
    and public.can_run_account_credit_check(
      split_part(name, '/', 2)
    )
  );

comment on table public.os_account_credit_checks is
  'Phase 78: payment-worthiness checks on OTHER companies (clients). Default commercial posture remains Due Upon Receipt; suggested_terms are DRAFT guidance only — never auto-applied to contracts/IES.';
comment on function public.can_run_account_credit_check(text) is
  'Manager+/finance may run checks; entity-scoped. Instant NDA / Signent rows allowed by schema but product UI stays dark until flagged.';
