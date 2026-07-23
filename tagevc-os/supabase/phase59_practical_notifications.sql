-- Phase 59: Practical Production Notifications.
-- In-app inbox completeness, optional email digests for critical events,
-- owner/assignee routing, preference center extensions.
-- Reliability over channel expansion. NOT a full push notification product.
-- Apply after Phase 58. Safe to re-run.
-- Append-only delivery evidence only. full_push always false.
-- Never mutates snapshot retirement tables.

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

create or replace function public.phase59_notifications_safe_detail(p_detail jsonb)
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
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://)'
    );
$$;

create or replace function public.reject_notifications_phase59_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Practical notifications Phase 59 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Preference extensions on os_notification_prefs (Phase 13 base).
-- ---------------------------------------------------------------------------
alter table public.os_notification_prefs
  add column if not exists email_critical_digests boolean not null default true;

alter table public.os_notification_prefs
  add column if not exists notify_critical_events boolean not null default true;

alter table public.os_notification_prefs
  add column if not exists notify_owner_assignments boolean not null default true;

-- ---------------------------------------------------------------------------
-- Append-only delivery evidence (in_app / email_critical only; no full push).
-- ---------------------------------------------------------------------------
create table if not exists public.os_notification_delivery_phase59_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  recipient_user_id uuid,
  channel text not null
    check (channel in ('in_app','email_critical')),
  delivery_status text not null
    check (delivery_status in (
      'delivered','failed','skipped_pref_off','skipped_no_recipient',
      'skipped_not_critical','replayed'
    )),
  event_kind text not null
    check (event_kind ~ '^[a-z][a-z0-9_]{1,62}$'),
  severity text not null default 'info'
    check (severity in ('info','warning','critical')),
  notification_ref text,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_notif_del_p59_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase59_notifications_safe_detail(detail)
    ),
  constraint os_notif_del_p59_no_full_push_check
    check (coalesce((detail->>'full_push')::boolean,false)=false)
);

create index if not exists os_notif_del_p59_recipient_created_idx
  on public.os_notification_delivery_phase59_evidence(
    recipient_user_id, created_at desc
  );
create index if not exists os_notif_del_p59_channel_created_idx
  on public.os_notification_delivery_phase59_evidence(channel, created_at desc);
create index if not exists os_notif_del_p59_entity_created_idx
  on public.os_notification_delivery_phase59_evidence(entity_id, created_at desc);

alter table public.os_notification_delivery_phase59_evidence
  enable row level security;
drop policy if exists "os_notif_del_p59_select"
  on public.os_notification_delivery_phase59_evidence;
create policy "os_notif_del_p59_select"
  on public.os_notification_delivery_phase59_evidence for select to authenticated
  using (
    public.is_firm_wide_access()
    or recipient_user_id = auth.uid()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_notification_delivery_phase59_evidence
  from public, anon, authenticated;
grant select on public.os_notification_delivery_phase59_evidence
  to authenticated;

drop trigger if exists os_notif_del_p59_immutable
  on public.os_notification_delivery_phase59_evidence;
create trigger os_notif_del_p59_immutable
  before update or delete on public.os_notification_delivery_phase59_evidence
  for each row execute function public.reject_notifications_phase59_mutation();
drop trigger if exists os_notif_del_p59_no_truncate
  on public.os_notification_delivery_phase59_evidence;
create trigger os_notif_del_p59_no_truncate
  before truncate on public.os_notification_delivery_phase59_evidence
  for each statement execute function public.reject_notifications_phase59_mutation();

-- ---------------------------------------------------------------------------
-- Owner / assignee routing evidence.
-- ---------------------------------------------------------------------------
create table if not exists public.os_notification_routing_phase59_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  route_kind text not null
    check (route_kind in ('owner','assignee','both','explicit')),
  owner_user_id uuid,
  assignee_user_id uuid,
  recipient_user_id uuid not null,
  event_kind text not null
    check (event_kind ~ '^[a-z][a-z0-9_]{1,62}$'),
  severity text not null default 'info'
    check (severity in ('info','warning','critical')),
  title text not null check (char_length(title) between 2 and 240),
  href text,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_notif_route_p59_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase59_notifications_safe_detail(detail)
    ),
  constraint os_notif_route_p59_no_full_push_check
    check (coalesce((detail->>'full_push')::boolean,false)=false)
);

