-- Portfolio entity shell: Leadership strategy/goals, Think Tank journals,
-- entity KPIs, financial snapshot stubs, and default KPI provisioning.
-- Run after 0041_mail_signatures.sql.
--
-- Owner oversight of Think Tank journals is intentionally server-side only
-- (OWNER_OVERSIGHT_EMAIL edge secret). Do not surface "forwarded to owner" in UI.

-- ---------------------------------------------------------------------------
-- Seed Tage VC as portfolio parent entity (idempotent)
-- ---------------------------------------------------------------------------
do $$
declare
  v_entity_id uuid;
begin
  select id into v_entity_id
  from public.ops_entities
  where slug = 'tage-vc'
  limit 1;

  if v_entity_id is null then
    select id into v_entity_id
    from public.ops_entities
    where lower(name) in ('tage vc', 'tage venture capital')
    limit 1;
  end if;

  if v_entity_id is null then
    insert into public.ops_entities (
      name, slug, entity_type, status, website_url, notes
    ) values (
      'Tage VC',
      'tage-vc',
      'operate',
      'active',
      'https://tagevc.com',
      'Parent / studio entity — portfolio oversight.'
    )
    returning id into v_entity_id;
  else
    update public.ops_entities
    set
      name = 'Tage VC',
      slug = 'tage-vc',
      website_url = case
        when coalesce(website_url, '') = '' then 'https://tagevc.com'
        else website_url
      end,
      updated_at = now()
    where id = v_entity_id;
  end if;

  insert into public.ops_folders (entity_id, name, sort_order)
  select v_entity_id, df.name, df.sort_order
  from public.ops_default_folders df
  where not exists (
    select 1 from public.ops_folders f
    where f.entity_id = v_entity_id and f.name = df.name
  );
end $$;

-- Normalize Instant NDA naming (fix Instantnda / Instanda typos if any)
update public.ops_entities
set name = 'Instant NDA', updated_at = now()
where slug = 'instant-nda'
  and name is distinct from 'Instant NDA';

-- ---------------------------------------------------------------------------
-- Leadership: strategy + goals (one row per entity)
-- ---------------------------------------------------------------------------
create table if not exists public.entity_leadership (
  entity_id     uuid primary key references public.ops_entities (id) on delete cascade,
  strategy_md   text not null default '',
  goals_md      text not null default '',
  updated_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create or replace function public.set_entity_leadership_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists entity_leadership_updated_at on public.entity_leadership;
create trigger entity_leadership_updated_at
  before update on public.entity_leadership
  for each row execute function public.set_entity_leadership_updated_at();

alter table public.entity_leadership enable row level security;

drop policy if exists "Entity users manage leadership" on public.entity_leadership;
create policy "Entity users manage leadership"
  on public.entity_leadership for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

-- ---------------------------------------------------------------------------
-- Think Tank: conversations + messages (COO journal + Grok coach)
-- ---------------------------------------------------------------------------
create table if not exists public.think_tank_conversations (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  user_id       uuid not null references public.sales_users (id) on delete cascade,
  title         text not null default 'Journal',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entity_id, user_id)
);

create index if not exists think_tank_conversations_entity_idx
  on public.think_tank_conversations (entity_id);

create table if not exists public.think_tank_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.think_tank_conversations (id) on delete cascade,
  role             text not null check (role in ('user', 'assistant', 'system')),
  content          text not null,
  model            text,
  created_at       timestamptz not null default now()
);

create index if not exists think_tank_messages_conversation_idx
  on public.think_tank_messages (conversation_id, created_at);

create or replace function public.set_think_tank_conversation_updated_at()
returns trigger
language plpgsql
as $$
begin
  update public.think_tank_conversations
  set updated_at = now()
  where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists think_tank_messages_touch_conversation on public.think_tank_messages;
create trigger think_tank_messages_touch_conversation
  after insert on public.think_tank_messages
  for each row execute function public.set_think_tank_conversation_updated_at();

alter table public.think_tank_conversations enable row level security;
alter table public.think_tank_messages enable row level security;

drop policy if exists "Entity users manage think tank conversations" on public.think_tank_conversations;
create policy "Entity users manage think tank conversations"
  on public.think_tank_conversations for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Entity users manage think tank messages" on public.think_tank_messages;
