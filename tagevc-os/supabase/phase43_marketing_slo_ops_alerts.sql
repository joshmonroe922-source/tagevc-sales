-- Phase 43: marketing credential binding health + critical-window SLO ops alerts.
-- Builds on Phase 42 authenticity/settlement SLO snapshots. Safe to re-run.
-- Never stores secret values — env *names* and present/absent flags only.
-- Never mutates snapshot retirement tables or Phase 42 SLO snapshot tables.

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

-- ---------------------------------------------------------------------------
-- Append-only credential binding health (env names + present flags only)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_credential_binding_health (
  binding_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid not null references public.os_marketing_revenue_sources(source_id),
  ledger_profile text not null check (ledger_profile in ('production_v1','sandbox_v1')),
  authenticity_mode text not null check (authenticity_mode in
    ('hmac_sha256','request_id','signed_headers_v1','jwt_bearer_v1')),
  credential_env_name text not null
    check (credential_env_name ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  signature_env_name text
    check (signature_env_name is null or signature_env_name ~ '^[A-Z][A-Z0-9_]{2,127}$'),
  credential_env_present boolean not null,
  signature_env_present boolean,
  signature_env_required boolean not null default false,
  binding_status text not null check (binding_status in
    ('healthy','missing_credential','missing_signature','missing_both','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value'
  ]))
);

create index if not exists os_mkt_rev_cred_bind_entity_idx
  on public.os_marketing_revenue_credential_binding_health
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_cred_bind_source_idx
  on public.os_marketing_revenue_credential_binding_health
    (source_id, created_at desc);

alter table public.os_marketing_revenue_credential_binding_health
  enable row level security;

