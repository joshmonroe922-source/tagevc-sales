-- Phase 47: notify owners when quarterly handoff digests publish (not full
-- push), and richer ownership-change visibility with upcoming handoff windows.
-- Apply after phase46_slo_governance_ops.sql.
-- Counterfactual / governance only — never mutates os_slo_alerts evaluation
-- or production delivery paths. Digest notify is a separate append-only ledger.

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

create or replace function public.phase47_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Handoff digest owner notifications (destination_key + owner_id only; no PII)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_handoff_digest_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null
    references public.os_slo_owner_handoff_digest_publications(publication_id),
  destination_key text not null,
  owner_id uuid not null references public.profiles(id),
  delivery_status text not null default 'queued',
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_handoff_notif_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_handoff_notif_status_check
    check (delivery_status in (
      'queued','notified','skipped','failed','replayed'
    )),
  constraint os_slo_handoff_notif_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_handoff_notif_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_handoff_notif_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_handoff_notif_pub_owner_unique
    unique (publication_id, owner_id, destination_key)
);

create index if not exists os_slo_handoff_notif_pub_idx
  on public.os_slo_handoff_digest_notifications(publication_id,created_at desc);
create index if not exists os_slo_handoff_notif_owner_idx
  on public.os_slo_handoff_digest_notifications(owner_id,created_at desc);

-- ---------------------------------------------------------------------------
-- Ownership-change visibility with upcoming handoff windows
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_ownership_change_visibility (
  visibility_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique,
  ownership_id uuid,
  owner_id uuid references public.profiles(id),
  handoff_window_start timestamptz,
  handoff_window_end timestamptz,
  expires_at timestamptz,
  severity text not null default 'warning',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_own_vis_kind_check
    check (alert_kind in (
      'ownership_expiry_without_handoff',
      'upcoming_handoff_window'
    )),
  constraint os_slo_own_vis_severity_check
    check (severity in ('info','warning','critical')),
  constraint os_slo_own_vis_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_own_vis_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_own_vis_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096),
  constraint os_slo_own_vis_window_order_check
    check (
      handoff_window_start is null
      or handoff_window_end is null
      or handoff_window_start<=handoff_window_end
    )
);

create index if not exists os_slo_own_vis_kind_idx
  on public.os_slo_ownership_change_visibility(alert_kind,created_at desc);
create index if not exists os_slo_own_vis_handoff_window_idx
  on public.os_slo_ownership_change_visibility(
    handoff_window_start,handoff_window_end
  );

create or replace function public.prevent_slo_phase47_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_handoff_notif_append_only
  on public.os_slo_handoff_digest_notifications;
create trigger os_slo_handoff_notif_append_only before update or delete
  on public.os_slo_handoff_digest_notifications for each row
  execute function public.prevent_slo_phase47_append_only();
drop trigger if exists os_slo_handoff_notif_no_truncate
  on public.os_slo_handoff_digest_notifications;
create trigger os_slo_handoff_notif_no_truncate before truncate
  on public.os_slo_handoff_digest_notifications for each statement
  execute function public.prevent_slo_phase47_append_only();

drop trigger if exists os_slo_own_vis_append_only
  on public.os_slo_ownership_change_visibility;
create trigger os_slo_own_vis_append_only before update or delete
  on public.os_slo_ownership_change_visibility for each row
  execute function public.prevent_slo_phase47_append_only();
drop trigger if exists os_slo_own_vis_no_truncate
  on public.os_slo_ownership_change_visibility;
create trigger os_slo_own_vis_no_truncate before truncate
  on public.os_slo_ownership_change_visibility for each statement
  execute function public.prevent_slo_phase47_append_only();

