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
