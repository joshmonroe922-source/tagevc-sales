-- Phase 72: HRIS deepen — Graph joiner, docs vault, comp fields, IT child links.
-- Additive on Phase 68/71. Safe to re-run. Does NOT touch os_store_snapshots.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Compensation (light, protected at app layer — HR/Visionary)
-- ---------------------------------------------------------------------------
alter table public.os_hris_employees
  add column if not exists comp_amount numeric(14,2),
  add column if not exists comp_currency text not null default 'USD'
    check (comp_currency ~ '^[A-Z]{3}$'),
  add column if not exists comp_basis text not null default 'salary'
    check (comp_basis in ('salary', 'hourly', 'commission', 'draw', 'other')),
  add column if not exists pay_frequency text not null default 'annual'
    check (pay_frequency in ('annual', 'monthly', 'biweekly', 'weekly', 'hourly')),
  add column if not exists manager_profile_id uuid;

create index if not exists os_hris_employees_manager_profile_idx
  on public.os_hris_employees (manager_profile_id)
  where manager_profile_id is not null;

-- ---------------------------------------------------------------------------
-- Document vault metadata (binaries in private storage bucket hris-private)
-- ---------------------------------------------------------------------------
create table if not exists public.os_hris_documents (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null
    references public.os_hris_employees (id) on delete cascade,
  step_id uuid,
  kind text not null default 'other'
    check (kind in (
      'offer', 'nda', 'i9', 'handbook', 'contract', 'id', 'other', 'signed'
    )),
  title text not null,
  file_name text not null,
  mime_type text not null default 'application/octet-stream',
  byte_size integer not null default 0 check (byte_size >= 0),
  storage_path text not null,
  uploaded_by uuid,
  docusign_envelope_id text,
  docusign_status text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_hris_docs_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_hris_docs_employee_idx
  on public.os_hris_documents (employee_id, created_at desc);
create index if not exists os_hris_docs_step_idx
  on public.os_hris_documents (step_id)
  where step_id is not null;

alter table public.os_hris_documents enable row level security;

drop policy if exists os_hris_docs_select on public.os_hris_documents;
create policy os_hris_docs_select on public.os_hris_documents
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

drop policy if exists os_hris_docs_write on public.os_hris_documents;
create policy os_hris_docs_write on public.os_hris_documents
  for all to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  )
  with check (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_hris_employees e
      where e.id = employee_id and public.can_access_entity(e.entity_id)
    )
  );

revoke all on public.os_hris_documents from public, anon;
grant select, insert, update, delete on public.os_hris_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Expand system_hook vocabulary for new assists
-- ---------------------------------------------------------------------------
alter table public.os_hris_process_template_steps
  drop constraint if exists os_hris_process_template_steps_system_hook_check;

alter table public.os_hris_process_template_steps
  add constraint os_hris_process_template_steps_system_hook_check
  check (
    system_hook is null
    or system_hook in (
      'manual', 'payroll', 'it_provision', 'asset_audit', 'benefits',
      'access_revoke', 'i9', 'handbook_ack', 'employment_contract',
      'compliance_ack', 'messaging_revoke', 'portal_revoke', 'ticketing_revoke',
      'knowledge_handoff', 'exit_interview',
      'graph_provision', 'mailbox_grant', 'docusign_send', 'document_vault'
    )
  );

alter table public.os_hris_process_steps
  drop constraint if exists os_hris_process_steps_system_hook_check;

-- process steps may mirror template hooks; add same if constraint exists
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='os_hris_process_steps'
      and column_name='system_hook'
  ) then
    begin
      alter table public.os_hris_process_steps
        drop constraint if exists os_hris_process_steps_system_hook_check;
    exception when undefined_object then null;
    end;
  end if;
end $$;

-- Update mailbox step hook + offer letter hook if present
update public.os_hris_process_template_steps s
set system_hook = 'mailbox_grant', automation = 'assist'
from public.os_hris_process_templates t
where s.template_id = t.id
  and t.slug = 'r619-onboarding-v1'
  and s.step_key = 'bs.visionary_mailbox_access';

