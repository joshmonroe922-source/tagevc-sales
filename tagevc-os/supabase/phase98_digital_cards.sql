-- Phase 98: Digital Business Card spine
-- Additive. Safe to re-run. Does NOT touch os_store_snapshots or SSC tables.
-- Public reads go through service role only; anon has no table access.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.can_admin_digital_cards()
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
      and p.role in (
        'visionary', 'admin', 'coo', 'service_lead', 'counsel_ops', 'partner'
      )
  );
$$;

create or replace function public.can_manage_entity_digital_cards(p_entity_id text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.can_admin_digital_cards()
    or (
      exists (
        select 1 from public.profiles p
        where p.id = auth.uid()
          and p.active = true
          and p.role in ('sub_lead', 'service_lead', 'coo', 'partner')
          and (
            public.is_firm_wide_access()
            or public.can_access_entity(p_entity_id)
          )
      )
    );
$$;

grant execute on function public.can_admin_digital_cards() to authenticated;
grant execute on function public.can_manage_entity_digital_cards(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Entity templates (admin-locked brand + defaults)
-- ---------------------------------------------------------------------------
create table if not exists public.os_digital_card_entity_templates (
  entity_id text primary key,
  default_cta jsonb not null default '{}'::jsonb,
  locked_theme jsonb not null default '{}'::jsonb,
  required_share_fields text[] not null default '{}',
  routing_defaults jsonb not null default '{}'::jsonb,
  company_main_line text,
  company_website text,
  desk_public_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_os_digital_card_entity_templates_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_os_digital_card_entity_templates_updated
  on public.os_digital_card_entity_templates;
create trigger trg_os_digital_card_entity_templates_updated
  before update on public.os_digital_card_entity_templates
  for each row
  execute function public.set_os_digital_card_entity_templates_updated_at();

alter table public.os_digital_card_entity_templates enable row level security;

drop policy if exists os_digital_card_entity_templates_select
  on public.os_digital_card_entity_templates;
create policy os_digital_card_entity_templates_select
  on public.os_digital_card_entity_templates
  for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );

drop policy if exists os_digital_card_entity_templates_write
  on public.os_digital_card_entity_templates;
create policy os_digital_card_entity_templates_write
  on public.os_digital_card_entity_templates
  for all to authenticated
  using (public.can_admin_digital_cards())
  with check (public.can_admin_digital_cards());

revoke all on public.os_digital_card_entity_templates from public, anon;
grant select, insert, update, delete on public.os_digital_card_entity_templates to authenticated;
grant all on public.os_digital_card_entity_templates to service_role;

comment on table public.os_digital_card_entity_templates is
  'Digital card brand locks, default CTAs, and routing defaults per entity.';

-- Seed entity templates (CTAs from spine prompt)
insert into public.os_digital_card_entity_templates (
  entity_id, default_cta, locked_theme, required_share_fields, routing_defaults,
  company_main_line, company_website
)
values
  (
    'ENT-FIRM',
    '{"label":"Explore our companies","url":"https://tagevc.com"}'::jsonb,
    '{"primary":"#3B4559","accent":"#B2A384","surface":"#F7F5F1"}'::jsonb,
    array['work_email'],
    '{"default_action":"network_contact"}'::jsonb,
    null,
    'https://tagevc.com'
  ),
  (
    'ENT-R619',
    '{"label":"Request talent / Find work","url":"https://recruit619.com"}'::jsonb,
    '{"primary":"#3B4559","accent":"#B2A384","surface":"#F7F5F1"}'::jsonb,
    array['work_email'],
    '{"default_action":"network_contact","hiring_intent":"client_lead","jobseek_intent":"candidate_interest","human_confirm":true}'::jsonb,
    null,
    'https://recruit619.com'
  ),
  (
    'ENT-SIGNENT',
    '{"label":"Talk to HR","url":"https://signenthr.com"}'::jsonb,
    '{"primary":"#3B4559","accent":"#B2A384","surface":"#F7F5F1"}'::jsonb,
    array['work_email'],
    '{"default_action":"network_contact","notify":"sales"}'::jsonb,
    null,
    'https://signenthr.com'
  ),
  (
    'ENT-INDA',
    '{"label":"Send an NDA","url":"https://instantnda.us"}'::jsonb,
    '{"primary":"#3B4559","accent":"#B2A384","surface":"#F7F5F1"}'::jsonb,
    array['work_email'],
    '{"default_action":"network_contact","cta_attribution":true}'::jsonb,
    null,
    'https://instantnda.us'
  )
on conflict (entity_id) do update set
  default_cta = excluded.default_cta,
  locked_theme = excluded.locked_theme,
  routing_defaults = excluded.routing_defaults,
  company_website = coalesce(
    public.os_digital_card_entity_templates.company_website,
    excluded.company_website
  ),
  updated_at = now();

-- ---------------------------------------------------------------------------
-- Personas
-- ---------------------------------------------------------------------------
create table if not exists public.os_digital_card_personas (
  id uuid primary key default gen_random_uuid(),
  user_profile_id uuid not null references public.profiles(id) on delete cascade,
  entity_id text not null,
  public_id text not null unique
    check (public_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  public_slug text unique,
  display_name text not null default '',
  title text not null default '',
  department text not null default '',
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  website text,
  calendar_url text,
  booking_url text,
  socials jsonb not null default '{}'::jsonb,
  bio_short text not null default '',
  photo_url text,
  cta_primary jsonb not null default '{}'::jsonb,
  theme jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  is_active boolean not null default true,
  revoked_at timestamptz,
  revoke_message text,
  event_tag text,
  event_tag_remaining integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists os_digital_card_personas_user_idx
  on public.os_digital_card_personas (user_profile_id);
create index if not exists os_digital_card_personas_entity_idx
  on public.os_digital_card_personas (entity_id);
create index if not exists os_digital_card_personas_active_idx
  on public.os_digital_card_personas (is_active, revoked_at)
  where is_active = true and revoked_at is null;

create or replace function public.set_os_digital_card_personas_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_os_digital_card_personas_updated
  on public.os_digital_card_personas;
create trigger trg_os_digital_card_personas_updated
  before update on public.os_digital_card_personas
  for each row
  execute function public.set_os_digital_card_personas_updated_at();

-- One default persona per user (when is_default)
create unique index if not exists os_digital_card_personas_one_default_idx
  on public.os_digital_card_personas (user_profile_id)
  where is_default = true;

alter table public.os_digital_card_personas enable row level security;

drop policy if exists os_digital_card_personas_select on public.os_digital_card_personas;
create policy os_digital_card_personas_select
  on public.os_digital_card_personas
  for select to authenticated
  using (
    user_profile_id = auth.uid()
    or public.can_manage_entity_digital_cards(entity_id)
  );

drop policy if exists os_digital_card_personas_insert on public.os_digital_card_personas;
create policy os_digital_card_personas_insert
  on public.os_digital_card_personas
  for insert to authenticated
  with check (
    user_profile_id = auth.uid()
    or public.can_admin_digital_cards()
  );

drop policy if exists os_digital_card_personas_update on public.os_digital_card_personas;
create policy os_digital_card_personas_update
  on public.os_digital_card_personas
  for update to authenticated
  using (
    user_profile_id = auth.uid()
    or public.can_admin_digital_cards()
  )
  with check (
    user_profile_id = auth.uid()
    or public.can_admin_digital_cards()
  );

drop policy if exists os_digital_card_personas_delete on public.os_digital_card_personas;
create policy os_digital_card_personas_delete
  on public.os_digital_card_personas
  for delete to authenticated
  using (
    user_profile_id = auth.uid()
    or public.can_admin_digital_cards()
  );

revoke all on public.os_digital_card_personas from public, anon;
grant select, insert, update, delete on public.os_digital_card_personas to authenticated;
grant all on public.os_digital_card_personas to service_role;

comment on table public.os_digital_card_personas is
  'Employee digital card personas. public_id is stable across title edits.';

-- ---------------------------------------------------------------------------
-- Network contacts (owned by employee)
-- ---------------------------------------------------------------------------
create table if not exists public.os_network_contacts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  entity_id text not null,
  persona_id uuid references public.os_digital_card_personas(id) on delete set null,
  name text not null,
  email text,
  phone text,
  company text,
  title text,
  source_channel text not null default 'unknown',
  source_detail text,
  entry_path text,
  meeting_context text,
  event_tag text,
  location_text text,
  their_notes text,
  our_notes text,
  consent_marketing boolean not null default false,
  consent_at timestamptz,
  external_submission_id text,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'new'
    check (status in (
      'new', 'followed_up', 'linked_lead', 'linked_candidate', 'closed'
    )),
  linked_client_lead_id text,
  linked_candidate_id text,
  routing_suggestion jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_network_contacts_external_submission_uidx
  on public.os_network_contacts (external_submission_id)
  where external_submission_id is not null;

create index if not exists os_network_contacts_owner_idx
  on public.os_network_contacts (owner_user_id, created_at desc);
create index if not exists os_network_contacts_entity_idx
  on public.os_network_contacts (entity_id, status);
create index if not exists os_network_contacts_persona_idx
  on public.os_network_contacts (persona_id, created_at desc);
create index if not exists os_network_contacts_email_idx
  on public.os_network_contacts (lower(email))
  where email is not null;

create or replace function public.set_os_network_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_os_network_contacts_updated on public.os_network_contacts;
create trigger trg_os_network_contacts_updated
  before update on public.os_network_contacts
  for each row
  execute function public.set_os_network_contacts_updated_at();

alter table public.os_network_contacts enable row level security;

drop policy if exists os_network_contacts_select on public.os_network_contacts;
create policy os_network_contacts_select
  on public.os_network_contacts
  for select to authenticated
  using (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards(entity_id)
  );

drop policy if exists os_network_contacts_insert on public.os_network_contacts;
create policy os_network_contacts_insert
  on public.os_network_contacts
  for insert to authenticated
  with check (
    owner_user_id = auth.uid()
    or public.can_admin_digital_cards()
  );

drop policy if exists os_network_contacts_update on public.os_network_contacts;
create policy os_network_contacts_update
  on public.os_network_contacts
  for update to authenticated
  using (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards(entity_id)
  )
  with check (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards(entity_id)
  );

drop policy if exists os_network_contacts_delete on public.os_network_contacts;
create policy os_network_contacts_delete
  on public.os_network_contacts
  for delete to authenticated
  using (
    owner_user_id = auth.uid()
    or public.can_admin_digital_cards()
  );

revoke all on public.os_network_contacts from public, anon;
grant select, insert, update, delete on public.os_network_contacts to authenticated;
grant all on public.os_network_contacts to service_role;

comment on table public.os_network_contacts is
  'Inbound exchange contacts owned by the employee; source-tracked.';

-- ---------------------------------------------------------------------------
-- Events (PII-minimal analytics)
-- ---------------------------------------------------------------------------
create table if not exists public.os_digital_card_events (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid references public.os_digital_card_personas(id) on delete set null,
  entity_id text not null,
  event_type text not null
    check (event_type in (
      'view', 'save_vcard', 'exchange_submit', 'share_click', 'revoke_hit'
    )),
  source_channel text not null default 'unknown',
  source_detail text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_digital_card_events_persona_idx
  on public.os_digital_card_events (persona_id, created_at desc);
create index if not exists os_digital_card_events_entity_idx
  on public.os_digital_card_events (entity_id, event_type, created_at desc);
create index if not exists os_digital_card_events_source_idx
  on public.os_digital_card_events (source_channel, created_at desc);

alter table public.os_digital_card_events enable row level security;

drop policy if exists os_digital_card_events_select on public.os_digital_card_events;
create policy os_digital_card_events_select
  on public.os_digital_card_events
  for select to authenticated
  using (
    public.can_manage_entity_digital_cards(entity_id)
    or exists (
      select 1 from public.os_digital_card_personas p
      where p.id = persona_id
        and p.user_profile_id = auth.uid()
    )
  );

-- Authenticated inserts for own persona analytics (views from logged-in preview)
drop policy if exists os_digital_card_events_insert on public.os_digital_card_events;
create policy os_digital_card_events_insert
  on public.os_digital_card_events
  for insert to authenticated
  with check (
    public.can_admin_digital_cards()
    or exists (
      select 1 from public.os_digital_card_personas p
      where p.id = persona_id
        and p.user_profile_id = auth.uid()
    )
  );

revoke all on public.os_digital_card_events from public, anon;
grant select, insert on public.os_digital_card_events to authenticated;
grant all on public.os_digital_card_events to service_role;

comment on table public.os_digital_card_events is
  'Digital card analytics. Prefer hashed IP in meta; avoid unnecessary PII.';

-- ---------------------------------------------------------------------------
-- Public rate-limit ledger (service role only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_digital_card_rate_limits (
  bucket_key text primary key,
  hit_count integer not null default 0,
  window_started_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_digital_card_rate_limits enable row level security;

-- No authenticated policies — service role only
revoke all on public.os_digital_card_rate_limits from public, anon, authenticated;
grant all on public.os_digital_card_rate_limits to service_role;

comment on table public.os_digital_card_rate_limits is
  'Fail-soft public intake rate limits. Service role only.';

-- ---------------------------------------------------------------------------
-- HRIS hooks: activate / revoke digital card
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
      'gusto_provision',
      'email_signature',
      'digital_card_activate',
      'digital_card_revoke'
    )
  );

insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook, notes
)
select
  t.id,
  'sd.digital_card_activate',
  'Activate digital business card',
  'Start Date',
  245,
  'Human Resources',
  'start_date',
  0,
  true,
  'assist',
  false,
  false,
  'digital_card_activate',
  'Create default persona for home entity; seed title/work email/display name. Employee completes mobile/socials/photo in My Card.'
from public.os_hris_process_templates t
where t.kind = 'onboarding'
  and t.active = true
  and not exists (
    select 1 from public.os_hris_process_template_steps s
    where s.template_id = t.id
      and s.step_key = 'sd.digital_card_activate'
  );

insert into public.os_hris_process_template_steps (
  template_id, step_key, title, category, sort_order, owner_role,
  timing_anchor, offset_days, evidence_required, automation, destructive,
  optional_for_audience, system_hook, notes
)
select
  t.id,
  'ex.digital_card_revoke',
  'Revoke digital business card',
  'Exit',
  45,
  'Human Resources',
  'end_date',
  0,
  true,
  'assist',
  true,
  false,
  'digital_card_revoke',
  'Public kill switch for all personas. Network contacts retained per retention policy.'
from public.os_hris_process_templates t
where t.kind = 'offboarding'
  and t.active = true
  and not exists (
    select 1 from public.os_hris_process_template_steps s
    where s.template_id = t.id
      and s.step_key = 'ex.digital_card_revoke'
  );

-- Runtime steps already spawned
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'os_hris_process_steps'
      and column_name = 'system_hook'
  ) then
    update public.os_hris_process_steps
    set system_hook = 'digital_card_activate',
        automation = 'assist'
    where step_key = 'sd.digital_card_activate'
      and coalesce(system_hook, '') is distinct from 'digital_card_activate';

    update public.os_hris_process_steps
    set system_hook = 'digital_card_revoke',
        automation = 'assist'
    where step_key = 'ex.digital_card_revoke'
      and coalesce(system_hook, '') is distinct from 'digital_card_revoke';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Recruit routing stubs (human-confirmed links from network contacts)
-- Does not touch careers Path A / website intake / general résumé pipelines.
-- ---------------------------------------------------------------------------
create table if not exists public.os_recruit_card_lead_links (
  lead_id text primary key,
  contact_id uuid not null references public.os_network_contacts(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  company text,
  contact_name text,
  email text,
  phone text,
  source text not null default 'digital_card',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_recruit_card_candidate_links (
  candidate_id text primary key,
  contact_id uuid not null references public.os_network_contacts(id) on delete cascade,
  owner_user_id uuid not null references public.profiles(id) on delete cascade,
  name text,
  email text,
  phone text,
  source text not null default 'digital_card_general_interest',
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_recruit_card_lead_links enable row level security;
alter table public.os_recruit_card_candidate_links enable row level security;

drop policy if exists os_recruit_card_lead_links_all on public.os_recruit_card_lead_links;
create policy os_recruit_card_lead_links_all
  on public.os_recruit_card_lead_links
  for all to authenticated
  using (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards('ENT-R619')
  )
  with check (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards('ENT-R619')
  );

drop policy if exists os_recruit_card_candidate_links_all
  on public.os_recruit_card_candidate_links;
create policy os_recruit_card_candidate_links_all
  on public.os_recruit_card_candidate_links
  for all to authenticated
  using (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards('ENT-R619')
  )
  with check (
    owner_user_id = auth.uid()
    or public.can_manage_entity_digital_cards('ENT-R619')
  );

revoke all on public.os_recruit_card_lead_links from public, anon;
revoke all on public.os_recruit_card_candidate_links from public, anon;
grant select, insert, update, delete on public.os_recruit_card_lead_links to authenticated;
grant select, insert, update, delete on public.os_recruit_card_candidate_links to authenticated;
grant all on public.os_recruit_card_lead_links to service_role;
grant all on public.os_recruit_card_candidate_links to service_role;
