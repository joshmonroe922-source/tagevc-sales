-- Chunked OS graph search_vector backfill (companion to 0013 / phase109).
--
-- Full-table UPDATE locks too long. Each statement updates at most 500 rows
-- whose vector is missing or stale vs the compute_* helper.
-- Re-run EACH statement until it reports UPDATE 0.
-- Safe to re-run anytime (new rows / weight changes).
--
-- Apply AFTER phase109 / 0013 (needs accounts_compute_search_vector etc.).
-- NOT APPLIED TO PRODUCTION. Do not wrap the whole file in one long txn if
-- the editor offers autocommit — run statement-by-statement.

-- Accounts (500 / run)
with batch as (
  select
    id,
    public.accounts_compute_search_vector(
      name, canonical_domain, legal_name, website, industry,
      hq_city, hq_state, hq_country, description
    ) as sv
  from public.accounts
  where search_vector is distinct from public.accounts_compute_search_vector(
    name, canonical_domain, legal_name, website, industry,
    hq_city, hq_state, hq_country, description
  )
  order by id
  limit 500
)
update public.accounts a
set search_vector = batch.sv
from batch
where a.id = batch.id;

-- Contacts (500 / run)
with batch as (
  select
    id,
    public.contacts_compute_search_vector(
      full_name, first_name, last_name, primary_email, emails, phones,
      title, department, seniority, location, skills, linkedin_url
    ) as sv
  from public.contacts
  where search_vector is distinct from public.contacts_compute_search_vector(
    full_name, first_name, last_name, primary_email, emails, phones,
    title, department, seniority, location, skills, linkedin_url
  )
  order by id
  limit 500
)
update public.contacts c
set search_vector = batch.sv
from batch
where c.id = batch.id;

-- Jobs (500 / run)
with batch as (
  select
    id,
    public.recruit_job_reqs_compute_search_vector(
      title, req_number, location, employment_type, status,
      req_skills, description, notes
    ) as sv
  from public.recruit_job_reqs
  where search_vector is distinct from public.recruit_job_reqs_compute_search_vector(
    title, req_number, location, employment_type, status,
    req_skills, description, notes
  )
  order by id
  limit 500
)
update public.recruit_job_reqs j
set search_vector = batch.sv
from batch
where j.id = batch.id;