update public.os_hris_process_template_steps s
set system_hook = 'graph_provision', automation = 'assist'
from public.os_hris_process_templates t
where s.template_id = t.id
  and t.slug = 'r619-onboarding-v1'
  and s.step_key = 'bs.ms_email';

update public.os_hris_process_template_steps s
set system_hook = 'docusign_send', automation = 'assist'
from public.os_hris_process_templates t
where s.template_id = t.id
  and t.slug = 'r619-onboarding-v1'
  and s.step_key in ('pre.offer_letter');

-- Ensure Visionary mailbox step exists (idempotent with phase71)
insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook
)
select
  t.id,
  'bs.visionary_mailbox_access',
  'Grant Visionary (Josh) Read and manage mailbox permissions',
  'Before Start Date',
  165,
  'IT',
  'start_date',
  -4,
  true,
  'assist',
  false,
  false,
  'mailbox_grant'
from public.os_hris_process_templates t
where t.slug = 'r619-onboarding-v1'
  and not exists (
    select 1 from public.os_hris_process_template_steps s
    where s.template_id = t.id and s.step_key = 'bs.visionary_mailbox_access'
  );

-- Propagate new template steps into open Dennis onboarding run if missing
insert into public.os_hris_process_steps (
  run_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, due_at, status, evidence_required,
  automation, destructive, optional_for_audience, system_hook, blocker
)
select
  r.id,
  ts.step_key,
  ts.title,
  ts.category,
  ts.sort_order,
  ts.owner_role,
  ts.timing_anchor,
  ts.offset_days,
  case
    when ts.timing_anchor = 'start_date' and r.start_date is not null
      then (r.start_date + (ts.offset_days || ' days')::interval)::date
    when ts.timing_anchor = 'offer_accepted' and r.offer_accepted_at is not null
      then (r.offer_accepted_at + (ts.offset_days || ' days')::interval)::date
    else null
  end,
  'pending',
  ts.evidence_required,
  ts.automation,
  ts.destructive,
  ts.optional_for_audience,
  ts.system_hook,
  false
from public.os_hris_process_runs r
join public.os_hris_process_templates t on t.id = r.template_id
join public.os_hris_process_template_steps ts on ts.template_id = t.id
where r.run_key = 'ONB-dennis-r619-v1'
  and r.status in ('open', 'in_progress', 'blocked')
  and not exists (
    select 1 from public.os_hris_process_steps ps
    where ps.run_id = r.id and ps.step_key = ts.step_key
  );

-- Sync system_hook / automation on existing open Dennis steps from template
update public.os_hris_process_steps ps
set
  system_hook = ts.system_hook,
  automation = ts.automation,
  title = ts.title
from public.os_hris_process_runs r
join public.os_hris_process_templates t on t.id = r.template_id
join public.os_hris_process_template_steps ts on ts.template_id = t.id
where ps.run_id = r.id
  and ts.step_key = ps.step_key
  and r.run_key = 'ONB-dennis-r619-v1'
  and r.status in ('open', 'in_progress', 'blocked')
  and ps.step_key in (
    'bs.ms_email',
    'bs.visionary_mailbox_access',
    'pre.offer_letter'
  );

-- Private document vault bucket (binaries); metadata in os_hris_documents
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hris-private',
  'hris-private',
  false,
  52428800,
  array[
    'application/pdf',
    'text/plain',
    'image/jpeg',
    'image/png',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/octet-stream'
  ]
)
on conflict (id) do update set
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "hris_private_storage_select" on storage.objects;
create policy "hris_private_storage_select"
  on storage.objects for select to authenticated
  using (bucket_id = 'hris-private' and public.is_firm_wide_access());

drop policy if exists "hris_private_storage_insert" on storage.objects;
create policy "hris_private_storage_insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'hris-private' and public.is_firm_wide_access());
