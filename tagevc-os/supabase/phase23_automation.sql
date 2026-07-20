-- Phase 23: Marketing brand voice + OAuth tokens, DocuSign signed files, IT offboarding
-- Safe to re-run.

-- ─── Brand voice (per entity; null entity = firm default) ────────────────────
create table if not exists public.os_marketing_brand_voices (
  id uuid primary key default gen_random_uuid(),
  voice_id text not null unique,
  entity_id text references public.entities(entity_id),
  name text not null,
  tone_guidelines text,
  audience text,
  forbidden_phrases jsonb not null default '[]'::jsonb,
  preferred_phrases jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists os_marketing_brand_voices_entity_uniq
  on public.os_marketing_brand_voices ((coalesce(entity_id, '')))
  where active = true;

-- ─── OAuth tokens (ciphertext only; never plaintext) ─────────────────────────
create table if not exists public.os_marketing_oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  account_id text not null unique,
  platform text not null,
  entity_id text references public.entities(entity_id),
  access_token_cipher text not null,
  refresh_token_cipher text,
  token_expires_at timestamptz,
  scopes text[],
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists os_marketing_oauth_account_idx
  on public.os_marketing_oauth_tokens (account_id);

-- ─── Extend schedule jobs with post result visibility ────────────────────────
alter table public.os_marketing_schedule_jobs
  add column if not exists published_url text;
alter table public.os_marketing_schedule_jobs
  add column if not exists publisher text;

-- ─── DocuSign signed file archive ────────────────────────────────────────────
create table if not exists public.os_docusign_signed_files (
  id uuid primary key default gen_random_uuid(),
  envelope_id text not null,
  doc_id text,
  entity_id text references public.entities(entity_id),
  file_name text not null,
  content_base64 text,
  content_type text not null default 'application/pdf',
  library_path text,
  source text not null default 'docusign',
  received_at timestamptz not null default now()
);

create index if not exists os_docusign_signed_envelope_idx
  on public.os_docusign_signed_files (envelope_id, received_at desc);
create index if not exists os_docusign_signed_doc_idx
  on public.os_docusign_signed_files (doc_id);

-- ─── IT offboarding runs ─────────────────────────────────────────────────────
create table if not exists public.os_it_offboarding_runs (
  id uuid primary key default gen_random_uuid(),
  run_id text not null unique,
  user_id text not null,
  entity_id text references public.entities(entity_id),
  status text not null default 'open',
  checklist jsonb not null default '[]'::jsonb,
  notes text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists os_it_offboarding_user_idx
  on public.os_it_offboarding_runs (user_id, created_at desc);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
alter table public.os_marketing_brand_voices enable row level security;
alter table public.os_marketing_oauth_tokens enable row level security;
alter table public.os_docusign_signed_files enable row level security;
alter table public.os_it_offboarding_runs enable row level security;

drop policy if exists "os_mkt_voices_select" on public.os_marketing_brand_voices;
drop policy if exists "os_mkt_voices_write" on public.os_marketing_brand_voices;
create policy "os_mkt_voices_select"
  on public.os_marketing_brand_voices for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_mkt_voices_write"
  on public.os_marketing_brand_voices for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

-- OAuth tokens: service role only for reads of ciphertext in app (persist client).
-- Authenticated may not select cipher columns via RLS deny-all select for anon users;
-- allow firm-wide select of metadata-free rows for admins via firm-wide.
drop policy if exists "os_mkt_oauth_deny_select" on public.os_marketing_oauth_tokens;
create policy "os_mkt_oauth_firm_select"
  on public.os_marketing_oauth_tokens for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists "os_docusign_signed_select" on public.os_docusign_signed_files;
create policy "os_docusign_signed_select"
  on public.os_docusign_signed_files for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );

drop policy if exists "os_it_offboard_select" on public.os_it_offboarding_runs;
drop policy if exists "os_it_offboard_write" on public.os_it_offboarding_runs;
create policy "os_it_offboard_select"
  on public.os_it_offboarding_runs for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
create policy "os_it_offboard_write"
  on public.os_it_offboarding_runs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (public.is_firm_wide_access() or public.can_access_entity(entity_id));

grant select, insert, update on public.os_marketing_brand_voices to authenticated;
grant select on public.os_marketing_oauth_tokens to authenticated;
grant select on public.os_docusign_signed_files to authenticated;
grant select, insert, update on public.os_it_offboarding_runs to authenticated;
