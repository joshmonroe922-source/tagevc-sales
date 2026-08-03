-- Phase 6 Journeys + Phase 7 Intelligence (additive on ECC).
alter table public.ecc_journeys add column if not exists trigger_json jsonb not null default '{"type":"manual"}'::jsonb;
alter table public.ecc_journeys add column if not exists goal_json jsonb not null default '{}'::jsonb;
alter table public.ecc_journeys add column if not exists reentry_policy text not null default 'allow_after_exit';
alter table public.ecc_journeys add column if not exists starter_pack_key text;
alter table public.ecc_journeys add column if not exists version int not null default 1;

alter table public.ecc_journey_enrollments add column if not exists current_node text;
alter table public.ecc_journey_enrollments add column if not exists metadata_json jsonb not null default '{}'::jsonb;

create table if not exists public.ecc_journey_node_runs (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.ecc_journey_enrollments(id) on delete cascade,
  entity_id text not null,
  node_id text not null,
  status text not null default 'pending',
  scheduled_for timestamptz,
  completed_at timestamptz,
  send_message_id uuid,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists ecc_journey_node_runs_enroll_idx on public.ecc_journey_node_runs(enrollment_id, created_at desc);

alter table public.contacts add column if not exists preferred_send_hour int;
alter table public.contacts add column if not exists engagement_band text;

alter table public.ecc_engagement_events add column if not exists utm_json jsonb not null default '{}'::jsonb;
alter table public.ecc_engagement_events add column if not exists hour_local int;

create table if not exists public.ecc_ai_assist_drafts (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  campaign_id uuid references public.ecc_campaigns(id) on delete set null,
  template_id uuid references public.ecc_templates(id) on delete set null,
  kind text not null default 'rewrite',
  source_text text not null default '',
  suggestion_text text not null default '',
  tone text not null default 'professional',
  status text not null default 'suggested' check (status in ('suggested','approved','rejected','applied')),
  auto_send_allowed boolean not null default false,
  created_by uuid,
  reviewed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ecc_attribution_touch (
  id uuid primary key default gen_random_uuid(),
  entity_id text not null,
  contact_id uuid references public.contacts(id) on delete cascade,
  campaign_id uuid,
  journey_id uuid,
  event_type text not null,
  utm_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists ecc_attribution_touch_contact_idx on public.ecc_attribution_touch(entity_id, contact_id, occurred_at desc);

do $$ declare t text; begin
  foreach t in array array['ecc_journey_node_runs','ecc_ai_assist_drafts','ecc_attribution_touch'] loop
    execute format('alter table public.%I enable row level security', t);
    begin
      execute format(
        'create policy %I on public.%I for select to authenticated using (public.is_firm_wide_access() or public.can_access_entity(entity_id))',
        t||'_select', t
      );
    exception when others then null;
    end;
  end loop;
end $$;