-- Notify owners after a digest publication (ledger only — not full push).
create or replace function public.notify_slo_handoff_digest_owners_phase47(
  p_actor_id uuid default null,
  p_publication_id uuid default null,
  p_destination_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pub public.os_slo_owner_handoff_digest_publications%rowtype;
  v_dest text;
  v_owner record;
  v_existing public.os_slo_handoff_digest_notifications%rowtype;
  v_notification_id uuid;
  v_window text;
  v_hash text;
  v_recorded integer:=0;
  v_replayed integer:=0;
  v_skipped integer:=0;
  v_status text;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to notify handoff digest owners';
  end if;

  if p_publication_id is null then
    select * into v_pub from public.os_slo_owner_handoff_digest_publications p
      where p.publish_status='published'
      order by p.published_at desc nulls last, p.created_at desc
      limit 1;
  else
    select * into v_pub from public.os_slo_owner_handoff_digest_publications
      where publication_id=p_publication_id;
  end if;

  if not found then
    return jsonb_build_object(
      'ok',true,'skipped',true,
      'reason','no_published_digest',
      'notifications_recorded',0,
      'production_alerts_mutated',false,
      'contract_version','phase47-v1'
    );
  end if;

  if v_pub.publish_status is distinct from 'published' then
    return jsonb_build_object(
      'ok',true,'skipped',true,
      'reason','publication_not_published',
      'publication_id',v_pub.publication_id,
      'publish_status',v_pub.publish_status,
      'notifications_recorded',0,
      'production_alerts_mutated',false,
      'contract_version','phase47-v1'
    );
  end if;

  v_dest:=coalesce(
    nullif(trim(p_destination_key),''),
    v_pub.destination_key,
    'ops_alerts'
  );
  if v_dest !~ '^[a-z][a-z0-9_]{0,62}$' then
    raise exception 'Handoff digest notification destination_key is invalid';
  end if;

  for v_owner in
    select distinct o.owner_id
    from public.os_slo_owners o
    where o.active
      and o.owner_id is not null
    order by o.owner_id
    limit 500
  loop
    v_window:='phase47:handoff_notif:'||v_pub.publication_id::text||':'||
      v_owner.owner_id::text||':'||v_dest;

    select * into v_existing from public.os_slo_handoff_digest_notifications
      where window_key=v_window;
    if found then
      v_replayed:=v_replayed+1;
      continue;
    end if;

    v_status:='notified';
    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase47-v1',
      'destination_key',v_dest,
      'digest_quarter',v_pub.digest_quarter,
      'owner_id',v_owner.owner_id,
      'publication_id',v_pub.publication_id,
      'delivery_status',v_status
    )::text);

    insert into public.os_slo_handoff_digest_notifications(
      publication_id,destination_key,owner_id,delivery_status,
      window_key,metrics_sha256,detail
    ) values (
      v_pub.publication_id,v_dest,v_owner.owner_id,v_status,v_window,v_hash,
      jsonb_build_object(
        'contract_version','phase47-v1',
        'digest_quarter',v_pub.digest_quarter,
        'notified_by',p_actor_id,
        'source','notify_slo_handoff_digest_owners_phase47'
      )
    ) returning notification_id into v_notification_id;
    v_recorded:=v_recorded+1;
  end loop;

  if v_recorded=0 and v_replayed=0 then
    v_skipped:=1;
  end if;

  return jsonb_build_object(
    'ok',true,
    'publication_id',v_pub.publication_id,
    'digest_quarter',v_pub.digest_quarter,
    'destination_key',v_dest,
    'notifications_recorded',v_recorded,
    'notifications_replayed',v_replayed,
    'skipped',v_skipped>0,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase47-v1'
  );
end $$;

create or replace function public.record_slo_ownership_change_visibility_phase47(
  p_alert_kind text,
  p_window_key text,
  p_severity text default 'warning',
  p_ownership_id uuid default null,
  p_owner_id uuid default null,
  p_handoff_window_start timestamptz default null,
  p_handoff_window_end timestamptz default null,
  p_expires_at timestamptz default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_slo_ownership_change_visibility%rowtype;
  v_visibility_id uuid;
  v_hash text;
begin
  if p_alert_kind not in (
       'ownership_expiry_without_handoff','upcoming_handoff_window'
     )
     or coalesce(p_window_key,'') !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or coalesce(p_severity,'warning') not in ('info','warning','critical')
     or not public.phase47_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
     or (
       p_handoff_window_start is not null
       and p_handoff_window_end is not null
       and p_handoff_window_start>p_handoff_window_end
     )
  then
    raise exception 'Phase 47 ownership-change visibility input failed';
  end if;

  select * into v_existing from public.os_slo_ownership_change_visibility
    where window_key=p_window_key;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'visibility_id',v_existing.visibility_id,
      'alert_kind',v_existing.alert_kind
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'alert_kind',p_alert_kind,
    'contract_version','phase47-v1',
    'detail',coalesce(p_detail,'{}'::jsonb),
    'expires_at',p_expires_at,
    'handoff_window_end',p_handoff_window_end,
    'handoff_window_start',p_handoff_window_start,
    'owner_id',p_owner_id,
    'ownership_id',p_ownership_id,
    'severity',coalesce(p_severity,'warning'),
    'window_key',p_window_key
  )::text);

  insert into public.os_slo_ownership_change_visibility(
    alert_kind,window_key,ownership_id,owner_id,
    handoff_window_start,handoff_window_end,expires_at,
    severity,metrics_sha256,detail
  ) values (
    p_alert_kind,p_window_key,p_ownership_id,p_owner_id,
    p_handoff_window_start,p_handoff_window_end,p_expires_at,
    coalesce(p_severity,'warning'),v_hash,coalesce(p_detail,'{}'::jsonb)
  ) returning visibility_id into v_visibility_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'visibility_id',v_visibility_id,
    'alert_kind',p_alert_kind,
    'window_key',p_window_key,
    'metrics_sha256',v_hash
  );
