-- Multi-subsidiary readiness P3: Messaging multi-entity.
-- Home-entity membership, directory badges, default channels, cross-entity policy.
-- Apply after phase_ms_p2. Safe to re-run. Additive only.
-- Never auto-approves money. Never mutates snapshot retirement tables.

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

create or replace function public.phase_ms_p3_safe_detail(p_detail jsonb)
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

-- Home-entity membership (joiner provision / leaver revoke).
create table if not exists public.os_messaging_entity_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  membership_role text not null default 'member'
    check (membership_role in ('member','admin','operator')),
  is_home boolean not null default false,
  provisioned_at timestamptz not null default now(),
  deprovisioned_at timestamptz,
  detail jsonb not null default '{}'::jsonb,
  primary key (user_id, entity_id),
  constraint os_msg_ent_mem_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p3_safe_detail(detail)
    ),
  constraint os_msg_ent_mem_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create unique index if not exists os_msg_ent_mem_home_uidx
  on public.os_messaging_entity_memberships(user_id)
  where is_home and deprovisioned_at is null;

create index if not exists os_msg_ent_mem_entity_idx
  on public.os_messaging_entity_memberships(entity_id)
  where deprovisioned_at is null;

alter table public.os_messaging_entity_memberships enable row level security;
drop policy if exists "os_msg_ent_mem_select"
  on public.os_messaging_entity_memberships;
create policy "os_msg_ent_mem_select"
  on public.os_messaging_entity_memberships for select to authenticated
  using (
    user_id = auth.uid()
    or public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_messaging_entity_memberships
  from public, anon, authenticated;
grant select on public.os_messaging_entity_memberships to authenticated;

-- Default channels per entity (created lazily by provision RPC).
create table if not exists public.os_messaging_default_channels (
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  channel_key text not null
    check (channel_key ~ '^[a-z][a-z0-9_-]{1,63}$'),
  title text not null,
  description text,
  conversation_id uuid,
  active boolean not null default true,
  detail jsonb not null default '{}'::jsonb,
  primary key (entity_id, channel_key),
  constraint os_msg_def_ch_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p3_safe_detail(detail)
    )
);

alter table public.os_messaging_default_channels enable row level security;
drop policy if exists "os_msg_def_ch_select"
  on public.os_messaging_default_channels;
create policy "os_msg_def_ch_select"
  on public.os_messaging_default_channels for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_messaging_default_channels
  from public, anon, authenticated;
grant select on public.os_messaging_default_channels to authenticated;

insert into public.os_messaging_default_channels
  (entity_id, channel_key, title, description, detail)
values
  (
    'ENT-R619','general','Recruit 619 · General',
    'Default subsidiary channel for Recruit 619',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1')
  ),
  (
    'ENT-R619','shared-services','Recruit 619 · Shared Services',
    'Escalations and SS coordination',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1')
  ),
  (
    'ENT-INDA','general','Instant NDA · General',
    'Default subsidiary channel for Instant NDA',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1')
  ),
  (
    'ENT-INDA','support','Instant NDA · Support',
    'Customer support coordination',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1')
  ),
  (
    'ENT-FIRM','shared-services','Tage · Shared Services',
    'Firm-wide Shared Services room',
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1')
  )
on conflict (entity_id, channel_key) do update set
  title = excluded.title,
  description = excluded.description,
  active = true,
  detail = excluded.detail;

-- Cross-entity messaging decision audit (append-only).
create table if not exists public.os_messaging_cross_entity_audits (
  audit_id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  peer_id uuid,
  actor_entity_id text,
  peer_entity_id text,
  action text not null
    check (action in (
      'dm_allow','dm_deny','room_allow','room_deny','sso_deeplink'
    )),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_msg_xe_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p3_safe_detail(detail)
    ),
  constraint os_msg_xe_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_msg_xe_audits_created_idx
  on public.os_messaging_cross_entity_audits(created_at desc);

alter table public.os_messaging_cross_entity_audits enable row level security;
drop policy if exists "os_msg_xe_audits_select"
  on public.os_messaging_cross_entity_audits;
create policy "os_msg_xe_audits_select"
  on public.os_messaging_cross_entity_audits for select to authenticated
  using (public.is_firm_wide_access() or actor_id = auth.uid());
revoke all on public.os_messaging_cross_entity_audits
  from public, anon, authenticated;
grant select on public.os_messaging_cross_entity_audits to authenticated;

create or replace function public.reject_os_msg_xe_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Messaging cross-entity audits are append-only';
end;
$$;

drop trigger if exists os_msg_xe_immutable
  on public.os_messaging_cross_entity_audits;
