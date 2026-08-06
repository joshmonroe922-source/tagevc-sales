-- Phase 96: Gusto multi-entity (one company UUID + OAuth grant per employer entity)
-- Additive. Safe to re-run. Secrets never in os_partner_entity_bindings.config.
-- See docs/GUSTO_MULTI_ENTITY.md. Keep GUSTO_LIVE=0 until dry-run smoke + OAuth.

-- ---------------------------------------------------------------------------
-- OAuth vault (cipher at rest; plaintext: bootstrap only for local/dev)
-- ---------------------------------------------------------------------------
create table if not exists public.os_gusto_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  company_uuid text not null,
  access_token_cipher text not null,
  refresh_token_cipher text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  environment text not null default 'production'
    check (environment in ('sandbox', 'production')),
  status text not null default 'connected'
    check (status in ('connected', 'revoked', 'error', 'expired')),
  connected_by uuid,
  connected_at timestamptz,
  refreshed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_uuid),
  unique (entity_id)
);

create index if not exists os_gusto_oauth_tokens_entity_idx
  on public.os_gusto_oauth_tokens (entity_id);

alter table public.os_gusto_oauth_tokens enable row level security;

drop policy if exists "os_gusto_oauth_tokens_select" on public.os_gusto_oauth_tokens;
drop policy if exists "os_gusto_oauth_tokens_write" on public.os_gusto_oauth_tokens;

create policy "os_gusto_oauth_tokens_select"
  on public.os_gusto_oauth_tokens for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

create policy "os_gusto_oauth_tokens_write"
  on public.os_gusto_oauth_tokens for all to authenticated
  using (public.is_firm_wide_access())
  with check (public.is_firm_wide_access());

revoke all on public.os_gusto_oauth_tokens from public, anon;
grant select, insert, update, delete on public.os_gusto_oauth_tokens to authenticated;
grant all on public.os_gusto_oauth_tokens to service_role;

comment on table public.os_gusto_oauth_tokens is
  'Per-Gusto-company OAuth tokens (encrypted). One row per OS employer entity. Never store tokens in partner binding config.';

-- ---------------------------------------------------------------------------
-- HRIS: gusto_provision system_hook + onboarding template step
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
      'graph_provision', 'mailbox_grant', 'docusign_send', 'document_vault',
      'verified_first', 'screening',
      'gusto_provision'
    )
  );

insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook, notes
)
select
  t.id,
  'bs.gusto_provision',
  'Provision employee in Gusto payroll (entity company)',
  'Before Start Date',
  155,
  'Human Resources',
  'start_date',
  -5,
  true,
  'assist',
  false,
  false,
  'gusto_provision',
  'Fail-closed resolve via os_partner_entity_bindings (partner=gusto). Never firm fallback. GUSTO_LIVE=0 → dry-run.'
from public.os_hris_process_templates t
where t.kind = 'onboarding'
  and t.active = true
  and t.slug in (
    'tage-onboarding-v1',
    'parent-onboarding-v1',
    'r619-onboarding-v1',
    'signent-onboarding-v1',
    'inda-onboarding-v1'
  )
on conflict (template_id, step_key) do update
  set system_hook = 'gusto_provision',
      automation = 'assist',
      evidence_required = true,
      notes = excluded.notes,
      title = excluded.title;

-- ---------------------------------------------------------------------------
-- Binding meta scaffold (UUID filled when Josh / OAuth provides company id)
-- Does NOT invent UUIDs. Status stays scaffolded until external_account_id set.
-- ---------------------------------------------------------------------------
update public.os_partner_entity_bindings
set
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'company_name', 'Recruit 619, LLC',
    'plan', 'Simple',
    'environment', 'production',
    'role', 'subsidiary_payroll'
  ),
  updated_at = now()
where partner_key = 'gusto'
  and entity_id = 'ENT-R619'
  and (external_account_id is null or btrim(external_account_id) = '');

update public.os_partner_entity_bindings
set
  config = coalesce(config, '{}'::jsonb) || jsonb_build_object(
    'company_name', 'Tage Venture Capital',
    'environment', 'production',
    'role', 'parent_payroll'
  ),
  updated_at = now()
where partner_key = 'gusto'
  and entity_id = 'ENT-FIRM'
  and (external_account_id is null or btrim(external_account_id) = '');
