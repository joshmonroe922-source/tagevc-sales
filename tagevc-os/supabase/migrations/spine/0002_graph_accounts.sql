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
