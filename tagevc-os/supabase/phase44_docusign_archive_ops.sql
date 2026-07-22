-- Phase 44: DocuSign archive drift/backfill ops + integrity alerts.
-- Depends on phase43_docusign_first_quarterly_ops.sql.
-- Historical drift from governance receipts, backfill completeness snapshots,
-- marketing-style critical ops alerts. Never create/void/resend envelopes.
-- Evidence = digests/metadata only. Never mutates snapshot retirement tables.
-- Safe to re-run.

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

create or replace function public.phase42_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  -- Bootstrap if Phase 42 DocuSign SQL was not applied yet.
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

create or replace function public.phase44_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase42_docusign_ops_safe_metadata(p_detail);
$$;

-- ---------------------------------------------------------------------------
-- Append-only weekly/receipt drift aggregates
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_drift_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  verified_count integer not null default 0,
  content_drift_count integer not null default 0,
  storage_unavailable_count integer not null default 0,
  quarantined_count integer not null default 0,
  window_start timestamptz not null,
  window_end timestamptz not null,
  metrics_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_drift_snap_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_drift_snap_counts_check
    check (
      verified_count >= 0
      and content_drift_count >= 0
      and storage_unavailable_count >= 0
      and quarantined_count >= 0
    ),
  constraint os_docusign_archive_drift_snap_window_check
    check (window_end >= window_start),
  constraint os_docusign_archive_drift_snap_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase44_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_drift_snap_created_idx
  on public.os_docusign_archive_drift_snapshots(created_at desc);
create index if not exists os_docusign_archive_drift_snap_window_idx
  on public.os_docusign_archive_drift_snapshots(window_start, window_end);

alter table public.os_docusign_archive_drift_snapshots
  enable row level security;
drop policy if exists "os_docusign_archive_drift_snap_select"
  on public.os_docusign_archive_drift_snapshots;
create policy "os_docusign_archive_drift_snap_select"
  on public.os_docusign_archive_drift_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_drift_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_archive_drift_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only backfill / legacy archive completeness snapshots
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_backfill_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  remaining_unhashed integer not null default 0,
  certificate_gap_count integer not null default 0,
  quarantine_backlog integer not null default 0,
  quarantine_oldest_age_days integer not null default 0,
  completeness_pct numeric(5,2) not null default 0,
  burn_rate_per_hour numeric(12,4),
  metrics_sha256 text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_bf_snap_hash_check
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_bf_snap_counts_check
    check (
      remaining_unhashed >= 0
      and certificate_gap_count >= 0
      and quarantine_backlog >= 0
      and quarantine_oldest_age_days >= 0
      and completeness_pct >= 0
      and completeness_pct <= 100
    ),
  constraint os_docusign_archive_bf_snap_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase44_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_bf_snap_created_idx
  on public.os_docusign_archive_backfill_snapshots(created_at desc);

alter table public.os_docusign_archive_backfill_snapshots
  enable row level security;
drop policy if exists "os_docusign_archive_bf_snap_select"
  on public.os_docusign_archive_backfill_snapshots;
create policy "os_docusign_archive_bf_snap_select"
  on public.os_docusign_archive_backfill_snapshots for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_backfill_snapshots
  from public, anon, authenticated;
grant select on public.os_docusign_archive_backfill_snapshots
  to authenticated;

-- ---------------------------------------------------------------------------
-- Append-only integrity ops alerts (marketing P43 style)
-- ---------------------------------------------------------------------------
create table if not exists public.os_docusign_archive_phase44_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  alert_kind text not null,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'critical'
    check (severity = 'critical'),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer
    check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null
    check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_p44_alert_kind_check
    check (alert_kind in (
      'integrity_drift_burst',
      'quarantine_aging_breach',
      'quarantine_backlog_high',
      'backfill_stalled',
      'full_scan_overdue',
      'first_quarterly_still_gated',
      'storage_unavailable_elevated'
    )),
  constraint os_docusign_archive_p44_alert_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase44_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_p44_alert_created_idx
  on public.os_docusign_archive_phase44_ops_alerts(created_at desc);
