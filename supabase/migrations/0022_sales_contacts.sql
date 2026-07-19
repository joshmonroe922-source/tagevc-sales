-- Account → Contact → Deal foundation (classic CRM shape for Tage B2B).
-- Communications hang on Contact; Deal links Account + primary Contact.
-- Phase 2: call lists of contacts (optionally filtered by account).

-- ---------------------------------------------------------------------------
-- sales_accounts — companies / orgs
-- ---------------------------------------------------------------------------
create table if not exists public.sales_accounts (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  website         text not null default '',
  -- soft segment: acquisition target, partner, portfolio, prospect, other
  account_type    text not null default 'prospect'
                    check (account_type in (
                      'prospect', 'partner', 'portfolio', 'acquisition', 'other'
                    )),
  notes           text not null default '',
  created_by      uuid references public.sales_users (id) on delete set null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_accounts_name_idx
  on public.sales_accounts (lower(name));
create index if not exists sales_accounts_type_idx
  on public.sales_accounts (account_type)
  where archived_at is null;
create index if not exists sales_accounts_created_at_idx
  on public.sales_accounts (created_at desc);

comment on table public.sales_accounts is
  'Companies/orgs. Contacts belong here; deals prefer linking the account.';

create or replace function public.set_sales_accounts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sales_accounts_updated_at on public.sales_accounts;
create trigger sales_accounts_updated_at
  before update on public.sales_accounts
  for each row execute function public.set_sales_accounts_updated_at();

alter table public.sales_accounts enable row level security;

create policy "Sales users view accounts"
  on public.sales_accounts for select
  using (public.is_active_sales_user());

create policy "Sales users insert accounts"
  on public.sales_accounts for insert
  with check (public.is_active_sales_user());

create policy "Sales users update accounts"
  on public.sales_accounts for update
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Admins delete accounts"
  on public.sales_accounts for delete
  using (public.is_active_sales_user() and public.sales_user_role() in ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- sales_contacts — people under an account
-- ---------------------------------------------------------------------------
create table if not exists public.sales_contacts (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid references public.sales_accounts (id) on delete set null,
  full_name       text not null,
  title           text not null default '',
  -- Denormalized company label for search/display; prefer account.name
  company         text not null default '',
  primary_email   text not null default '',
  primary_phone   text not null default '',
  emails          text[] not null default '{}',
  phones          text[] not null default '{}',
  notes           text not null default '',
  created_by      uuid references public.sales_users (id) on delete set null,
  archived_at     timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_contacts_account_id_idx
  on public.sales_contacts (account_id)
  where account_id is not null;
create index if not exists sales_contacts_name_idx
  on public.sales_contacts (lower(full_name));
create index if not exists sales_contacts_email_idx
  on public.sales_contacts (lower(primary_email))
  where primary_email <> '';
create index if not exists sales_contacts_phone_idx
  on public.sales_contacts (primary_phone)
  where primary_phone <> '';
create index if not exists sales_contacts_created_at_idx
  on public.sales_contacts (created_at desc);
create index if not exists sales_contacts_emails_gin_idx
  on public.sales_contacts using gin (emails);
create index if not exists sales_contacts_phones_gin_idx
  on public.sales_contacts using gin (phones);

comment on table public.sales_contacts is
  'People. SMS/call/email history hangs here. Prefer account_id set.';

create or replace function public.set_sales_contacts_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sales_contacts_updated_at on public.sales_contacts;
create trigger sales_contacts_updated_at
  before update on public.sales_contacts
  for each row execute function public.set_sales_contacts_updated_at();

alter table public.sales_contacts enable row level security;

create policy "Sales users view contacts"
  on public.sales_contacts for select
  using (public.is_active_sales_user());

create policy "Sales users insert contacts"
  on public.sales_contacts for insert
  with check (public.is_active_sales_user());

create policy "Sales users update contacts"
  on public.sales_contacts for update
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Admins delete contacts"
  on public.sales_contacts for delete
  using (public.is_active_sales_user() and public.sales_user_role() in ('admin', 'manager'));

-- ---------------------------------------------------------------------------
-- Deals → account + contact
-- ---------------------------------------------------------------------------
alter table public.sales_leads
  add column if not exists contact_id uuid
    references public.sales_contacts (id) on delete set null;

alter table public.sales_leads
  add column if not exists account_id uuid
    references public.sales_accounts (id) on delete set null;

create index if not exists sales_leads_contact_id_idx
  on public.sales_leads (contact_id)
  where contact_id is not null;

create index if not exists sales_leads_account_id_idx
  on public.sales_leads (account_id)
  where account_id is not null;

comment on column public.sales_leads.contact_id is
  'Primary contact for this deal. Required for new deals in the app.';
comment on column public.sales_leads.account_id is
  'Company for this deal. Prefer set from contact.account_id.';

-- ---------------------------------------------------------------------------
-- Activities: contact and/or deal; SMS/call types for RingCentral later
-- ---------------------------------------------------------------------------
alter table public.sales_lead_activities
  alter column lead_id drop not null;

alter table public.sales_lead_activities
  add column if not exists contact_id uuid
    references public.sales_contacts (id) on delete set null;

create index if not exists sales_lead_activities_contact_idx
  on public.sales_lead_activities (contact_id, created_at desc)
  where contact_id is not null;

alter table public.sales_lead_activities
  drop constraint if exists sales_lead_activities_activity_type_check;

alter table public.sales_lead_activities
  add constraint sales_lead_activities_activity_type_check
  check (activity_type in (
    'email_sent', 'email_queued', 'email_received',
    'task_created', 'task_cleared',
    'drip_enrolled', 'drip_step_sent', 'drip_completed', 'drip_cancelled',
    'note', 'stage_change', 'system', 'intake',
    'sms_sent', 'sms_received', 'call_logged', 'call_missed'
  ));

alter table public.sales_lead_activities
  drop constraint if exists sales_lead_activities_subject_check;

alter table public.sales_lead_activities
  add constraint sales_lead_activities_subject_check
  check (lead_id is not null or contact_id is not null);

comment on column public.sales_lead_activities.contact_id is
  'Person this activity belongs to. Prefer both contact + lead when deal-linked.';

alter table public.sales_email_messages
  add column if not exists contact_id uuid
    references public.sales_contacts (id) on delete set null;

create index if not exists sales_email_messages_contact_id_idx
  on public.sales_email_messages (contact_id, created_at desc)
  where contact_id is not null;

-- ---------------------------------------------------------------------------
-- Phase 2 stubs: call lists of contacts
-- ---------------------------------------------------------------------------
create table if not exists public.sales_call_lists (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  description     text not null default '',
  status          text not null default 'draft'
                    check (status in ('draft', 'active', 'archived')),
  created_by      uuid references public.sales_users (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_call_lists_status_idx
  on public.sales_call_lists (status, updated_at desc);

comment on table public.sales_call_lists is
  'Phase 2 stub: ordered lists of contacts to call/SMS.';

alter table public.sales_call_lists enable row level security;

create policy "Sales users view call lists"
  on public.sales_call_lists for select
  using (public.is_active_sales_user());

create policy "Sales users manage call lists"
  on public.sales_call_lists for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create table if not exists public.sales_call_list_members (
  id              uuid primary key default gen_random_uuid(),
  list_id         uuid not null references public.sales_call_lists (id) on delete cascade,
  contact_id      uuid not null references public.sales_contacts (id) on delete cascade,
  sort_order      int not null default 0,
  status          text not null default 'pending'
                    check (status in (
                      'pending', 'called', 'skipped', 'sms_sent', 'no_answer'
                    )),
  notes           text not null default '',
  last_attempt_at timestamptz,
  metadata        jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  unique (list_id, contact_id)
);

create index if not exists sales_call_list_members_list_idx
  on public.sales_call_list_members (list_id, sort_order);

alter table public.sales_call_list_members enable row level security;

create policy "Sales users view call list members"
  on public.sales_call_list_members for select
  using (public.is_active_sales_user());

create policy "Sales users manage call list members"
  on public.sales_call_list_members for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

-- ---------------------------------------------------------------------------
-- Backfill: Account from company (or Unknown / {name}), Contact, link deal
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_account_id uuid;
  v_contact_id uuid;
  v_account_name text;
  v_emails text[];
  v_phones text[];
begin
  for r in
    select id, name, email, phone, company, notes, assigned_rep_id, created_at,
           contact_id, account_id
    from public.sales_leads
    where contact_id is null or account_id is null
    order by created_at asc
  loop
    v_account_id := r.account_id;
    v_contact_id := r.contact_id;

    -- Account: reuse by case-insensitive name when company present
    if v_account_id is null then
      v_account_name := coalesce(nullif(trim(r.company), ''), 'Unknown / ' || coalesce(nullif(trim(r.name), ''), 'Contact'));

      select a.id into v_account_id
      from public.sales_accounts a
      where lower(a.name) = lower(v_account_name)
        and a.archived_at is null
      order by a.created_at asc
      limit 1;

      if v_account_id is null then
        insert into public.sales_accounts (
          name, notes, created_by, created_at
        )
        values (
          v_account_name,
          'Backfilled from deal.',
          r.assigned_rep_id,
          r.created_at
        )
        returning id into v_account_id;
      end if;
    end if;

    -- Contact: reuse by email when present; else create under account
    if v_contact_id is null then
      v_emails := case
        when nullif(trim(r.email), '') is not null then array[lower(trim(r.email))]
        else '{}'::text[]
      end;
      v_phones := case
        when nullif(trim(r.phone), '') is not null then array[trim(r.phone)]
        else '{}'::text[]
      end;

      if nullif(trim(r.email), '') is not null then
        select c.id into v_contact_id
        from public.sales_contacts c
        where lower(c.primary_email) = lower(trim(r.email))
           or lower(trim(r.email)) = any (
                select lower(x) from unnest(c.emails) as x
              )
        order by c.created_at asc
        limit 1;
      end if;

      if v_contact_id is null then
        insert into public.sales_contacts (
          account_id,
          full_name,
          company,
          primary_email,
          primary_phone,
          emails,
          phones,
          notes,
          created_by,
          created_at
        )
        values (
          v_account_id,
          coalesce(nullif(trim(r.name), ''), 'Unknown'),
          coalesce(nullif(trim(r.company), ''), (select name from public.sales_accounts where id = v_account_id)),
          lower(coalesce(trim(r.email), '')),
          coalesce(trim(r.phone), ''),
          v_emails,
          v_phones,
          case
            when nullif(trim(r.notes), '') is not null
              then 'Backfilled from deal. ' || left(trim(r.notes), 500)
            else ''
          end,
          r.assigned_rep_id,
          r.created_at
        )
        returning id into v_contact_id;
      else
        -- Attach orphan contact to the deal's account when missing
        update public.sales_contacts
        set account_id = coalesce(account_id, v_account_id),
            company = case when company = '' then coalesce(nullif(trim(r.company), ''), company) else company end
        where id = v_contact_id;
      end if;
    end if;

    update public.sales_leads
    set contact_id = coalesce(contact_id, v_contact_id),
        account_id = coalesce(account_id, v_account_id),
        company = case
          when coalesce(company, '') = '' then coalesce(
            (select name from public.sales_accounts where id = v_account_id),
            company
          )
          else company
        end
    where id = r.id;
  end loop;

  update public.sales_lead_activities a
  set contact_id = l.contact_id
  from public.sales_leads l
  where a.lead_id = l.id
    and a.contact_id is null
    and l.contact_id is not null;

  update public.sales_email_messages m
  set contact_id = l.contact_id
  from public.sales_leads l
  where m.lead_id = l.id
    and m.contact_id is null
    and l.contact_id is not null;
end $$;
