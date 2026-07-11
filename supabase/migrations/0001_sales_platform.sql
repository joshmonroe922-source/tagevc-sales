-- Tage VC Sales Platform v1
-- Pipeline, tasks, drips, activity. Designed for single-admin now; multi-rep later.

-- ---------------------------------------------------------------------------
-- sales_users — allowlist matched by auth email on login
-- ---------------------------------------------------------------------------
create table if not exists public.sales_users (
  id                uuid primary key default gen_random_uuid(),
  email             text not null unique,
  full_name         text,
  role              text not null default 'rep'
                      check (role in ('rep', 'manager', 'admin')),
  active            boolean not null default true,
  manager_id        uuid references public.sales_users (id) on delete set null,
  is_house_account  boolean not null default false,
  created_at        timestamptz not null default now()
);

create index if not exists sales_users_email_lower_idx
  on public.sales_users (lower(email));

create unique index if not exists sales_users_one_house_account_idx
  on public.sales_users (is_house_account)
  where is_house_account = true;

alter table public.sales_users enable row level security;

-- ---------------------------------------------------------------------------
-- sales_settings — singleton toggles + assignment cursor
-- ---------------------------------------------------------------------------
create table if not exists public.sales_settings (
  id                    uuid primary key
                          default '00000000-0000-4000-8000-000000000001'::uuid,
  last_assigned_rep_id  uuid references public.sales_users (id) on delete set null,
  automation_owner_id   uuid references public.sales_users (id) on delete set null,
  auto_emails_enabled   boolean not null default true,
  auto_tasks_enabled    boolean not null default true,
  drips_enabled         boolean not null default true,
  intake_alert_email    text not null default 'josh@tagevc.com',
  updated_at            timestamptz not null default now()
);

insert into public.sales_settings (id)
values ('00000000-0000-4000-8000-000000000001'::uuid)
on conflict (id) do nothing;

alter table public.sales_settings enable row level security;

