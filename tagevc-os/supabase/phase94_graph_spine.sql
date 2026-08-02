-- phase94_graph_spine.sql — apply bundle for C1 graph spine (0001–0010)

-- ===== 0001_tenancy.sql =====
-- C1 / 0001_tenancy — organizations, user_profiles, memberships
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  parent_id uuid references public.organizations (id) on delete set null,
  kind text not null check (kind in ('parent', 'subsidiary')),
  branding jsonb not null default '{}'::jsonb,
  feature_flags jsonb not null default '{
    "enrichment_enabled": true,
    "waterfall_pdl": true,
    "waterfall_hunter": true,
    "zoominfo_enabled": false,
    "site_research_enabled": true,
    "hierarchy_enabled": true,
    "copilot_enabled": true,
    "signature_mining_enabled": false,
    "auto_expand_employees": true,
    "auto_expand_peers": false
  }'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  icp_title_patterns text[] not null default '{}',
  auto_expand_employees boolean not null default true,
  auto_expand_cap int not null default 75
    check (auto_expand_cap >= 0 and auto_expand_cap <= 500),
  auto_expand_peers boolean not null default false,
  monthly_enrichment_budget_usd numeric(12,2) not null default 500,
  created_at timestamptz not null default now()
);

create table if not exists public.user_profiles (
  id uuid primary key default gen_random_uuid(),
  entra_oid text not null unique,
  email text not null,
  display_name text,
  avatar_url text,
  is_tage_admin boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  user_id uuid not null references public.user_profiles (id) on delete cascade,
  role text not null check (role in ('member', 'org_admin', 'billing')),
  status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (org_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships (user_id);
create index if not exists memberships_org_idx on public.memberships (org_id);

-- ===== 0002_graph_accounts.sql =====
-- C1 / 0002_graph_accounts — canonical company graph
create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  canonical_domain text,
  name text not null,
  legal_name text,
  website text,
  linkedin_url text,
  logo_url text,
  industry text,
  employee_range text,
  employee_count int,
  revenue_range text,
  founded_year int,
  hq_city text,
  hq_state text,
  hq_country text,
  description text,
  apollo_org_id text,
  pdl_id text,
  zoominfo_id text,
  enrich_status text not null default 'pending',
  last_enriched_at timestamptz,
  enrichment_version int not null default 0,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists accounts_canonical_domain_uidx
  on public.accounts (canonical_domain)
  where canonical_domain is not null;

create index if not exists accounts_name_trgm
  on public.accounts using gin (name gin_trgm_ops);

create index if not exists accounts_search
  on public.accounts using gin (search_vector);

create or replace function public.spine_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists accounts_set_updated_at on public.accounts;
create trigger accounts_set_updated_at
  before update on public.accounts
  for each row execute function public.spine_set_updated_at();

create or replace function public.accounts_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.canonical_domain, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.legal_name, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.industry, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.description, '')), 'D');
  return new;
end;
$$;

drop trigger if exists accounts_search_vector_trg on public.accounts;
create trigger accounts_search_vector_trg
  before insert or update of name, canonical_domain, legal_name, industry, description
  on public.accounts
  for each row execute function public.accounts_rebuild_search_vector();

-- ===== 0003_graph_contacts.sql =====
-- C1 / 0003_graph_contacts — canonical people graph
create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  first_name text,
  last_name text,
  primary_email text,
  primary_email_status text not null default 'unknown',
  emails jsonb not null default '[]'::jsonb,
  phones jsonb not null default '[]'::jsonb,
  linkedin_url text,
  title text,
  seniority text,
  department text,
  location text,
  photo_url text,
  apollo_id text,
  pdl_id text,
  zoominfo_id text,
  enrich_status text not null default 'pending',
  last_enriched_at timestamptz,
  enrichment_version int not null default 0,
  search_vector tsvector,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists contacts_primary_email_uidx
  on public.contacts (lower(primary_email))
  where primary_email is not null;

create unique index if not exists contacts_linkedin_uidx
  on public.contacts (linkedin_url)
  where linkedin_url is not null;

create index if not exists contacts_name_trgm
  on public.contacts using gin (full_name gin_trgm_ops);

create index if not exists contacts_emails_gin
  on public.contacts using gin (emails);

create index if not exists contacts_search
  on public.contacts using gin (search_vector);

drop trigger if exists contacts_set_updated_at on public.contacts;
create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.spine_set_updated_at();

