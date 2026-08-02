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