-- ---------------------------------------------------------------------------
-- sales_leads — VC deal pipeline
-- ---------------------------------------------------------------------------
create table if not exists public.sales_leads (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  email           text not null default '',
  phone           text not null default '',
  company         text not null default '',
  deal_path       text not null default 'launch'
                    check (deal_path in ('launch', 'partner', 'exit')),
  source          text not null default 'manual'
                    check (source in ('website_form', 'manual', 'referral')),
  stage           text not null default 'new'
                    check (stage in (
                      'new', 'qualified', 'call_booked', 'diligence',
                      'term_sheet', 'closed_won', 'closed_lost', 'passed'
                    )),
  notes           text not null default '',
  assigned_rep_id uuid references public.sales_users (id) on delete set null,
  next_action_at  timestamptz,
  closed_at       timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists sales_leads_stage_idx on public.sales_leads (stage);
create index if not exists sales_leads_deal_path_idx on public.sales_leads (deal_path);
create index if not exists sales_leads_created_at_idx on public.sales_leads (created_at desc);
create index if not exists sales_leads_assigned_rep_idx on public.sales_leads (assigned_rep_id);
create index if not exists sales_leads_next_action_idx on public.sales_leads (next_action_at);

alter table public.sales_leads enable row level security;

-- ---------------------------------------------------------------------------
-- sales_tasks
-- ---------------------------------------------------------------------------
create table if not exists public.sales_tasks (
  id              uuid primary key default gen_random_uuid(),
  sales_user_id   uuid not null references public.sales_users (id) on delete cascade,
  lead_id         uuid references public.sales_leads (id) on delete cascade,
  title           text not null,
  notes           text not null default '',
  due_at          timestamptz,
  status          text not null default 'open'
                    check (status in ('open', 'done')),
  created_at      timestamptz not null default now(),
  completed_at    timestamptz
);

create index if not exists sales_tasks_user_status_idx
  on public.sales_tasks (sales_user_id, status, due_at);
create index if not exists sales_tasks_lead_idx
  on public.sales_tasks (lead_id);

alter table public.sales_tasks enable row level security;

-- ---------------------------------------------------------------------------
-- sales_lead_activities
-- ---------------------------------------------------------------------------
create table if not exists public.sales_lead_activities (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.sales_leads (id) on delete cascade,
  activity_type text not null
                  check (activity_type in (
                    'email_sent', 'email_queued', 'task_created', 'task_cleared',
                    'drip_enrolled', 'drip_step_sent', 'drip_completed', 'drip_cancelled',
                    'note', 'stage_change', 'system', 'intake'
                  )),
  summary       text not null default '',
  metadata      jsonb not null default '{}'::jsonb,
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists sales_lead_activities_lead_idx
  on public.sales_lead_activities (lead_id, created_at desc);

alter table public.sales_lead_activities enable row level security;

-- ---------------------------------------------------------------------------
-- Drip sequences / steps / enrollments
-- ---------------------------------------------------------------------------
create table if not exists public.sales_drip_sequences (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  name        text not null,
  description text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.sales_drip_steps (
  id            uuid primary key default gen_random_uuid(),
  sequence_id   uuid not null references public.sales_drip_sequences (id) on delete cascade,
  step_order    int not null check (step_order >= 0),
  delay_days    int not null default 0 check (delay_days >= 0),
  action_type   text not null default 'internal_reminder'
                  check (action_type in ('internal_reminder', 'create_task', 'email_lead')),
  subject       text not null,
  body_html     text not null default '',
  created_at    timestamptz not null default now(),
  unique (sequence_id, step_order)
);

create table if not exists public.sales_drip_enrollments (
  id              uuid primary key default gen_random_uuid(),
  sequence_id     uuid not null references public.sales_drip_sequences (id) on delete cascade,
  lead_id         uuid not null references public.sales_leads (id) on delete cascade,
  owner_id        uuid references public.sales_users (id) on delete set null,
  status          text not null default 'active'
                    check (status in ('active', 'completed', 'cancelled', 'paused')),
  current_step    int not null default 0,
  enrolled_at     timestamptz not null default now(),
  next_send_at    timestamptz,
  last_sent_at    timestamptz,
  completed_at    timestamptz,
  unique (sequence_id, lead_id)
);

create index if not exists sales_drip_enrollments_due_idx
  on public.sales_drip_enrollments (status, next_send_at)
  where status = 'active';

alter table public.sales_drip_sequences enable row level security;
alter table public.sales_drip_steps enable row level security;
alter table public.sales_drip_enrollments enable row level security;

-- ---------------------------------------------------------------------------
-- Auth helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_active_sales_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.sales_users su
    where lower(su.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
      and su.active = true
  );
$$;

create or replace function public.current_sales_user_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select su.id
  from public.sales_users su
  where lower(su.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and su.active = true
  limit 1;
$$;

create or replace function public.sales_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select su.role
  from public.sales_users su
  where lower(su.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    and su.active = true
  limit 1;
$$;

-- Assign inbound leads: prefer active reps (non-house), else admin/manager
create or replace function public.assign_lead_round_robin()
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settings_id constant uuid := '00000000-0000-4000-8000-000000000001'::uuid;
  v_last_rep      uuid;
  v_reps          uuid[];
  v_count         int;
  v_last_idx      int;
  v_next_rep      uuid;
begin
  select coalesce(array_agg(id order by created_at, id), '{}')
  into v_reps
  from public.sales_users
  where active = true
    and role = 'rep'
    and coalesce(is_house_account, false) = false;

  v_count := coalesce(array_length(v_reps, 1), 0);

  if v_count = 0 then
    select id into v_next_rep
    from public.sales_users
    where active = true
      and role in ('admin', 'manager')
    order by
      case role when 'admin' then 0 when 'manager' then 1 else 2 end,
      created_at,
      id
    limit 1;

    if v_next_rep is not null then
      update public.sales_settings
      set last_assigned_rep_id = v_next_rep,
          updated_at = now()
      where id = v_settings_id;
    end if;

    return v_next_rep;
  end if;

  select last_assigned_rep_id into v_last_rep
  from public.sales_settings
  where id = v_settings_id;

  if v_last_rep is null then
    v_next_rep := v_reps[1];
  else
    v_last_idx := array_position(v_reps, v_last_rep);
    if v_last_idx is null or v_last_idx >= v_count then
      v_next_rep := v_reps[1];
    else
      v_next_rep := v_reps[v_last_idx + 1];
    end if;
  end if;

  update public.sales_settings
  set last_assigned_rep_id = v_next_rep,
      updated_at = now()
  where id = v_settings_id;

  return v_next_rep;
end;
$$;

create or replace function public.set_sales_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  if new.stage in ('closed_won', 'closed_lost', 'passed')
     and (old.stage is distinct from new.stage) then
    new.closed_at = coalesce(new.closed_at, now());
  end if;
  if new.stage not in ('closed_won', 'closed_lost', 'passed') then
    new.closed_at = null;
  end if;
  return new;
end;
$$;

drop trigger if exists sales_leads_updated_at on public.sales_leads;
create trigger sales_leads_updated_at
  before update on public.sales_leads
  for each row execute function public.set_sales_leads_updated_at();

-- ---------------------------------------------------------------------------
-- RLS policies (v1: all active sales users see everything; tighten later for multi-rep)
-- ---------------------------------------------------------------------------
create policy "Sales users view own row"
  on public.sales_users for select
  using (
    public.is_active_sales_user()
    or lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

create policy "Admins manage sales users"
  on public.sales_users for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view settings"
  on public.sales_settings for select
  using (public.is_active_sales_user());

create policy "Admins update settings"
  on public.sales_settings for update
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view leads"
  on public.sales_leads for select
  using (public.is_active_sales_user());

create policy "Sales users insert leads"
  on public.sales_leads for insert
  with check (public.is_active_sales_user());

create policy "Sales users update leads"
  on public.sales_leads for update
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users delete leads"
  on public.sales_leads for delete
  using (public.is_active_sales_user() and public.sales_user_role() in ('admin', 'manager'));

create policy "Sales users view tasks"
  on public.sales_tasks for select
  using (public.is_active_sales_user());

create policy "Sales users insert tasks"
  on public.sales_tasks for insert
  with check (public.is_active_sales_user());

create policy "Sales users update tasks"
  on public.sales_tasks for update
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

create policy "Sales users delete tasks"
  on public.sales_tasks for delete
  using (public.is_active_sales_user());

create policy "Sales users view activities"
  on public.sales_lead_activities for select
  using (public.is_active_sales_user());

create policy "Sales users insert activities"
  on public.sales_lead_activities for insert
  with check (public.is_active_sales_user());

create policy "Sales users view drip sequences"
  on public.sales_drip_sequences for select
  using (public.is_active_sales_user());

create policy "Admins manage drip sequences"
  on public.sales_drip_sequences for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view drip steps"
  on public.sales_drip_steps for select
  using (public.is_active_sales_user());

create policy "Admins manage drip steps"
  on public.sales_drip_steps for all
  using (public.is_active_sales_user() and public.sales_user_role() = 'admin')
  with check (public.is_active_sales_user() and public.sales_user_role() = 'admin');

create policy "Sales users view drip enrollments"
  on public.sales_drip_enrollments for select
  using (public.is_active_sales_user());

create policy "Sales users manage drip enrollments"
  on public.sales_drip_enrollments for all
  using (public.is_active_sales_user())
  with check (public.is_active_sales_user());

-- ---------------------------------------------------------------------------
-- Seed: Josh Monroe admin + house account + new-lead drip
-- ---------------------------------------------------------------------------
insert into public.sales_users (email, full_name, role, active)
values ('josh@tagevc.com', 'Josh Monroe', 'admin', true)
on conflict (email) do update
  set full_name = excluded.full_name,
      role = 'admin',
      active = true;

insert into public.sales_users (email, full_name, role, active, is_house_account)
values ('house@tagevc.com', 'House Account', 'rep', true, true)
on conflict (email) do update
  set full_name = excluded.full_name,
      is_house_account = true,
      active = true,
      role = 'rep';

update public.sales_settings
set automation_owner_id = (
      select id from public.sales_users where is_house_account = true limit 1
    ),
    intake_alert_email = 'josh@tagevc.com',
    updated_at = now()
where id = '00000000-0000-4000-8000-000000000001'::uuid;

insert into public.sales_drip_sequences (slug, name, description, active)
values (
  'new-lead-nurture',
  'New lead nurture',
  'Day 0 internal thank-you reminder, Day 2 follow-up task, Day 7 nurture reminder for Tage VC inbound leads.',
  true
)
on conflict (slug) do update
set name = excluded.name,
    description = excluded.description,
    active = true;

do $$
declare
  v_seq uuid;
begin
  select id into v_seq from public.sales_drip_sequences where slug = 'new-lead-nurture';
  delete from public.sales_drip_steps where sequence_id = v_seq;

  insert into public.sales_drip_steps (sequence_id, step_order, delay_days, action_type, subject, body_html)
  values
    (
      v_seq, 0, 0,
      'internal_reminder',
      'New lead: {{name}} at {{company}}',
      '<p>New inbound lead for <strong>{{deal_path}}</strong>.</p><p><strong>{{name}}</strong> ({{email}}) — {{company}}</p><p>Stage: New. Review and qualify within 1 business day.</p>'
    ),
    (
      v_seq, 1, 2,
      'create_task',
      'Follow up with {{name}}',
      'Call or email {{name}} at {{company}} about {{deal_path}}. Confirm fit and next step.'
    ),
    (
      v_seq, 2, 7,
      'internal_reminder',
      'Nurture check: {{name}} / {{company}}',
      '<p>Day-7 nurture reminder for <strong>{{name}}</strong> at {{company}} ({{deal_path}}).</p><p>If still open, send a soft follow-up or move stage.</p>'
    );
end $$;