end $$;

create or replace function public.scan_slo_ownership_change_visibility_phase47(
  p_actor_id uuid default null,
  p_days_ahead integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recorded integer:=0;
  v_windows integer:=0;
  v_one jsonb;
  v_row record;
  v_days integer:=least(greatest(coalesce(p_days_ahead,60),1),180);
  v_window_start timestamptz;
  v_window_end timestamptz;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan ownership-change visibility';
  end if;

  -- Expiry without accepted handoff (richer visibility ledger).
  for v_row in
    select o.ownership_id,o.owner_id,o.expires_at
    from public.os_slo_owners o
    where o.active
      and o.expires_at is not null
      and o.expires_at>now()
      and o.expires_at<=now()+(v_days||' days')::interval
      and not exists (
        select 1 from public.os_slo_owner_handoff_suggestions s
        where s.ownership_id=o.ownership_id
          and s.status='accepted'
      )
    order by o.expires_at,o.ownership_id
    limit 200
  loop
    v_one:=public.record_slo_ownership_change_visibility_phase47(
      'ownership_expiry_without_handoff',
      'phase47:ownership_expiry:'||v_row.ownership_id::text||':'||
        to_char(v_row.expires_at at time zone 'utc','YYYY-MM-DD'),
      case when v_row.expires_at<=now()+interval '14 days' then 'critical' else 'warning' end,
      v_row.ownership_id,
      v_row.owner_id,
      greatest(now(), v_row.expires_at - interval '30 days'),
      v_row.expires_at,
      v_row.expires_at,
      jsonb_build_object(
        'days_ahead',v_days,
        'source','scan_slo_ownership_change_visibility_phase47'
      )
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_recorded:=v_recorded+1;
    end if;
  end loop;

  -- Upcoming handoff windows for active ownership approaching expiry
  -- (with or without accepted suggestions — visibility of the window itself).
  for v_row in
    select o.ownership_id,o.owner_id,o.expires_at,
      exists (
        select 1 from public.os_slo_owner_handoff_suggestions s
        where s.ownership_id=o.ownership_id and s.status='accepted'
      ) as has_accepted_handoff
    from public.os_slo_owners o
    where o.active
      and o.expires_at is not null
      and o.expires_at>now()
      and o.expires_at<=now()+(v_days||' days')::interval
    order by o.expires_at,o.ownership_id
    limit 200
  loop
    v_window_start:=greatest(now(), v_row.expires_at - interval '30 days');
    v_window_end:=v_row.expires_at;
    v_one:=public.record_slo_ownership_change_visibility_phase47(
      'upcoming_handoff_window',
      'phase47:handoff_window:'||v_row.ownership_id::text||':'||
        to_char(v_row.expires_at at time zone 'utc','YYYY-MM-DD'),
      case
        when v_row.expires_at<=now()+interval '14 days' then 'critical'
        when v_row.expires_at<=now()+interval '30 days' then 'warning'
        else 'info'
      end,
      v_row.ownership_id,
      v_row.owner_id,
      v_window_start,
      v_window_end,
      v_row.expires_at,
      jsonb_build_object(
        'days_ahead',v_days,
        'has_accepted_handoff',v_row.has_accepted_handoff,
        'source','scan_slo_ownership_change_visibility_phase47'
      )
    );
    if coalesce((v_one->>'replayed')::boolean,false)=false then
      v_windows:=v_windows+1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'expiry_visibility_recorded',v_recorded,
    'handoff_windows_recorded',v_windows,
    'days_ahead',v_days,
    'production_alerts_mutated',false,
    'contract_version','phase47-v1'
  );
end $$;

create or replace function public.get_slo_phase47_governance_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_upcoming jsonb:='[]'::jsonb;
  v_windows jsonb:='[]'::jsonb;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 47 governance report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sort_at), '[]'::jsonb)
    into v_upcoming
  from (
    select
      v.alert_kind,
      v.visibility_id,
      v.ownership_id,
      v.owner_id,
      v.expires_at as sort_at,
      v.expires_at,
      v.handoff_window_start,
      v.handoff_window_end,
      v.severity
    from public.os_slo_ownership_change_visibility v
    where v.alert_kind='ownership_expiry_without_handoff'
      and v.created_at>=now()-interval '30 days'
    order by sort_at nulls last
    limit 40
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.sort_at), '[]'::jsonb)
    into v_windows
  from (
    select
      v.visibility_id,
      v.ownership_id,
      v.owner_id,
      v.handoff_window_start as sort_at,
      v.handoff_window_start,
      v.handoff_window_end,
      v.expires_at,
      v.severity,
      v.detail
    from public.os_slo_ownership_change_visibility v
    where v.alert_kind='upcoming_handoff_window'
      and (
        v.handoff_window_end is null
        or v.handoff_window_end>=now()
      )
    order by sort_at nulls last
    limit 40
  ) t;

  return jsonb_build_object(
    'digest_notifications',
      (select count(*) from public.os_slo_handoff_digest_notifications),
    'digest_notifications_notified',
      (select count(*) from public.os_slo_handoff_digest_notifications
        where delivery_status='notified'),
    'digest_notifications_30d',
      (select count(*) from public.os_slo_handoff_digest_notifications
        where created_at>=now()-interval '30 days'),
    'ownership_visibility_30d',
      (select count(*) from public.os_slo_ownership_change_visibility
        where created_at>=now()-interval '30 days'),
    'upcoming_handoff_windows',v_windows,
    'upcoming_handoff_window_count',jsonb_array_length(v_windows),
    'ownership_expiry_without_handoff',v_upcoming,
    'ownership_expiry_without_handoff_count',jsonb_array_length(v_upcoming),
    'production_alerts_mutated',false,
    'full_push',false,
    'live_succession_mutated',false,
    'contract_version','phase47-v1'
  );