-- ---------------------------------------------------------------------------
-- Append-only critical-window ops alert evidence (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_revenue_slo_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text not null references public.entities(entity_id),
  source_id uuid references public.os_marketing_revenue_sources(source_id),
  alert_kind text not null check (alert_kind in
    ('authenticity_critical','settlement_critical','credential_binding')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null check (severity = 'critical'),
  destination_key text not null
    check (destination_key ~ '^[a-z][a-z0-9_]{0,62}$'),
  delivery_status text not null check (delivery_status in
    ('delivered','skipped_no_webhook','failed','recorded')),
  response_code integer check (response_code is null or response_code between 100 and 599),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (jsonb_typeof(metadata) = 'object'),
  check (pg_column_size(metadata) <= 2048),
  check (not (metadata ?| array[
    'authorization','cookie','set-cookie','token','secret','signature','jwt',
    'credential','password','payload','body','value','env_value','url'
  ]))
);

create index if not exists os_mkt_rev_slo_ops_alert_entity_idx
  on public.os_marketing_revenue_slo_ops_alerts
    (entity_id, created_at desc);
create index if not exists os_mkt_rev_slo_ops_alert_kind_idx
  on public.os_marketing_revenue_slo_ops_alerts
    (alert_kind, created_at desc);

alter table public.os_marketing_revenue_slo_ops_alerts
  enable row level security;

do $$
begin
  revoke all on public.os_marketing_revenue_credential_binding_health
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_credential_binding_health from service_role;
  grant select on public.os_marketing_revenue_credential_binding_health
    to service_role;

  revoke all on public.os_marketing_revenue_slo_ops_alerts
    from public, anon, authenticated;
  revoke insert, update, delete, truncate, references, trigger
    on public.os_marketing_revenue_slo_ops_alerts from service_role;
  grant select on public.os_marketing_revenue_slo_ops_alerts
    to service_role;
end $$;

create or replace function public.prevent_marketing_revenue_phase43_ops_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  raise exception 'Marketing revenue Phase 43 ops evidence is append-only';
end;
$$;

drop trigger if exists os_mkt_rev_cred_bind_immutable
  on public.os_marketing_revenue_credential_binding_health;
create trigger os_mkt_rev_cred_bind_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_credential_binding_health
  for each statement
  execute function public.prevent_marketing_revenue_phase43_ops_mutation();

drop trigger if exists os_mkt_rev_slo_ops_alert_immutable
  on public.os_marketing_revenue_slo_ops_alerts;
create trigger os_mkt_rev_slo_ops_alert_immutable
  before update or delete or truncate
  on public.os_marketing_revenue_slo_ops_alerts
  for each statement
  execute function public.prevent_marketing_revenue_phase43_ops_mutation();

create or replace function public.phase43_marketing_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select jsonb_typeof(coalesce(p_detail, '{}'::jsonb)) = 'object'
    and pg_column_size(coalesce(p_detail, '{}'::jsonb)) <= 2048
    and not (coalesce(p_detail, '{}'::jsonb) ?| array[
      'authorization','cookie','set-cookie','token','secret','signature','jwt',
      'credential','password','payload','body','value','env_value','url'
    ]);
$$;

create or replace function public.phase43_credential_binding_status(
  p_credential_present boolean,
  p_signature_required boolean,
  p_signature_present boolean)
returns text
language sql
immutable
parallel safe
as $$
  select case
    when not coalesce(p_credential_present, false)
      and coalesce(p_signature_required, false)
      and not coalesce(p_signature_present, false) then 'missing_both'
    when not coalesce(p_credential_present, false) then 'missing_credential'
    when coalesce(p_signature_required, false)
      and not coalesce(p_signature_present, false) then 'missing_signature'
    when coalesce(p_credential_present, false) then 'healthy'
    else 'unknown'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Record credential binding observations from the worker (names + flags only)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_credential_binding_health(
  p_bindings jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_row jsonb;
  v_source public.os_marketing_revenue_sources%rowtype;
  v_cred_name text;
  v_sig_name text;
  v_cred_present boolean;
  v_sig_present boolean;
  v_sig_required boolean;
  v_status text;
  v_hash text;
  v_inserted integer := 0;
begin
  if jsonb_typeof(coalesce(p_bindings, '[]'::jsonb)) <> 'array' then
    raise exception 'Credential binding payload must be a JSON array';
  end if;

  for v_row in
    select value from jsonb_array_elements(coalesce(p_bindings, '[]'::jsonb))
  loop
    if jsonb_typeof(v_row) <> 'object'
      or not public.phase43_marketing_ops_safe_metadata(
        coalesce(v_row->'metadata', '{}'::jsonb)) then
      raise exception 'Credential binding row metadata is invalid or unsafe';
    end if;

    select * into v_source
    from public.os_marketing_revenue_sources
    where source_id = nullif(v_row->>'source_id','')::uuid;

    if not found then
      raise exception 'Credential binding source is unknown';
    end if;

    v_cred_name := coalesce(nullif(v_row->>'credential_env_name',''), v_source.credential_env_name);
    v_sig_name := nullif(coalesce(v_row->>'signature_env_name', v_source.signature_env_name), '');
    if v_cred_name is distinct from v_source.credential_env_name
      or coalesce(v_sig_name,'') is distinct from coalesce(v_source.signature_env_name,'') then
      raise exception 'Credential binding env names must match source configuration';
    end if;

    v_cred_present := coalesce((v_row->>'credential_env_present')::boolean, false);
    v_sig_required := coalesce((v_row->>'signature_env_required')::boolean,
      v_source.authenticity_mode in
        ('hmac_sha256','signed_headers_v1','jwt_bearer_v1'));
    v_sig_present := case
      when not v_sig_required then null
      else coalesce((v_row->>'signature_env_present')::boolean, false)
    end;
    v_status := public.phase43_credential_binding_status(
      v_cred_present, v_sig_required, coalesce(v_sig_present, false));
    v_hash := public.os_sha256_hex(jsonb_build_object(
      'version','phase43-v1',
      'kind','credential_binding',
      'entity_id',v_source.entity_id,
      'source_id',v_source.source_id,
      'ledger_profile',v_source.ledger_profile,
      'authenticity_mode',v_source.authenticity_mode,
      'credential_env_name',v_cred_name,
      'signature_env_name',v_sig_name,
      'credential_env_present',v_cred_present,
      'signature_env_present',v_sig_present,
      'signature_env_required',v_sig_required,
      'binding_status',v_status
    )::text);

    insert into public.os_marketing_revenue_credential_binding_health(
      entity_id,source_id,ledger_profile,authenticity_mode,
      credential_env_name,signature_env_name,credential_env_present,
      signature_env_present,signature_env_required,binding_status,
      metrics_sha256,metadata)
    values (
      v_source.entity_id,v_source.source_id,v_source.ledger_profile,
      v_source.authenticity_mode,v_cred_name,v_sig_name,v_cred_present,
      v_sig_present,v_sig_required,v_status,v_hash,
      coalesce(v_row->'metadata','{}'::jsonb) || jsonb_build_object(
        'contract_version','phase43-v1',
        'metric','credential_env_binding'
      ));
    v_inserted := v_inserted + 1;
  end loop;

  return jsonb_build_object(
    'version','phase43-v1',
    'bindings_recorded',v_inserted);
end;
$$;

-- ---------------------------------------------------------------------------
-- List critical windows that still need an idempotent ops alert insert
-- ---------------------------------------------------------------------------
create or replace function public.list_marketing_revenue_phase43_critical_windows(
  p_entity_id text,
  p_days integer default 30,
  p_window_hours integer default 24)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_hours integer := least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_auth jsonb;
  v_settle jsonb;
  v_bind jsonb;
begin
  v_bucket := to_char(
    to_timestamp(
      (floor(extract(epoch from now()) / (v_hours * 3600.0))
        * (v_hours * 3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','authenticity_critical',
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'window_key','authcrit:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'fail_rate',l.fail_rate,
      'probe_count',l.probe_count
    ) order by l.source_id)
    from (
      select a.*,
        row_number() over (
          partition by a.source_id, a.authenticity_mode, a.ledger_profile
          order by a.created_at desc, a.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_authenticity_slo_snapshots a
      where a.created_at >= v_since
        and a.severity = 'critical'
        and a.ledger_profile = 'production_v1'
        and (p_entity_id is null or a.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_slo_ops_alerts x
        where x.window_key =
          'authcrit:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_auth;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','settlement_critical',
      'entity_id',l.entity_id,
      'source_id',null,
      'window_key','settlecrit:'||l.entity_id||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'snapshot_id',l.snapshot_id,
      'overdue_rate',l.overdue_rate,
      'late_rate',l.late_rate
    ) order by l.entity_id)
    from (
      select s.*,
        row_number() over (
          partition by s.entity_id
          order by s.created_at desc, s.snapshot_id desc
        ) rn
      from public.os_marketing_revenue_settlement_slo_snapshots s
      where s.created_at >= v_since
        and s.severity = 'critical'
        and (p_entity_id is null or s.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_slo_ops_alerts x
        where x.window_key =
          'settlecrit:'||l.entity_id||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_settle;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','credential_binding',
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'window_key','credbind:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','critical',
      'metrics_sha256',l.metrics_sha256,
      'binding_id',l.binding_id,
      'binding_status',l.binding_status
    ) order by l.source_id)
    from (
      select b.*,
        row_number() over (
          partition by b.source_id
          order by b.created_at desc, b.binding_id desc
        ) rn
      from public.os_marketing_revenue_credential_binding_health b
      where b.created_at >= v_since
        and b.ledger_profile = 'production_v1'
        and b.binding_status in
          ('missing_credential','missing_signature','missing_both')
        and (p_entity_id is null or b.entity_id = p_entity_id)
    ) l
    where l.rn = 1
      and not exists (
        select 1 from public.os_marketing_revenue_slo_ops_alerts x
        where x.window_key =
          'credbind:'||l.source_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 50
  ), '[]'::jsonb) into v_bind;

  return jsonb_build_object(
    'version','phase43-v1',
    'window_days',v_days,
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_auth,'[]'::jsonb)
      || coalesce(v_settle,'[]'::jsonb)
      || coalesce(v_bind,'[]'::jsonb));
end;
$$;

-- ---------------------------------------------------------------------------
-- Record one critical ops alert after delivery attempt (idempotent window_key)
-- ---------------------------------------------------------------------------
create or replace function public.record_marketing_revenue_phase43_ops_alert(
  p_alert jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text;
  v_entity text;
  v_source uuid;
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
    raise exception 'Ops alert payload must be a JSON object';
  end if;

  v_kind := coalesce(p_alert->>'alert_kind','');
  v_entity := coalesce(p_alert->>'entity_id','');
  v_source := nullif(p_alert->>'source_id','')::uuid;
  v_window := coalesce(p_alert->>'window_key','');
  v_dest := coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery := coalesce(p_alert->>'delivery_status','recorded');
  v_code := nullif(p_alert->>'response_code','')::integer;
  v_meta := coalesce(p_alert->'metadata','{}'::jsonb);

  if v_kind not in
      ('authenticity_critical','settlement_critical','credential_binding')
    or v_entity = ''
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_dest ~* '://|^https?'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or not public.phase43_marketing_ops_safe_metadata(v_meta) then
    raise exception 'Ops alert contract is invalid or unsafe';
  end if;

  if not exists (select 1 from public.entities where entity_id = v_entity) then
    raise exception 'Ops alert entity is unknown';
  end if;

  if v_source is not null and not exists (
    select 1 from public.os_marketing_revenue_sources
    where source_id = v_source and entity_id = v_entity
  ) then
    raise exception 'Ops alert source/entity mismatch';
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase43-v1',
    'alert_kind',v_kind,
    'entity_id',v_entity,
    'source_id',v_source,
    'window_key',v_window,
    'severity','critical',
    'destination_key',v_dest,
    'delivery_status',v_delivery,
    'response_code',v_code
  )::text);

  insert into public.os_marketing_revenue_slo_ops_alerts(
    entity_id,source_id,alert_kind,window_key,severity,destination_key,
    delivery_status,response_code,metrics_sha256,metadata)
  values (
    v_entity,v_source,v_kind,v_window,'critical',v_dest,
    v_delivery,v_code,v_hash,
    v_meta || jsonb_build_object('contract_version','phase43-v1'))
  on conflict (window_key) do nothing
  returning alert_id, delivery_status into v_id, v_status;

  if v_id is null then
    select alert_id, delivery_status into v_id, v_status
    from public.os_marketing_revenue_slo_ops_alerts
    where window_key = v_window;
    return jsonb_build_object(
      'version','phase43-v1',
      'alert_id',v_id,
      'window_key',v_window,
      'delivery_status',v_status,
      'inserted',false);
  end if;

  return jsonb_build_object(
    'version','phase43-v1',
    'alert_id',v_id,
    'window_key',v_window,
    'delivery_status',v_status,
    'inserted',true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Hub report: latest binding health + critical alert delivery badges
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_revenue_phase43_ops_report(
  p_entity_id text,
  p_days integer default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_days integer := least(greatest(coalesce(p_days,30),1),90);
  v_since timestamptz := now() - make_interval(
    days => least(greatest(coalesce(p_days,30),1),90));
  v_bindings jsonb;
  v_alerts jsonb;
  v_binding_health text := 'unknown';
  v_alert_delivery text := 'none';
  v_critical_open integer := 0;
begin
  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'binding_id',l.binding_id,
      'entity_id',l.entity_id,
      'source_id',l.source_id,
      'ledger_profile',l.ledger_profile,
      'authenticity_mode',l.authenticity_mode,
      'credential_env_name',l.credential_env_name,
      'signature_env_name',l.signature_env_name,
      'credential_env_present',l.credential_env_present,
      'signature_env_present',l.signature_env_present,
      'signature_env_required',l.signature_env_required,
      'binding_status',l.binding_status,
      'metrics_sha256',l.metrics_sha256,
      'created_at',l.created_at
    ) order by l.binding_status desc, l.source_id)
    from (
      select b.*,
        row_number() over (
          partition by b.source_id
          order by b.created_at desc, b.binding_id desc
        ) rn
      from public.os_marketing_revenue_credential_binding_health b
      where b.created_at >= v_since
        and (p_entity_id is null or b.entity_id = p_entity_id)
    ) l
    where l.rn = 1
    limit 100
  ), '[]'::jsonb) into v_bindings;

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_id',a.alert_id,
      'entity_id',a.entity_id,
      'source_id',a.source_id,
      'alert_kind',a.alert_kind,
      'window_key',a.window_key,
      'severity',a.severity,
      'destination_key',a.destination_key,
      'delivery_status',a.delivery_status,
      'response_code',a.response_code,
      'metrics_sha256',a.metrics_sha256,
      'created_at',a.created_at
    ) order by a.created_at desc)
    from public.os_marketing_revenue_slo_ops_alerts a
    where a.created_at >= v_since
      and (p_entity_id is null or a.entity_id = p_entity_id)
    limit 50
  ), '[]'::jsonb) into v_alerts;

  select coalesce((
    select case
      when bool_or(x.binding_status in
        ('missing_credential','missing_signature','missing_both'))
        then 'critical'
      when bool_or(x.binding_status = 'healthy') then 'healthy'
      else 'unknown'
    end
    from jsonb_to_recordset(coalesce(v_bindings,'[]'::jsonb))
      as x(binding_status text)
  ), 'unknown') into v_binding_health;

  select count(*)::integer into v_critical_open
  from jsonb_to_recordset(coalesce(v_alerts,'[]'::jsonb))
    as x(delivery_status text)
  where x.delivery_status in ('failed','skipped_no_webhook','recorded','delivered');

  select coalesce((
    select case
      when bool_or(x.delivery_status = 'failed') then 'failed'
      when bool_or(x.delivery_status = 'skipped_no_webhook') then 'skipped_no_webhook'
      when bool_or(x.delivery_status = 'delivered') then 'delivered'
      when bool_or(x.delivery_status = 'recorded') then 'recorded'
      else 'none'
    end
    from jsonb_to_recordset(coalesce(v_alerts,'[]'::jsonb))
      as x(delivery_status text)
  ), 'none') into v_alert_delivery;

  return jsonb_build_object(
    'version','phase43-v1',
    'window_days',v_days,
    'binding_health',v_binding_health,
    'alert_delivery',v_alert_delivery,
    'critical_alert_count',v_critical_open,
    'bindings',coalesce(v_bindings,'[]'::jsonb),
    'alerts',coalesce(v_alerts,'[]'::jsonb),
    'destination_key','ops_alerts');
end;
$$;

revoke all on function public.prevent_marketing_revenue_phase43_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.phase43_marketing_ops_safe_metadata(jsonb)
  from public, anon, authenticated;
revoke all on function public.phase43_credential_binding_status(boolean,boolean,boolean)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_credential_binding_health(jsonb)
  from public, anon, authenticated;
revoke all on function public.list_marketing_revenue_phase43_critical_windows(text,integer,integer)
  from public, anon, authenticated;
revoke all on function public.record_marketing_revenue_phase43_ops_alert(jsonb)
  from public, anon, authenticated;
revoke all on function public.get_marketing_revenue_phase43_ops_report(text,integer)
  from public, anon, authenticated;

grant execute on function public.phase43_marketing_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase43_credential_binding_status(boolean,boolean,boolean)
  to authenticated, service_role;
grant execute on function public.list_marketing_revenue_phase43_critical_windows(text,integer,integer)
  to authenticated, service_role;
grant execute on function public.get_marketing_revenue_phase43_ops_report(text,integer)
  to authenticated, service_role;
grant execute on function public.record_marketing_revenue_credential_binding_health(jsonb)
  to service_role;
grant execute on function public.record_marketing_revenue_phase43_ops_alert(jsonb)
  to service_role;