create index if not exists os_notif_route_p59_recipient_created_idx
  on public.os_notification_routing_phase59_events(
    recipient_user_id, created_at desc
  );
create index if not exists os_notif_route_p59_entity_created_idx
  on public.os_notification_routing_phase59_events(entity_id, created_at desc);

alter table public.os_notification_routing_phase59_events
  enable row level security;
drop policy if exists "os_notif_route_p59_select"
  on public.os_notification_routing_phase59_events;
create policy "os_notif_route_p59_select"
  on public.os_notification_routing_phase59_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or recipient_user_id = auth.uid()
    or owner_user_id = auth.uid()
    or assignee_user_id = auth.uid()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_notification_routing_phase59_events
  from public, anon, authenticated;
grant select on public.os_notification_routing_phase59_events
  to authenticated;

drop trigger if exists os_notif_route_p59_immutable
  on public.os_notification_routing_phase59_events;
create trigger os_notif_route_p59_immutable
  before update or delete on public.os_notification_routing_phase59_events
  for each row execute function public.reject_notifications_phase59_mutation();
drop trigger if exists os_notif_route_p59_no_truncate
  on public.os_notification_routing_phase59_events;
create trigger os_notif_route_p59_no_truncate
  before truncate on public.os_notification_routing_phase59_events
  for each statement execute function public.reject_notifications_phase59_mutation();

-- ---------------------------------------------------------------------------
-- Inbox completeness snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_notification_inbox_phase59_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  unread_total integer not null default 0 check (unread_total >= 0),
  unread_critical integer not null default 0 check (unread_critical >= 0),
  unread_mentions integer not null default 0 check (unread_mentions >= 0),
  unread_chat integer not null default 0 check (unread_chat >= 0),
  unread_owner_routed integer not null default 0 check (unread_owner_routed >= 0),
  prefs_configured integer not null default 0 check (prefs_configured >= 0),
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_notif_inbox_p59_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase59_notifications_safe_detail(detail)
    ),
  constraint os_notif_inbox_p59_no_full_push_check
    check (coalesce((detail->>'full_push')::boolean,false)=false)
);

create index if not exists os_notif_inbox_p59_entity_created_idx
  on public.os_notification_inbox_phase59_snapshots(entity_id, created_at desc);
create index if not exists os_notif_inbox_p59_created_idx
  on public.os_notification_inbox_phase59_snapshots(created_at desc);

alter table public.os_notification_inbox_phase59_snapshots
  enable row level security;
drop policy if exists "os_notif_inbox_p59_select"
  on public.os_notification_inbox_phase59_snapshots;
create policy "os_notif_inbox_p59_select"
  on public.os_notification_inbox_phase59_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_notification_inbox_phase59_snapshots
  from public, anon, authenticated;
grant select on public.os_notification_inbox_phase59_snapshots
  to authenticated;

drop trigger if exists os_notif_inbox_p59_immutable
  on public.os_notification_inbox_phase59_snapshots;
create trigger os_notif_inbox_p59_immutable
  before update or delete on public.os_notification_inbox_phase59_snapshots
  for each row execute function public.reject_notifications_phase59_mutation();
drop trigger if exists os_notif_inbox_p59_no_truncate
  on public.os_notification_inbox_phase59_snapshots;
create trigger os_notif_inbox_p59_no_truncate
  before truncate on public.os_notification_inbox_phase59_snapshots
  for each statement execute function public.reject_notifications_phase59_mutation();

-- ---------------------------------------------------------------------------
-- Ops alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.os_notification_phase59_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'inbox_gap','routing_gap','delivery_failed','critical_digest_gap',
      'prefs_missing','refresh_failed','subsidiary_gap'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_notif_ops_p59_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase59_notifications_safe_detail(detail)
    ),
  constraint os_notif_ops_p59_no_full_push_check
    check (coalesce((detail->>'full_push')::boolean,false)=false)
);