end $$;

alter table public.os_slo_handoff_digest_notifications enable row level security;
alter table public.os_slo_ownership_change_visibility enable row level security;

drop policy if exists "os_slo_handoff_notif_select"
  on public.os_slo_handoff_digest_notifications;
create policy "os_slo_handoff_notif_select"
  on public.os_slo_handoff_digest_notifications for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_own_vis_select"
  on public.os_slo_ownership_change_visibility;
create policy "os_slo_own_vis_select"
  on public.os_slo_ownership_change_visibility for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_handoff_digest_notifications,
  public.os_slo_ownership_change_visibility
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_handoff_digest_notifications,
  public.os_slo_ownership_change_visibility
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase47_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.notify_slo_handoff_digest_owners_phase47(
  uuid,uuid,text
) from public,authenticated;
revoke all on function public.record_slo_ownership_change_visibility_phase47(
  text,text,text,uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb
) from public,authenticated;
revoke all on function public.scan_slo_ownership_change_visibility_phase47(
  uuid,integer
) from public,authenticated;
revoke all on function public.get_slo_phase47_governance_report()
  from public,anon;

grant execute on function public.phase47_slo_safe_detail(jsonb),
  public.get_slo_phase47_governance_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.notify_slo_handoff_digest_owners_phase47(uuid,uuid,text),
  public.record_slo_ownership_change_visibility_phase47(
    text,text,text,uuid,uuid,timestamptz,timestamptz,timestamptz,jsonb
  ),
  public.scan_slo_ownership_change_visibility_phase47(uuid,integer)
  to service_role;
