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
