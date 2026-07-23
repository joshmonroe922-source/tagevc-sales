-- Phase 51: unified dual-approve INBOX covering postmortem publish
-- suggestions (Phase 49), breaker tuning proposals (Phase 50), and
-- promote-waive proposals (Phase 50) — one place to see everything awaiting
-- a first/second human approval. Apply after phase50_intune_resilience_ops.sql.
-- Observe-only: this file NEVER closes, resets, applies, or approves
-- anything on its own — it only reads the existing dual-approve gate
-- evidence tables and aggregates them for visibility. Aggregates NEVER
-- include entity identifiers.

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

-- Bootstrap Phase 49/50 sanitize helpers if prior Intune SQL was skipped.
create or replace function public.it_intune_phase49_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase50_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select public.it_intune_phase49_sanitize_aggregate(p_evidence);
$$;

create or replace function public.it_intune_phase51_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select public.it_intune_phase50_sanitize_aggregate(p_evidence);
$$;

-- ---------------------------------------------------------------------------
-- Append-only periodic rollups of the unified dual-approve inbox size, for
-- trend visibility. Never a mutation path — purely observational.
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase51_inbox_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  postmortem_pending integer not null default 0 check (postmortem_pending >= 0),
  breaker_tuning_pending integer not null default 0 check (breaker_tuning_pending >= 0),
  promote_waive_pending integer not null default 0 check (promote_waive_pending >= 0),
  total_pending integer not null default 0 check (total_pending >= 0),
  oldest_pending_hours numeric,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p51_inbox_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p51_inbox_no_auto_close check (
    coalesce((aggregate_evidence->>'closes_or_resets_breaker')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p51_inbox_recorded_idx
  on public.os_it_intune_phase51_inbox_snapshots(recorded_at desc);

alter table public.os_it_intune_phase51_inbox_snapshots
  enable row level security;
drop policy if exists "os_it_intune_p51_inbox_select"
  on public.os_it_intune_phase51_inbox_snapshots;
create policy "os_it_intune_p51_inbox_select"
  on public.os_it_intune_phase51_inbox_snapshots for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase51_inbox_snapshots to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase51_inbox_snapshots
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 51 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase51_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning',
  destination_key text not null default 'ops_alerts'
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null,
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p51_alert_kind_check
    check (alert_kind in (
      'dual_approve_inbox_backlog_critical',
      'dual_approve_inbox_stale_item'
    )),
  constraint os_it_intune_p51_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p51_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p51_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p51_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p51_alert_kind_recorded_idx
  on public.os_it_intune_phase51_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase51_ops_alerts
  enable row level security;
drop policy if exists "os_it_intune_p51_alert_select"
  on public.os_it_intune_phase51_ops_alerts;
create policy "os_it_intune_p51_alert_select"
  on public.os_it_intune_phase51_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase51_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase51_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase51_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 51 Intune dual-approve inbox evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p51_inbox_append_only
  on public.os_it_intune_phase51_inbox_snapshots;
create trigger os_it_intune_p51_inbox_append_only
  before update or delete
  on public.os_it_intune_phase51_inbox_snapshots
  for each row execute function public.prevent_it_intune_phase51_ops_mutation();
drop trigger if exists os_it_intune_p51_inbox_no_truncate
  on public.os_it_intune_phase51_inbox_snapshots;
create trigger os_it_intune_p51_inbox_no_truncate
  before truncate
  on public.os_it_intune_phase51_inbox_snapshots
  for each statement execute function public.prevent_it_intune_phase51_ops_mutation();

drop trigger if exists os_it_intune_p51_alert_append_only
  on public.os_it_intune_phase51_ops_alerts;
create trigger os_it_intune_p51_alert_append_only
  before update or delete
  on public.os_it_intune_phase51_ops_alerts
  for each row execute function public.prevent_it_intune_phase51_ops_mutation();
drop trigger if exists os_it_intune_p51_alert_no_truncate
  on public.os_it_intune_phase51_ops_alerts;
create trigger os_it_intune_p51_alert_no_truncate
  before truncate
  on public.os_it_intune_phase51_ops_alerts
  for each statement execute function public.prevent_it_intune_phase51_ops_mutation();

-- ---------------------------------------------------------------------------
-- Unified dual-approve inbox — read-only union of postmortem publish
-- suggestions, breaker tuning proposals, and promote-waive proposals that
-- are each currently 'awaiting_second_approval' (i.e. exactly 1 distinct
-- approver so far). Observe-only: never applies, approves, closes, or
-- resets anything. Aggregates NEVER include entity identifiers.
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_dual_approve_inbox_phase51(
  p_limit integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit,50),1),200);
  v_items jsonb := '[]'::jsonb;
  v_part jsonb;
  v_postmortem_count integer := 0;
  v_tuning_count integer := 0;
  v_waive_count integer := 0;
