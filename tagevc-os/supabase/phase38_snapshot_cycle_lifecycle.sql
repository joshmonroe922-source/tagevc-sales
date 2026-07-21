-- Phase 38: canonical, replay-safe snapshot evidence-cycle lifecycle.
-- This migration intentionally performs no DDL or DML against os_store_snapshots.

create table if not exists public.os_snapshot_evidence_cycles (
  cycle_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source text not null,
  operation text not null,
  observed_at timestamptz not null,
  requested_actor jsonb not null,
  normalized_config jsonb not null,
  contract_version text not null,
  report jsonb not null,
  observation jsonb not null,
  canonical_input jsonb not null,
  canonical_sha256 text not null,
  status text not null default 'recording',
  drill_run_id uuid references public.os_snapshot_drill_runs(drill_run_id),
  observation_id uuid references public.os_snapshot_soak_observations(id),
  epoch_id uuid references public.os_snapshot_soak_epochs(epoch_id),
  evidence_sha256 text,
  conflict_count integer not null default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_snapshot_cycle_source_check check (source in ('cron','admin')),
  constraint os_snapshot_cycle_operation_check check (operation in ('drill','soak')),
  constraint os_snapshot_cycle_status_check check (
    status in ('recording','completed','failed','conflicted')
  ),
  constraint os_snapshot_cycle_contract_check check (contract_version='phase38-v1'),
  constraint os_snapshot_cycle_hash_check check (canonical_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.os_snapshot_evidence_cycles
  add column if not exists evidence_valid boolean not null default true,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;
alter table public.os_snapshot_evidence_cycles
  drop constraint if exists os_snapshot_cycle_source_check,
  drop constraint if exists os_snapshot_cycle_operation_check,
  drop constraint if exists os_snapshot_cycle_status_check,
  drop constraint if exists os_snapshot_cycle_contract_check,
  drop constraint if exists os_snapshot_cycle_hash_check;
alter table public.os_snapshot_evidence_cycles
  add constraint os_snapshot_cycle_source_check check (source in ('cron','admin')),
  add constraint os_snapshot_cycle_operation_check check (operation in ('drill','soak')),
  add constraint os_snapshot_cycle_status_check check (
    status in ('recording','completed','failed','conflicted')
  ),
  add constraint os_snapshot_cycle_contract_check check (contract_version='phase38-v1'),
  add constraint os_snapshot_cycle_hash_check check (canonical_sha256 ~ '^[0-9a-f]{64}$');
alter table public.os_snapshot_soak_observations
  add column if not exists evidence_valid boolean not null default true,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;
alter table public.os_snapshot_drill_runs
  add column if not exists evidence_valid boolean not null default true,
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;
alter table public.os_snapshot_rollback_rehearsals
  add column if not exists invalidated_at timestamptz,
  add column if not exists invalidation_reason text;
alter table public.os_snapshot_rollback_rehearsals
  drop constraint if exists os_snapshot_rehearsal_status_check;
alter table public.os_snapshot_rollback_rehearsals
  add constraint os_snapshot_rehearsal_status_check check (
    status in ('awaiting_review','attested','rejected','expired','superseded',
      'invalidated')
  );
create index if not exists os_snapshot_cycle_latest
  on public.os_snapshot_evidence_cycles(operation,source,observed_at desc,cycle_id desc);

create table if not exists public.os_snapshot_evidence_cycle_events (
  event_id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null references public.os_snapshot_evidence_cycles(cycle_id),
  event_type text not null,
  actor jsonb not null,
  canonical_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  constraint os_snapshot_cycle_event_type_check check (
    event_type in ('recording_started','completed','exact_replay',
      'replay_conflict','recording_failed','epoch_invalidated',
      'rehearsals_refreshed')
  )
);
alter table public.os_snapshot_evidence_cycle_events
  drop constraint if exists os_snapshot_cycle_event_type_check;
alter table public.os_snapshot_evidence_cycle_events
  add constraint os_snapshot_cycle_event_type_check check (
    event_type in ('recording_started','completed','exact_replay',
      'replay_conflict','recording_failed','epoch_invalidated',
      'rehearsals_refreshed')
  );
create index if not exists os_snapshot_cycle_event_timeline
  on public.os_snapshot_evidence_cycle_events(cycle_id,occurred_at,event_id);
create or replace function public.prevent_append_only_change()
returns trigger language plpgsql as $$
begin raise exception '% is append-only',tg_table_name; end $$;
drop trigger if exists os_snapshot_cycle_events_append_only
  on public.os_snapshot_evidence_cycle_events;
create trigger os_snapshot_cycle_events_append_only before update or delete
  on public.os_snapshot_evidence_cycle_events for each row
  execute function public.prevent_append_only_change();

drop view if exists public.os_snapshot_latest_evidence_cycle;
create view public.os_snapshot_latest_evidence_cycle as
select distinct on (operation)
  cycle_id,idempotency_key,source,operation,observed_at,requested_actor,
  normalized_config,contract_version,canonical_sha256,status,evidence_valid,
  invalidated_at,invalidation_reason,drill_run_id,
  observation_id,epoch_id,evidence_sha256,conflict_count,completed_at
from public.os_snapshot_evidence_cycles
order by operation,observed_at desc,cycle_id desc;

create or replace function public.phase38_latest_snapshot_metric(
  p_metric_key text,p_evaluated_at timestamptz
) returns table(metric_value numeric,detail jsonb)
language sql stable set search_path=public as $$
  with latest as (
    select * from public.os_snapshot_evidence_cycles
    where operation='soak'
      and (p_metric_key<>'snapshot_cron_observation_age_seconds' or source='cron')
    order by observed_at desc,cycle_id desc limit 1
  )
  select case
      when p_metric_key='snapshot_cron_observation_age_seconds'
        then extract(epoch from (p_evaluated_at-c.observed_at))
      when p_metric_key='snapshot_evidence_integrity'
        then case when c.status='completed' and c.evidence_valid
          and c.conflict_count=0 and d.status='passed' and d.evidence_valid
          and o.healthy and o.evidence_valid
          and o.continuity_status in ('active','qualified','pre_rename',
            'manual_nonqualifying')
          and c.evidence_sha256=d.evidence_sha256
          and c.observation_id=o.id and c.epoch_id is not distinct from o.epoch_id
          then 0 else 1 end
    end,
    jsonb_build_object('cycle_id',c.cycle_id,
      'canonical_sha256',c.canonical_sha256,'cycle_status',c.status,
      'evidence_valid',c.evidence_valid,'conflict_count',c.conflict_count)
  from latest c
  left join public.os_snapshot_drill_runs d on d.drill_run_id=c.drill_run_id
  left join public.os_snapshot_soak_observations o on o.id=c.observation_id
$$;

create or replace function public.invalidate_snapshot_epoch_evidence(
  p_epoch_id uuid,p_actor jsonb,p_reason text
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_observations integer;v_drills integer;v_cycles integer;
  v_rehearsals integer;v_row record;
begin
  if p_epoch_id is null or nullif(trim(p_reason),'') is null then
    raise exception 'Epoch and invalidation reason are required';
  end if;
  update public.os_snapshot_soak_observations set evidence_valid=false,
    invalidated_at=coalesce(invalidated_at,now()),
    invalidation_reason=coalesce(invalidation_reason,p_reason)
  where epoch_id=p_epoch_id and evidence_valid;
  get diagnostics v_observations=row_count;
  update public.os_snapshot_drill_runs set evidence_valid=false,
    invalidated_at=coalesce(invalidated_at,now()),
    invalidation_reason=coalesce(invalidation_reason,p_reason)
  where epoch_id=p_epoch_id and evidence_valid;
  get diagnostics v_drills=row_count;
  insert into public.os_snapshot_evidence_cycle_events(
    cycle_id,event_type,actor,canonical_sha256,detail
  )
  select cycle_id,'epoch_invalidated',p_actor,canonical_sha256,
    jsonb_build_object('epoch_id',p_epoch_id,'reason',p_reason)
  from public.os_snapshot_evidence_cycles
  where epoch_id=p_epoch_id and evidence_valid;
  update public.os_snapshot_evidence_cycles set evidence_valid=false,
    invalidated_at=coalesce(invalidated_at,now()),
    invalidation_reason=coalesce(invalidation_reason,p_reason)
  where epoch_id=p_epoch_id and evidence_valid;
  get diagnostics v_cycles=row_count;
  v_rehearsals:=0;
  for v_row in
    select * from public.os_snapshot_rollback_rehearsals
    where epoch_id=p_epoch_id and status in ('awaiting_review','attested')
    for update
  loop
    update public.os_snapshot_rollback_rehearsals set status='invalidated',
      invalidated_at=now(),invalidation_reason=p_reason,
      valid_until=null,row_version=row_version+1,updated_at=now()
    where drill_run_id=v_row.drill_run_id;
    insert into public.os_snapshot_rollback_rehearsal_events(
      drill_run_id,event_type,from_status,to_status,actor_id,reason,
      evidence_bundle_sha256,row_version
    ) values (
      v_row.drill_run_id,'epoch_invalidated',v_row.status,'invalidated',
      nullif(p_actor->>'actor_id','')::uuid,p_reason,
      v_row.evidence_bundle_sha256,v_row.row_version+1
    );
    v_rehearsals:=v_rehearsals+1;
  end loop;
  return jsonb_build_object('epoch_id',p_epoch_id,
    'observations_invalidated',v_observations,'drills_invalidated',v_drills,
    'cycles_invalidated',v_cycles,'rehearsals_invalidated',v_rehearsals);
end $$;

create or replace function public.record_snapshot_evidence_cycle_v2(
  p_source text,
  p_requested_actor jsonb,
  p_observed_at timestamptz,
  p_normalized_config jsonb,
  p_contract_version text,
  p_code_revision text,
  p_report jsonb,
  p_observation jsonb,
  p_record_soak boolean
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_canonical jsonb; v_hash text; v_key text; v_bucket timestamptz;
  v_cycle public.os_snapshot_evidence_cycles%rowtype;
  v_result jsonb; v_retired text; v_refresh jsonb;
  v_prior_epoch uuid; v_refresh_epoch uuid;
begin
  if p_source not in ('cron','admin') or p_observed_at is null
     or p_requested_actor is null or jsonb_typeof(p_requested_actor)<>'object'
     or p_normalized_config is null or jsonb_typeof(p_normalized_config)<>'object'
     or p_contract_version<>'phase38-v1' or p_report is null or p_observation is null
     or p_record_soak is null then
    raise exception 'Phase 38 snapshot cycle input is invalid';
  end if;
  if (p_source='cron' and (
        p_requested_actor->>'actor_type'<>'cron'
        or nullif(p_requested_actor->>'actor_id','') is not null
      ))
     or (p_source='admin' and (
       p_requested_actor->>'actor_type'<>'user'
       or not exists (select 1 from public.profiles p
         where p.id=nullif(p_requested_actor->>'actor_id','')::uuid
           and p.active and p.role in ('visionary','admin'))
     )) then
    raise exception 'Snapshot evidence requested actor is unauthorized';
  end if;
  v_retired:=nullif(p_normalized_config->>'retired_table','');
  if v_retired is not null and v_retired !~ '^os_store_snapshots_retired_[0-9]{8}$' then
    raise exception 'Retired snapshot evidence relation name is invalid';
  end if;
  v_canonical:=jsonb_build_object(
    'contract_version',p_contract_version,
    'source',p_source,
    'operation',case when p_record_soak then 'soak' else 'drill' end,
    'observed_at',to_jsonb(p_observed_at),
    'requested_actor',p_requested_actor,
    'normalized_config',p_normalized_config,
    'code_revision',coalesce(nullif(p_code_revision,''),'local'),
    'report',p_report,
    'observation',p_observation
  );
  v_hash:=encode(digest(v_canonical::text,'sha256'),'hex');
  v_bucket:=date_bin(interval '6 hours',p_observed_at,
    timestamptz '2000-01-01 00:00:00+00');
  v_key:=case when p_source='cron'
    then 'phase38:'||case when p_record_soak then 'soak:' else 'drill:' end
      ||encode(digest(p_normalized_config::text,'sha256'),'hex')||':'||v_bucket::text
    else 'phase38:admin:'||v_hash end;
  perform pg_advisory_xact_lock(hashtextextended('snapshot-cycle:'||v_key,0));
  select * into v_cycle from public.os_snapshot_evidence_cycles
  where idempotency_key=v_key for update;
  if found then
    if v_cycle.canonical_sha256=v_hash and v_cycle.canonical_input=v_canonical then
      insert into public.os_snapshot_evidence_cycle_events(
        cycle_id,event_type,actor,canonical_sha256,detail
      ) values (v_cycle.cycle_id,'exact_replay',p_requested_actor,v_hash,
        jsonb_build_object('status',v_cycle.status));
      return jsonb_build_object('ok',v_cycle.status='completed',
        'cycle_id',v_cycle.cycle_id,'drill_run_id',v_cycle.drill_run_id,
        'observation_id',v_cycle.observation_id,'epoch_id',v_cycle.epoch_id,
        'epoch_status',(select status from public.os_snapshot_soak_epochs
          where epoch_id=v_cycle.epoch_id),
        'evidence_sha256',v_cycle.evidence_sha256,'canonical_sha256',v_hash,
        'replayed',true,'input_matched',true);
    end if;
    update public.os_snapshot_evidence_cycles
      set status='conflicted',conflict_count=conflict_count+1,
        completed_at=coalesce(completed_at,now())
      where cycle_id=v_cycle.cycle_id;
    insert into public.os_snapshot_evidence_cycle_events(
      cycle_id,event_type,actor,canonical_sha256,detail
    ) values (v_cycle.cycle_id,'replay_conflict',p_requested_actor,v_hash,
      jsonb_build_object('retained_sha256',v_cycle.canonical_sha256,
        'incoming_sha256',v_hash,'incoming_canonical_input',v_canonical));
    return jsonb_build_object('ok',false,'cycle_id',v_cycle.cycle_id,
      'replayed',true,'input_matched',false,'replay_conflict',true,
      'canonical_sha256',v_hash,'retained_sha256',v_cycle.canonical_sha256);
  end if;
  insert into public.os_snapshot_evidence_cycles(
    idempotency_key,source,operation,observed_at,requested_actor,
    normalized_config,contract_version,report,observation,canonical_input,
    canonical_sha256
  ) values (
    v_key,p_source,case when p_record_soak then 'soak' else 'drill' end,
    p_observed_at,p_requested_actor,p_normalized_config,p_contract_version,
    p_report,p_observation,v_canonical,v_hash
  ) returning * into v_cycle;
  insert into public.os_snapshot_evidence_cycle_events(
    cycle_id,event_type,actor,canonical_sha256
  ) values (v_cycle.cycle_id,'recording_started',p_requested_actor,v_hash);

  if p_record_soak and v_retired is not null then
    select epoch_id into v_prior_epoch from public.os_snapshot_soak_epochs
    where retired_table_name=v_retired and status in ('active','qualified')
    order by created_at desc limit 1;
  end if;
  begin
    v_result:=public.record_snapshot_evidence_cycle(
      p_source,nullif(p_requested_actor->>'actor_id','')::uuid,p_observed_at,
      v_retired,encode(digest(p_normalized_config::text,'sha256'),'hex'),
      p_code_revision,p_report,p_observation,p_record_soak);
  exception when others then
    update public.os_snapshot_evidence_cycles set status='failed',
      completed_at=now() where cycle_id=v_cycle.cycle_id;
    insert into public.os_snapshot_evidence_cycle_events(
      cycle_id,event_type,actor,canonical_sha256,detail
    ) values (v_cycle.cycle_id,'recording_failed',p_requested_actor,v_hash,
      jsonb_build_object('sqlstate',sqlstate,'error',sqlerrm));
    return jsonb_build_object('ok',false,'cycle_id',v_cycle.cycle_id,
      'error',sqlerrm,'canonical_sha256',v_hash,'replayed',false);
  end;

  update public.os_snapshot_evidence_cycles set status='completed',
    drill_run_id=nullif(v_result->>'drill_run_id','')::uuid,
    observation_id=nullif(v_result->>'observation_id','')::uuid,
    epoch_id=nullif(v_result->>'epoch_id','')::uuid,
    evidence_sha256=v_result->>'evidence_sha256',completed_at=now()
  where cycle_id=v_cycle.cycle_id;
  insert into public.os_snapshot_evidence_cycle_events(
    cycle_id,event_type,actor,canonical_sha256,detail
  ) values (v_cycle.cycle_id,'completed',p_requested_actor,v_hash,v_result);

  -- The legacy transaction can break/roll back an epoch. Refreshing dependent
  -- rehearsals in the same outer transaction prevents stale attested evidence.
  v_refresh_epoch:=coalesce(nullif(v_result->>'epoch_id','')::uuid,v_prior_epoch);
  if v_refresh_epoch is not null then
    if coalesce((select status from public.os_snapshot_soak_epochs
      where epoch_id=v_refresh_epoch),'') in ('broken','rolled_back') then
      v_refresh:=public.invalidate_snapshot_epoch_evidence(
        v_refresh_epoch,p_requested_actor,
        'Epoch became '||(select status from public.os_snapshot_soak_epochs
          where epoch_id=v_refresh_epoch)||' during evidence cycle');
      insert into public.os_snapshot_evidence_cycle_events(
        cycle_id,event_type,actor,canonical_sha256,detail
      ) values (v_cycle.cycle_id,'epoch_invalidated',p_requested_actor,v_hash,
        v_refresh);
    else
      v_refresh:=public.refresh_snapshot_rollback_rehearsals(v_refresh_epoch);
      insert into public.os_snapshot_evidence_cycle_events(
        cycle_id,event_type,actor,canonical_sha256,detail
      ) values (v_cycle.cycle_id,'rehearsals_refreshed',p_requested_actor,
        v_hash,v_refresh);
    end if;
  end if;
  return v_result||jsonb_build_object('ok',true,'cycle_id',v_cycle.cycle_id,
    'canonical_sha256',v_hash);
end $$;

alter table public.os_snapshot_evidence_cycles enable row level security;
alter table public.os_snapshot_evidence_cycle_events enable row level security;
drop policy if exists "os_snapshot_cycle_select"
  on public.os_snapshot_evidence_cycles;
drop policy if exists "os_snapshot_cycle_event_select"
  on public.os_snapshot_evidence_cycle_events;
create policy "os_snapshot_cycle_select" on public.os_snapshot_evidence_cycles
  for select to authenticated using (public.is_firm_wide_access());
create policy "os_snapshot_cycle_event_select" on public.os_snapshot_evidence_cycle_events
  for select to authenticated using (public.is_firm_wide_access());
grant select on public.os_snapshot_evidence_cycles,
  public.os_snapshot_evidence_cycle_events,
  public.os_snapshot_latest_evidence_cycle to authenticated;
revoke all on function public.record_snapshot_evidence_cycle_v2(
  text,jsonb,timestamptz,jsonb,text,text,jsonb,jsonb,boolean
) from public,authenticated;
revoke all on function public.invalidate_snapshot_epoch_evidence(uuid,jsonb,text)
  from public,authenticated;
grant execute on function public.record_snapshot_evidence_cycle_v2(
  text,jsonb,timestamptz,jsonb,text,text,jsonb,jsonb,boolean
) to service_role;
grant execute on function public.invalidate_snapshot_epoch_evidence(uuid,jsonb,text)
  to service_role;

create or replace function public.assert_phase38_snapshot_invariants()
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_valid_observations integer;v_valid_drills integer;
  v_effective_rehearsals integer;
begin
  select count(*) into v_valid_observations
  from public.os_snapshot_soak_observations o
  join public.os_snapshot_soak_epochs e on e.epoch_id=o.epoch_id
  where e.status in ('broken','rolled_back') and o.evidence_valid;
  select count(*) into v_valid_drills
  from public.os_snapshot_drill_runs d
  join public.os_snapshot_soak_epochs e on e.epoch_id=d.epoch_id
  where e.status in ('broken','rolled_back') and d.evidence_valid;
  select count(*) into v_effective_rehearsals
  from public.os_snapshot_rollback_rehearsals r
  join public.os_snapshot_soak_epochs e on e.epoch_id=r.epoch_id
  where e.status in ('broken','rolled_back')
    and r.status in ('awaiting_review','attested');
  if v_valid_observations+v_valid_drills+v_effective_rehearsals>0 then
    raise exception 'Phase 38 snapshot evidence invariant violation';
  end if;
  return jsonb_build_object('ok',true,
    'valid_observations_on_invalid_epoch',v_valid_observations,
    'valid_drills_on_invalid_epoch',v_valid_drills,
    'effective_rehearsals_on_invalid_epoch',v_effective_rehearsals);
end $$;
revoke all on function public.assert_phase38_snapshot_invariants()
  from public,authenticated;
grant execute on function public.assert_phase38_snapshot_invariants()
  to service_role;