create index if not exists os_docusign_archive_p44_alert_kind_idx
  on public.os_docusign_archive_phase44_ops_alerts(alert_kind, created_at desc);

alter table public.os_docusign_archive_phase44_ops_alerts
  enable row level security;
drop policy if exists "os_docusign_archive_p44_alert_select"
  on public.os_docusign_archive_phase44_ops_alerts;
create policy "os_docusign_archive_p44_alert_select"
  on public.os_docusign_archive_phase44_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());
revoke all on public.os_docusign_archive_phase44_ops_alerts
  from public, anon, authenticated;
grant select on public.os_docusign_archive_phase44_ops_alerts
  to authenticated;

create or replace function public.reject_docusign_phase44_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 44 DocuSign archive ops evidence is append-only';
end;
$$;

drop trigger if exists os_docusign_archive_drift_snap_immutable
  on public.os_docusign_archive_drift_snapshots;
create trigger os_docusign_archive_drift_snap_immutable
  before update or delete on public.os_docusign_archive_drift_snapshots
  for each row execute function public.reject_docusign_phase44_ops_mutation();
drop trigger if exists os_docusign_archive_drift_snap_no_truncate
  on public.os_docusign_archive_drift_snapshots;
create trigger os_docusign_archive_drift_snap_no_truncate
  before truncate on public.os_docusign_archive_drift_snapshots
  for each statement execute function public.reject_docusign_phase44_ops_mutation();

drop trigger if exists os_docusign_archive_bf_snap_immutable
  on public.os_docusign_archive_backfill_snapshots;
create trigger os_docusign_archive_bf_snap_immutable
  before update or delete on public.os_docusign_archive_backfill_snapshots
  for each row execute function public.reject_docusign_phase44_ops_mutation();
drop trigger if exists os_docusign_archive_bf_snap_no_truncate
  on public.os_docusign_archive_backfill_snapshots;
create trigger os_docusign_archive_bf_snap_no_truncate
  before truncate on public.os_docusign_archive_backfill_snapshots
  for each statement execute function public.reject_docusign_phase44_ops_mutation();

drop trigger if exists os_docusign_archive_p44_alert_immutable
  on public.os_docusign_archive_phase44_ops_alerts;
create trigger os_docusign_archive_p44_alert_immutable
  before update or delete on public.os_docusign_archive_phase44_ops_alerts
  for each row execute function public.reject_docusign_phase44_ops_mutation();
drop trigger if exists os_docusign_archive_p44_alert_no_truncate
  on public.os_docusign_archive_phase44_ops_alerts;
create trigger os_docusign_archive_p44_alert_no_truncate
  before truncate on public.os_docusign_archive_phase44_ops_alerts
  for each statement execute function public.reject_docusign_phase44_ops_mutation();

-- Certificate-only gaps (combined present, certificate missing).
create or replace function public.docusign_archive_certificate_gap_count(
  p_entity_id text default null
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.os_documents d
  join public.os_docusign_envelopes e
    on e.envelope_id=d.envelope_id and e.doc_id=d.doc_id
   and e.entity_id is not distinct from d.entity_id
  where lower(d.status) in ('completed','signed','executed')
    and lower(coalesce(e.provider_status,'')) in ('completed','signed')
    and e.envelope_id not like 'ENV-%'
    and (p_entity_id is null or d.entity_id is not distinct from p_entity_id)
    and exists (
      select 1 from public.os_docusign_archive_manifests m
      where m.envelope_id=e.envelope_id and m.document_id=d.doc_id
        and m.file_kind='combined'
    )
    and not exists (
      select 1 from public.os_docusign_archive_manifests m
      where m.envelope_id=e.envelope_id and m.document_id=d.doc_id
        and m.file_kind='certificate'
    );
$$;

create or replace function public.docusign_archive_eligible_total_count(
  p_entity_id text default null
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.os_documents d
  join public.os_docusign_envelopes e
    on e.envelope_id=d.envelope_id and e.doc_id=d.doc_id
   and e.entity_id is not distinct from d.entity_id
  where lower(d.status) in ('completed','signed','executed')
    and lower(coalesce(e.provider_status,'')) in ('completed','signed')
    and e.envelope_id not like 'ENV-%'
    and (p_entity_id is null or d.entity_id is not distinct from p_entity_id);
$$;

-- ---------------------------------------------------------------------------
-- Record drift snapshot from governance receipts (default weekly window)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_drift_snapshot_phase44(
  p_window_days integer default 7,
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_window_days, 7), 1), 90);
  v_start timestamptz := now() - make_interval(days => least(greatest(coalesce(p_window_days, 7), 1), 90));
  v_end timestamptz := now();
  v_verified integer := 0;
  v_drift integer := 0;
  v_storage integer := 0;
  v_quarantined integer := 0;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_hash text;
  v_row public.os_docusign_archive_drift_snapshots%rowtype;