create trigger os_msg_xe_immutable
  before update or delete on public.os_messaging_cross_entity_audits
  for each row execute function public.reject_os_msg_xe_mutation();
drop trigger if exists os_msg_xe_no_truncate
  on public.os_messaging_cross_entity_audits;
create trigger os_msg_xe_no_truncate
  before truncate on public.os_messaging_cross_entity_audits
  for each statement execute function public.reject_os_msg_xe_mutation();

-- Portal deep-link / SSO hooks (metadata only — tokens never stored).
create table if not exists public.os_messaging_portal_deeplinks (
  entity_id text primary key
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  portal_base_url text,
  messages_path text not null default '/messages',
  sso_provider text default 'azure',
  detail jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint os_msg_deeplink_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p3_safe_detail(detail)
    )
);

alter table public.os_messaging_portal_deeplinks enable row level security;
drop policy if exists "os_msg_deeplink_select"
  on public.os_messaging_portal_deeplinks;
create policy "os_msg_deeplink_select"
  on public.os_messaging_portal_deeplinks for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_messaging_portal_deeplinks
  from public, anon, authenticated;
grant select on public.os_messaging_portal_deeplinks to authenticated;

insert into public.os_messaging_portal_deeplinks
  (entity_id, portal_base_url, messages_path, sso_provider, detail)
values
  (
    'ENT-R619',
    'https://portal.recruit619.com',
    '/messages',
    'azure',
    jsonb_build_object(
      'tage_messages','https://app.tagevc.com/messages',
      'money_auto_approve',false,
      'contract_version','ms-p3-v1'
    )
  ),
  (
    'ENT-INDA',
    null,
    '/messages',
    'azure',
    jsonb_build_object(
      'portal_todo','TODO: Instant NDA portal URL for SSO deep-links',
      'tage_messages','https://app.tagevc.com/messages',
      'legacy_alias','ENT-002',
      'money_auto_approve',false,
      'contract_version','ms-p3-v1'
    )
  )
on conflict (entity_id) do update set
  portal_base_url = coalesce(excluded.portal_base_url, os_messaging_portal_deeplinks.portal_base_url),
  messages_path = excluded.messages_path,
  sso_provider = excluded.sso_provider,
  detail = excluded.detail,
  updated_at = now();