create index if not exists os_notif_ops_p59_created_idx
  on public.os_notification_phase59_ops_alerts(created_at desc);

alter table public.os_notification_phase59_ops_alerts enable row level security;
drop policy if exists "os_notif_ops_p59_select"
  on public.os_notification_phase59_ops_alerts;
create policy "os_notif_ops_p59_select"
  on public.os_notification_phase59_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_notification_phase59_ops_alerts
  from public, anon, authenticated;
grant select on public.os_notification_phase59_ops_alerts
  to authenticated;

drop trigger if exists os_notif_ops_p59_immutable
  on public.os_notification_phase59_ops_alerts;
create trigger os_notif_ops_p59_immutable
  before update or delete on public.os_notification_phase59_ops_alerts
  for each row execute function public.reject_notifications_phase59_mutation();
drop trigger if exists os_notif_ops_p59_no_truncate
  on public.os_notification_phase59_ops_alerts;
create trigger os_notif_ops_p59_no_truncate
  before truncate on public.os_notification_phase59_ops_alerts
  for each statement execute function public.reject_notifications_phase59_mutation();

-- ---------------------------------------------------------------------------
-- Upsert Phase 59 preference extensions (own row only).
-- ---------------------------------------------------------------------------
create or replace function public.upsert_notification_prefs_phase59(
  p_email_digests boolean default null,
  p_digest_frequency text default null,
  p_notify_mentions boolean default null,
  p_notify_chat_messages boolean default null,
  p_email_critical_digests boolean default null,
  p_notify_critical_events boolean default null,
  p_notify_owner_assignments boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  me uuid := auth.uid();
  v_row public.os_notification_prefs%rowtype;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;

  if p_digest_frequency is not null
     and p_digest_frequency not in ('off','daily','weekly') then
    raise exception 'Invalid digest_frequency for Phase 59 prefs';
  end if;

  insert into public.os_notification_prefs (user_id)
  values (me)
  on conflict (user_id) do nothing;

  update public.os_notification_prefs
  set
    email_digests = coalesce(p_email_digests, email_digests),
    digest_frequency = coalesce(p_digest_frequency, digest_frequency),
    notify_mentions = coalesce(p_notify_mentions, notify_mentions),
    notify_chat_messages = coalesce(p_notify_chat_messages, notify_chat_messages),
    email_critical_digests = coalesce(p_email_critical_digests, email_critical_digests),
    notify_critical_events = coalesce(p_notify_critical_events, notify_critical_events),
    notify_owner_assignments = coalesce(
      p_notify_owner_assignments, notify_owner_assignments
    ),
    updated_at = now()
  where user_id = me
  returning * into v_row;

  return jsonb_build_object(
    'user_id', v_row.user_id,
    'email_digests', v_row.email_digests,
    'digest_frequency', v_row.digest_frequency,
    'notify_mentions', v_row.notify_mentions,
    'notify_chat_messages', v_row.notify_chat_messages,
    'email_critical_digests', v_row.email_critical_digests,
    'notify_critical_events', v_row.notify_critical_events,
    'notify_owner_assignments', v_row.notify_owner_assignments,
    'muted_conversation_ids', to_jsonb(v_row.muted_conversation_ids),
    'updated_at', v_row.updated_at,
    'full_push', false,
    'contract_version', 'phase59-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record delivery evidence (append-only; never full push).
-- ---------------------------------------------------------------------------
create or replace function public.record_notification_delivery_phase59(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_recipient uuid := nullif(p_payload->>'recipient_user_id','')::uuid;
  v_channel text := nullif(trim(coalesce(p_payload->>'channel','')),'');
  v_status text := nullif(trim(coalesce(p_payload->>'delivery_status','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'event_kind','')),'');
  v_severity text := coalesce(
    nullif(trim(lower(coalesce(p_payload->>'severity',''))),''),
    'info'
  );
  v_ref text := nullif(trim(coalesce(p_payload->>'notification_ref','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 59 delivery payload must be a JSON object';
  end if;
  if v_channel is null
    or v_channel not in ('in_app','email_critical')
    or v_status is null
    or v_status not in (
      'delivered','failed','skipped_pref_off','skipped_no_recipient',
      'skipped_not_critical','replayed'
    )
    or v_kind is null
    or v_kind !~ '^[a-z][a-z0-9_]{1,62}$'
    or v_severity not in ('info','warning','critical')
    or not public.phase59_notifications_safe_detail(v_meta) then
    raise exception 'Phase 59 delivery contract is invalid or unsafe';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 59 delivery';
  end if;

  v_window := left(
    'phase59:del:' || coalesce(v_entity,'firm') || ':' || v_channel || ':'
      || v_kind || ':' || coalesce(v_recipient::text,'none') || ':'
      || coalesce(v_ref,'noref') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || v_channel || '|' || v_status || '|'
    || v_kind || '|' || v_window
  );

  insert into public.os_notification_delivery_phase59_evidence (
    entity_id, recipient_user_id, channel, delivery_status, event_kind,
    severity, notification_ref, window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_recipient, v_channel, v_status, v_kind, v_severity, v_ref,
    v_window, v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase59-v1',
      'full_push',false
    ),
    v_actor
  )
  on conflict (window_key) do nothing
  returning evidence_id into v_id;

  if v_id is null then
    select evidence_id into v_id
    from public.os_notification_delivery_phase59_evidence
    where window_key = v_window;
    return jsonb_build_object(
      'evidence_id', v_id,
      'window_key', v_window,
      'delivery_status', 'replayed',
      'full_push', false,
      'contract_version', 'phase59-v1'
    );
  end if;

  if v_status = 'failed' then
    insert into public.os_notification_phase59_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'delivery_failed', v_id,
      left('phase59:alert:del_fail:' || v_id::text, 200),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version','phase59-v1',
        'channel', v_channel,
        'event_kind', v_kind,
        'full_push', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'evidence_id', v_id,
    'window_key', v_window,
    'delivery_status', v_status,
    'channel', v_channel,
    'full_push', false,
    'contract_version', 'phase59-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Route notification to owner and/or assignee; write in-app + evidence.
-- Optional critical email is evidence-only here (app sends via Resend).
-- ---------------------------------------------------------------------------
create or replace function public.route_notification_phase59(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_route text := coalesce(
    nullif(trim(lower(coalesce(p_payload->>'route_kind',''))),''),
    'both'
  );
  v_owner uuid := nullif(p_payload->>'owner_user_id','')::uuid;
  v_assignee uuid := nullif(p_payload->>'assignee_user_id','')::uuid;
  v_explicit uuid := nullif(p_payload->>'recipient_user_id','')::uuid;
  v_kind text := nullif(trim(coalesce(p_payload->>'event_kind','')),'');
  v_severity text := coalesce(
    nullif(trim(lower(coalesce(p_payload->>'severity',''))),''),
    'info'
  );
  v_title text := nullif(trim(coalesce(p_payload->>'title','')),'');
  v_body text := nullif(trim(coalesce(p_payload->>'body','')),'');
  v_href text := nullif(trim(coalesce(p_payload->>'href','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_recipients uuid[] := '{}'::uuid[];
  v_uid uuid;
  v_pref public.os_notification_prefs%rowtype;
  v_notif_id text;
  v_route_id uuid;
  v_window text;
  v_hash text;
  v_routed integer := 0;
  v_skipped integer := 0;
  v_email_candidates integer := 0;
  v_app_kind text;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 59 route payload must be a JSON object';
  end if;
  if v_route not in ('owner','assignee','both','explicit')
    or v_kind is null
    or v_kind !~ '^[a-z][a-z0-9_]{1,62}$'
    or v_severity not in ('info','warning','critical')
    or v_title is null or char_length(v_title) < 2
    or not public.phase59_notifications_safe_detail(v_meta) then
    raise exception 'Phase 59 route contract is invalid or unsafe';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 59 route';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 59 route';
  end if;

  if v_route = 'explicit' and v_explicit is not null then
    v_recipients := array_append(v_recipients, v_explicit);
  end if;
  if v_route in ('owner','both') and v_owner is not null then
    if not (v_owner = any (v_recipients)) then
      v_recipients := array_append(v_recipients, v_owner);
    end if;
  end if;
  if v_route in ('assignee','both') and v_assignee is not null then
    if not (v_assignee = any (v_recipients)) then
      v_recipients := array_append(v_recipients, v_assignee);
    end if;
  end if;

  if cardinality(v_recipients) = 0 then
    perform public.record_notification_delivery_phase59(
      jsonb_build_object(
        'entity_id', v_entity,
        'channel', 'in_app',
        'delivery_status', 'skipped_no_recipient',
        'event_kind', v_kind,
        'severity', v_severity,
        'actor_id', v_actor,
        'detail', jsonb_build_object(
          'route_kind', v_route,
          'source', 'route_notification_phase59'
        )
      )
    );
    return jsonb_build_object(
      'ok', true,
      'routed', 0,
      'skipped', 1,
      'email_critical_candidates', 0,
      'full_push', false,
      'contract_version', 'phase59-v1',
      'todo', 'Provide owner_user_id and/or assignee_user_id'
    );
  end if;

  v_app_kind := 'owner_routed';
  if v_severity = 'critical' then
    v_app_kind := 'critical_event';
  end if;

  foreach v_uid in array v_recipients loop
    select * into v_pref
    from public.os_notification_prefs
    where user_id = v_uid;

    if v_severity = 'critical'
       and coalesce(v_pref.notify_critical_events, true) = false then
      v_skipped := v_skipped + 1;
      perform public.record_notification_delivery_phase59(
        jsonb_build_object(
          'entity_id', v_entity,
          'recipient_user_id', v_uid,
          'channel', 'in_app',
          'delivery_status', 'skipped_pref_off',
          'event_kind', v_kind,
          'severity', v_severity,
          'actor_id', v_actor,
          'detail', jsonb_build_object(
            'pref','notify_critical_events',
            'source','route_notification_phase59'
          )
        )
      );
      continue;
    end if;

    if v_severity <> 'critical'
       and coalesce(v_pref.notify_owner_assignments, true) = false then
      v_skipped := v_skipped + 1;
      perform public.record_notification_delivery_phase59(
        jsonb_build_object(
          'entity_id', v_entity,
          'recipient_user_id', v_uid,
          'channel', 'in_app',
          'delivery_status', 'skipped_pref_off',
          'event_kind', v_kind,
          'severity', v_severity,
          'actor_id', v_actor,
          'detail', jsonb_build_object(
            'pref','notify_owner_assignments',
            'source','route_notification_phase59'
          )
        )
      );
      continue;
    end if;

    v_notif_id := 'NTF-P59-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

    insert into public.app_notifications (
      notification_id, user_id, kind, title, body, href
    ) values (
      v_notif_id,
      v_uid,
      v_app_kind,
      left(v_title, 240),
      left(coalesce(v_body, v_title), 500),
      left(coalesce(v_href, '/activity'), 500)
    );

    v_window := left(
      'phase59:route:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
        || v_uid::text || ':' || v_notif_id,
      200
    );
    v_hash := public.os_sha256_hex(
      coalesce(v_entity,'firm') || '|' || v_kind || '|' || v_uid::text || '|'
      || v_notif_id
    );

    insert into public.os_notification_routing_phase59_events (
      entity_id, route_kind, owner_user_id, assignee_user_id,
      recipient_user_id, event_kind, severity, title, href,
      window_key, metrics_sha256, detail, actor_id
    ) values (
      v_entity, v_route, v_owner, v_assignee, v_uid, v_kind, v_severity,
      left(v_title, 240), left(coalesce(v_href, '/activity'), 500),
      v_window, v_hash,
      v_meta || jsonb_build_object(
        'contract_version','phase59-v1',
        'full_push',false,
        'notification_id', v_notif_id,
        'app_kind', v_app_kind
      ),
      v_actor
    )
    on conflict (window_key) do nothing
    returning event_id into v_route_id;

    perform public.record_notification_delivery_phase59(
      jsonb_build_object(
        'entity_id', v_entity,
        'recipient_user_id', v_uid,
        'channel', 'in_app',
        'delivery_status', 'delivered',
        'event_kind', v_kind,
        'severity', v_severity,
        'notification_ref', v_notif_id,
        'actor_id', v_actor,
        'detail', jsonb_build_object(
          'route_kind', v_route,
          'routing_event_id', v_route_id,
          'source', 'route_notification_phase59'
        )
      )
    );

    v_routed := v_routed + 1;

    -- Critical email is optional and sent by digest/cron (Resend), not here.
    if v_severity = 'critical'
       and coalesce(v_pref.email_critical_digests, true) = true then
      v_email_candidates := v_email_candidates + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'routed', v_routed,
    'skipped', v_skipped,
    'email_critical_candidates', v_email_candidates,
    'recipients', to_jsonb(v_recipients),
    'full_push', false,
    'contract_version', 'phase59-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh inbox completeness board (observe + evidence).
-- ---------------------------------------------------------------------------
create or replace function public.refresh_notification_inbox_phase59(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_unread_total integer := 0;
  v_unread_critical integer := 0;
  v_unread_mentions integer := 0;
  v_unread_chat integer := 0;
  v_unread_owner integer := 0;
  v_prefs integer := 0;
  v_board text := 'missing';
  v_window text;
  v_hash text;
  v_id uuid;
  v_has_notif boolean := false;
  v_has_prefs boolean := false;
  v_del_failed integer := 0;
  v_r619_routes integer := 0;
  v_inda_routes integer := 0;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 59 inbox refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 59 inbox refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 59 inbox refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='app_notifications'
  ) into v_has_notif;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_notification_prefs'
  ) into v_has_prefs;

  if v_has_notif then
    begin
      select
        count(*) filter (where read_at is null)::integer,
        count(*) filter (
          where read_at is null and kind = 'critical_event'
        )::integer,
        count(*) filter (
          where read_at is null and kind = 'chat_mention'
        )::integer,
        count(*) filter (
          where read_at is null and kind = 'chat_message'
        )::integer,
        count(*) filter (
          where read_at is null and kind = 'owner_routed'
        )::integer
      into
        v_unread_total, v_unread_critical, v_unread_mentions,
        v_unread_chat, v_unread_owner
      from public.app_notifications;
    exception when others then
      v_unread_total := 0;
      v_unread_critical := 0;
      v_unread_mentions := 0;
      v_unread_chat := 0;
      v_unread_owner := 0;
    end;
  end if;

  if v_has_prefs then
    begin
      select count(*)::integer into v_prefs
      from public.os_notification_prefs;
    exception when others then
      v_prefs := 0;
    end;
  end if;

  select count(*)::integer into v_del_failed
  from public.os_notification_delivery_phase59_evidence
  where delivery_status = 'failed'
    and created_at > now() - interval '7 days'
    and (v_entity is null or entity_id = v_entity);

  select count(*)::integer into v_r619_routes
  from public.os_notification_routing_phase59_events
  where entity_id = 'ENT-R619'
    and created_at > now() - interval '30 days';

  select count(*)::integer into v_inda_routes
  from public.os_notification_routing_phase59_events
  where entity_id = 'ENT-INDA'
    and created_at > now() - interval '30 days';

  if v_has_notif and coalesce(v_prefs,0) > 0 then
    if coalesce(v_del_failed,0) = 0
       and coalesce(v_unread_critical,0) < 50 then
      v_board := 'ok';
    else
      v_board := 'partial';
    end if;
  elsif v_has_notif then
    v_board := 'partial';
  else
    -- TODO: ensure app_notifications + prefs present in all envs.
    v_board := 'missing';
  end if;

  if v_board in ('missing','partial') then
    insert into public.os_notification_phase59_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'inbox_gap',
      left(
        'phase59:alert:inbox_gap:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex(
        'inbox_gap|' || coalesce(v_entity,'firm') || '|' || v_board
      ),
      jsonb_build_object(
        'contract_version','phase59-v1',
        'board_status', v_board,
        'full_push', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_r619_routes,0) = 0 then
    insert into public.os_notification_phase59_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      'ENT-R619', 'subsidiary_gap',
      left(
        'phase59:alert:sub:ENT-R619:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'info',
      public.os_sha256_hex('sub|ENT-R619|0'),
      jsonb_build_object(
        'contract_version','phase59-v1',
        'todo','TODO: route Recruit critical events with entity_id=ENT-R619',
        'full_push', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_inda_routes,0) = 0 then
    insert into public.os_notification_phase59_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      'ENT-INDA', 'subsidiary_gap',
      left(
        'phase59:alert:sub:ENT-INDA:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'info',
      public.os_sha256_hex('sub|ENT-INDA|0'),
      jsonb_build_object(
        'contract_version','phase59-v1',
        'todo','TODO: show ENT-INDA routed notifications when evidence exists',
        'full_push', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  v_window := left(
    'phase59:inbox:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_unread_total,0)::text
    || '|' || coalesce(v_unread_critical,0)::text || '|' || v_board
    || '|' || v_window
  );

  insert into public.os_notification_inbox_phase59_snapshots (
    entity_id, window_key, unread_total, unread_critical, unread_mentions,
    unread_chat, unread_owner_routed, prefs_configured, board_status,
    metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_unread_total,0), coalesce(v_unread_critical,0),
    coalesce(v_unread_mentions,0), coalesce(v_unread_chat,0),
    coalesce(v_unread_owner,0), coalesce(v_prefs,0), v_board, v_hash,
    jsonb_build_object(
      'contract_version','phase59-v1',
      'full_push',false,
      'source','refresh_notification_inbox_phase59',
      'delivery_failed_7d', coalesce(v_del_failed,0),
      'ent_r619_routes_30d', coalesce(v_r619_routes,0),
      'ent_inda_routes_30d', coalesce(v_inda_routes,0),
      'reuses_digest_route', true,
      'reuses_notification_prefs', true
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_notification_inbox_phase59_snapshots
    where window_key = v_window;
  end if;

  return public.get_practical_notifications_phase59_report(v_entity);
end;
$$;

-- ---------------------------------------------------------------------------
-- Report.
-- ---------------------------------------------------------------------------
create or replace function public.get_practical_notifications_phase59_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_snap public.os_notification_inbox_phase59_snapshots%rowtype;
  v_recent_routes jsonb := '[]'::jsonb;
  v_recent_deliveries jsonb := '[]'::jsonb;
  v_recent_alerts jsonb := '[]'::jsonb;
  v_critical_email_ok integer := 0;
  v_critical_email_fail integer := 0;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 59 notifications report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 59 notifications report';
  end if;

  select * into v_snap
  from public.os_notification_inbox_phase59_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  if v_snap.snapshot_id is null then
    select * into v_snap
    from public.os_notification_inbox_phase59_snapshots s
    order by s.created_at desc
    limit 1;
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_recent_routes
  from (
    select
      event_id, entity_id, route_kind, recipient_user_id, event_kind,
      severity, title, href, created_at
    from public.os_notification_routing_phase59_events
    where v_entity is null or entity_id = v_entity
    order by created_at desc
    limit 20
  ) r;

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
  into v_recent_deliveries
  from (
    select
      evidence_id, entity_id, recipient_user_id, channel, delivery_status,
      event_kind, severity, notification_ref, created_at
    from public.os_notification_delivery_phase59_evidence
    where v_entity is null or entity_id = v_entity
    order by created_at desc
    limit 20
  ) d;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_recent_alerts
  from (
    select alert_id, entity_id, alert_kind, severity, created_at, detail
    from public.os_notification_phase59_ops_alerts
    where v_entity is null or entity_id = v_entity
    order by created_at desc
    limit 15
  ) a;

  select
    count(*) filter (
      where channel = 'email_critical' and delivery_status = 'delivered'
    )::integer,
    count(*) filter (
      where channel = 'email_critical' and delivery_status = 'failed'
    )::integer
  into v_critical_email_ok, v_critical_email_fail
  from public.os_notification_delivery_phase59_evidence
  where created_at > now() - interval '7 days'
    and (v_entity is null or entity_id = v_entity);

  return jsonb_build_object(
    'entity_id', v_entity,
    'unread_total', coalesce(v_snap.unread_total, 0),
    'unread_critical', coalesce(v_snap.unread_critical, 0),
    'unread_mentions', coalesce(v_snap.unread_mentions, 0),
    'unread_chat', coalesce(v_snap.unread_chat, 0),
    'unread_owner_routed', coalesce(v_snap.unread_owner_routed, 0),
    'prefs_configured', coalesce(v_snap.prefs_configured, 0),
    'board_status', coalesce(v_snap.board_status, 'missing'),
    'snapshot_id', v_snap.snapshot_id,
    'captured_at', v_snap.created_at,
    'critical_email_delivered_7d', coalesce(v_critical_email_ok, 0),
    'critical_email_failed_7d', coalesce(v_critical_email_fail, 0),
    'recent_routes', v_recent_routes,
    'recent_deliveries', v_recent_deliveries,
    'recent_alerts', v_recent_alerts,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'Refresh inbox board; route critical owner/assignee events; optional critical email via digest',
    'full_push', false,
    'email_critical_only', true,
    'reuses_digest_route', true,
    'reuses_notification_prefs', true,
    'contract_version', 'phase59-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Mark critical email delivery result (called by digest/cron after Resend).
-- ---------------------------------------------------------------------------
create or replace function public.mark_critical_email_delivery_phase59(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_status text := nullif(trim(coalesce(p_payload->>'delivery_status','')),'');
begin
  if v_status is null
     or v_status not in ('delivered','failed','skipped_pref_off','skipped_no_recipient') then
    raise exception 'Phase 59 critical email status invalid';
  end if;

  return public.record_notification_delivery_phase59(
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'channel', 'email_critical',
      'event_kind', coalesce(nullif(trim(p_payload->>'event_kind'),''), 'critical_digest'),
      'severity', coalesce(nullif(trim(p_payload->>'severity'),''), 'critical')
    )
  );
end;
$$;

-- Grants
revoke all on function public.upsert_notification_prefs_phase59(
  boolean, text, boolean, boolean, boolean, boolean, boolean
) from public, anon;
revoke all on function public.record_notification_delivery_phase59(jsonb)
  from public, anon;
revoke all on function public.route_notification_phase59(jsonb)
  from public, anon;
revoke all on function public.refresh_notification_inbox_phase59(uuid, text)
  from public, anon;
revoke all on function public.get_practical_notifications_phase59_report(text)
  from public, anon;
revoke all on function public.mark_critical_email_delivery_phase59(jsonb)
  from public, anon;
revoke all on function public.phase59_notifications_safe_detail(jsonb)
  from public, anon;

grant execute on function public.phase59_notifications_safe_detail(jsonb)
  to authenticated, service_role;
grant execute on function public.upsert_notification_prefs_phase59(
  boolean, text, boolean, boolean, boolean, boolean, boolean
) to authenticated, service_role;
grant execute on function public.record_notification_delivery_phase59(jsonb)
  to authenticated, service_role;
grant execute on function public.route_notification_phase59(jsonb)
  to authenticated, service_role;
grant execute on function public.refresh_notification_inbox_phase59(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_practical_notifications_phase59_report(text)
  to authenticated, service_role;
grant execute on function public.mark_critical_email_delivery_phase59(jsonb)
  to authenticated, service_role;
