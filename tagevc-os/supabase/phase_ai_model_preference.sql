-- AI model preference (Grok default + optional Claude)
-- Shared UDL across Tage OS + subsidiary portals. Fail-soft if not applied yet.
-- Copilot (M365) is out of scope for the in-app toggle.
-- See docs/AI_MODEL_PREFERENCE.md

create table if not exists public.os_ai_org_settings (
  entity_id text primary key,
  default_provider text not null default 'grok'
    check (default_provider in ('grok', 'claude')),
  claude_feature_enabled boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.os_ai_user_prefs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  preferred_provider text null
    check (
      preferred_provider is null
      or preferred_provider in ('grok', 'claude')
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.os_ai_org_settings enable row level security;
alter table public.os_ai_user_prefs enable row level security;

drop policy if exists os_ai_org_settings_select on public.os_ai_org_settings;
create policy os_ai_org_settings_select on public.os_ai_org_settings
  for select to authenticated
  using (true);

drop policy if exists os_ai_org_settings_write on public.os_ai_org_settings;
create policy os_ai_org_settings_write on public.os_ai_org_settings
  for all to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('visionary', 'admin', 'coo')
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and p.role in ('visionary', 'admin', 'coo')
    )
  );

drop policy if exists os_ai_user_prefs_own on public.os_ai_user_prefs;
create policy os_ai_user_prefs_own on public.os_ai_user_prefs
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

grant select, insert, update, delete on public.os_ai_org_settings to authenticated;
grant select, insert, update, delete on public.os_ai_user_prefs to authenticated;
grant select, insert, update, delete on public.os_ai_org_settings to service_role;
grant select, insert, update, delete on public.os_ai_user_prefs to service_role;

insert into public.os_ai_org_settings (entity_id, default_provider, claude_feature_enabled)
values
  ('ENT-FIRM', 'grok', false),
  ('ENT-R619', 'grok', false),
  ('ENT-SIGNENT', 'grok', false),
  ('ENT-INDA', 'grok', false)
on conflict (entity_id) do nothing;