begin
  select coalesce(jsonb_agg(jsonb_build_object(
      'kind','postmortem_publish',
      'reference_id',x.postmortem_id,
      'distinct_approvers',x.distinct_approvers,
      'awaiting_since',x.recorded_at
    ) order by x.recorded_at asc), '[]'::jsonb),
    count(*)
  into v_part, v_postmortem_count
  from (
    select distinct on (e.postmortem_id)
      e.postmortem_id, e.distinct_approvers, e.recorded_at, e.disposition
    from public.os_it_intune_postmortem_publish_events e
    order by e.postmortem_id, e.recorded_at desc
  ) x
  where x.disposition = 'awaiting_second_approval';
  v_items := v_items || coalesce(v_part,'[]'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind','breaker_tuning',
      'reference_id',x.proposal_id,
      'distinct_approvers',x.distinct_approvers,
      'awaiting_since',x.recorded_at
    ) order by x.recorded_at asc), '[]'::jsonb),
    count(*)
  into v_part, v_tuning_count
  from (
    select distinct on (e.proposal_id)
      e.proposal_id, e.distinct_approvers, e.recorded_at, e.disposition
    from public.os_it_intune_breaker_tuning_phase50_apply_events e
    order by e.proposal_id, e.recorded_at desc
  ) x
  where x.disposition = 'awaiting_second_approval';
  v_items := v_items || coalesce(v_part,'[]'::jsonb);

  select coalesce(jsonb_agg(jsonb_build_object(
      'kind','promote_waive',
      'reference_id',x.waive_proposal_id,
      'distinct_approvers',x.distinct_approvers,
      'awaiting_since',x.recorded_at
    ) order by x.recorded_at asc), '[]'::jsonb),
    count(*)
  into v_part, v_waive_count
  from (
    select distinct on (e.waive_proposal_id)
      e.waive_proposal_id, e.distinct_approvers, e.recorded_at, e.disposition
    from public.os_it_intune_promote_waive_phase50_apply_events e
    order by e.waive_proposal_id, e.recorded_at desc
  ) x
  where x.disposition = 'awaiting_second_approval';
  v_items := v_items || coalesce(v_part,'[]'::jsonb);

  select coalesce(jsonb_agg(t order by (t->>'awaiting_since')::timestamptz asc),'[]'::jsonb)
  into v_items
  from (
    select jsonb_array_elements(v_items) as t
  ) elems
  limit v_limit;

  return jsonb_build_object(
    'version','phase51-v1',
    'postmortem_pending_count',coalesce(v_postmortem_count,0),
    'breaker_tuning_pending_count',coalesce(v_tuning_count,0),
    'promote_waive_pending_count',coalesce(v_waive_count,0),
    'total_pending_count',
      coalesce(v_postmortem_count,0)+coalesce(v_tuning_count,0)+coalesce(v_waive_count,0),
    'items',coalesce(v_items,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- Roll up the current unified inbox into an append-only snapshot for trend
-- visibility, raising a backlog-critical alert when the total pending count
-- or oldest item's age exceeds thresholds. Observe-only.
create or replace function public.record_it_intune_phase51_inbox_snapshot(
  p_actor_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=public as $$
declare
  v_inbox jsonb;
  v_total integer;
  v_postmortem integer;
  v_tuning integer;
  v_waive integer;
  v_oldest_hours numeric;
  v_window text;
  v_hash text;
  v_id uuid;
  v_evidence jsonb;
begin
  v_inbox := public.list_it_intune_dual_approve_inbox_phase51(200);
  v_total := coalesce((v_inbox->>'total_pending_count')::integer,0);
  v_postmortem := coalesce((v_inbox->>'postmortem_pending_count')::integer,0);
  v_tuning := coalesce((v_inbox->>'breaker_tuning_pending_count')::integer,0);
  v_waive := coalesce((v_inbox->>'promote_waive_pending_count')::integer,0);

  select extract(epoch from (now()-min((item->>'awaiting_since')::timestamptz)))/3600.0
  into v_oldest_hours
  from jsonb_array_elements(coalesce(v_inbox->'items','[]'::jsonb)) item;

  v_window := 'phase51:inbox:' || to_char(now() at time zone 'utc','YYYY-MM-DD-HH24');
  if exists (
    select 1 from public.os_it_intune_phase51_inbox_snapshots s
    where s.window_key=v_window
  ) then
    select snapshot_id into v_id from public.os_it_intune_phase51_inbox_snapshots
      where window_key=v_window;
    return jsonb_build_object(
      'snapshot_id',v_id,
      'already_recorded_this_hour',true,
      'total_pending',v_total,
      'closes_or_resets_breaker',false);
  end if;

  v_evidence := public.it_intune_phase51_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase51-v1',
    'total_pending',v_total,
    'postmortem_pending',v_postmortem,
    'breaker_tuning_pending',v_tuning,
    'promote_waive_pending',v_waive,
    'closes_or_resets_breaker',false
  ));
  v_hash := public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase51_inbox_snapshots(
    window_key,postmortem_pending,breaker_tuning_pending,promote_waive_pending,
    total_pending,oldest_pending_hours,aggregate_evidence,evidence_sha256
  ) values (
    v_window,v_postmortem,v_tuning,v_waive,v_total,v_oldest_hours,v_evidence,v_hash
  ) returning snapshot_id into v_id;

  return jsonb_build_object(
    'snapshot_id',v_id,
    'total_pending',v_total,
    'postmortem_pending',v_postmortem,
    'breaker_tuning_pending',v_tuning,
    'promote_waive_pending',v_waive,
    'oldest_pending_hours',v_oldest_hours,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

-- Critical windows: unified inbox backlog thresholds — visibility only,
-- never applies/approves/closes/resets anything.
create or replace function public.list_it_intune_phase51_critical_windows(
  p_window_hours integer default 24,
  p_backlog_threshold integer default 10,
  p_stale_hours integer default 72
) returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours,24),1),168);
  v_threshold integer := least(greatest(coalesce(p_backlog_threshold,10),1),500);
  v_stale_hours integer := least(greatest(coalesce(p_stale_hours,72),1),720);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_snapshot public.os_it_intune_phase51_inbox_snapshots%rowtype;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_snapshot
  from public.os_it_intune_phase51_inbox_snapshots
  order by recorded_at desc
  limit 1;

  if v_snapshot.snapshot_id is not null and v_snapshot.total_pending >= v_threshold then
    v_key := 'inboxbacklog51:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_it_intune_phase51_ops_alerts x
      where x.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','dual_approve_inbox_backlog_critical',
        'window_key',v_key,
        'severity','critical',
        'total_pending',v_snapshot.total_pending
      ));
    end if;
  end if;

  if v_snapshot.snapshot_id is not null
    and v_snapshot.oldest_pending_hours is not null
    and v_snapshot.oldest_pending_hours >= v_stale_hours then
    v_key := 'inboxstale51:' || v_bucket || 'h' || v_hours::text;
    if not exists (
      select 1 from public.os_it_intune_phase51_ops_alerts x
      where x.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','dual_approve_inbox_stale_item',
        'window_key',v_key,
        'severity','warning',
        'oldest_pending_hours',v_snapshot.oldest_pending_hours
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase51-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase51_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 51 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');

  if v_kind not in (
      'dual_approve_inbox_backlog_critical','dual_approve_inbox_stale_item')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 51 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase51_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase51-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'closes_or_resets_breaker',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase51_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase51_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'closes_or_resets_breaker',false);
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'closes_or_resets_breaker',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ops report: unified dual-approve inbox visibility. Aggregates never
-- include entity identifiers.
-- ---------------------------------------------------------------------------
create or replace function public.get_it_intune_phase51_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_inbox jsonb;
  v_snapshots jsonb;
  v_alerts jsonb;
