-- Multi-subsidiary readiness P1: Entity registry + policy spine.
-- Canonical codes, aliases (ENT-002 → ENT-INDA), directory/messaging/ticket policy.
-- Apply after Phase 54. Safe to re-run. Additive only.
-- Never auto-approves money. Never mutates snapshot retirement tables.
-- Dual-approve gates remain untouched.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

create or replace function public.os_sha256_hex(p_input text)
returns text
language sql
immutable
parallel safe
set search_path = public, extensions
as $$
  select encode(digest(convert_to(coalesce(p_input, ''), 'UTF8'), 'sha256'), 'hex');
$$;

create or replace function public.phase_ms_p1_safe_detail(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select
    p_detail is null
    or (
      jsonb_typeof(p_detail)='object'
      and pg_column_size(p_detail)<=8192
      and p_detail::text !~*
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64|webhook_url)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
    );
$$;

-- ---------------------------------------------------------------------------
-- Canonical subsidiary / entity registry (policy spine).
-- ---------------------------------------------------------------------------
create table if not exists public.os_entity_registry (
  entity_code text primary key
    check (entity_code ~ '^ENT-[A-Z0-9-]{1,32}$'),
  canonical_name text not null,
  status text not null default 'Active'
    check (status in ('Active','Inactive','Pending')),
  portal_url text,
  portal_url_todo text,
  default_roles jsonb not null default '[]'::jsonb,
  parent_entity_code text
    check (parent_entity_code is null or parent_entity_code ~ '^ENT-[A-Z0-9-]{1,32}$'),
  is_subsidiary boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_entity_registry_roles_check
    check (
      jsonb_typeof(default_roles)='array'
      and pg_column_size(default_roles)<=2048
    ),
  constraint os_entity_registry_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase_ms_p1_safe_detail(detail)
    ),
  constraint os_entity_registry_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_entity_registry_status_idx
  on public.os_entity_registry(status);

alter table public.os_entity_registry enable row level security;
drop policy if exists "os_entity_registry_select" on public.os_entity_registry;
create policy "os_entity_registry_select"
  on public.os_entity_registry for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_code)
    or entity_code = 'ENT-FIRM'
  );
revoke all on public.os_entity_registry from public, anon, authenticated;
grant select on public.os_entity_registry to authenticated;

-- Legacy code aliases (ENT-002 Instant NDA → canonical ENT-INDA).
create table if not exists public.os_entity_aliases (
  alias_code text primary key
    check (alias_code ~ '^ENT-[A-Z0-9-]{1,32}$'),
  canonical_code text not null
    references public.os_entity_registry(entity_code) on delete cascade,
  reason text not null default 'legacy_code',
  created_at timestamptz not null default now(),
  constraint os_entity_aliases_no_self check (alias_code <> canonical_code)
);

alter table public.os_entity_aliases enable row level security;
drop policy if exists "os_entity_aliases_select" on public.os_entity_aliases;
create policy "os_entity_aliases_select"
  on public.os_entity_aliases for select to authenticated
  using (true);
revoke all on public.os_entity_aliases from public, anon, authenticated;
grant select on public.os_entity_aliases to authenticated;

-- Directory / messaging / ticket visibility policy (current row + append-only audit).
create table if not exists public.os_entity_policy (
  policy_key text primary key
    check (policy_key ~ '^[a-z][a-z0-9_]{2,63}$'),
  policy_version text not null default 'ms-p1-v1',
  directory_visibility text not null default 'home_plus_firm'
    check (directory_visibility in (
      'home_only','home_plus_firm','firm_wide','cross_entity_opt_in'
    )),
  cross_entity_messaging text not null default 'dm_opt_in_rooms_deny'
    check (cross_entity_messaging in (
      'deny','dm_opt_in_rooms_deny','opt_in','firm_wide_operators'
    )),
  ticket_visibility_default text not null default 'entity_scoped'
    check (ticket_visibility_default in (
      'entity_scoped','entity_plus_unscoped_soft','firm_wide'
    )),
  detail jsonb not null default '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint os_entity_policy_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase_ms_p1_safe_detail(detail)
    ),
  constraint os_entity_policy_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

alter table public.os_entity_policy enable row level security;
drop policy if exists "os_entity_policy_select" on public.os_entity_policy;
create policy "os_entity_policy_select"
  on public.os_entity_policy for select to authenticated
  using (public.is_firm_wide_access() or true);
revoke all on public.os_entity_policy from public, anon, authenticated;
grant select on public.os_entity_policy to authenticated;

