-- Phase 37: atomically persist drill checks, soak epochs, and observations.
-- This migration intentionally contains no DDL or DML against os_store_snapshots.

do $$
begin
  if exists (
    select 1 from public.os_snapshot_soak_epochs
    where status in ('active','qualified')
    group by retired_table_name having count(*) > 1
  ) then
    raise exception 'Duplicate effective snapshot soak epochs require reconciliation';
  end if;
end;
$$;

create index if not exists os_snapshot_observation_epoch_timeline_idx
  on public.os_snapshot_soak_observations(epoch_id, observed_at desc);

create or replace function public.record_snapshot_evidence_cycle(
  p_source text,
  p_requested_by uuid,
  p_observed_at timestamptz,
  p_retired_table_name text,
  p_config_fingerprint text,
  p_code_revision text,
  p_report jsonb,
  p_observation jsonb,
  p_record_soak boolean
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_hash text;
  v_bucket timestamptz;
  v_key text;
  v_run public.os_snapshot_drill_runs%rowtype;
  v_result jsonb;
  v_check jsonb;
  v_domain jsonb;
  v_expected_checks integer;
  v_actual_checks integer;
  v_event record;
  v_epoch public.os_snapshot_soak_epochs%rowtype;
  v_observation_id uuid;
  v_healthy boolean;
  v_continuity text;
  v_next_count integer := 0;
  v_started timestamptz;
  v_gap numeric;
  v_qualified boolean := false;
  v_report_ok boolean;
  v_stage4_ready boolean;
  v_all_checks_ok boolean;
begin
  if p_source is null or p_observed_at is null or p_report is null
     or p_observation is null or p_record_soak is null
     or p_source not in ('cron','admin')
     or p_config_fingerprint !~ '^[0-9a-f]{64}$'
     or p_observed_at > now() + interval '5 minutes'
     or p_observed_at < now() - interval '24 hours'
     or (p_retired_table_name is not null and
       p_retired_table_name !~ '^os_store_snapshots_retired_[0-9]{8}$')
     or jsonb_typeof(p_report->'results') <> 'array'
     or jsonb_array_length(p_report->'results') > 100
     or jsonb_typeof(p_observation->'issues') <> 'array' then
    raise exception 'Snapshot evidence cycle input is invalid';
  end if;
  select coalesce(sum(jsonb_array_length(domain->'checks')),0)::integer
  into v_expected_checks
  from jsonb_array_elements(p_report->'results') as domains(domain);
  select not exists (
    select 1
    from jsonb_array_elements(p_report->'results') as domains(domain)
    cross join lateral jsonb_array_elements(domain->'checks') as checks(check_row)
    where not coalesce((check_row->>'ok')::boolean,false)
  ) into v_all_checks_ok;
  if v_expected_checks < 1 or v_expected_checks > 500 then
    raise exception 'Snapshot evidence check count is invalid';
  end if;
  v_report_ok := coalesce((p_report->>'ok')::boolean,false);
  v_stage4_ready := coalesce((p_report->>'stage4_ready')::boolean,false);
  v_bucket := date_bin(
    interval '6 hours', p_observed_at, timestamptz '2000-01-01 00:00:00+00');
  v_hash := encode(digest(jsonb_build_object(
    'source',p_source,'operation',case when p_record_soak then 'soak' else 'drill' end,
    'retired_table_name',p_retired_table_name,
    'config_fingerprint',p_config_fingerprint,'code_revision',p_code_revision,
    'report',p_report-'fetched_at',
    'observation',case when p_record_soak then p_observation else null end
  )::text,'sha256'),'hex');
  v_key := case when p_source = 'cron'
    then case when p_record_soak then 'readiness-soak:' else 'readiness-drill:' end
      || p_config_fingerprint || ':' || v_bucket::text
    else 'readiness:admin:' || v_hash || ':' ||
      extract(epoch from p_observed_at)::bigint::text end;
  perform pg_advisory_xact_lock(hashtextextended(
    'snapshot-epoch:' || coalesce(p_retired_table_name,'live'),0));

  select * into v_run from public.os_snapshot_drill_runs
  where idempotency_key = v_key for update;
  if found then
    select count(*) into v_actual_checks
    from public.os_snapshot_drill_checks
    where drill_run_id = v_run.drill_run_id;
    if v_run.evidence_sha256 <> v_hash
       or v_actual_checks <> v_expected_checks then
      raise exception 'Snapshot evidence replay integrity mismatch';
    end if;
    if p_record_soak and (
      select count(*) from public.os_snapshot_soak_observations
      where drill_run_id=v_run.drill_run_id
    ) <> 1 then
      raise exception 'Snapshot soak replay is missing its linked observation';
    end if;
    return jsonb_build_object(
      'drill_run_id', v_run.drill_run_id,
      'observation_id', (
        select id from public.os_snapshot_soak_observations
        where drill_run_id = v_run.drill_run_id
        order by observed_at desc,id desc limit 1),
      'epoch_id', v_run.epoch_id, 'epoch_status', (
        select status from public.os_snapshot_soak_epochs
        where epoch_id = v_run.epoch_id),
      'evidence_sha256', v_run.evidence_sha256, 'replayed', true,
      'input_matched',true
    );
  end if;

  insert into public.os_snapshot_drill_runs (
    idempotency_key, drill_type, trigger_source, status,
    retired_table_name, requested_by, config_fingerprint, code_revision,
    started_at, completed_at, summary, evidence_sha256
  ) values (
    v_key, 'readiness', p_source,
    case when v_report_ok and v_all_checks_ok
      then 'passed' else 'failed' end,
    p_retired_table_name, p_requested_by, p_config_fingerprint,
    nullif(p_code_revision,''), p_observed_at, now(),
    jsonb_build_object('text',p_report->>'summary',
      'stage4_ready',coalesce((p_report->>'stage4_ready')::boolean,false),
      'transactional_evidence_version','phase37-v1'),
    v_hash
  ) returning * into v_run;

  for v_domain in select value from jsonb_array_elements(p_report->'results')
  loop
    if nullif(v_domain->>'collection','') is null
       or jsonb_typeof(v_domain->'checks') <> 'array' then
      raise exception 'Snapshot evidence domain is invalid';
    end if;
    for v_check in select value from jsonb_array_elements(v_domain->'checks')
    loop
      if nullif(v_check->>'name','') is null
         or v_check->'ok' is null then
        raise exception 'Snapshot evidence check is invalid';
      end if;
      insert into public.os_snapshot_drill_checks (
        drill_run_id, domain, check_name, ok, expected, observed, checked_at
      ) values (
        v_run.drill_run_id, v_domain->>'collection', v_check->>'name',
        (v_check->>'ok')::boolean, '{"ok":true}'::jsonb,
        jsonb_build_object('detail',v_check->>'detail'), p_observed_at
      );
    end loop;
  end loop;
  if not p_record_soak then
    return jsonb_build_object('drill_run_id',v_run.drill_run_id,
      'observation_id',null,'epoch_id',null,'epoch_status',null,
      'evidence_sha256',v_hash,'replayed',false);
  end if;

  v_healthy := coalesce((p_observation->>'healthy')::boolean,false)
    and v_report_ok and v_stage4_ready and v_all_checks_ok;
  v_continuity := case when p_source = 'admin' then 'manual_nonqualifying'
    when p_retired_table_name is null then 'pre_rename' else 'not_started' end;

  if p_retired_table_name is not null and p_source = 'cron' then
    if exists (
      select 1 from public.os_snapshot_soak_observations
      where retired_table_name=p_retired_table_name and source='cron'
        and observed_at>=p_observed_at
    ) then raise exception 'Out-of-order snapshot observation rejected'; end if;
    lock table public.os_snapshot_retirement_events in share mode;
    select event_id, stage, occurred_at into v_event
    from public.os_snapshot_retirement_events
    where retired_table_name = p_retired_table_name
    order by occurred_at desc,event_id desc limit 1 for share;
    if v_event.stage='rename_verified'
       and p_observed_at<v_event.occurred_at then
      raise exception 'Snapshot observation predates rename verification';
    end if;
    select * into v_epoch from public.os_snapshot_soak_epochs
    where retired_table_name = p_retired_table_name
      and status in ('active','qualified')
    order by created_at desc limit 1 for update;
    if v_epoch.epoch_id is not null and v_epoch.last_observed_at is not null
       and p_observed_at <= v_epoch.last_observed_at then
      raise exception 'Out-of-order snapshot observation rejected';
    end if;
    if v_event.stage = 'rollback' then
      if v_epoch.epoch_id is not null then
        update public.os_snapshot_soak_epochs set status = 'rolled_back',
          reset_reason = 'Durable rollback event', updated_at = p_observed_at
        where epoch_id = v_epoch.epoch_id;
      end if;
      v_epoch := null;
      v_continuity := 'rolled_back';
    elsif v_event.stage is distinct from 'rename_verified' then
      if v_epoch.epoch_id is not null then
        update public.os_snapshot_soak_epochs set status='broken',
          reset_reason='Latest retirement event is not rename_verified',
          updated_at=p_observed_at where epoch_id=v_epoch.epoch_id;
        v_epoch := null;
      end if;
      v_continuity := 'awaiting_rename_verification';
    elsif v_healthy then
      if v_epoch.epoch_id is not null and (
        v_epoch.config_fingerprint is distinct from p_config_fingerprint
        or v_epoch.rename_event_id is distinct from v_event.event_id
      ) then
        update public.os_snapshot_soak_epochs set status='broken',
          reset_reason=case
            when v_epoch.rename_event_id is distinct from v_event.event_id
              then 'Rename verification event changed'
            else 'Stage 4e configuration fingerprint changed' end,
          updated_at=p_observed_at where epoch_id=v_epoch.epoch_id;
        v_epoch := null;
      end if;
      if v_epoch.epoch_id is not null and v_epoch.last_observed_at is not null then
        v_gap := extract(epoch from
          (p_observed_at - v_epoch.last_observed_at)) / 3600;
        if v_gap > v_epoch.max_gap_hours then
          update public.os_snapshot_soak_epochs set status = 'broken',
            reset_reason = 'Observation gap exceeded the governed maximum',
            updated_at = p_observed_at where epoch_id = v_epoch.epoch_id;
          v_epoch := null;
        end if;
      end if;
      if v_epoch.epoch_id is null then
        insert into public.os_snapshot_soak_epochs (
          retired_table_name, rename_event_id, status, streak_started_at,
          last_observed_at, healthy_count, config_fingerprint,
          latest_drill_run_id
        ) values (
          p_retired_table_name, v_event.event_id, 'active', p_observed_at,
          p_observed_at, 1, p_config_fingerprint, v_run.drill_run_id
        ) returning * into v_epoch;
      else
        v_next_count := v_epoch.healthy_count + 1;
        v_started := coalesce(v_epoch.streak_started_at,p_observed_at);
        v_qualified :=
          extract(epoch from (p_observed_at - v_started)) / 3600
            >= v_epoch.required_hours
          and v_next_count >= v_epoch.minimum_observations;
        update public.os_snapshot_soak_epochs set
          status = case when v_qualified then 'qualified' else 'active' end,
          streak_started_at = v_started, last_observed_at = p_observed_at,
          healthy_count = v_next_count,
          qualified_at = case when v_qualified
            then coalesce(qualified_at,p_observed_at) else qualified_at end,
          reset_reason = null, latest_drill_run_id = v_run.drill_run_id,
          updated_at = p_observed_at
        where epoch_id = v_epoch.epoch_id returning * into v_epoch;
      end if;
      v_continuity := v_epoch.status;
    elsif v_epoch.epoch_id is not null then
      update public.os_snapshot_soak_epochs set status = 'broken',
        reset_reason = coalesce(nullif(p_observation->'issues'->>0,''),
          'Unhealthy observation'),
        last_observed_at = p_observed_at, updated_at = p_observed_at
      where epoch_id = v_epoch.epoch_id returning * into v_epoch;
      v_continuity := 'broken';
    end if;
  end if;

  update public.os_snapshot_drill_runs set
    epoch_id = v_epoch.epoch_id where drill_run_id = v_run.drill_run_id;
  insert into public.os_snapshot_soak_observations (
    healthy, issues, stage, sync_failure_count, fk_orphan_total,
    stage4_ready, drill_summary, source, retired_table_name, observed_at,
    epoch_id, continuity_status, healthy_streak_count,
    healthy_streak_started_at, observation_key, observation_bucket,
    qualification_eligible, drill_run_id, config_fingerprint,
    code_revision, evidence_sha256
  ) values (
    v_healthy, p_observation->'issues',
    coalesce(p_observation->>'stage','unknown'),
    coalesce((p_observation->>'sync_failure_count')::integer,0),
    coalesce((p_observation->>'fk_orphan_total')::integer,0),
    coalesce((p_observation->>'stage4_ready')::boolean,false),
    p_observation->>'drill_summary', p_source, p_retired_table_name,
    p_observed_at, v_epoch.epoch_id, v_continuity,
    coalesce(v_epoch.healthy_count,0), v_epoch.streak_started_at,
    p_source || ':' || coalesce(p_retired_table_name,'live') || ':' ||
      p_config_fingerprint || ':' ||
      v_bucket::text, v_bucket,
    p_source = 'cron' and v_healthy and v_epoch.epoch_id is not null,
    v_run.drill_run_id, p_config_fingerprint, p_code_revision, v_hash
  ) returning id into v_observation_id;
  return jsonb_build_object('drill_run_id',v_run.drill_run_id,
    'observation_id',v_observation_id,'epoch_id',v_epoch.epoch_id,
    'epoch_status',v_continuity,'evidence_sha256',v_hash,'replayed',false);
end;
$$;

revoke all on function public.record_snapshot_evidence_cycle(text,uuid,timestamptz,text,text,text,jsonb,jsonb,boolean)
  from public, authenticated;
grant execute on function public.record_snapshot_evidence_cycle(text,uuid,timestamptz,text,text,text,jsonb,jsonb,boolean)
  to service_role;
