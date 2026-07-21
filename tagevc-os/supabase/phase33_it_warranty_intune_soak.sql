-- Phase 33: atomic warranty batches, structured Intune action evidence,
-- and durable snapshot soak epochs. No snapshot DDL or destructive action.

create table if not exists public.os_it_warranty_import_batches (
  batch_id uuid primary key default gen_random_uuid(),
  source_name text,
  source_sha256 text not null,
  status text not null default 'previewing',
  created_by uuid not null,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  error_count integer not null default 0,
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  result jsonb not null default '{}'::jsonb,
  constraint os_it_warranty_batch_status_check
    check (status in ('previewing', 'ready', 'invalid', 'committed', 'cancelled'))
);

create table if not exists public.os_it_warranty_import_rows (
  batch_id uuid not null references public.os_it_warranty_import_batches(batch_id)
    on delete cascade,
  line_number integer not null,
  locator_type text not null,
  locator_value text not null,
  asset_id text,
  previous_warranty_ends_at date,
  proposed_warranty_ends_at date,
  validation_status text not null,
  validation_code text,
  validation_message text,
  source_row jsonb not null default '{}'::jsonb,
  primary key (batch_id, line_number),
  constraint os_it_warranty_row_status_check
    check (validation_status in ('valid', 'invalid'))
);

create unique index if not exists os_it_warranty_batch_asset_unique
  on public.os_it_warranty_import_rows (batch_id, asset_id)
  where asset_id is not null and validation_status = 'valid';
create index if not exists os_it_hardware_normalized_serial_idx
  on public.os_it_hardware_assets (lower(trim(serial_number)))
  where serial_number is not null;