create policy "Entity users manage think tank messages"
  on public.think_tank_messages for all
  using (
    public.is_active_sales_user()
    and exists (
      select 1 from public.think_tank_conversations c
      where c.id = conversation_id
        and public.user_has_entity(c.entity_id)
    )
  )
  with check (
    public.is_active_sales_user()
    and exists (
      select 1 from public.think_tank_conversations c
      where c.id = conversation_id
        and public.user_has_entity(c.entity_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Entity KPIs (definitions + period values)
-- ---------------------------------------------------------------------------
create table if not exists public.entity_kpis (
  id            uuid primary key default gen_random_uuid(),
  entity_id     uuid not null references public.ops_entities (id) on delete cascade,
  key           text not null,
  label         text not null,
  description   text not null default '',
  unit          text not null default '',
  target_value  numeric,
  sort_order    int not null default 0,
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (entity_id, key)
);

create index if not exists entity_kpis_entity_idx
  on public.entity_kpis (entity_id, sort_order);

create table if not exists public.entity_kpi_values (
  id            uuid primary key default gen_random_uuid(),
  kpi_id        uuid not null references public.entity_kpis (id) on delete cascade,
  period_key    text not null, -- e.g. 2026-07, 2026-Q2, 2026-YTD
  period_label  text not null default '',
  value         numeric,
  notes         text not null default '',
  recorded_at   timestamptz not null default now(),
  recorded_by   uuid references public.sales_users (id) on delete set null,
  unique (kpi_id, period_key)
);

create index if not exists entity_kpi_values_kpi_idx
  on public.entity_kpi_values (kpi_id);

alter table public.entity_kpis enable row level security;
alter table public.entity_kpi_values enable row level security;

drop policy if exists "Entity users manage entity kpis" on public.entity_kpis;
create policy "Entity users manage entity kpis"
  on public.entity_kpis for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

drop policy if exists "Entity users manage entity kpi values" on public.entity_kpi_values;
create policy "Entity users manage entity kpi values"
  on public.entity_kpi_values for all
  using (
    public.is_active_sales_user()
    and exists (
      select 1 from public.entity_kpis k
      where k.id = kpi_id and public.user_has_entity(k.entity_id)
    )
  )
  with check (
    public.is_active_sales_user()
    and exists (
      select 1 from public.entity_kpis k
      where k.id = kpi_id and public.user_has_entity(k.entity_id)
    )
  );

-- ---------------------------------------------------------------------------
-- Financial snapshots (stub until entity reporting sync)
-- ---------------------------------------------------------------------------
create table if not exists public.entity_financial_snapshots (
  id              uuid primary key default gen_random_uuid(),
  entity_id       uuid not null references public.ops_entities (id) on delete cascade,
  period_type     text not null check (period_type in (
    'mtd', 'month', 'quarter', 'ytd', 'mom', 'qoq', 'yoy',
    'rolling_90', 'rolling_180', 'rolling_365'
  )),
  period_key      text not null,
  period_label    text not null default '',
  revenue         numeric,
  cogs            numeric,
  opex            numeric,
  net_income      numeric,
  cash            numeric,
  currency        text not null default 'USD',
  source          text not null default 'manual', -- manual | sync_hook | stub
  notes           text not null default '',
  synced_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (entity_id, period_type, period_key)
);

create index if not exists entity_financial_snapshots_entity_idx
  on public.entity_financial_snapshots (entity_id, period_type, period_key);

alter table public.entity_financial_snapshots enable row level security;

drop policy if exists "Entity users manage financial snapshots" on public.entity_financial_snapshots;
create policy "Entity users manage financial snapshots"
  on public.entity_financial_snapshots for all
  using (public.is_active_sales_user() and public.user_has_entity(entity_id))
  with check (public.is_active_sales_user() and public.user_has_entity(entity_id));

-- ---------------------------------------------------------------------------
-- Default KPI catalog by entity slug (+ generic fallback)
-- ---------------------------------------------------------------------------
create table if not exists public.entity_kpi_templates (
  id            uuid primary key default gen_random_uuid(),
  -- '_default' = apply to any new entity without a matching slug catalog
  entity_slug   text not null default '_default',
  key           text not null,
  label         text not null,
  description   text not null default '',
  unit          text not null default '',
  target_value  numeric,
  sort_order    int not null default 0,
  unique (entity_slug, key)
);

insert into public.entity_kpi_templates (entity_slug, key, label, description, unit, target_value, sort_order)
values
  -- Recruit 619
  ('recruit-619', 'send_outs_month', 'Send outs / month', 'Primary recruiter throughput.', 'count', 80, 10),
  ('recruit-619', 'placements_month', 'Placements / month', 'Closed placements.', 'count', 8, 20),
  ('recruit-619', 'send_outs_per_placement', 'Send outs per placement', 'Efficiency of send outs.', 'ratio', 10, 30),
  ('recruit-619', 'revenue_month', 'Revenue / month', 'Billing / fee revenue.', 'USD', null, 40),
  -- Signent HR
  ('signent-hr', 'clients_active', 'Active clients', 'Paying HR clients.', 'count', null, 10),
  ('signent-hr', 'onboards_month', 'Onboards / month', 'Employees onboarded via Signent.', 'count', null, 20),
  ('signent-hr', 'nps', 'Client NPS', 'Net promoter score.', 'score', 50, 30),
  ('signent-hr', 'revenue_month', 'Revenue / month', 'MRR / project revenue.', 'USD', null, 40),
  -- Instant NDA
  ('instant-nda', 'ndas_signed_month', 'NDAs signed / month', 'Completed signing sessions.', 'count', null, 10),
  ('instant-nda', 'orgs_active', 'Active orgs', 'Organizations with billing.', 'count', null, 20),
  ('instant-nda', 'mrr', 'MRR', 'Monthly recurring revenue.', 'USD', null, 30),
  ('instant-nda', 'conversion_rate', 'Trial → paid conversion', 'Sales funnel conversion.', '%', null, 40),
  -- Tage VC
  ('tage-vc', 'deals_open', 'Open deals', 'Active deal-sourcing pipeline.', 'count', null, 10),
  ('tage-vc', 'closed_won_ytd', 'Closed won YTD', 'Wins year to date.', 'count', null, 20),
  ('tage-vc', 'portfolio_revenue', 'Portfolio revenue rollup', 'Combined subsidiary revenue.', 'USD', null, 30),
  ('tage-vc', 'new_entities_ytd', 'New entities YTD', 'Portfolio companies added.', 'count', null, 40),
  -- Generic for newly created subsidiaries
  ('_default', 'revenue_month', 'Revenue / month', 'Top-line for the period.', 'USD', null, 10),
  ('_default', 'gross_margin_pct', 'Gross margin %', 'Gross profit / revenue.', '%', null, 20),
  ('_default', 'opex_month', 'OpEx / month', 'Operating expenses.', 'USD', null, 30),
  ('_default', 'headcount', 'Headcount', 'FTEs.', 'count', null, 40)
on conflict (entity_slug, key) do nothing;

alter table public.entity_kpi_templates enable row level security;

drop policy if exists "Sales users read kpi templates" on public.entity_kpi_templates;
create policy "Sales users read kpi templates"
  on public.entity_kpi_templates for select
  using (public.is_active_sales_user());

-- ---------------------------------------------------------------------------
-- Provision leadership row + default KPIs for an entity
-- ---------------------------------------------------------------------------
create or replace function public.provision_portfolio_entity_shell(p_entity_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slug text;
begin
  select slug into v_slug from public.ops_entities where id = p_entity_id;
  if v_slug is null and not exists (select 1 from public.ops_entities where id = p_entity_id) then
    return;
  end if;

  insert into public.entity_leadership (entity_id)
  values (p_entity_id)
  on conflict (entity_id) do nothing;

  -- Slug-specific templates first; if none match, use _default catalog
  if v_slug is not null
     and exists (select 1 from public.entity_kpi_templates where entity_slug = v_slug) then
    insert into public.entity_kpis (
      entity_id, key, label, description, unit, target_value, sort_order
    )
    select
      p_entity_id, t.key, t.label, t.description, t.unit, t.target_value, t.sort_order
    from public.entity_kpi_templates t
    where t.entity_slug = v_slug
    on conflict (entity_id, key) do nothing;
  else
    insert into public.entity_kpis (
      entity_id, key, label, description, unit, target_value, sort_order
    )
    select
      p_entity_id, t.key, t.label, t.description, t.unit, t.target_value, t.sort_order
    from public.entity_kpi_templates t
    where t.entity_slug = '_default'
    on conflict (entity_id, key) do nothing;
  end if;
end;
$$;

create or replace function public.trg_ops_entities_provision_portfolio_shell()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.provision_portfolio_entity_shell(new.id);
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_portfolio_shell on public.ops_entities;
create trigger ops_entities_provision_portfolio_shell
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_portfolio_shell();

-- Backfill existing portfolio entities
do $$
declare
  r record;
begin
  for r in select id from public.ops_entities loop
    perform public.provision_portfolio_entity_shell(r.id);
  end loop;
end $$;

comment on table public.entity_leadership is
  'Per-entity strategy and goals for Manage Portfolio Leadership tab.';
comment on table public.think_tank_conversations is
  'COO Think Tank journal threads (one per user per entity). Owner oversight emails are server-side only.';
comment on table public.entity_financial_snapshots is
  'Entity financial period snapshots. source=stub until reporting sync hooks land.';
comment on function public.provision_portfolio_entity_shell(uuid) is
  'Ensures Leadership row + default KPIs when a portfolio entity is created (deal close / new entity).';