begin
  if not public.phase44_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 44 drift snapshot metadata is invalid or unsafe';
  end if;

  select
    coalesce(count(*) filter (where r.outcome='verified'), 0)::integer,
    coalesce(count(*) filter (where r.outcome='content_drift'), 0)::integer,
    coalesce(count(*) filter (where r.outcome='storage_unavailable'), 0)::integer,
    coalesce(count(*) filter (where r.outcome='quarantined'), 0)::integer
  into v_verified, v_drift, v_storage, v_quarantined
  from public.os_docusign_archive_governance_receipts r
  where r.created_at >= v_start
    and r.created_at <= v_end
    and r.outcome in (
      'verified','content_drift','storage_unavailable','quarantined'
    );

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase44-v1',
    'kind','drift_snapshot',
    'window_days',v_days,
    'window_start',v_start,
    'window_end',v_end,
    'verified_count',v_verified,
    'content_drift_count',v_drift,
    'storage_unavailable_count',v_storage,
    'quarantined_count',v_quarantined,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_drift_snapshots(
    verified_count,content_drift_count,storage_unavailable_count,
    quarantined_count,window_start,window_end,metrics_sha256,metadata)
  values (
    v_verified,v_drift,v_storage,v_quarantined,v_start,v_end,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase44-v1',
      'window_days',v_days
    ))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','recorded',
    'snapshot_id',v_row.snapshot_id,
    'verified_count',v_row.verified_count,
    'content_drift_count',v_row.content_drift_count,
    'storage_unavailable_count',v_row.storage_unavailable_count,
    'quarantined_count',v_row.quarantined_count,
    'window_start',v_row.window_start,
    'window_end',v_row.window_end,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase44-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record backfill completeness + legacy archive health snapshot
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_backfill_snapshot_phase44(
  p_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_remaining integer;
  v_cert_gap integer;
  v_quarantine integer;
  v_oldest integer;
  v_total integer;
  v_complete integer;
  v_pct numeric(5,2);
  v_burn numeric(12,4);
  v_prev public.os_docusign_archive_backfill_snapshots%rowtype;
  v_hours numeric;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_hash text;
  v_row public.os_docusign_archive_backfill_snapshots%rowtype;
begin
  if not public.phase44_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 44 backfill snapshot metadata is invalid or unsafe';
  end if;

  v_remaining := public.docusign_archive_remaining_unhashed_count(null);
  v_cert_gap := public.docusign_archive_certificate_gap_count(null);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(null);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(null);
  v_total := public.docusign_archive_eligible_total_count(null);
  v_complete := greatest(v_total - v_remaining, 0);

  if v_total <= 0 then
    v_pct := 100;
  else
    v_pct := round((v_complete::numeric / v_total::numeric) * 100, 2);
  end if;

  select * into v_prev
  from public.os_docusign_archive_backfill_snapshots
  order by created_at desc
  limit 1;

  v_burn := null;
  if found and v_prev.created_at < now() then
    v_hours := extract(epoch from (now() - v_prev.created_at)) / 3600.0;
    if v_hours >= 0.05 then
      v_burn := round(
        ((v_prev.remaining_unhashed - v_remaining)::numeric / v_hours),
        4
      );
    end if;
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase44-v1',
    'kind','backfill_snapshot',
    'remaining_unhashed',v_remaining,
    'certificate_gap_count',v_cert_gap,
    'quarantine_backlog',v_quarantine,
    'quarantine_oldest_age_days',v_oldest,
    'completeness_pct',v_pct,
    'burn_rate_per_hour',v_burn,
    'eligible_total',v_total,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_backfill_snapshots(
    remaining_unhashed,certificate_gap_count,quarantine_backlog,
    quarantine_oldest_age_days,completeness_pct,burn_rate_per_hour,
    metrics_sha256,metadata)
  values (
    v_remaining,v_cert_gap,v_quarantine,v_oldest,v_pct,v_burn,v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase44-v1',
      'eligible_total',v_total
    ))
  returning * into v_row;

  return jsonb_build_object(
    'disposition','recorded',
    'snapshot_id',v_row.snapshot_id,
    'remaining_unhashed',v_row.remaining_unhashed,
    'certificate_gap_count',v_row.certificate_gap_count,
    'quarantine_backlog',v_row.quarantine_backlog,
    'quarantine_oldest_age_days',v_row.quarantine_oldest_age_days,
    'completeness_pct',v_row.completeness_pct,
    'burn_rate_per_hour',v_row.burn_rate_per_hour,
    'metrics_sha256',v_row.metrics_sha256,
    'contract_version','phase44-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_docusign_archive_phase44_critical_windows(
  p_window_hours integer default 24
) returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_hours integer := least(greatest(coalesce(p_window_hours, 24), 1), 168);
  v_bucket text;
  v_pending jsonb := '[]'::jsonb;
  v_drift public.os_docusign_archive_drift_snapshots%rowtype;
  v_bf public.os_docusign_archive_backfill_snapshots%rowtype;
  v_oldest integer;
  v_quarantine integer;
  v_remaining integer;
  v_full_due boolean;
  v_gates jsonb;
  v_unlocked boolean;
  v_first_done boolean;
  v_key text;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select * into v_drift
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  select * into v_bf
  from public.os_docusign_archive_backfill_snapshots
  order by created_at desc
  limit 1;

  v_oldest := public.docusign_archive_quarantine_oldest_age_days(null);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(null);
  v_remaining := public.docusign_archive_remaining_unhashed_count(null);
  v_full_due := public.is_docusign_quarterly_full_integrity_due();
  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(null);
  v_unlocked := coalesce((v_gates->>'quarterly_unlocked')::boolean, false);
  v_first_done := coalesce((v_gates->>'first_quarterly_completed')::boolean, false);

  if v_drift.snapshot_id is not null and v_drift.content_drift_count >= 3 then
    v_key := 'driftsburst:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','integrity_drift_burst',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_drift.metrics_sha256,
        'snapshot_id',v_drift.snapshot_id,
        'content_drift_count',v_drift.content_drift_count
      ));
    end if;
  end if;

  if v_drift.snapshot_id is not null and v_drift.storage_unavailable_count >= 5 then
    v_key := 'storunelev:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','storage_unavailable_elevated',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_drift.metrics_sha256,
        'snapshot_id',v_drift.snapshot_id,
        'storage_unavailable_count',v_drift.storage_unavailable_count
      ));
    end if;
  end if;

  if v_oldest > 45 then
    v_key := 'quarag:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','quarantine_aging_breach',
        'window_key',v_key,
        'severity','critical',
        'quarantine_oldest_age_days',v_oldest,
        'aging_sla_days',45
      ));
    end if;
  end if;

  if v_quarantine > 25 then
    v_key := 'quarback:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','quarantine_backlog_high',
        'window_key',v_key,
        'severity','critical',
        'quarantine_backlog',v_quarantine,
        'quarantine_backlog_gate',25
      ));
    end if;
  end if;

  if v_remaining > 0
     and v_bf.snapshot_id is not null
     and v_bf.created_at <= now() - interval '6 hours'
     and coalesce(v_bf.burn_rate_per_hour, 0) <= 0 then
    v_key := 'bfstall:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','backfill_stalled',
        'window_key',v_key,
        'severity','critical',
        'metrics_sha256',v_bf.metrics_sha256,
        'snapshot_id',v_bf.snapshot_id,
        'remaining_unhashed',v_remaining,
        'burn_rate_per_hour',v_bf.burn_rate_per_hour
      ));
    end if;
  end if;

  if v_full_due then
    v_key := 'fullscanov:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','full_scan_overdue',
        'window_key',v_key,
        'severity','critical',
        'quarterly_full_due',true
      ));
    end if;
  end if;

  if not v_unlocked and not v_first_done then
    v_key := 'fqgated:firm:'||v_bucket||'h'||v_hours::text;
    if not exists (
      select 1 from public.os_docusign_archive_phase44_ops_alerts a
      where a.window_key=v_key
    ) then
      v_pending := v_pending || jsonb_build_array(jsonb_build_object(
        'alert_kind','first_quarterly_still_gated',
        'window_key',v_key,
        'severity','critical',
        'remaining_unhashed',v_remaining,
        'quarantine_backlog',v_quarantine,
        'quarantine_oldest_age_days',v_oldest
      ));
    end if;
  end if;

  return jsonb_build_object(
    'version','phase44-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',v_pending
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_docusign_archive_phase44_ops_alert(
  p_alert jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_hash text;
  v_meta jsonb;
  v_id uuid;
  v_status text;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 44 ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in (
       'integrity_drift_burst',
       'quarantine_aging_breach',
       'quarantine_backlog_high',
       'backfill_stalled',
       'full_scan_overdue',
       'first_quarterly_still_gated',
       'storage_unavailable_elevated'
     )
     or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
     or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
     or v_dest ~* '://|^https?'
     or v_delivery not in
       ('delivered','skipped_no_webhook','failed','recorded')
     or not public.phase44_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Phase 44 ops alert contract is invalid or unsafe';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase44-v1',
    'alert_kind',v_kind,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_docusign_archive_phase44_ops_alerts(
    alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase44-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_docusign_archive_phase44_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase44-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase44-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: drift health, backfill health, alert delivery
-- ---------------------------------------------------------------------------
create or replace function public.get_docusign_archive_phase44_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_drift public.os_docusign_archive_drift_snapshots%rowtype;
  v_bf public.os_docusign_archive_backfill_snapshots%rowtype;
  v_drift_rows jsonb;
  v_alerts jsonb;
  v_remaining integer;
  v_quarantine integer;
  v_drift_health text := 'unknown';
  v_backfill_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
begin
  select * into v_drift
  from public.os_docusign_archive_drift_snapshots
  order by created_at desc
  limit 1;

  select * into v_bf
  from public.os_docusign_archive_backfill_snapshots
  order by created_at desc
  limit 1;

  v_remaining := public.docusign_archive_remaining_unhashed_count(null);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(null);

  select coalesce(jsonb_agg(to_jsonb(d) order by d.created_at desc), '[]'::jsonb)
  into v_drift_rows
  from (
    select snapshot_id, verified_count, content_drift_count,
      storage_unavailable_count, quarantined_count, window_start, window_end,
      metrics_sha256, created_at
    from public.os_docusign_archive_drift_snapshots
    order by created_at desc
    limit 8
  ) d;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_alerts
  from (
    select alert_id, alert_kind, window_key, severity, destination_key,
      delivery_status, response_code, metrics_sha256, created_at
    from public.os_docusign_archive_phase44_ops_alerts
    order by created_at desc
    limit 20
  ) a;

  if v_drift.snapshot_id is not null then
    if v_drift.content_drift_count >= 3
       or v_drift.storage_unavailable_count >= 5 then
      v_drift_health := 'critical';
    elsif v_drift.content_drift_count > 0
       or v_drift.storage_unavailable_count > 0
       or v_drift.quarantined_count > 0 then
      v_drift_health := 'watch';
    else
      v_drift_health := 'healthy';
    end if;
  end if;

  if v_bf.snapshot_id is not null then
    if v_bf.quarantine_oldest_age_days > 45
       or v_bf.quarantine_backlog > 25
       or (
         v_bf.remaining_unhashed > 0
         and coalesce(v_bf.burn_rate_per_hour, 0) <= 0
         and v_bf.created_at <= now() - interval '6 hours'
       ) then
      v_backfill_health := 'critical';
    elsif v_bf.remaining_unhashed > 0 or v_bf.certificate_gap_count > 0 then
      v_backfill_health := 'watch';
    else
      v_backfill_health := 'healthy';
    end if;
  end if;

  select count(*)::integer into v_critical_open
  from public.os_docusign_archive_phase44_ops_alerts a
  where a.created_at >= now() - interval '7 days';

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from public.os_docusign_archive_phase44_ops_alerts x
    where x.created_at >= now() - interval '7 days'
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase44-v1',
    'drift_health',v_drift_health,
    'backfill_health',v_backfill_health,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'remaining_unhashed',v_remaining,
    'quarantine_backlog',v_quarantine,
    'latest_drift', case
      when v_drift.snapshot_id is null then null
      else jsonb_build_object(
        'snapshot_id',v_drift.snapshot_id,
        'verified_count',v_drift.verified_count,
        'content_drift_count',v_drift.content_drift_count,
        'storage_unavailable_count',v_drift.storage_unavailable_count,
        'quarantined_count',v_drift.quarantined_count,
        'window_start',v_drift.window_start,
        'window_end',v_drift.window_end,
        'metrics_sha256',v_drift.metrics_sha256,
        'created_at',v_drift.created_at
      )
    end,
    'latest_backfill', case
      when v_bf.snapshot_id is null then null
      else jsonb_build_object(
        'snapshot_id',v_bf.snapshot_id,
        'remaining_unhashed',v_bf.remaining_unhashed,
        'certificate_gap_count',v_bf.certificate_gap_count,
        'quarantine_backlog',v_bf.quarantine_backlog,
        'quarantine_oldest_age_days',v_bf.quarantine_oldest_age_days,
        'completeness_pct',v_bf.completeness_pct,
        'burn_rate_per_hour',v_bf.burn_rate_per_hour,
        'metrics_sha256',v_bf.metrics_sha256,
        'created_at',v_bf.created_at
      )
    end,
    'drift_snapshots',coalesce(v_drift_rows,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts'
  );
end;
$$;

revoke all on function public.reject_docusign_phase44_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.docusign_archive_certificate_gap_count(text)
  from public, anon;
revoke all on function public.docusign_archive_eligible_total_count(text)
  from public, anon;
revoke all on function public.record_docusign_archive_drift_snapshot_phase44(integer,jsonb)
  from public, anon, authenticated;
revoke all on function public.record_docusign_archive_backfill_snapshot_phase44(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_docusign_archive_phase44_critical_windows(integer)
  from public, anon;
revoke all on function public.record_docusign_archive_phase44_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_phase44_ops_report()
  from public, anon;

grant execute on function public.phase42_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase44_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.docusign_archive_certificate_gap_count(text)
  to authenticated, service_role;
grant execute on function public.docusign_archive_eligible_total_count(text)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_phase44_critical_windows(integer)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_phase44_ops_report()
  to authenticated, service_role;
grant execute on function public.record_docusign_archive_drift_snapshot_phase44(integer,jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_backfill_snapshot_phase44(jsonb)
  to service_role;
grant execute on function public.record_docusign_archive_phase44_ops_alert(jsonb)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