create table if not exists public.os_entity_policy_audits (
  audit_id uuid primary key default gen_random_uuid(),
  policy_key text not null,
  change_kind text not null
    check (change_kind in ('seed','update','rollback_note')),
  before_detail jsonb not null default '{}'::jsonb,
  after_detail jsonb not null default '{}'::jsonb,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_entity_policy_audits_before_check
    check (
      jsonb_typeof(before_detail)='object'
      and public.phase_ms_p1_safe_detail(before_detail)
    ),
  constraint os_entity_policy_audits_after_check
    check (
      jsonb_typeof(after_detail)='object'
      and public.phase_ms_p1_safe_detail(after_detail)
    ),
  constraint os_entity_policy_audits_no_money_approve_check
    check (coalesce((after_detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_entity_policy_audits_created_idx
  on public.os_entity_policy_audits(created_at desc);

alter table public.os_entity_policy_audits enable row level security;
drop policy if exists "os_entity_policy_audits_select"
  on public.os_entity_policy_audits;
create policy "os_entity_policy_audits_select"
  on public.os_entity_policy_audits for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_entity_policy_audits from public, anon, authenticated;
grant select on public.os_entity_policy_audits to authenticated;

create or replace function public.reject_os_entity_policy_audit_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Entity policy audits are append-only';
end;
$$;

drop trigger if exists os_entity_policy_audits_immutable
  on public.os_entity_policy_audits;
create trigger os_entity_policy_audits_immutable
  before update or delete on public.os_entity_policy_audits
  for each row execute function public.reject_os_entity_policy_audit_mutation();
drop trigger if exists os_entity_policy_audits_no_truncate
  on public.os_entity_policy_audits;
create trigger os_entity_policy_audits_no_truncate
  before truncate on public.os_entity_policy_audits
  for each statement execute function public.reject_os_entity_policy_audit_mutation();

-- Resolve alias → canonical (ENT-002 → ENT-INDA). Unknown codes pass through.
create or replace function public.resolve_canonical_entity_id(p_entity_id text)
returns text
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_raw text := nullif(trim(p_entity_id), '');
  v_canon text;
begin
  if v_raw is null then
    return null;
  end if;
  select a.canonical_code into v_canon
  from public.os_entity_aliases a
  where a.alias_code = v_raw;
  if v_canon is not null then
    return v_canon;
  end if;
  if exists (
    select 1 from public.os_entity_registry r where r.entity_code = v_raw
  ) then
    return v_raw;
  end if;
  return v_raw;
end;
$$;

revoke all on function public.resolve_canonical_entity_id(text)
  from public, anon;
grant execute on function public.resolve_canonical_entity_id(text)
  to authenticated, service_role;

create or replace function public.entity_ids_equivalent(
  p_a text,
  p_b text
)
returns boolean
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    public.resolve_canonical_entity_id(p_a)
      is not distinct from public.resolve_canonical_entity_id(p_b);
$$;

revoke all on function public.entity_ids_equivalent(text, text)
  from public, anon;
grant execute on function public.entity_ids_equivalent(text, text)
  to authenticated, service_role;

-- Seed registry: ENT-FIRM, ENT-R619, ENT-INDA (+ alias ENT-002).
insert into public.os_entity_registry as r (
  entity_code, canonical_name, status, portal_url, portal_url_todo,
  default_roles, parent_entity_code, is_subsidiary, detail
)
values
  (
    'ENT-FIRM',
    'Tage Venture Capital',
    'Active',
    'https://app.tagevc.com',
    null,
    '["visionary","admin","partner","associate","coo","counsel_ops","service_lead"]'::jsonb,
    null,
    false,
    jsonb_build_object(
      'contract_version','ms-p1-v1',
      'money_auto_approve',false
    )
  ),
  (
    'ENT-R619',
    'Recruit 619',
    'Active',
    'https://portal.recruit619.com',
    null,
    '["subsidiary_ops","recruiter","recruit_admin"]'::jsonb,
    'ENT-FIRM',
    true,
    jsonb_build_object(
      'contract_version','ms-p1-v1',
      'money_auto_approve',false,
      'brand','Recruit 619'
    )
  ),
  (
    'ENT-INDA',
    'Instant NDA',
    'Active',
    null,
    -- TODO: replace with live Instant NDA portal URL when published
    'TODO: set Instant NDA portal_url (legacy seed code ENT-002)',
    '["subsidiary_ops","inda_admin","inda_support"]'::jsonb,
    'ENT-FIRM',
    true,
    jsonb_build_object(
      'contract_version','ms-p1-v1',
      'money_auto_approve',false,
      'legacy_entity_codes', jsonb_build_array('ENT-002'),
      'brand','Instant NDA'
    )
  )
on conflict (entity_code) do update set
  canonical_name = excluded.canonical_name,
  status = excluded.status,
  portal_url = coalesce(excluded.portal_url, r.portal_url),
  portal_url_todo = coalesce(excluded.portal_url_todo, r.portal_url_todo),
  default_roles = excluded.default_roles,
  parent_entity_code = excluded.parent_entity_code,
  is_subsidiary = excluded.is_subsidiary,
  detail = excluded.detail,
  updated_at = now();

insert into public.os_entity_aliases (alias_code, canonical_code, reason)
values ('ENT-002', 'ENT-INDA', 'legacy_seed_code_instant_nda')
on conflict (alias_code) do update set
  canonical_code = excluded.canonical_code,
  reason = excluded.reason;

insert into public.os_entity_policy as p (
  policy_key, policy_version, directory_visibility,
  cross_entity_messaging, ticket_visibility_default, detail
)
values (
  'default',
  'ms-p1-v1',
  'home_plus_firm',
  'dm_opt_in_rooms_deny',
  'entity_scoped',
  jsonb_build_object(
    'contract_version','ms-p1-v1',
    'money_auto_approve',false,
    'notes','Local-first entity visibility; firm-wide operators see all'
  )
)
on conflict (policy_key) do nothing;

insert into public.os_entity_policy_audits (
  policy_key, change_kind, before_detail, after_detail, metrics_sha256, actor_id
)
select
  'default',
  'seed',
  '{}'::jsonb,
  jsonb_build_object(
    'directory_visibility','home_plus_firm',
    'cross_entity_messaging','dm_opt_in_rooms_deny',
    'ticket_visibility_default','entity_scoped',
    'money_auto_approve',false,
    'contract_version','ms-p1-v1'
  ),
  public.os_sha256_hex('ms-p1-seed-default-policy'),
  null
where not exists (
  select 1 from public.os_entity_policy_audits a
  where a.policy_key = 'default' and a.change_kind = 'seed'
);

-- Ensure entities table has ENT-INDA without breaking ENT-002 refs.
-- Prefer insert when missing; leave ENT-002 row intact for legacy FKs/seed.
do $$
begin
  if to_regclass('public.entities') is null then
    return;
  end if;
  insert into public.entities (
    entity_id, canonical_name, legal_name, type, status, industry,
    parent_entity_id, entity_type, track_origin, industry_module,
    notes, created_at, updated_at
  )
  select
    'ENT-INDA',
    'Instant NDA',
    'Instant NDA LLC',
    'Subsidiary',
    'Active',
    'SaaS',
    'ENT-FIRM',
    'Subsidiary',
    'VC Invest',
    'SaaS',
    'Canonical Instant NDA code (alias ENT-002 retained for legacy refs)',
    now(),
    now()
  where not exists (
    select 1 from public.entities e where e.entity_id = 'ENT-INDA'
  )
  and not exists (
    select 1 from public.entities e where e.canonical_name = 'Instant NDA'
      and e.entity_id = 'ENT-INDA'
  );
exception
  when unique_violation then
    -- ENT-002 already owns Instant NDA name — annotate only.
    update public.entities
    set notes = coalesce(notes,'') ||
      case when coalesce(notes,'') like '%canonical ENT-INDA%' then ''
           else ' | canonical ENT-INDA via os_entity_aliases'
      end,
      updated_at = now()
    where entity_id = 'ENT-002';
end;
$$;

create or replace function public.list_entity_registry_ms_p1()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
  v_aliases jsonb;
  v_policy jsonb;
begin
  if auth.role() <> 'service_role'
     and not public.is_firm_wide_access()
     and auth.uid() is null then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.entity_code), '[]'::jsonb)
  into v_rows
  from public.os_entity_registry r;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.alias_code), '[]'::jsonb)
  into v_aliases
  from public.os_entity_aliases a;

  select to_jsonb(p) into v_policy
  from public.os_entity_policy p
  where p.policy_key = 'default';

  return jsonb_build_object(
    'contract_version','ms-p1-v1',
    'money_auto_approve',false,
    'entities',v_rows,
    'aliases',v_aliases,
    'policy',coalesce(v_policy,'{}'::jsonb)
  );
end;
$$;

revoke all on function public.list_entity_registry_ms_p1()
  from public, anon;
grant execute on function public.list_entity_registry_ms_p1()
  to authenticated, service_role;