create or replace function public.can_cross_entity_message_ms_p3(
  p_actor_id uuid,
  p_peer_id uuid,
  p_kind text default 'dm'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_actor_ent text;
  v_peer_ent text;
  v_policy text;
  v_kind text := lower(coalesce(nullif(trim(p_kind),''),'dm'));
  v_allow boolean := false;
  v_reason text;
begin
  if p_actor_id is null or p_peer_id is null then
    return jsonb_build_object(
      'allowed',false,'reason','missing_users','money_auto_approve',false
    );
  end if;

  select public.resolve_canonical_entity_id(entity_id) into v_actor_ent
  from public.profiles where id = p_actor_id;
  select public.resolve_canonical_entity_id(entity_id) into v_peer_ent
  from public.profiles where id = p_peer_id;

  select cross_entity_messaging into v_policy
  from public.os_entity_policy where policy_key = 'default';
  v_policy := coalesce(v_policy, 'dm_opt_in_rooms_deny');

  if public.is_firm_wide_access() then
    v_allow := true;
    v_reason := 'firm_wide_operator';
  elsif v_actor_ent is not distinct from v_peer_ent then
    v_allow := true;
    v_reason := 'same_entity';
  elsif v_policy = 'deny' then
    v_allow := false;
    v_reason := 'policy_deny';
  elsif v_policy = 'firm_wide_operators' then
    v_allow := false;
    v_reason := 'operators_only';
  elsif v_kind = 'dm' and v_policy in ('dm_opt_in_rooms_deny','opt_in') then
    v_allow := true;
    v_reason := 'dm_opt_in';
  elsif v_kind <> 'dm' and v_policy = 'dm_opt_in_rooms_deny' then
    v_allow := false;
    v_reason := 'rooms_deny_cross_entity';
  elsif v_policy = 'opt_in' then
    v_allow := true;
    v_reason := 'opt_in';
  else
    v_allow := false;
    v_reason := 'default_deny';
  end if;

  return jsonb_build_object(
    'allowed',v_allow,
    'reason',v_reason,
    'actor_entity_id',v_actor_ent,
    'peer_entity_id',v_peer_ent,
    'kind',v_kind,
    'policy',v_policy,
    'money_auto_approve',false,
    'contract_version','ms-p3-v1'
  );
end;
$$;

revoke all on function public.can_cross_entity_message_ms_p3(uuid, uuid, text)
  from public, anon;
grant execute on function public.can_cross_entity_message_ms_p3(uuid, uuid, text)
  to authenticated, service_role;

create or replace function public.provision_messaging_membership_ms_p3(
  p_user_id uuid,
  p_entity_id text,
  p_is_home boolean default true,
  p_membership_role text default 'member'
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
  v_role text := coalesce(nullif(trim(p_membership_role),''),'member');
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null or v_entity is null then
    raise exception 'user_id and entity_id required';
  end if;
  if v_role not in ('member','admin','operator') then
    v_role := 'member';
  end if;

  if p_is_home then
    update public.os_messaging_entity_memberships
    set is_home = false
    where user_id = p_user_id
      and deprovisioned_at is null
      and is_home;
  end if;

  insert into public.os_messaging_entity_memberships as m (
    user_id, entity_id, membership_role, is_home, detail, deprovisioned_at
  ) values (
    p_user_id,
    v_entity,
    v_role,
    coalesce(p_is_home,true),
    jsonb_build_object('money_auto_approve',false,'contract_version','ms-p3-v1'),
    null
  )
  on conflict (user_id, entity_id) do update set
    membership_role = excluded.membership_role,
    is_home = excluded.is_home,
    deprovisioned_at = null,
    provisioned_at = now(),
    detail = excluded.detail;

  -- Mirror home entity onto profile when column exists.
  begin
    if coalesce(p_is_home,true) then
      update public.profiles
      set entity_id = v_entity
      where id = p_user_id
        and (entity_id is distinct from v_entity);
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok',true,
    'user_id',p_user_id,
    'entity_id',v_entity,
    'is_home',coalesce(p_is_home,true),
    'money_auto_approve',false,
    'contract_version','ms-p3-v1'
  );
end;
$$;

revoke all on function public.provision_messaging_membership_ms_p3(uuid, text, boolean, text)
  from public, anon;
grant execute on function public.provision_messaging_membership_ms_p3(uuid, text, boolean, text)
  to authenticated, service_role;

create or replace function public.deprovision_messaging_membership_ms_p3(
  p_user_id uuid,
  p_entity_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := public.resolve_canonical_entity_id(p_entity_id);
  v_count integer := 0;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;
  if p_user_id is null then
    raise exception 'user_id required';
  end if;

  update public.os_messaging_entity_memberships
  set deprovisioned_at = now(),
      is_home = false
  where user_id = p_user_id
    and deprovisioned_at is null
    and (v_entity is null or entity_id = v_entity);
  get diagnostics v_count = row_count;

  -- Soft-leave conversation memberships for entity-scoped rooms when possible.
  begin
    if to_regclass('public.os_conversation_members') is not null
       and to_regclass('public.os_conversations') is not null then
      update public.os_conversation_members m
      set left_at = now()
      from public.os_conversations c
      where m.conversation_id = c.id
        and m.user_id = p_user_id
        and m.left_at is null
        and (
          v_entity is null
          or public.entity_ids_equivalent(c.entity_id, v_entity)
        );
    end if;
  exception when others then
    null;
  end;

  return jsonb_build_object(
    'ok',true,
    'user_id',p_user_id,
    'entity_id',v_entity,
    'memberships_closed',v_count,
    'money_auto_approve',false,
    'contract_version','ms-p3-v1'
  );
end;
$$;

revoke all on function public.deprovision_messaging_membership_ms_p3(uuid, text)
  from public, anon;
grant execute on function public.deprovision_messaging_membership_ms_p3(uuid, text)
  to authenticated, service_role;

create or replace function public.list_directory_with_entity_badges_ms_p3(
  p_exclude_user_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_rows jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.full_name), '[]'::jsonb)
  into v_rows
  from (
    select
      p.id,
      p.email,
      p.full_name,
      p.avatar_url,
      p.role,
      p.active,
      public.resolve_canonical_entity_id(p.entity_id) as entity_id,
      coalesce(r.canonical_name, p.entity_id) as entity_badge,
      m.is_home
    from public.profiles p
    left join public.os_entity_registry r
      on r.entity_code = public.resolve_canonical_entity_id(p.entity_id)
    left join public.os_messaging_entity_memberships m
      on m.user_id = p.id
     and m.is_home
     and m.deprovisioned_at is null
    where p.active = true
      and (p_exclude_user_id is null or p.id <> p_exclude_user_id)
  ) x;

  return jsonb_build_object(
    'contract_version','ms-p3-v1',
    'money_auto_approve',false,
    'profiles',coalesce(v_rows,'[]'::jsonb)
  );
end;
$$;

revoke all on function public.list_directory_with_entity_badges_ms_p3(uuid)
  from public, anon;
grant execute on function public.list_directory_with_entity_badges_ms_p3(uuid)
  to authenticated, service_role;
