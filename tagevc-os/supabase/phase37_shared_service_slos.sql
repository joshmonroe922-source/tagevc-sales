-- Phase 37: entity-scoped Shared Services SLO evaluations and durable alerts.

create table if not exists public.os_operational_worker_runs (
  worker_run_id uuid primary key default gen_random_uuid(),
  invocation_id uuid not null,
  service text not null,
  worker_name text not null,
  entity_id text references public.entities(entity_id),
  trigger_source text not null,
  status text not null default 'running',
  claimed integer not null default 0,
  succeeded integer not null default 0,
  failed integer not null default 0,
  lease_conflicts integer not null default 0,
  error_code text,
  error_detail text,
  details jsonb not null default '{}'::jsonb,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_operational_worker_service_check check (
    service in ('marketing','docusign','intune','snapshot','shared_services')
  ),
  constraint os_operational_worker_status_check check (
    status in ('running','completed','partial','failed')
  ),
  unique(invocation_id,service,worker_name,entity_id)
);
create index if not exists os_operational_worker_timeline_idx
  on public.os_operational_worker_runs(service,entity_id,started_at desc);
create unique index if not exists os_operational_worker_invocation_unique
  on public.os_operational_worker_runs(
    invocation_id,service,worker_name,coalesce(entity_id,'__firm__')
  );

create table if not exists public.os_slo_evaluations (
  evaluation_id uuid primary key default gen_random_uuid(),
  evaluation_bucket timestamptz not null,
  policy_version text not null,
  service text not null,
  metric_key text not null,
  entity_id text references public.entities(entity_id),
  severity text not null,
  observed_value numeric,
  warning_threshold numeric,
  critical_threshold numeric,
  comparator text not null,
  window_seconds integer not null,
  sample_count integer not null default 0,
  detail jsonb not null default '{}'::jsonb,
  evaluated_at timestamptz not null default now(),
  constraint os_slo_eval_severity_check check (
    severity in ('healthy','warning','critical','unknown')
  ),
  constraint os_slo_eval_comparator_check check (
    comparator in ('higher_bad','lower_bad')
  )
);
create unique index if not exists os_slo_evaluation_scope_unique
  on public.os_slo_evaluations(
    evaluation_bucket,policy_version,service,metric_key,
    coalesce(entity_id,'__firm__')
  );
create index if not exists os_slo_evaluation_timeline_idx
  on public.os_slo_evaluations(service,entity_id,evaluated_at desc);

create table if not exists public.os_slo_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  service text not null,
  metric_key text not null,
  entity_id text references public.entities(entity_id),
  policy_version text not null,
  status text not null default 'open',
  severity text not null,
  first_breached_at timestamptz not null,
  last_breached_at timestamptz not null,
  resolved_at timestamptz,
  consecutive_breaches integer not null default 1,
  consecutive_healthy integer not null default 0,
  occurrence_count integer not null default 1,
  latest_evaluation_id uuid not null
    references public.os_slo_evaluations(evaluation_id),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint os_slo_alert_status_check check (status in ('open','resolved')),
  constraint os_slo_alert_severity_check check (
    severity in ('warning','critical')
  )
);
create unique index if not exists os_slo_one_open_alert
  on public.os_slo_alerts(
    service,metric_key,coalesce(entity_id,'__firm__'),policy_version
  ) where status = 'open';
create index if not exists os_slo_alert_timeline_idx
  on public.os_slo_alerts(status,severity,updated_at desc);

alter table public.os_operational_worker_runs enable row level security;
alter table public.os_slo_evaluations enable row level security;
alter table public.os_slo_alerts enable row level security;
drop policy if exists "os_operational_worker_select"
  on public.os_operational_worker_runs;
drop policy if exists "os_slo_evaluation_select" on public.os_slo_evaluations;
drop policy if exists "os_slo_alert_select" on public.os_slo_alerts;
create policy "os_operational_worker_select"
  on public.os_operational_worker_runs for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_slo_evaluation_select"
  on public.os_slo_evaluations for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_slo_alert_select"
  on public.os_slo_alerts for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
grant select on public.os_operational_worker_runs,
  public.os_slo_evaluations, public.os_slo_alerts to authenticated;

