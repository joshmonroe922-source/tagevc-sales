-- Phase 48: allowlisted owner digest webhooks + notification delivery SLO
-- tracking and visibility. NOT a full push notification system.
-- Apply after phase47_slo_governance_ops.sql.
-- Counterfactual / governance only — never mutates os_slo_alerts evaluation
-- or production delivery paths. Digest webhook delivery is a separate
-- append-only ledger with allowlisted destination keys.

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

create or replace function public.phase48_slo_safe_detail(p_detail jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(p_detail)='object'
    and pg_column_size(p_detail)<=4096
    and p_detail::text !~*
      '"[^"]*(payload|secret|token|password|authorization|cookie|body|email|webhook_url)[^"]*"\s*:'
    and p_detail::text !~*
      '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
$$;

-- ---------------------------------------------------------------------------
-- Bootstrap Phase 47 digest notification ledger (required for delivery FK)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_handoff_digest_notifications (
  notification_id uuid primary key default gen_random_uuid(),
  publication_id uuid not null,
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

-- ---------------------------------------------------------------------------
-- Allowlisted owner digest webhook destinations (keys + host fingerprint only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_owner_digest_webhook_allowlist (
  allowlist_id uuid primary key default gen_random_uuid(),
  destination_key text not null unique,
  host_sha256 text not null,
  allowlist_status text not null default 'active',
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  constraint os_slo_owner_digest_wl_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_owner_digest_wl_host_check
    check (host_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_owner_digest_wl_status_check
    check (allowlist_status in ('active','paused','revoked')),
  constraint os_slo_owner_digest_wl_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_owner_digest_wl_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_owner_digest_wl_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_owner_digest_wl_status_idx
  on public.os_slo_owner_digest_webhook_allowlist(allowlist_status,created_at desc);

-- ---------------------------------------------------------------------------
-- Digest notification webhook delivery attempts (not full push)
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_digest_notification_deliveries (
  delivery_id uuid primary key default gen_random_uuid(),
  notification_id uuid
    references public.os_slo_handoff_digest_notifications(notification_id),
  destination_key text not null,
  delivery_status text not null,
  response_code integer,
  window_key text not null unique,
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_digest_del_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_digest_del_status_check
    check (delivery_status in (
      'delivered','failed','skipped_no_webhook','skipped_not_allowlisted','replayed'
    )),
  constraint os_slo_digest_del_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_digest_del_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_digest_del_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_digest_del_dest_idx
  on public.os_slo_digest_notification_deliveries(destination_key,created_at desc);
create index if not exists os_slo_digest_del_status_idx
  on public.os_slo_digest_notification_deliveries(delivery_status,created_at desc);

-- ---------------------------------------------------------------------------
-- Notification delivery SLO snapshots + visibility alerts
-- ---------------------------------------------------------------------------
create table if not exists public.os_slo_digest_notification_delivery_slo (
  snapshot_id uuid primary key default gen_random_uuid(),
  destination_key text not null,
  window_key text not null unique,
  window_days integer not null,
  delivered_count integer not null default 0,
  failed_count integer not null default 0,
  skipped_count integer not null default 0,
  success_rate numeric(6,4),
  severity text not null default 'healthy',
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_digest_slo_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_digest_slo_days_check
    check (window_days between 1 and 90),
  constraint os_slo_digest_slo_counts_check
    check (
      delivered_count>=0 and failed_count>=0 and skipped_count>=0
      and delivered_count<=1000000 and failed_count<=1000000
      and skipped_count<=1000000
    ),
  constraint os_slo_digest_slo_rate_check
    check (success_rate is null or (success_rate>=0 and success_rate<=1)),
  constraint os_slo_digest_slo_severity_check
    check (severity in ('healthy','warning','critical')),
  constraint os_slo_digest_slo_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_digest_slo_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_digest_slo_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_digest_slo_dest_idx
  on public.os_slo_digest_notification_delivery_slo(destination_key,created_at desc);

create table if not exists public.os_slo_digest_notification_delivery_visibility (
  visibility_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  destination_key text not null,
  window_key text not null unique,
  severity text not null default 'warning',
  success_rate numeric(6,4),
  metrics_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_slo_digest_vis_kind_check
    check (alert_kind in (
      'delivery_slo_warning','delivery_slo_critical','allowlist_empty'
    )),
  constraint os_slo_digest_vis_dest_check
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  constraint os_slo_digest_vis_severity_check
    check (severity in ('info','warning','critical')),
  constraint os_slo_digest_vis_window_check
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  constraint os_slo_digest_vis_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_slo_digest_vis_detail_check
    check (jsonb_typeof(detail)='object' and pg_column_size(detail)<=4096)
);

create index if not exists os_slo_digest_vis_kind_idx
  on public.os_slo_digest_notification_delivery_visibility(alert_kind,created_at desc);

create or replace function public.prevent_slo_phase48_append_only()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;

drop trigger if exists os_slo_owner_digest_wl_append_only
  on public.os_slo_owner_digest_webhook_allowlist;
create trigger os_slo_owner_digest_wl_append_only before update or delete
  on public.os_slo_owner_digest_webhook_allowlist for each row
  execute function public.prevent_slo_phase48_append_only();
drop trigger if exists os_slo_owner_digest_wl_no_truncate
  on public.os_slo_owner_digest_webhook_allowlist;
create trigger os_slo_owner_digest_wl_no_truncate before truncate
  on public.os_slo_owner_digest_webhook_allowlist for each statement
  execute function public.prevent_slo_phase48_append_only();

drop trigger if exists os_slo_digest_del_append_only
  on public.os_slo_digest_notification_deliveries;
create trigger os_slo_digest_del_append_only before update or delete
  on public.os_slo_digest_notification_deliveries for each row
  execute function public.prevent_slo_phase48_append_only();
drop trigger if exists os_slo_digest_del_no_truncate
  on public.os_slo_digest_notification_deliveries;
create trigger os_slo_digest_del_no_truncate before truncate
  on public.os_slo_digest_notification_deliveries for each statement
  execute function public.prevent_slo_phase48_append_only();

drop trigger if exists os_slo_digest_slo_append_only
  on public.os_slo_digest_notification_delivery_slo;
create trigger os_slo_digest_slo_append_only before update or delete
  on public.os_slo_digest_notification_delivery_slo for each row
  execute function public.prevent_slo_phase48_append_only();
drop trigger if exists os_slo_digest_slo_no_truncate
  on public.os_slo_digest_notification_delivery_slo;
create trigger os_slo_digest_slo_no_truncate before truncate
  on public.os_slo_digest_notification_delivery_slo for each statement
  execute function public.prevent_slo_phase48_append_only();

drop trigger if exists os_slo_digest_vis_append_only
  on public.os_slo_digest_notification_delivery_visibility;
create trigger os_slo_digest_vis_append_only before update or delete
  on public.os_slo_digest_notification_delivery_visibility for each row
  execute function public.prevent_slo_phase48_append_only();
drop trigger if exists os_slo_digest_vis_no_truncate
  on public.os_slo_digest_notification_delivery_visibility;
create trigger os_slo_digest_vis_no_truncate before truncate
  on public.os_slo_digest_notification_delivery_visibility for each statement
  execute function public.prevent_slo_phase48_append_only();

-- Register allowlisted destination_key + host fingerprint (never stores URL).
create or replace function public.register_slo_owner_digest_webhook_allowlist_phase48(
  p_actor_id uuid,
  p_destination_key text,
  p_host_sha256 text,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.os_slo_owner_digest_webhook_allowlist%rowtype;
  v_allowlist_id uuid;
  v_window text;
  v_hash text;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to register digest webhook allowlist';
  end if;

  if coalesce(p_destination_key,'') !~ '^[a-z][a-z0-9_]{0,62}$'
     or coalesce(p_host_sha256,'') !~ '^[0-9a-f]{64}$'
     or not public.phase48_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 48 digest webhook allowlist input failed';
  end if;

  v_window:='phase48:owner_digest_wl:'||p_destination_key||':'||
    left(p_host_sha256,16);

  select * into v_existing from public.os_slo_owner_digest_webhook_allowlist
    where destination_key=p_destination_key;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'allowlist_id',v_existing.allowlist_id,
      'destination_key',v_existing.destination_key,
      'allowlist_status',v_existing.allowlist_status,
      'full_push',false,
      'contract_version','phase48-v1'
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase48-v1',
    'destination_key',p_destination_key,
    'host_sha256',p_host_sha256,
    'window_key',v_window
  )::text);

  insert into public.os_slo_owner_digest_webhook_allowlist(
    destination_key,host_sha256,allowlist_status,window_key,
    metrics_sha256,detail,actor_id
  ) values (
    p_destination_key,p_host_sha256,'active',v_window,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'contract_version','phase48-v1',
      'source','register_slo_owner_digest_webhook_allowlist_phase48'
    ),
    p_actor_id
  ) returning allowlist_id into v_allowlist_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'allowlist_id',v_allowlist_id,
    'destination_key',p_destination_key,
    'allowlist_status','active',
    'full_push',false,
    'contract_version','phase48-v1'
  );
end $$;

-- Record a single owner-digest webhook delivery attempt (ledger only).
create or replace function public.record_slo_digest_notification_delivery_phase48(
  p_actor_id uuid default null,
  p_notification_id uuid default null,
  p_destination_key text default null,
  p_delivery_status text default null,
  p_response_code integer default null,
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dest text;
  v_status text;
  v_existing public.os_slo_digest_notification_deliveries%rowtype;
  v_delivery_id uuid;
  v_window text;
  v_hash text;
  v_allowlisted boolean:=false;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to record digest notification delivery';
  end if;

  v_dest:=coalesce(nullif(trim(p_destination_key),''),'owner_digest');
  v_status:=coalesce(nullif(trim(p_delivery_status),''),'failed');

  if v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_status not in (
       'delivered','failed','skipped_no_webhook','skipped_not_allowlisted','replayed'
     )
     or not public.phase48_slo_safe_detail(coalesce(p_detail,'{}'::jsonb))
  then
    raise exception 'Phase 48 digest notification delivery input failed';
  end if;

  select exists (
    select 1 from public.os_slo_owner_digest_webhook_allowlist a
    where a.destination_key=v_dest and a.allowlist_status='active'
  ) into v_allowlisted;

  if not v_allowlisted and v_status='delivered' then
    v_status:='skipped_not_allowlisted';
  end if;

  v_window:=case
    when p_notification_id is not null then
      'phase48:digest_del:'||p_notification_id::text||':'||v_dest
    else
      'phase48:digest_del:orphan:'||v_dest||':'||
        to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24:MI')
  end;

  select * into v_existing from public.os_slo_digest_notification_deliveries
    where window_key=v_window;
  if found then
    return jsonb_build_object(
      'ok',true,'replayed',true,
      'delivery_id',v_existing.delivery_id,
      'delivery_status',v_existing.delivery_status,
      'destination_key',v_existing.destination_key,
      'full_push',false,
      'contract_version','phase48-v1'
    );
  end if;

  v_hash:=public.os_sha256_hex(jsonb_build_object(
    'contract_version','phase48-v1',
    'delivery_status',v_status,
    'destination_key',v_dest,
    'notification_id',p_notification_id,
    'response_code',p_response_code,
    'window_key',v_window
  )::text);

  insert into public.os_slo_digest_notification_deliveries(
    notification_id,destination_key,delivery_status,response_code,
    window_key,metrics_sha256,detail
  ) values (
    p_notification_id,v_dest,v_status,p_response_code,v_window,v_hash,
    coalesce(p_detail,'{}'::jsonb)||jsonb_build_object(
      'allowlisted',v_allowlisted,
      'contract_version','phase48-v1',
      'source','record_slo_digest_notification_delivery_phase48'
    )
  ) returning delivery_id into v_delivery_id;

  return jsonb_build_object(
    'ok',true,'replayed',false,
    'delivery_id',v_delivery_id,
    'destination_key',v_dest,
    'delivery_status',v_status,
    'allowlisted',v_allowlisted,
    'full_push',false,
    'production_alerts_mutated',false,
    'contract_version','phase48-v1'
  );
end $$;

-- Scan delivery attempts into SLO snapshots + visibility alerts.
create or replace function public.scan_slo_digest_notification_delivery_slo_phase48(
  p_actor_id uuid default null,
  p_days integer default 30
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer:=least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz:=now()-(v_days||' days')::interval;
  v_row record;
  v_recorded integer:=0;
  v_alerts integer:=0;
  v_success numeric;
  v_severity text;
  v_attempted integer;
  v_window text;
  v_hash text;
  v_vis_kind text;
  v_vis_window text;
  v_existing_vis public.os_slo_digest_notification_delivery_visibility%rowtype;
  v_allowlist_count integer:=0;
begin
  if p_actor_id is not null
     and not public.phase39_actor_authorized(p_actor_id,null,true)
     and auth.role() is distinct from 'service_role' then
    raise exception 'Actor is not authorized to scan digest notification delivery SLOs';
  end if;

  select count(*) into v_allowlist_count
  from public.os_slo_owner_digest_webhook_allowlist
  where allowlist_status='active';

  if v_allowlist_count=0 then
    v_vis_window:='phase48:allowlist_empty:'||
      to_char(now() at time zone 'utc','YYYY-MM-DD');
    select * into v_existing_vis
      from public.os_slo_digest_notification_delivery_visibility
      where window_key=v_vis_window;
    if not found then
      v_hash:=public.os_sha256_hex(jsonb_build_object(
        'alert_kind','allowlist_empty',
        'contract_version','phase48-v1',
        'window_key',v_vis_window
      )::text);
      insert into public.os_slo_digest_notification_delivery_visibility(
        alert_kind,destination_key,window_key,severity,success_rate,
        metrics_sha256,detail
      ) values (
        'allowlist_empty','owner_digest',v_vis_window,'info',null,v_hash,
        jsonb_build_object(
          'contract_version','phase48-v1',
          'source','scan_slo_digest_notification_delivery_slo_phase48'
        )
      );
      v_alerts:=v_alerts+1;
    end if;
  end if;

  for v_row in
    select d.destination_key,
      count(*) filter (where d.delivery_status='delivered')::integer as delivered_count,
      count(*) filter (where d.delivery_status='failed')::integer as failed_count,
      count(*) filter (where d.delivery_status in (
        'skipped_no_webhook','skipped_not_allowlisted'
      ))::integer as skipped_count
    from public.os_slo_digest_notification_deliveries d
    where d.created_at>=v_since
    group by d.destination_key
    order by d.destination_key
    limit 100
  loop
    v_attempted:=v_row.delivered_count+v_row.failed_count;
    if v_attempted=0 then
      v_success:=null;
      v_severity:='healthy';
    else
      v_success:=round(
        (v_row.delivered_count::numeric / v_attempted::numeric),4
      );
      if v_success<0.8000 then
        v_severity:='critical';
      elsif v_success<0.9500 then
        v_severity:='warning';
      else
        v_severity:='healthy';
      end if;
    end if;

    v_window:='phase48:digest_slo:'||v_row.destination_key||':'||
      to_char(now() at time zone 'utc','YYYY-MM-DD')||':'||v_days::text;

    if exists (
      select 1 from public.os_slo_digest_notification_delivery_slo s
      where s.window_key=v_window
    ) then
      continue;
    end if;

    v_hash:=public.os_sha256_hex(jsonb_build_object(
      'contract_version','phase48-v1',
      'delivered',v_row.delivered_count,
      'destination_key',v_row.destination_key,
      'failed',v_row.failed_count,
      'severity',v_severity,
      'skipped',v_row.skipped_count,
      'success_rate',v_success,
      'window_days',v_days,
      'window_key',v_window
    )::text);

    insert into public.os_slo_digest_notification_delivery_slo(
      destination_key,window_key,window_days,delivered_count,failed_count,
      skipped_count,success_rate,severity,metrics_sha256,detail
    ) values (
      v_row.destination_key,v_window,v_days,
      v_row.delivered_count,v_row.failed_count,v_row.skipped_count,
      v_success,v_severity,v_hash,
      jsonb_build_object(
        'contract_version','phase48-v1',
        'metric','digest_notification_delivery_success_rate',
        'warning_threshold',0.9500,
        'critical_threshold',0.8000,
        'source','scan_slo_digest_notification_delivery_slo_phase48'
      )
    );
    v_recorded:=v_recorded+1;

    if v_severity in ('warning','critical') then
      v_vis_kind:=case
        when v_severity='critical' then 'delivery_slo_critical'
        else 'delivery_slo_warning'
      end;
      v_vis_window:='phase48:'||v_vis_kind||':'||v_row.destination_key||':'||
        to_char(now() at time zone 'utc','YYYY-MM-DD');
      select * into v_existing_vis
        from public.os_slo_digest_notification_delivery_visibility
        where window_key=v_vis_window;
      if not found then
        v_hash:=public.os_sha256_hex(jsonb_build_object(
          'alert_kind',v_vis_kind,
          'contract_version','phase48-v1',
          'destination_key',v_row.destination_key,
          'success_rate',v_success,
          'window_key',v_vis_window
        )::text);
        insert into public.os_slo_digest_notification_delivery_visibility(
          alert_kind,destination_key,window_key,severity,success_rate,
          metrics_sha256,detail
        ) values (
          v_vis_kind,v_row.destination_key,v_vis_window,v_severity,v_success,
          v_hash,
          jsonb_build_object(
            'contract_version','phase48-v1',
            'window_days',v_days,
            'source','scan_slo_digest_notification_delivery_slo_phase48'
          )
        );
        v_alerts:=v_alerts+1;
      end if;
    end if;
  end loop;

  return jsonb_build_object(
    'ok',true,
    'slo_snapshots_recorded',v_recorded,
    'visibility_alerts_recorded',v_alerts,
    'window_days',v_days,
    'active_allowlist_count',v_allowlist_count,
    'production_alerts_mutated',false,
    'full_push',false,
    'contract_version','phase48-v1'
  );
end $$;

create or replace function public.get_slo_phase48_governance_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_slo jsonb:='[]'::jsonb;
  v_visibility jsonb:='[]'::jsonb;
begin
  if not public.is_firm_wide_access()
     and auth.role() is distinct from 'service_role' then
    raise exception 'Firm-wide access required for SLO Phase 48 governance report';
  end if;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_slo
  from (
    select
      s.snapshot_id,
      s.destination_key,
      s.window_days,
      s.delivered_count,
      s.failed_count,
      s.skipped_count,
      s.success_rate,
      s.severity,
      s.created_at
    from public.os_slo_digest_notification_delivery_slo s
    where s.created_at>=now()-interval '30 days'
    order by s.created_at desc
    limit 40
  ) t;

  select coalesce(jsonb_agg(row_to_json(t)::jsonb order by t.created_at desc),'[]'::jsonb)
    into v_visibility
  from (
    select
      v.visibility_id,
      v.alert_kind,
      v.destination_key,
      v.severity,
      v.success_rate,
      v.created_at
    from public.os_slo_digest_notification_delivery_visibility v
    where v.created_at>=now()-interval '30 days'
    order by v.created_at desc
    limit 40
  ) t;

  return jsonb_build_object(
    'owner_digest_allowlist_active',
      (select count(*) from public.os_slo_owner_digest_webhook_allowlist
        where allowlist_status='active'),
    'digest_deliveries_30d',
      (select count(*) from public.os_slo_digest_notification_deliveries
        where created_at>=now()-interval '30 days'),
    'digest_deliveries_delivered_30d',
      (select count(*) from public.os_slo_digest_notification_deliveries
        where created_at>=now()-interval '30 days'
          and delivery_status='delivered'),
    'digest_deliveries_failed_30d',
      (select count(*) from public.os_slo_digest_notification_deliveries
        where created_at>=now()-interval '30 days'
          and delivery_status='failed'),
    'delivery_slo_snapshots_30d',
      (select count(*) from public.os_slo_digest_notification_delivery_slo
        where created_at>=now()-interval '30 days'),
    'delivery_slo_critical_30d',
      (select count(*) from public.os_slo_digest_notification_delivery_slo
        where created_at>=now()-interval '30 days'
          and severity='critical'),
    'delivery_visibility_30d',jsonb_array_length(v_visibility),
    'recent_delivery_slos',v_slo,
    'recent_delivery_visibility',v_visibility,
    'production_alerts_mutated',false,
    'full_push',false,
    'live_succession_mutated',false,
    'contract_version','phase48-v1'
  );
end $$;

alter table public.os_slo_handoff_digest_notifications enable row level security;
alter table public.os_slo_owner_digest_webhook_allowlist enable row level security;
alter table public.os_slo_digest_notification_deliveries enable row level security;
alter table public.os_slo_digest_notification_delivery_slo enable row level security;
alter table public.os_slo_digest_notification_delivery_visibility enable row level security;

drop policy if exists "os_slo_owner_digest_wl_select"
  on public.os_slo_owner_digest_webhook_allowlist;
create policy "os_slo_owner_digest_wl_select"
  on public.os_slo_owner_digest_webhook_allowlist for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_digest_del_select"
  on public.os_slo_digest_notification_deliveries;
create policy "os_slo_digest_del_select"
  on public.os_slo_digest_notification_deliveries for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_digest_slo_select"
  on public.os_slo_digest_notification_delivery_slo;
create policy "os_slo_digest_slo_select"
  on public.os_slo_digest_notification_delivery_slo for select to authenticated
  using (public.is_firm_wide_access());
drop policy if exists "os_slo_digest_vis_select"
  on public.os_slo_digest_notification_delivery_visibility;
create policy "os_slo_digest_vis_select"
  on public.os_slo_digest_notification_delivery_visibility for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_slo_owner_digest_webhook_allowlist,
  public.os_slo_digest_notification_deliveries,
  public.os_slo_digest_notification_delivery_slo,
  public.os_slo_digest_notification_delivery_visibility
  to authenticated, service_role;
revoke insert,update,delete,truncate on
  public.os_slo_owner_digest_webhook_allowlist,
  public.os_slo_digest_notification_deliveries,
  public.os_slo_digest_notification_delivery_slo,
  public.os_slo_digest_notification_delivery_visibility
  from public,authenticated,service_role;

revoke all on function public.prevent_slo_phase48_append_only()
  from public,anon,authenticated,service_role;
revoke all on function public.register_slo_owner_digest_webhook_allowlist_phase48(
  uuid,text,text,jsonb
) from public,authenticated;
revoke all on function public.record_slo_digest_notification_delivery_phase48(
  uuid,uuid,text,text,integer,jsonb
) from public,authenticated;
revoke all on function public.scan_slo_digest_notification_delivery_slo_phase48(
  uuid,integer
) from public,authenticated;
revoke all on function public.get_slo_phase48_governance_report()
  from public,anon;

grant execute on function public.phase48_slo_safe_detail(jsonb),
  public.get_slo_phase48_governance_report(),
  public.os_sha256_hex(text)
  to authenticated, service_role;
grant execute on function public.register_slo_owner_digest_webhook_allowlist_phase48(
  uuid,text,text,jsonb
),
  public.record_slo_digest_notification_delivery_phase48(
    uuid,uuid,text,text,integer,jsonb
  ),
  public.scan_slo_digest_notification_delivery_slo_phase48(uuid,integer)
  to service_role;
