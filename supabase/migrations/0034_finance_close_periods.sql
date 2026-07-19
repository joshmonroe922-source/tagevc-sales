-- Month-end & year-end close checklists (parent + each subsidiary)
-- Run after 0030 on hqmobgtnedmhzipusert. Finance portal only — not entity detail pages.

-- ---------------------------------------------------------------------------
-- Close item templates (catalog) — seed checklist rows per period
-- ---------------------------------------------------------------------------
create table if not exists public.finance_close_item_templates (
  item_key             text primary key,
  title                text not null,
  description          text not null default '',
  area                 text not null default 'Period Close',
  period_type          text not null
                         check (period_type in ('month', 'year', 'both')),
  sort_order           integer not null default 100,
  evidence_expectation text not null default '',
  source_control_key   text not null default '',
  owner_role           text not null default 'Finance',
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.set_finance_close_item_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_close_item_templates_updated_at on public.finance_close_item_templates;
create trigger finance_close_item_templates_updated_at
  before update on public.finance_close_item_templates
  for each row execute function public.set_finance_close_item_templates_updated_at();

alter table public.finance_close_item_templates enable row level security;

drop policy if exists "Finance users read close item templates" on public.finance_close_item_templates;
create policy "Finance users read close item templates"
  on public.finance_close_item_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Close periods: entity_id null = Tage parent; period_key = YYYY-MM or YYYY
-- ---------------------------------------------------------------------------
create table if not exists public.finance_close_periods (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid references public.ops_entities (id) on delete cascade,
  period_type   text not null check (period_type in ('month', 'year')),
  period_key    text not null,
  status        text not null default 'open'
                  check (status in ('open', 'in_progress', 'closed')),
  due_at        date,
  opened_at     timestamptz not null default now(),
  closed_at     timestamptz,
  closed_by     uuid references public.sales_users (id) on delete set null,
  notes         text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint finance_close_periods_key_fmt check (
    (period_type = 'month' and period_key ~ '^\d{4}-\d{2}$')
    or (period_type = 'year' and period_key ~ '^\d{4}$')
  )
);

create unique index if not exists finance_close_periods_scope_uidx
  on public.finance_close_periods (
    period_type,
    period_key,
    coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

create index if not exists finance_close_periods_entity_idx
  on public.finance_close_periods (entity_id);

create index if not exists finance_close_periods_status_idx
  on public.finance_close_periods (status, period_type, period_key);

create or replace function public.set_finance_close_periods_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_close_periods_updated_at on public.finance_close_periods;
create trigger finance_close_periods_updated_at
  before update on public.finance_close_periods
  for each row execute function public.set_finance_close_periods_updated_at();

alter table public.finance_close_periods enable row level security;

drop policy if exists "Finance users manage close periods" on public.finance_close_periods;
create policy "Finance users manage close periods"
  on public.finance_close_periods for all
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'))
  with check (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Close checklist items (instance per period)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_close_items (
  id                     uuid primary key default gen_random_uuid(),
  period_id              uuid not null references public.finance_close_periods (id) on delete cascade,
  item_key               text not null default '',
  title                  text not null,
  description            text not null default '',
  area                   text not null default 'Period Close',
  sort_order             integer not null default 100,
  evidence_expectation   text not null default '',
  source_control_key     text not null default '',
  owner_role             text not null default 'Finance',
  status                 text not null default 'open'
                           check (status in ('open', 'in_progress', 'done', 'na', 'blocked')),
  due_at                 date,
  completed_at           date,
  evidence_url           text not null default '',
  evidence_notes         text not null default '',
  evidence_storage_path  text not null default '',
  evidence_file_name     text not null default '',
  evidence_mime_type     text not null default '',
  notes                  text not null default '',
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create unique index if not exists finance_close_items_period_key_uidx
  on public.finance_close_items (period_id, item_key)
  where item_key <> '';

create index if not exists finance_close_items_period_idx
  on public.finance_close_items (period_id, sort_order);

create index if not exists finance_close_items_status_idx
  on public.finance_close_items (status, due_at);

create or replace function public.set_finance_close_items_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_close_items_updated_at on public.finance_close_items;
create trigger finance_close_items_updated_at
  before update on public.finance_close_items
  for each row execute function public.set_finance_close_items_updated_at();

alter table public.finance_close_items enable row level security;

drop policy if exists "Finance users manage close items" on public.finance_close_items;
create policy "Finance users manage close items"
  on public.finance_close_items for all
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'))
  with check (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Close tasks linked to incomplete items
-- ---------------------------------------------------------------------------
create table if not exists public.finance_close_tasks (
  id            uuid primary key default gen_random_uuid(),
  item_id       uuid not null references public.finance_close_items (id) on delete cascade,
  sales_task_id uuid references public.sales_tasks (id) on delete set null,
  title         text not null,
  status        text not null default 'open'
                  check (status in ('open', 'done', 'cancelled')),
  assigned_to   uuid references public.sales_users (id) on delete set null,
  due_at        date,
  notes         text not null default '',
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists finance_close_tasks_open_item_uidx
  on public.finance_close_tasks (item_id)
  where status = 'open';

create index if not exists finance_close_tasks_status_idx
  on public.finance_close_tasks (status, due_at);

create or replace function public.set_finance_close_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists finance_close_tasks_updated_at on public.finance_close_tasks;
create trigger finance_close_tasks_updated_at
  before update on public.finance_close_tasks
  for each row execute function public.set_finance_close_tasks_updated_at();

alter table public.finance_close_tasks enable row level security;

drop policy if exists "Finance users manage close tasks" on public.finance_close_tasks;
create policy "Finance users manage close tasks"
  on public.finance_close_tasks for all
  using (public.is_active_sales_user() and public.user_has_portal('accounting-finance'))
  with check (public.is_active_sales_user() and public.user_has_portal('accounting-finance'));

-- ---------------------------------------------------------------------------
-- Helpers: period keys / due dates
-- ---------------------------------------------------------------------------
create or replace function public.finance_close_default_due(
  p_period_type text,
  p_period_key text
)
returns date
language plpgsql
immutable
as $$
declare
  y int;
  m int;
begin
  if p_period_type = 'month' then
    y := split_part(p_period_key, '-', 1)::int;
    m := split_part(p_period_key, '-', 2)::int;
    -- Soft close due: 5th of following month
    return (make_date(y, m, 1) + interval '1 month' + interval '4 days')::date;
  elsif p_period_type = 'year' then
    y := p_period_key::int;
    -- Year-end pack due end of January following
    return make_date(y + 1, 1, 31);
  end if;
  return null;
end;
$$;

create or replace function public.finance_close_next_period_key(
  p_period_type text,
  p_period_key text
)
returns text
language plpgsql
immutable
as $$
declare
  y int;
  m int;
begin
  if p_period_type = 'month' then
    y := split_part(p_period_key, '-', 1)::int;
    m := split_part(p_period_key, '-', 2)::int;
    if m = 12 then
      return (y + 1)::text || '-01';
    end if;
    return y::text || '-' || lpad((m + 1)::text, 2, '0');
  elsif p_period_type = 'year' then
    return (p_period_key::int + 1)::text;
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- Provision one period + seed checklist items from templates
-- ---------------------------------------------------------------------------
create or replace function public.provision_finance_close_period(
  p_entity_id uuid,
  p_period_type text,
  p_period_key text,
  p_status text default 'open'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_period_id uuid;
  v_due date;
  v_is_parent boolean;
begin
  if p_period_type not in ('month', 'year') then
    raise exception 'period_type must be month or year';
  end if;
  if p_status not in ('open', 'in_progress', 'closed') then
    raise exception 'invalid status';
  end if;

  v_due := public.finance_close_default_due(p_period_type, p_period_key);
  v_is_parent := p_entity_id is null;

  select id into v_period_id
  from public.finance_close_periods
  where period_type = p_period_type
    and period_key = p_period_key
    and coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid)
      = coalesce(p_entity_id, '00000000-0000-0000-0000-000000000000'::uuid);

  if v_period_id is null then
    insert into public.finance_close_periods (
      entity_id, period_type, period_key, status, due_at, notes
    ) values (
      p_entity_id,
      p_period_type,
      p_period_key,
      p_status,
      v_due,
      'Auto-provisioned close period'
    )
    returning id into v_period_id;
  end if;

  insert into public.finance_close_items (
    period_id, item_key, title, description, area, sort_order,
    evidence_expectation, source_control_key, owner_role, status, due_at
  )
  select
    v_period_id,
    t.item_key,
    t.title,
    t.description,
    t.area,
    t.sort_order,
    t.evidence_expectation,
    t.source_control_key,
    t.owner_role,
    'open',
    v_due
  from public.finance_close_item_templates t
  where t.period_type in (p_period_type, 'both')
    and (
      (v_is_parent and t.applies_to_parent)
      or (not v_is_parent and t.applies_to_entities)
    )
    and not exists (
      select 1 from public.finance_close_items i
      where i.period_id = v_period_id and i.item_key = t.item_key
    );

  return v_period_id;
end;
$$;

-- Open (or create) a period — used by UI "Open period"
create or replace function public.open_finance_close_period(
  p_entity_id uuid,
  p_period_type text,
  p_period_key text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  v_id := public.provision_finance_close_period(p_entity_id, p_period_type, p_period_key, 'open');
  update public.finance_close_periods
  set status = case when status = 'closed' then 'open' else status end,
      closed_at = case when status = 'closed' then null else closed_at end,
      closed_by = case when status = 'closed' then null else closed_by end
  where id = v_id;
  return v_id;
end;
$$;

-- Mark period closed; auto-open next period for same entity/scope
create or replace function public.complete_finance_close_period(
  p_period_id uuid,
  p_closed_by uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.finance_close_periods%rowtype;
  next_key text;
  next_id uuid;
  open_incomplete integer;
begin
  select * into rec from public.finance_close_periods where id = p_period_id for update;
  if not found then
    raise exception 'close period not found';
  end if;

  select count(*) into open_incomplete
  from public.finance_close_items
  where period_id = p_period_id
    and status in ('open', 'in_progress', 'blocked');

  if open_incomplete > 0 then
    -- Allow close with incomplete if caller wants; flip status to closed anyway
    -- but keep items as-is so tasks can still track residual work.
    null;
  end if;

  update public.finance_close_periods
  set status = 'closed',
      closed_at = now(),
      closed_by = p_closed_by
  where id = p_period_id;

  -- Mark remaining open items NA only if they are still open with no evidence? leave as-is.

  next_key := public.finance_close_next_period_key(rec.period_type, rec.period_key);
  if next_key is not null then
    next_id := public.provision_finance_close_period(
      rec.entity_id, rec.period_type, next_key, 'open'
    );
  end if;

  return coalesce(next_id, p_period_id);
end;
$$;

-- Mark a close item done; close linked open tasks; bump period to in_progress
create or replace function public.mark_finance_close_item_done(
  p_item_id uuid,
  p_completed_by uuid default null
)
returns public.finance_close_items
language plpgsql
security definer
set search_path = public
as $$
declare
  rec public.finance_close_items%rowtype;
begin
  update public.finance_close_items
  set status = 'done',
      completed_at = coalesce(completed_at, current_date)
  where id = p_item_id
  returning * into rec;

  if not found then
    raise exception 'close item not found';
  end if;

  update public.finance_close_tasks
  set status = 'done'
  where item_id = p_item_id and status = 'open';

  update public.finance_close_periods
  set status = case when status = 'open' then 'in_progress' else status end
  where id = rec.period_id
    and status <> 'closed';

  -- Auto-close period when all checklist items are done/na
  if not exists (
    select 1 from public.finance_close_items
    where period_id = rec.period_id
      and status not in ('done', 'na')
  ) then
    perform public.complete_finance_close_period(rec.period_id, p_completed_by);
  end if;

  return rec;
end;
$$;

create or replace function public.create_finance_close_tasks_for_incomplete(
  p_created_by uuid default null,
  p_period_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.finance_close_tasks (item_id, title, status, due_at, notes, created_by)
  select
    i.id,
    'Close: ' || i.title,
    'open',
    i.due_at,
    coalesce(nullif(i.area, ''), 'Period Close')
      || ' · ' || coalesce(nullif(i.item_key, ''), 'item'),
    p_created_by
  from public.finance_close_items i
  join public.finance_close_periods p on p.id = i.period_id
  where p.status in ('open', 'in_progress')
    and (p_period_id is null or i.period_id = p_period_id)
    and i.status in ('open', 'in_progress', 'blocked')
    and not exists (
      select 1 from public.finance_close_tasks t
      where t.item_id = i.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

-- Seed current calendar year months + year for parent + each active entity
create or replace function public.ensure_finance_close_periods_for_year(
  p_year integer default extract(year from current_date)::integer
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  created integer := 0;
  m int;
  r record;
  pk text;
  before_id uuid;
begin
  -- Parent year
  select id into before_id
  from public.finance_close_periods
  where entity_id is null and period_type = 'year' and period_key = p_year::text;
  perform public.provision_finance_close_period(null, 'year', p_year::text, 'open');
  if before_id is null then created := created + 1; end if;

  for m in 1..12 loop
    pk := p_year::text || '-' || lpad(m::text, 2, '0');
    select id into before_id
    from public.finance_close_periods
    where entity_id is null and period_type = 'month' and period_key = pk;
    perform public.provision_finance_close_period(null, 'month', pk, 'open');
    if before_id is null then created := created + 1; end if;
  end loop;

  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    select id into before_id
    from public.finance_close_periods
    where entity_id = r.id and period_type = 'year' and period_key = p_year::text;
    perform public.provision_finance_close_period(r.id, 'year', p_year::text, 'open');
    if before_id is null then created := created + 1; end if;

    for m in 1..12 loop
      pk := p_year::text || '-' || lpad(m::text, 2, '0');
      select id into before_id
      from public.finance_close_periods
      where entity_id = r.id and period_type = 'month' and period_key = pk;
      perform public.provision_finance_close_period(r.id, 'month', pk, 'open');
      if before_id is null then created := created + 1; end if;
    end loop;
  end loop;

  -- Ensure next calendar month exists (helps roll-forward UX mid-year)
  pk := to_char(date_trunc('month', current_date) + interval '1 month', 'YYYY-MM');
  perform public.provision_finance_close_period(null, 'month', pk, 'open');
  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    perform public.provision_finance_close_period(r.id, 'month', pk, 'open');
  end loop;

  return created;
end;
$$;

-- Auto-provision close periods when a new entity becomes active
create or replace function public.trg_ops_entities_provision_finance_close()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from current_date)::integer;
  m int;
  pk text;
begin
  if new.status in ('active', 'forming', 'acquired') then
    perform public.provision_finance_close_period(new.id, 'year', y::text, 'open');
    for m in 1..12 loop
      pk := y::text || '-' || lpad(m::text, 2, '0');
      perform public.provision_finance_close_period(new.id, 'month', pk, 'open');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_finance_close on public.ops_entities;
create trigger ops_entities_provision_finance_close
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_finance_close();

create or replace function public.trg_ops_entities_provision_finance_close_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  y int := extract(year from current_date)::integer;
  m int;
  pk text;
begin
  if new.status is distinct from old.status
     and new.status in ('active', 'forming', 'acquired')
     and (old.status is null or old.status not in ('active', 'forming', 'acquired')) then
    perform public.provision_finance_close_period(new.id, 'year', y::text, 'open');
    for m in 1..12 loop
      pk := y::text || '-' || lpad(m::text, 2, '0');
      perform public.provision_finance_close_period(new.id, 'month', pk, 'open');
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_finance_close_on_status on public.ops_entities;
create trigger ops_entities_provision_finance_close_on_status
  after update of status on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_finance_close_on_status();

grant execute on function public.finance_close_default_due(text, text) to authenticated;
grant execute on function public.finance_close_next_period_key(text, text) to authenticated;
grant execute on function public.provision_finance_close_period(uuid, text, text, text) to authenticated;
grant execute on function public.open_finance_close_period(uuid, text, text) to authenticated;
grant execute on function public.complete_finance_close_period(uuid, uuid) to authenticated;
grant execute on function public.mark_finance_close_item_done(uuid, uuid) to authenticated;
grant execute on function public.create_finance_close_tasks_for_incomplete(uuid, uuid) to authenticated;
grant execute on function public.ensure_finance_close_periods_for_year(integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Seed close checklist templates
-- (standard close steps + finance audit areas; maps to control_keys where useful)
-- ---------------------------------------------------------------------------
insert into public.finance_close_item_templates (
  item_key, title, description, area, period_type, sort_order,
  evidence_expectation, source_control_key, owner_role, applies_to_parent, applies_to_entities
) values
-- Month-end (entity + parent)
('me-bank-recon','Reconcile bank & cash accounts','Clear bank feed exceptions; complete bank reconciliations for all accounts.','Banking','month',10,'Signed bank recon reports','acct-banking-reconciliations','Finance',true,true),
('me-bank-feed-health','Bank feed health check','Confirm feeds connected and uncleared exceptions reviewed.','Banking','month',15,'Bank feed status / exception list','rec-bank-feed-health','Finance',true,true),
('me-ar-aging','AR aging & collections cut-off','Review AR aging; resolve collections / credit memos; cutoff invoices vs receipts.','Accounts Receivable','month',20,'AR aging + collection notes','acct-ar-cycle','Finance',true,true),
('me-ap-aging','AP aging & payment cut-off','Review AP aging; confirm bills entered through period-end; payment run cut-off.','Accounts Payable','month',30,'AP aging + cut-off note','acct-ap-cycle','Finance',true,true),
('me-accruals','Record month-end accruals','Accrue unpaid expenses, revenue cut-off, and other month-end accruals.','General Ledger','month',40,'Accrual JE support pack','acct-gl-journal-entries','Finance',true,true),
('me-prepaids','Amortize prepaids / deferrals','Post prepaid expense amortization and deferred revenue recognition for the month.','General Ledger','month',45,'Prepaid / deferred rollforward','acct-gl-journal-entries','Finance',true,true),
('me-payroll','Payroll postings & reconciliation','Confirm payroll integrated/posted; reconcile wages, tax, and benefits to GL.','Payroll','month',50,'Payroll recon worksheet','acct-payroll','Finance / HR',true,true),
('me-inventory','Inventory reconciliation (or N/A)','Reconcile inventory subledger / count; mark N/A when entity has no inventory.','Inventory','month',60,'Inventory recon or N/A note','acct-inventory','Finance',true,true),
('me-fixed-assets','Fixed asset additions & depreciation','Post asset additions/disposals and monthly depreciation where applicable.','Fixed Assets','month',70,'FA register delta / dep schedule','acct-fixed-assets','Finance',true,true),
('me-ic-transactions','Intercompany transactions reconciled','Confirm IC bills/invoices/JEs recorded; agree balances with counterpart entities.','Intercompany','month',80,'IC balance agree worksheet','ic-transactions','Finance',true,true),
('me-je-review','Journal entry review','Review non-standard JEs; confirm recurring templates posted.','General Ledger','month',90,'JE log / approval sample','acct-gl-journal-entries','Finance',true,true),
('me-trial-balance','Trial balance review','Review TB for suspense, unusual balances, and mapping issues.','Financial Reporting','month',100,'TB with review notes','acct-entity-financial-reporting','Finance',true,true),
('me-statements','Generate entity financial statements','Run and retain P&L, Balance Sheet, Cash Flow, and Trial Balance for the entity.','Financial Reporting','month',110,'P&L / BS / CF / TB pack','acct-entity-financial-reporting','Finance',true,true),
('me-tax-estimates','Monthly tax / sales-tax estimates','Update tax accruals / sales tax estimates; export support for CPA (not filings).','Tax Support','month',120,'Tax estimate worksheet','ctrl-tax-ready-reporting','Finance',true,true),
('me-working-capital','Working capital snapshot','Capture AR/AP days, cash, and inventory turns for the month.','Working Capital','month',130,'Working capital snapshot','fin-working-capital','Finance',true,true),
('me-kpis','Entity KPI dashboard refresh','Refresh entity KPIs (margin, AR/AP days, etc.) for close pack.','KPIs & Dashboards','month',140,'KPI export / dashboard screenshot','fin-kpis-entity','Finance',true,true),
('me-cash-forecast','Cash flow forecast update','Update short-term cash forecast from closed books.','Budgeting & Forecasting','month',150,'Updated cash forecast','fin-cash-flow-forecast','Finance',true,true),
('me-supporting-docs','Supporting documentation pack','Assemble aging reports, FA register, payroll recon into close binder.','Audit Prep','month',160,'Supporting docs pack','ctrl-entity-supporting-docs','Finance',true,true),
('me-recon-control','Bank / AR / AP recon control sign-off','Confirm monthly bank, AR, and AP reconciliations control complete.','Controls','month',170,'Recon control checklist','ctrl-monthly-recons','Finance',true,true),
('me-period-lock','Entity period close & lock','Complete entity close checklist and soft-lock the period in the Suite.','Period Close','month',200,'Close checklist sign-off','acct-period-close-entity','Finance',true,true),

-- Parent / group month-end
('me-elim-review','Review eliminations & ICJEs','Review automated eliminations and ICJEs before group close.','Audit Prep','month',210,'Elim / ICJE review note','consol-elim-icje-review','Finance',true,false),
('me-consol-run','Run consolidation','Aggregate entities and run group consolidation.','Consolidation','month',220,'Consolidation run log','consol-process','Finance',true,false),
('me-consol-statements','Consolidated financial statements','Generate consolidated P&L, BS, and Cash Flow.','Consolidation','month',230,'Consolidated statements pack','consol-statements','Finance',true,false),
('me-group-treasury','Group treasury / cash visibility','Refresh centralized cash visibility and document IC transfers.','Treasury','month',240,'Group cash dashboard','fin-group-treasury','Finance',true,false),
('me-group-kpis','Group KPI & contribution report','Refresh consolidated metrics and entity contribution.','KPIs & Dashboards','month',250,'Group KPI report','fin-group-kpis','Finance',true,false),

-- Year-end (entity + parent)
('ye-december-complete','Confirm December month-end closed','Ensure December entity month-end close is complete before year-end pack.','Period Close','year',10,'Dec close status / pack link','acct-period-close-entity','Finance',true,true),
('ye-bank-recon','Year-end bank reconciliations','Final bank reconciliations and outstanding item aging as of Dec 31.','Banking','year',20,'YE bank recon pack','acct-banking-reconciliations','Finance',true,true),
('ye-ar-ap-cutoff','AR/AP cut-off & confirmations','Verify AR/AP cut-off; retain confirmation samples as needed.','Accounts Receivable','year',30,'Cut-off memo + aging','acct-ar-cycle','Finance',true,true),
('ye-accrual-trueup','Accrual & deferral true-up','True-up accruals, prepaids, and deferred revenue for year-end.','General Ledger','year',40,'YE accrual true-up schedule','acct-gl-journal-entries','Finance',true,true),
('ye-inventory-count','Year-end inventory count (or N/A)','Perform / document physical inventory or cycle-count coverage; N/A if none.','Inventory','year',50,'Count sheets or N/A','acct-inventory','Finance',true,true),
('ye-fixed-assets','Fixed asset rollforward','Complete FA rollforward, depreciation, impairments, and disposals.','Fixed Assets','year',60,'FA rollforward','acct-fixed-assets','Finance',true,true),
('ye-payroll-trueup','Payroll & benefits year-end recon','Reconcile payroll, payroll tax, and benefits for the year.','Payroll','year',70,'YE payroll recon','acct-payroll','Finance / HR',true,true),
('ye-ic-loans','Intercompany loans & dividends','Reconcile IC loans, interest, and dividends for year-end.','Intercompany','year',80,'IC loan / dividend schedule','fin-intercompany-loans-dividends','Finance',true,true),
('ye-ic-balance-agree','Intercompany balance agree','Full IC receivable/payable agree across entities at year-end.','Intercompany','year',90,'IC agree worksheet','ic-transactions','Finance',true,true),
('ye-statements','Annual financial statement pack','Finalize entity annual P&L, BS, CF, and TB pack.','Financial Reporting','year',100,'Annual statements pack','acct-entity-financial-reporting','Finance',true,true),
('ye-tax-provision','Tax provision / estimates pack','Prepare tax-ready exports and estimate pack for CPA (no SoS filings).','Tax Support','year',110,'Tax provision / export pack','ctrl-tax-ready-reporting','Finance',true,true),
('ye-1099-exports','1099 / vendor tax exports','Export 1099-ready vendor reports from Suite for CPA prep.','Tax Support','year',120,'1099 export files','ctrl-tax-ready-reporting','Finance',true,true),
('ye-budget-next','Seed next-year entity budget','Load or refresh next-year operating/capital budget from closed books.','Budgeting & Forecasting','year',130,'Next-year budget draft','fin-budgeting-entity','Finance',true,true),
('ye-projections','Refresh 3–5 year projections','Update multi-year projections using year-end actuals.','Budgeting & Forecasting','year',140,'Updated projection model','fin-projections-3-5yr','Finance',true,true),
('ye-statutory','Statutory / entity audit readiness','Assemble entity statutory pack or document N/A.','Audit Prep','year',150,'Statutory pack or N/A','ctrl-statutory-entity-audit','Finance',true,true),
('ye-supporting-docs','Year-end supporting docs binder','Aging, FA, payroll, IC schedules assembled for audit/CPA.','Audit Prep','year',160,'YE supporting binder','ctrl-entity-supporting-docs','Finance',true,true),
('ye-period-lock','Hard close / period lock','Hard-close the fiscal year in Suite after pack sign-off.','Period Close','year',200,'YE close sign-off','acct-period-close-entity','Finance',true,true),

-- Parent / group year-end
('ye-consol','Year-end consolidation & eliminations','Run final consolidation; review all eliminations and NCI.','Consolidation','year',210,'YE consolidation log','consol-process','Finance',true,false),
('ye-consol-statements','Consolidated annual statements','Produce consolidated annual P&L, BS, CF for the group.','Consolidation','year',220,'Consolidated annual pack','consol-statements','Finance',true,false),
('ye-nci','NCI schedule (or N/A)','Finalize NCI schedule when partial ownership exists.','Consolidation','year',230,'NCI schedule or N/A','consol-nci','Finance',true,false),
('ye-group-audit','Group audit prep binder','Consolidated reports + elimination trails ready for auditors.','Audit Prep','year',240,'Group audit binder','ctrl-group-audit-prep','Finance',true,false),
('ye-capital','Capital structure / funding review','Document year-end capital structure and funding allocations.','Treasury','year',250,'Capital schedule','fin-capital-allocation','Finance',true,false),
('ye-consol-budget','Consolidated next-year budget','Roll entity budgets into group view for next year.','Budgeting & Forecasting','year',260,'Consolidated budget pack','fin-consol-budgeting','Finance',true,false)
on conflict (item_key) do update set
  title = excluded.title,
  description = excluded.description,
  area = excluded.area,
  period_type = excluded.period_type,
  sort_order = excluded.sort_order,
  evidence_expectation = excluded.evidence_expectation,
  source_control_key = excluded.source_control_key,
  owner_role = excluded.owner_role,
  applies_to_parent = excluded.applies_to_parent,
  applies_to_entities = excluded.applies_to_entities,
  updated_at = now();

-- Provision current calendar year for parent + entities
select public.ensure_finance_close_periods_for_year(extract(year from current_date)::integer);

comment on table public.finance_close_periods is
  'Month-end (YYYY-MM) or year-end (YYYY) close period per parent (entity_id null) or subsidiary.';
comment on table public.finance_close_items is
  'Checklist instance rows for a close period; evidence + status mirror finance audit patterns.';
comment on table public.finance_close_item_templates is
  'Durable catalog seeding month/year close checklists from standard steps + finance audit areas.';