create or replace function public.start_operational_worker_run(
  p_invocation_id uuid,
  p_service text,
  p_worker_name text,
  p_entity_id text,
  p_trigger_source text,
  p_details jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_id uuid;
begin
  insert into public.os_operational_worker_runs (
    invocation_id,service,worker_name,entity_id,trigger_source,details
  ) values (
    p_invocation_id,p_service,p_worker_name,p_entity_id,p_trigger_source,
    coalesce(p_details,'{}')
  ) on conflict (
    invocation_id,service,worker_name,(coalesce(entity_id,'__firm__'))
  ) do update set
    details = os_operational_worker_runs.details || excluded.details
  returning worker_run_id into v_id;
  return v_id;
end;
$$;

create or replace function public.finish_operational_worker_run(
  p_worker_run_id uuid,
  p_status text,
  p_claimed integer,
  p_succeeded integer,
  p_failed integer,
  p_lease_conflicts integer,
  p_error_code text,
  p_error_detail text,
  p_details jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.os_operational_worker_runs set
    status = p_status, claimed = greatest(coalesce(p_claimed,0),0),
    succeeded = greatest(coalesce(p_succeeded,0),0),
    failed = greatest(coalesce(p_failed,0),0),
    lease_conflicts = greatest(coalesce(p_lease_conflicts,0),0),
    error_code = left(p_error_code,100), error_detail = left(p_error_detail,500),
    details = details || coalesce(p_details,'{}'), completed_at = now()
  where worker_run_id = p_worker_run_id and status = 'running';
end;
$$;

create or replace function public.evaluate_shared_service_slos(
  p_evaluated_at timestamptz default now()
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_bucket timestamptz := date_bin(
    interval '1 hour',p_evaluated_at,timestamptz '2000-01-01 00:00:00+00');
  v_metric record;
  v_eval public.os_slo_evaluations%rowtype;
  v_alert public.os_slo_alerts%rowtype;
  v_severity text;
  v_recent_breaches integer;
  v_existing_evaluation_id uuid;
  v_transitions jsonb := '[]'::jsonb;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('shared-services-slo-evaluator',0));
  perform public.refresh_snapshot_rollback_rehearsals(null);
  create temporary table tmp_slo_metrics (
    service text, metric_key text, entity_id text, observed_value numeric,
    warning_threshold numeric, critical_threshold numeric, comparator text,
    window_seconds integer, sample_count integer, detail jsonb
  ) on commit drop;

  insert into tmp_slo_metrics
  select 'marketing','paid_sync_due_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at -
      coalesce(r.next_attempt_at,r.lease_expires_at,r.queued_at)))),0),
    1800,7200,'higher_bad',7200,count(r.run_id),
    jsonb_build_object('due_runs',count(r.run_id))
  from (
    select distinct entity_id from public.os_marketing_social_accounts
    where account_type = 'paid_ads' and entity_id is not null
  ) entities
  left join public.os_marketing_paid_sync_runs r
    on r.entity_id = entities.entity_id and (
      r.status = 'queued'
      or (r.status = 'retry_wait' and r.next_attempt_at <= p_evaluated_at)
      or (r.status = 'leased' and r.lease_expires_at <= p_evaluated_at))
  group by entities.entity_id;
  insert into tmp_slo_metrics
  select 'marketing','paid_sync_terminal_failures_24h',entities.entity_id,
    count(r.run_id),1,3,'higher_bad',86400,count(r.run_id),
    jsonb_build_object('terminal_failures',count(r.run_id))
  from (
    select distinct entity_id from public.os_marketing_social_accounts
    where account_type = 'paid_ads' and entity_id is not null
  ) entities
  left join public.os_marketing_paid_sync_runs r
    on r.entity_id = entities.entity_id and r.status = 'failed'
    and r.updated_at >= p_evaluated_at - interval '24 hours'
  group by entities.entity_id;

  insert into tmp_slo_metrics
  select 'docusign','send_recovery_due_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at -
      coalesce(i.next_recovery_at,i.lease_expires_at,i.requested_at)))),0),
    900,3600,'higher_bad',3600,count(i.intent_id),
    jsonb_build_object('due_intents',count(i.intent_id))
  from (
    select distinct entity_id from public.os_docusign_send_intents
    where entity_id is not null
  ) entities
  left join public.os_docusign_send_intents i
    on i.entity_id = entities.entity_id and (
      i.state = 'provider_unknown'
      or (i.state = 'retry_wait' and i.next_recovery_at <= p_evaluated_at)
      or (i.state = 'recovering' and i.lease_expires_at <= p_evaluated_at))
  group by entities.entity_id;
  insert into tmp_slo_metrics
  select 'docusign','send_manual_review_count',entities.entity_id,
    count(i.intent_id),1,3,'higher_bad',3600,count(i.intent_id),
    jsonb_build_object('manual_review_count',count(i.intent_id))
  from (
    select distinct entity_id from public.os_docusign_send_intents
    where entity_id is not null
  ) entities
  left join public.os_docusign_send_intents i
    on i.entity_id = entities.entity_id and i.state = 'manual_review'
  group by entities.entity_id;

  insert into tmp_slo_metrics
  select 'intune','intune_due_action_age_seconds',entities.entity_id,
    coalesce(max(extract(epoch from (p_evaluated_at -
      coalesce(a.next_poll_at,a.approved_at,a.requested_at)))),0),
    600,1800,'higher_bad',1800,count(a.action_id),
    jsonb_build_object('due_actions',count(a.action_id))
  from (
    select distinct entity_id from public.os_it_intune_actions
    where entity_id is not null
  ) entities
  left join public.os_it_intune_actions a
    on a.entity_id = entities.entity_id
    and a.status in ('approved','preflighting','dispatch_authorized',
      'submitted','verifying')
    and (a.next_poll_at is null or a.next_poll_at <= p_evaluated_at)
  group by entities.entity_id;
  insert into tmp_slo_metrics
  select 'intune','intune_platform_failures_1h',entities.entity_id,
    count(a.action_id),1,3,'higher_bad',3600,count(a.action_id),
    jsonb_build_object('platform_failures',count(a.action_id))
  from (
    select distinct entity_id from public.os_it_intune_actions
    where entity_id is not null
  ) entities
  left join public.os_it_intune_actions a
    on a.entity_id = entities.entity_id and a.last_error_class = 'platform'
    and a.updated_at >= p_evaluated_at - interval '1 hour'
  group by entities.entity_id;

  insert into tmp_slo_metrics values (
    'snapshot','snapshot_cron_observation_age_seconds',null,
    coalesce((select extract(epoch from (p_evaluated_at-max(observed_at)))
      from public.os_snapshot_soak_observations where source='cron'),999999),
    21600,28800,'higher_bad',28800,
    (select count(*) from public.os_snapshot_soak_observations
      where source='cron' and observed_at >= p_evaluated_at-interval '24 hours'),
    '{}'::jsonb
  );
  insert into tmp_slo_metrics values (
    'snapshot','snapshot_attestation_validity_seconds',null,
    coalesce((select max(extract(epoch from (valid_until-p_evaluated_at)))
      from public.os_snapshot_rollback_rehearsals where status='attested'
        and valid_until > p_evaluated_at),0),
    1209600,604800,'lower_bad',1209600,
    (select count(*) from public.os_snapshot_rollback_rehearsals
      where status='attested' and valid_until > p_evaluated_at),
    '{}'::jsonb
  );
  insert into tmp_slo_metrics values (
    'snapshot','snapshot_evidence_integrity',null,
    case when coalesce((
      select case when r.status='passed'
        and o.evidence_sha256=r.evidence_sha256
        and count(c.*)>0 and bool_and(c.ok) then 0 else 1 end
      from public.os_snapshot_soak_observations o
      left join public.os_snapshot_drill_runs r
        on r.drill_run_id=o.drill_run_id
      left join public.os_snapshot_drill_checks c
        on c.drill_run_id=r.drill_run_id
      where o.id = (
        select latest.id from public.os_snapshot_soak_observations latest
        where latest.source='cron' and latest.qualification_eligible
        order by latest.observed_at desc,latest.id desc limit 1
      )
      group by o.id,r.drill_run_id,r.status,o.evidence_sha256,r.evidence_sha256
    ),1)=0 then 0 else 1 end,
    1,1,'higher_bad',28800,1,'{}'::jsonb
  );

  for v_metric in select * from tmp_slo_metrics
  loop
    v_severity := case
      when v_metric.observed_value is null then 'unknown'
      when v_metric.comparator = 'higher_bad'
        and v_metric.observed_value >= v_metric.critical_threshold then 'critical'
      when v_metric.comparator = 'higher_bad'
        and v_metric.observed_value >= v_metric.warning_threshold then 'warning'
      when v_metric.comparator = 'lower_bad'
        and v_metric.observed_value <= v_metric.critical_threshold then 'critical'
      when v_metric.comparator = 'lower_bad'
        and v_metric.observed_value <= v_metric.warning_threshold then 'warning'
      else 'healthy' end;
    select evaluation_id into v_existing_evaluation_id
    from public.os_slo_evaluations
    where evaluation_bucket=v_bucket and policy_version='phase37-v1'
      and service=v_metric.service and metric_key=v_metric.metric_key
      and entity_id is not distinct from v_metric.entity_id;
    insert into public.os_slo_evaluations (
      evaluation_bucket,policy_version,service,metric_key,entity_id,severity,
      observed_value,warning_threshold,critical_threshold,comparator,
      window_seconds,sample_count,detail,evaluated_at
    ) values (
      v_bucket,'phase37-v1',v_metric.service,v_metric.metric_key,
      v_metric.entity_id,v_severity,v_metric.observed_value,
      v_metric.warning_threshold,v_metric.critical_threshold,
      v_metric.comparator,v_metric.window_seconds,v_metric.sample_count,
      v_metric.detail,p_evaluated_at
    ) on conflict (
      evaluation_bucket,policy_version,service,metric_key,
      (coalesce(entity_id,'__firm__'))
    ) do update set severity=excluded.severity,
      observed_value=excluded.observed_value,sample_count=excluded.sample_count,
      detail=excluded.detail,evaluated_at=excluded.evaluated_at
    returning * into v_eval;
    if v_existing_evaluation_id is not null then
      v_existing_evaluation_id := null;
      continue;
    end if;
    select * into v_alert from public.os_slo_alerts
    where service=v_metric.service and metric_key=v_metric.metric_key
      and entity_id is not distinct from v_metric.entity_id
      and policy_version='phase37-v1' and status='open' for update;
    if v_severity in ('warning','critical') then
      select case when count(*)=2
        and bool_and(recent.severity in ('warning','critical'))
        and max(recent.evaluation_bucket)-min(recent.evaluation_bucket)
          <= interval '1 hour'
        then 2 else 0 end into v_recent_breaches
      from (
        select e.severity,e.evaluation_bucket
        from public.os_slo_evaluations e
        where e.service=v_metric.service and e.metric_key=v_metric.metric_key
          and e.entity_id is not distinct from v_metric.entity_id
          and e.policy_version='phase37-v1'
        order by e.evaluation_bucket desc limit 2
      ) recent;
      if v_alert.alert_id is not null then
        update public.os_slo_alerts set severity=v_severity,
          last_breached_at=p_evaluated_at,consecutive_breaches=consecutive_breaches+1,
          consecutive_healthy=0,occurrence_count=occurrence_count+1,
          latest_evaluation_id=v_eval.evaluation_id,detail=v_metric.detail,
          updated_at=now() where alert_id=v_alert.alert_id;
        if v_alert.severity <> v_severity then
          v_transitions := v_transitions || jsonb_build_array(jsonb_build_object(
            'alert_id',v_alert.alert_id,'transition','escalated',
            'service',v_metric.service,'metric_key',v_metric.metric_key,
            'severity',v_severity,'entity_id',v_metric.entity_id));
        end if;
      elsif v_severity='critical' or v_recent_breaches >= 2 then
        insert into public.os_slo_alerts (
          service,metric_key,entity_id,policy_version,status,severity,
          first_breached_at,last_breached_at,latest_evaluation_id,detail
        ) values (
          v_metric.service,v_metric.metric_key,v_metric.entity_id,'phase37-v1',
          'open',v_severity,p_evaluated_at,p_evaluated_at,
          v_eval.evaluation_id,v_metric.detail
        ) returning * into v_alert;
        v_transitions := v_transitions || jsonb_build_array(jsonb_build_object(
          'alert_id',v_alert.alert_id,'transition','opened',
          'service',v_metric.service,'metric_key',v_metric.metric_key,
          'severity',v_severity,'entity_id',v_metric.entity_id));
      end if;
    elsif v_severity='healthy' and v_alert.alert_id is not null then
      if v_alert.consecutive_healthy + 1 >= 2 then
        update public.os_slo_alerts set status='resolved',
          resolved_at=p_evaluated_at,consecutive_healthy=consecutive_healthy+1,
          latest_evaluation_id=v_eval.evaluation_id,updated_at=now()
        where alert_id=v_alert.alert_id;
        v_transitions := v_transitions || jsonb_build_array(jsonb_build_object(
          'alert_id',v_alert.alert_id,'transition','resolved',
          'service',v_metric.service,'metric_key',v_metric.metric_key,
          'severity','healthy','entity_id',v_metric.entity_id));
      else
        update public.os_slo_alerts set consecutive_healthy=consecutive_healthy+1,
          latest_evaluation_id=v_eval.evaluation_id,updated_at=now()
        where alert_id=v_alert.alert_id;
      end if;
    end if;
    v_alert := null;
  end loop;
  return jsonb_build_object('policy_version','phase37-v1',
    'evaluation_bucket',v_bucket,'evaluations',(select count(*) from tmp_slo_metrics),
    'transitions',v_transitions);
end;
$$;

revoke all on function public.start_operational_worker_run(uuid,text,text,text,text,jsonb)
  from public,authenticated;
revoke all on function public.finish_operational_worker_run(uuid,text,integer,integer,integer,integer,text,text,jsonb)
  from public,authenticated;
revoke all on function public.evaluate_shared_service_slos(timestamptz)
  from public,authenticated;
grant execute on function public.start_operational_worker_run(uuid,text,text,text,text,jsonb)
  to service_role;
grant execute on function public.finish_operational_worker_run(uuid,text,integer,integer,integer,integer,text,text,jsonb)
  to service_role;
grant execute on function public.evaluate_shared_service_slos(timestamptz)
  to service_role;