begin
  v_inbox := public.list_it_intune_dual_approve_inbox_phase51(50);

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_snapshots
  from (
    select s.snapshot_id,s.postmortem_pending,s.breaker_tuning_pending,
      s.promote_waive_pending,s.total_pending,s.oldest_pending_hours,
      s.recorded_at
    from public.os_it_intune_phase51_inbox_snapshots s
    order by s.recorded_at desc
    limit 30
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select al.alert_id,al.alert_kind,al.window_key,al.severity,
      al.destination_key,al.delivery_status,al.response_code,
      al.evidence_sha256,al.recorded_at
    from public.os_it_intune_phase51_ops_alerts al
    order by al.recorded_at desc
    limit 50
  ) x;

  return jsonb_build_object(
    'version','phase51-v1',
    'postmortem_pending_count',coalesce((v_inbox->>'postmortem_pending_count')::integer,0),
    'breaker_tuning_pending_count',coalesce((v_inbox->>'breaker_tuning_pending_count')::integer,0),
    'promote_waive_pending_count',coalesce((v_inbox->>'promote_waive_pending_count')::integer,0),
    'total_pending_count',coalesce((v_inbox->>'total_pending_count')::integer,0),
    'items',coalesce(v_inbox->'items','[]'::jsonb),
    'recent_inbox_snapshots',v_snapshots,
    'ops_alerts',v_alerts,
    'destination_key','ops_alerts',
    'requires_dual_approval',true,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

revoke all on function public.it_intune_phase51_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.list_it_intune_dual_approve_inbox_phase51(integer)
  from public;
revoke all on function public.record_it_intune_phase51_inbox_snapshot(uuid)
  from public,authenticated;
revoke all on function public.list_it_intune_phase51_critical_windows(integer,integer,integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase51_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase51_ops_report()
  from public,authenticated;
revoke all on function public.prevent_it_intune_phase51_ops_mutation()
  from public,authenticated,service_role;

grant execute on function public.list_it_intune_dual_approve_inbox_phase51(integer)
  to authenticated, service_role;
grant execute on function public.list_it_intune_phase51_critical_windows(integer,integer,integer),
  public.record_it_intune_phase51_ops_alert(jsonb),
  public.record_it_intune_phase51_inbox_snapshot(uuid),
  public.get_it_intune_phase51_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase51_critical_windows(integer,integer,integer),
  public.get_it_intune_phase51_ops_report()
  to authenticated;