create or replace function public.prepare_it_warranty_import(
  p_source_name text,
  p_source_sha256 text,
  p_actor_id uuid,
  p_rows jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_id uuid;
  v_row jsonb;
  v_line integer;
  v_asset_id text;
  v_serial text;
  v_date date;
  v_match_count integer;
  v_resolved record;
  v_status text;
  v_code text;
  v_message text;
  v_valid integer;
  v_errors integer;
begin
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0
     or jsonb_array_length(p_rows) > 5000 then
    raise exception 'Warranty preview requires 1–5000 rows';
  end if;

  insert into public.os_it_warranty_import_batches (
    source_name, source_sha256, created_by, row_count
  ) values (
    nullif(trim(p_source_name), ''), p_source_sha256, p_actor_id,
    jsonb_array_length(p_rows)
  ) returning batch_id into v_batch_id;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    v_line := coalesce((v_row->>'line_number')::integer, 0);
    v_asset_id := nullif(trim(v_row->>'asset_id'), '');
    v_serial := nullif(trim(v_row->>'serial_number'), '');
    begin
      v_date := (v_row->>'warranty_ends_at')::date;
    exception when others then
      v_date := null;
    end;
    v_status := 'valid';
    v_code := null;
    v_message := null;
    v_resolved := null;

    if v_date is null then
      v_status := 'invalid'; v_code := 'invalid_date';
      v_message := 'warranty_ends_at must be a valid date';
    elsif v_asset_id is not null then
      select count(*) into v_match_count
      from public.os_it_hardware_assets where asset_id = v_asset_id;
      if v_match_count <> 1 then
        v_status := 'invalid'; v_code := 'asset_not_found';
        v_message := 'Asset ID did not resolve uniquely';
      else
        select asset_id, warranty_ends_at, entity_id into v_resolved
        from public.os_it_hardware_assets where asset_id = v_asset_id;
      end if;
    elsif v_serial is not null then
      select count(*) into v_match_count
      from public.os_it_hardware_assets
      where lower(trim(serial_number)) = lower(v_serial);
      if v_match_count = 0 then
        v_status := 'invalid'; v_code := 'serial_not_found';
        v_message := 'Serial number not found';
      elsif v_match_count > 1 then
        v_status := 'invalid'; v_code := 'serial_ambiguous';
        v_message := 'Serial number matches multiple assets';
      else
        select asset_id, warranty_ends_at, entity_id into v_resolved
        from public.os_it_hardware_assets
        where lower(trim(serial_number)) = lower(v_serial);
      end if;
    else
      v_status := 'invalid'; v_code := 'missing_locator';
      v_message := 'asset_id or serial_number is required';
    end if;

    if v_status = 'valid' and exists (
      select 1 from public.os_it_warranty_import_rows
      where batch_id = v_batch_id and asset_id = v_resolved.asset_id
    ) then
      v_status := 'invalid'; v_code := 'duplicate_asset';
      v_message := 'Multiple rows resolve to the same asset';
    end if;

    insert into public.os_it_warranty_import_rows (
      batch_id, line_number, locator_type, locator_value, asset_id,
      previous_warranty_ends_at, proposed_warranty_ends_at,
      validation_status, validation_code, validation_message, source_row
    ) values (
      v_batch_id, v_line,
      case when v_asset_id is not null then 'asset_id' else 'serial_number' end,
      coalesce(v_asset_id, v_serial, ''),
      case when v_status = 'valid' then v_resolved.asset_id else null end,
      case when v_status = 'valid' then v_resolved.warranty_ends_at else null end,
      v_date, v_status, v_code, v_message, v_row
    );
  end loop;

  select
    count(*) filter (where validation_status = 'valid'),
    count(*) filter (where validation_status = 'invalid')
  into v_valid, v_errors
  from public.os_it_warranty_import_rows where batch_id = v_batch_id;

  update public.os_it_warranty_import_batches
  set valid_count = v_valid, error_count = v_errors,
      status = case when v_errors = 0 then 'ready' else 'invalid' end
  where batch_id = v_batch_id;

  return jsonb_build_object(
    'batch_id', v_batch_id, 'status',
    case when v_errors = 0 then 'ready' else 'invalid' end,
    'valid', v_valid, 'errors', v_errors
  );
end;
$$;

create or replace function public.commit_it_warranty_import(
  p_batch_id uuid,
  p_source_sha256 text,
  p_actor_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch public.os_it_warranty_import_batches%rowtype;
  v_stale integer;
  v_changed integer;
begin
  select * into v_batch from public.os_it_warranty_import_batches
  where batch_id = p_batch_id for update;
  if not found then raise exception 'Warranty batch not found'; end if;
  if v_batch.source_sha256 <> p_source_sha256 then
    raise exception 'Warranty batch source hash mismatch';
  end if;
  if v_batch.status = 'committed' then return v_batch.result; end if;
  if v_batch.status <> 'ready' then
    raise exception 'Warranty batch is not ready: %', v_batch.status;
  end if;

  perform 1 from public.os_it_hardware_assets a
  join public.os_it_warranty_import_rows r on r.asset_id = a.asset_id
  where r.batch_id = p_batch_id and r.validation_status = 'valid'
  order by a.asset_id for update of a;

  select count(*) into v_stale
  from public.os_it_warranty_import_rows r
  join public.os_it_hardware_assets a on a.asset_id = r.asset_id
  where r.batch_id = p_batch_id and r.validation_status = 'valid'
    and a.warranty_ends_at is distinct from r.previous_warranty_ends_at;
  if v_stale > 0 then
    raise exception 'Warranty preview is stale for % asset(s); create a new preview',
      v_stale;
  end if;

  with changed as (
    update public.os_it_hardware_assets a
    set warranty_ends_at = r.proposed_warranty_ends_at, updated_at = now()
    from public.os_it_warranty_import_rows r
    where r.batch_id = p_batch_id and r.validation_status = 'valid'
      and r.asset_id = a.asset_id
      and a.warranty_ends_at is distinct from r.proposed_warranty_ends_at
    returning a.asset_id, a.entity_id
  )
  select count(*) into v_changed from changed;

  insert into public.os_it_lifecycle_events (
    event_id, run_id, item_id, target_id, entity_id, actor_id,
    status, detail, metadata
  )
  select
    'ITL-' || gen_random_uuid()::text, p_batch_id::text,
    'warranty-import', r.asset_id, a.entity_id, p_actor_id, 'done',
    'Warranty ' || coalesce(r.previous_warranty_ends_at::text, 'unset') ||
      ' → ' || r.proposed_warranty_ends_at::text,
    jsonb_build_object(
      'kind', 'atomic_warranty_import', 'batch_id', p_batch_id,
      'before', r.previous_warranty_ends_at, 'after', r.proposed_warranty_ends_at
    )
  from public.os_it_warranty_import_rows r
  join public.os_it_hardware_assets a on a.asset_id = r.asset_id
  where r.batch_id = p_batch_id and r.validation_status = 'valid'
    and r.previous_warranty_ends_at is distinct from r.proposed_warranty_ends_at;

  update public.os_it_warranty_import_batches
  set status = 'committed', committed_at = now(),
      result = jsonb_build_object(
        'batch_id', p_batch_id, 'status', 'committed', 'changed', v_changed
      )
  where batch_id = p_batch_id
  returning * into v_batch;
  return v_batch.result;
end;
$$;

create table if not exists public.os_it_intune_actions (
  action_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  run_id text,
  item_id text,
  managed_device_id text not null,
  user_id text,
  entity_id text references public.entities(entity_id),
  action_type text not null default 'retire',
  status text not null default 'requested',
  requested_by uuid,
  approved_by uuid,
  requested_at timestamptz not null default now(),
  approved_at timestamptz,
  submitted_at timestamptz,
  verified_at timestamptz,
  graph_request_id text,
  attempt_count integer not null default 0,
  next_poll_at timestamptz,
  last_error text,
  request_metadata jsonb not null default '{}'::jsonb,
  submission_evidence jsonb not null default '{}'::jsonb,
  verification_evidence jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint os_it_intune_action_type_check check (action_type in ('retire')),
  constraint os_it_intune_action_status_check check (
    status in ('requested', 'approved', 'submitted', 'verifying', 'verified', 'failed', 'cancelled')
  )
);

create unique index if not exists os_it_intune_active_action_unique
  on public.os_it_intune_actions (managed_device_id, action_type)
  where status in ('requested', 'approved', 'submitted', 'verifying');
create index if not exists os_it_intune_action_poll_idx
  on public.os_it_intune_actions (status, next_poll_at);

create table if not exists public.os_it_intune_action_events (
  event_id uuid primary key default gen_random_uuid(),
  action_id uuid not null references public.os_it_intune_actions(action_id),
  from_status text,
  to_status text not null,
  actor_id uuid,
  source text not null,
  evidence jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

alter table public.os_it_warranty_import_batches enable row level security;
alter table public.os_it_warranty_import_rows enable row level security;
alter table public.os_it_intune_actions enable row level security;
alter table public.os_it_intune_action_events enable row level security;

drop policy if exists "os_it_warranty_batch_select"
  on public.os_it_warranty_import_batches;
drop policy if exists "os_it_warranty_row_select"
  on public.os_it_warranty_import_rows;
drop policy if exists "os_it_intune_action_select"
  on public.os_it_intune_actions;
drop policy if exists "os_it_intune_event_select"
  on public.os_it_intune_action_events;
create policy "os_it_warranty_batch_select" on public.os_it_warranty_import_batches
  for select to authenticated using (created_by = auth.uid() or public.is_firm_wide_access());
create policy "os_it_warranty_row_select" on public.os_it_warranty_import_rows
  for select to authenticated using (
    exists (select 1 from public.os_it_warranty_import_batches b
      where b.batch_id = os_it_warranty_import_rows.batch_id
        and (b.created_by = auth.uid() or public.is_firm_wide_access()))
  );
create policy "os_it_intune_action_select" on public.os_it_intune_actions
  for select to authenticated using (
    public.is_firm_wide_access() or entity_id is null or public.can_access_entity(entity_id)
  );
create policy "os_it_intune_event_select" on public.os_it_intune_action_events
  for select to authenticated using (
    exists (select 1 from public.os_it_intune_actions a
      where a.action_id = os_it_intune_action_events.action_id
        and (public.is_firm_wide_access() or a.entity_id is null or public.can_access_entity(a.entity_id)))
  );

grant select on public.os_it_warranty_import_batches,
  public.os_it_warranty_import_rows, public.os_it_intune_actions,
  public.os_it_intune_action_events to authenticated;
revoke all on function public.prepare_it_warranty_import(text, text, uuid, jsonb)
  from public, authenticated;
revoke all on function public.commit_it_warranty_import(uuid, text, uuid)
  from public, authenticated;
grant execute on function public.prepare_it_warranty_import(text, text, uuid, jsonb)
  to service_role;
grant execute on function public.commit_it_warranty_import(uuid, text, uuid)
  to service_role;

alter table public.os_snapshot_soak_observations
  add column if not exists epoch_id uuid,
  add column if not exists continuity_status text,
  add column if not exists healthy_streak_count integer,
  add column if not exists healthy_streak_started_at timestamptz;

create table if not exists public.os_snapshot_soak_epochs (
  epoch_id uuid primary key default gen_random_uuid(),
  retired_table_name text not null,
  rename_event_id text,
  status text not null default 'active',
  required_hours integer not null default 168,
  max_gap_hours integer not null default 8,
  minimum_observations integer not null default 21,
  streak_started_at timestamptz,
  last_observed_at timestamptz,
  healthy_count integer not null default 0,
  reset_reason text,
  qualified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_snapshot_soak_epoch_status_check
    check (status in ('active', 'broken', 'qualified', 'rolled_back')),
  constraint os_snapshot_soak_epoch_name_check
    check (retired_table_name ~ '^os_store_snapshots_retired_[0-9]{8}$')
);

alter table public.os_snapshot_soak_epochs enable row level security;
drop policy if exists "os_snapshot_soak_epoch_select"
  on public.os_snapshot_soak_epochs;
create policy "os_snapshot_soak_epoch_select" on public.os_snapshot_soak_epochs
  for select to authenticated using (public.is_firm_wide_access());
grant select on public.os_snapshot_soak_epochs to authenticated;