create or replace function public.contacts_rebuild_search_vector()
returns trigger
language plpgsql
as $$
begin
  new.search_vector :=
    setweight(to_tsvector('english', coalesce(new.full_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.primary_email, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(new.title, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(new.department, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(new.location, '')), 'D');
  return new;
end;
$$;

drop trigger if exists contacts_search_vector_trg on public.contacts;
create trigger contacts_search_vector_trg
  before insert or update of full_name, primary_email, title, department, location
  on public.contacts
  for each row execute function public.contacts_rebuild_search_vector();

-- ===== 0004_employments_edges.sql =====
-- C1 / 0004_employments_edges
create table if not exists public.employments (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.contacts (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text,
  department text,
  is_current boolean not null default true,
  started_on date,
  ended_on date,
  source text,
  created_at timestamptz not null default now()
);

create unique index if not exists employments_current_uidx
  on public.employments (contact_id, account_id)
  where is_current = true;

create index if not exists employments_account_idx on public.employments (account_id);
create index if not exists employments_contact_idx on public.employments (contact_id);

create table if not exists public.org_edges (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts (id) on delete cascade,
  manager_contact_id uuid not null references public.contacts (id) on delete cascade,
  report_contact_id uuid not null references public.contacts (id) on delete cascade,
  relation text not null default 'reports_to',
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  confidence numeric(4, 3),
  rationale text,
  suggested_by text,
  confirmed_by uuid references public.user_profiles (id) on delete set null,
  confirmed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists org_edges_active_uidx
  on public.org_edges (account_id, report_contact_id, relation)
  where status in ('suggested', 'confirmed');

create index if not exists org_edges_account_idx on public.org_edges (account_id);

drop trigger if exists org_edges_set_updated_at on public.org_edges;
create trigger org_edges_set_updated_at
  before update on public.org_edges
  for each row execute function public.spine_set_updated_at();

-- ===== 0005_links_provenance.sql =====
-- C1 / 0005_links_provenance — tenancy links + user-beats-agent provenance
create table if not exists public.account_org_links (
  account_id uuid not null references public.accounts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  visibility text not null default 'org'
    check (visibility in ('org', 'shared', 'network')),
  owner_user_id uuid references public.user_profiles (id) on delete set null,
  is_primary boolean not null default true,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (account_id, org_id)
);

create index if not exists account_org_links_org_idx
  on public.account_org_links (org_id);

create table if not exists public.contact_org_links (
  contact_id uuid not null references public.contacts (id) on delete cascade,
  org_id uuid not null references public.organizations (id) on delete cascade,
  visibility text not null default 'org'
    check (visibility in ('org', 'shared', 'network')),
  owner_user_id uuid references public.user_profiles (id) on delete set null,
  is_primary boolean not null default true,
  starred boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (contact_id, org_id)
);

create index if not exists contact_org_links_org_idx
  on public.contact_org_links (org_id);

create table if not exists public.field_provenance (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('account', 'contact')),
  entity_id uuid not null,
  field_name text not null,
  value text,
  source text not null,
  confidence numeric(4, 3),
  locked boolean not null default false,
  locked_by uuid references public.user_profiles (id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (entity_type, entity_id, field_name)
);

create table if not exists public.contact_field_history (
  id bigserial primary key,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  field_name text not null,
  old_value text,
  new_value text,
  source text,
  at timestamptz not null default now()
);

create index if not exists contact_field_history_contact_idx
  on public.contact_field_history (contact_id, at desc);

create table if not exists public.suggested_updates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  entity_type text not null check (entity_type in ('account', 'contact')),
  entity_id uuid not null,
  field_name text not null,
  suggested_value text,
  confidence numeric(4, 3),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'expired')),
  rationale text,
  job_id uuid,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references public.user_profiles (id) on delete set null
);

create index if not exists suggested_updates_org_pending_idx
  on public.suggested_updates (org_id, status)
  where status = 'pending';

-- ===== 0006_jobs_evidence.sql =====
-- C1 / 0006_jobs_evidence — enrichment queue, evidence, credits, graph activities
create table if not exists public.enrichment_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued'
    check (status in (
      'queued', 'running', 'succeeded', 'failed', 'budget_blocked', 'cancelled'
    )),
  idempotency_key text not null unique,
  attempts int not null default 0,
  max_attempts int not null default 5,
  progress_pct int not null default 0
    check (progress_pct >= 0 and progress_pct <= 100),
  progress_message text,
  cost_usd numeric(12, 4) not null default 0,
  provider_trace jsonb not null default '[]'::jsonb,
  error text,
  parent_job_id uuid references public.enrichment_jobs (id) on delete set null,
  account_id uuid references public.accounts (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz
);

create index if not exists enrichment_jobs_queue_idx
  on public.enrichment_jobs (status, created_at)
  where status in ('queued', 'running');

create index if not exists enrichment_jobs_org_idx
  on public.enrichment_jobs (org_id, created_at desc);

create table if not exists public.enrichment_evidence (
  id bigserial primary key,
  job_id uuid not null references public.enrichment_jobs (id) on delete cascade,
  provider text not null,
  request_meta jsonb not null default '{}'::jsonb,
  raw jsonb,
  normalized jsonb,
  created_at timestamptz not null default now()
);

create index if not exists enrichment_evidence_job_idx
  on public.enrichment_evidence (job_id);

create table if not exists public.credit_ledger (
  id bigserial primary key,
  org_id uuid not null references public.organizations (id) on delete cascade,
  provider text not null,
  units numeric(12, 4) not null default 1,
  usd_estimate numeric(12, 4) not null default 0,
  job_id uuid references public.enrichment_jobs (id) on delete set null,
  note text,
  at timestamptz not null default now()
);

create index if not exists credit_ledger_org_month_idx
  on public.credit_ledger (org_id, at desc);

create table if not exists public.activities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid references public.accounts (id) on delete set null,
  contact_id uuid references public.contacts (id) on delete set null,
  kind text not null,
  body text,
  meta jsonb not null default '{}'::jsonb,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists activities_org_idx
  on public.activities (org_id, created_at desc);

create index if not exists activities_account_idx
  on public.activities (account_id, created_at desc);

-- T3/T4: enqueue bootstrap jobs when org links are created
create or replace function public.spine_enqueue_account_bootstrap()
returns trigger
language plpgsql
as $$
declare
  v_org public.organizations%rowtype;
  v_key text;
begin
  select * into v_org from public.organizations where id = new.org_id;
  if not found then
    return new;
  end if;
  if coalesce(v_org.auto_expand_employees, true) = false then
    return new;
  end if;
  v_key := format(
    'account.bootstrap:%s:%s:%s',
    new.account_id,
    new.org_id,
    to_char(now() at time zone 'utc', 'YYYY-MM-DD')
  );
  insert into public.enrichment_jobs (org_id, type, payload, idempotency_key, account_id)
  values (
    new.org_id,
    'account.bootstrap',
    jsonb_build_object(
      'account_id', new.account_id,
      'org_id', new.org_id,
      'expand', true,
      'cap', coalesce(v_org.auto_expand_cap, 75)
    ),
    v_key,
    new.account_id
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists account_org_links_bootstrap_trg on public.account_org_links;
create trigger account_org_links_bootstrap_trg
  after insert on public.account_org_links
  for each row execute function public.spine_enqueue_account_bootstrap();

create or replace function public.spine_enqueue_contact_bootstrap()
returns trigger
language plpgsql
as $$
declare
  v_key text;
begin
  v_key := format(
    'contact.bootstrap:%s:%s:%s',
    new.contact_id,
    new.org_id,
    to_char(now() at time zone 'utc', 'YYYY-MM-DD')
  );
  insert into public.enrichment_jobs (org_id, type, payload, idempotency_key, contact_id)
  values (
    new.org_id,
    'contact.bootstrap',
    jsonb_build_object(
      'contact_id', new.contact_id,
      'org_id', new.org_id
    ),
    v_key,
    new.contact_id
  )
  on conflict (idempotency_key) do nothing;
  return new;
end;
$$;

drop trigger if exists contact_org_links_bootstrap_trg on public.contact_org_links;
create trigger contact_org_links_bootstrap_trg
  after insert on public.contact_org_links
  for each row execute function public.spine_enqueue_contact_bootstrap();

-- ===== 0007_product_recruit.sql =====
-- C11 / 0007_product_recruit — Recruit product tables on shared graph
create table if not exists public.recruit_job_reqs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  title text not null,
  status text not null default 'open',
  -- USER-owned field: workers must never update without explicit human API
  hiring_manager_contact_id uuid references public.contacts (id) on delete set null,
  hiring_manager_locked boolean not null default true,
  created_by uuid references public.user_profiles (id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists recruit_job_reqs_org_idx
  on public.recruit_job_reqs (org_id, status);

create index if not exists recruit_job_reqs_account_idx
  on public.recruit_job_reqs (account_id);

drop trigger if exists recruit_job_reqs_set_updated_at on public.recruit_job_reqs;
create trigger recruit_job_reqs_set_updated_at
  before update on public.recruit_job_reqs
  for each row execute function public.spine_set_updated_at();

create table if not exists public.recruit_candidates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status text not null default 'sourced',
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (org_id, contact_id)
);

create table if not exists public.recruit_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  job_req_id uuid not null references public.recruit_job_reqs (id) on delete cascade,
  candidate_id uuid not null references public.recruit_candidates (id) on delete cascade,
  status text not null default 'submitted',
  submitted_at timestamptz not null default now(),
  notes text,
  unique (job_req_id, candidate_id)
);

-- ===== 0008_product_nda_signent.sql =====
-- C11 / 0008_product_nda_signent — Instant NDA + Signent on shared graph
create table if not exists public.nda_envelopes (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  status text not null default 'draft',
  template_id text,
  docusign_envelope_id text,
  library_document_id text,
  created_by uuid references public.user_profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists nda_envelopes_org_idx
  on public.nda_envelopes (org_id, status);

drop trigger if exists nda_envelopes_set_updated_at on public.nda_envelopes;
create trigger nda_envelopes_set_updated_at
  before update on public.nda_envelopes
  for each row execute function public.spine_set_updated_at();

create table if not exists public.nda_signers (
  id uuid primary key default gen_random_uuid(),
  envelope_id uuid not null references public.nda_envelopes (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  role text not null default 'signer',
  signed_at timestamptz,
  unique (envelope_id, contact_id, role)
);

-- NOTE: public.signent_engagements already exists (portal billing shape).
-- Graph-linked engagements live on spine_signent_engagements.
create table if not exists public.spine_signent_engagements (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations (id) on delete cascade,
  account_id uuid not null references public.accounts (id) on delete cascade,
  primary_contact_id uuid references public.contacts (id) on delete set null,
  client_org_id uuid,
  status text not null default 'prospect',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists spine_signent_engagements_org_idx
  on public.spine_signent_engagements (org_id, status);

drop trigger if exists spine_signent_engagements_set_updated_at on public.spine_signent_engagements;
create trigger spine_signent_engagements_set_updated_at
  before update on public.spine_signent_engagements
  for each row execute function public.spine_set_updated_at();

-- ===== 0009_rls.sql =====
-- C1 / 0009_rls — JWT claim helpers + RLS (Entra claims; service_role bypasses)
create or replace function public.fn_is_tage_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_tage_admin')::boolean, false);
$$;

create or replace function public.fn_org_ids()
returns uuid[]
language plpgsql
stable
as $$
declare
  raw jsonb;
  out uuid[] := '{}';
  elem text;
begin
  raw := auth.jwt() -> 'org_ids';
  if raw is null then
    return out;
  end if;
  if jsonb_typeof(raw) = 'array' then
    for elem in select jsonb_array_elements_text(raw)
    loop
      begin
        out := array_append(out, elem::uuid);
      exception when others then
        null;
      end;
    end loop;
  end if;
  return out;
end;
$$;

create or replace function public.fn_has_org(oid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin() or oid = any (public.fn_org_ids());
$$;

create or replace function public.fn_can_see_account(aid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin()
    or exists (
      select 1
      from public.account_org_links l
      where l.account_id = aid
        and (
          l.org_id = any (public.fn_org_ids())
          or l.visibility in ('shared', 'network')
        )
    );
$$;

create or replace function public.fn_can_see_contact(cid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin()
    or exists (
      select 1
      from public.contact_org_links l
      where l.contact_id = cid
        and (
          l.org_id = any (public.fn_org_ids())
          or l.visibility in ('shared', 'network')
        )
    );
$$;

alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.employments enable row level security;
alter table public.org_edges enable row level security;
alter table public.account_org_links enable row level security;
alter table public.contact_org_links enable row level security;
alter table public.field_provenance enable row level security;
alter table public.contact_field_history enable row level security;
alter table public.suggested_updates enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_evidence enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.activities enable row level security;
alter table public.recruit_job_reqs enable row level security;
alter table public.recruit_candidates enable row level security;
alter table public.recruit_submissions enable row level security;
alter table public.nda_envelopes enable row level security;
alter table public.nda_signers enable row level security;
alter table public.spine_signent_engagements enable row level security;

-- organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select using (public.fn_has_org(id));

drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations
  for all using (public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin());

-- accounts / contacts
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select using (public.fn_can_see_account(id));

drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts
  for all using (public.fn_can_see_account(id) or public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin() or public.fn_org_ids() is not null);

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (public.fn_can_see_contact(id));

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all using (public.fn_can_see_contact(id) or public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin() or public.fn_org_ids() is not null);

-- employments / edges via parent account
drop policy if exists employments_all on public.employments;
create policy employments_all on public.employments
  for all using (public.fn_can_see_account(account_id))
  with check (public.fn_can_see_account(account_id));

drop policy if exists org_edges_all on public.org_edges;
create policy org_edges_all on public.org_edges
  for all using (public.fn_can_see_account(account_id))
  with check (public.fn_can_see_account(account_id));

drop policy if exists account_org_links_all on public.account_org_links;
create policy account_org_links_all on public.account_org_links
  for all using (public.fn_has_org(org_id) or public.fn_is_tage_admin())
  with check (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists contact_org_links_all on public.contact_org_links;
create policy contact_org_links_all on public.contact_org_links
  for all using (public.fn_has_org(org_id) or public.fn_is_tage_admin())
  with check (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists enrichment_jobs_all on public.enrichment_jobs;
create policy enrichment_jobs_all on public.enrichment_jobs
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists enrichment_evidence_select on public.enrichment_evidence;
create policy enrichment_evidence_select on public.enrichment_evidence
  for select using (
    exists (
      select 1 from public.enrichment_jobs j
      where j.id = job_id and public.fn_has_org(j.org_id)
    )
  );

drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select using (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists suggested_updates_all on public.suggested_updates;
create policy suggested_updates_all on public.suggested_updates
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists activities_all on public.activities;
create policy activities_all on public.activities
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists field_provenance_select on public.field_provenance;
create policy field_provenance_select on public.field_provenance
  for select using (
    (entity_type = 'account' and public.fn_can_see_account(entity_id))
    or (entity_type = 'contact' and public.fn_can_see_contact(entity_id))
    or public.fn_is_tage_admin()
  );

drop policy if exists recruit_job_reqs_all on public.recruit_job_reqs;
create policy recruit_job_reqs_all on public.recruit_job_reqs
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists recruit_candidates_all on public.recruit_candidates;
create policy recruit_candidates_all on public.recruit_candidates
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists recruit_submissions_all on public.recruit_submissions;
create policy recruit_submissions_all on public.recruit_submissions
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists nda_envelopes_all on public.nda_envelopes;
create policy nda_envelopes_all on public.nda_envelopes
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists nda_signers_select on public.nda_signers;
create policy nda_signers_select on public.nda_signers
  for all using (
    exists (
      select 1 from public.nda_envelopes e
      where e.id = envelope_id and public.fn_has_org(e.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.nda_envelopes e
      where e.id = envelope_id and public.fn_has_org(e.org_id)
    )
  );

drop policy if exists spine_signent_engagements_all on public.spine_signent_engagements;
create policy spine_signent_engagements_all on public.spine_signent_engagements
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

-- ===== 0010_seed_orgs.sql =====
-- Seed parent + subsidiary orgs (idempotent by slug)
insert into public.organizations (
  slug, name, kind, parent_id, icp_title_patterns, auto_expand_employees, auto_expand_cap
)
values
  (
    'tage',
    'Tage Venture Capital',
    'parent',
    null,
    array[
      'CEO', 'Founder', 'President', 'COO', 'CFO', 'CTO', 'Partner', 'Managing Director'
    ],
    true,
    75
  )
on conflict (slug) do update
set name = excluded.name,
    kind = excluded.kind;

insert into public.organizations (
  slug, name, kind, parent_id, icp_title_patterns, auto_expand_employees, auto_expand_cap
)
select
  v.slug,
  v.name,
  'subsidiary',
  p.id,
  v.icp,
  true,
  75
from public.organizations p
cross join (
  values
    (
      'recruit619',
      'Recruit 619',
      array[
        'VP Talent', 'Head of Talent', 'Talent Acquisition', 'Director HR',
        'CHRO', 'People Ops', 'Recruiting Manager'
      ]::text[]
    ),
    (
      'signent',
      'Signent HR',
      array[
        'CHRO', 'VP HR', 'HR Director', 'People Ops', 'HRBP', 'Controller'
      ]::text[]
    ),
    (
      'instant_nda',
      'Instant NDA',
      array[
        'General Counsel', 'Legal Ops', 'CLO', 'VP Legal', 'Contracts Manager'
      ]::text[]
    )
) as v(slug, name, icp)
where p.slug = 'tage'
on conflict (slug) do update
set name = excluded.name,
    parent_id = excluded.parent_id,
    icp_title_patterns = excluded.icp_title_patterns;

