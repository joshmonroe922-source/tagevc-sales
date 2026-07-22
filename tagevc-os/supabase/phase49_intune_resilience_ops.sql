-- Phase 49: human-apply for postmortem template suggestions, dual-approve
-- gate before publish, and suggested-vs-published visibility.
-- Apply after phase48_intune_resilience_ops.sql.
-- Observe-only against breaker state: never closes, resets, or mutates breakers.
-- NEVER auto-publish — publish still requires the existing independent
-- maker-checker RPC; Phase 49 only ADDS a distinct dual-approval gate in
-- front of it. Aggregates never include entity identifiers.

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

-- Bootstrap Phase 48 sanitize helper if prior Intune SQL was skipped.
create or replace function public.it_intune_phase48_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select coalesce(p_evidence,'{}'::jsonb)
    - 'entity_id' - 'entity_ids' - 'entity_scope' - 'entity_scopes'
    || jsonb_build_object('entity_identifiers_included',false);
$$;

create or replace function public.it_intune_phase49_sanitize_aggregate(p_evidence jsonb)
returns jsonb
language sql immutable set search_path=public as $$
  select public.it_intune_phase48_sanitize_aggregate(p_evidence);
$$;

-- ---------------------------------------------------------------------------
-- Append-only human-apply requests (never auto-publish)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_apply_requests (
  apply_id uuid primary key default gen_random_uuid(),
  suggestion_id uuid not null
    references public.os_it_intune_postmortem_template_suggestions(suggestion_id),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  actor_id uuid not null,
  applied_notes_fragment_sha256 text not null
    check (applied_notes_fragment_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null
    check (status in ('applied','skipped_not_draft','skipped_duplicate')),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p49_apply_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p49_apply_no_auto_publish check (
    coalesce((aggregate_evidence->>'auto_publish')::boolean,false)=false
  ),
  constraint os_it_intune_p49_apply_unique
    unique (suggestion_id, postmortem_id)
);

create index if not exists os_it_intune_p49_apply_pm_recorded_idx
  on public.os_it_intune_postmortem_apply_requests(postmortem_id, recorded_at desc);

alter table public.os_it_intune_postmortem_apply_requests
  enable row level security;
drop policy if exists "os_it_intune_p49_apply_select"
  on public.os_it_intune_postmortem_apply_requests;
create policy "os_it_intune_p49_apply_select"
  on public.os_it_intune_postmortem_apply_requests for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_apply_requests to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_apply_requests
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only dual distinct-actor publish approvals (gate in front of the
-- existing independent maker-checker publish RPC — never replaces it)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_publish_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  statement text not null check (length(statement) between 20 and 1000),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p49_pub_appr_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p49_pub_appr_unique
    unique (postmortem_id, actor_id)
);

create index if not exists os_it_intune_p49_pub_appr_pm_idx
  on public.os_it_intune_postmortem_publish_approvals(postmortem_id, recorded_at desc);

alter table public.os_it_intune_postmortem_publish_approvals
  enable row level security;
drop policy if exists "os_it_intune_p49_pub_appr_select"
  on public.os_it_intune_postmortem_publish_approvals;
create policy "os_it_intune_p49_pub_appr_select"
  on public.os_it_intune_postmortem_publish_approvals for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_publish_approvals to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_publish_approvals
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only publish gate outcomes (suggested vs published visibility)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_postmortem_publish_events (
  event_id uuid primary key default gen_random_uuid(),
  postmortem_id uuid not null
    references public.os_it_intune_outage_postmortems(postmortem_id),
  disposition text not null
    check (disposition in (
      'awaiting_second_approval','published','blocked','recorded_reject'
    )),
  distinct_approvers integer not null default 0
    check (distinct_approvers >= 0),
  block_reason text,
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p49_pub_evt_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  ),
  constraint os_it_intune_p49_pub_evt_no_auto_publish check (
    coalesce((aggregate_evidence->>'auto_publish')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p49_pub_evt_pm_idx
  on public.os_it_intune_postmortem_publish_events(postmortem_id, recorded_at desc);
create index if not exists os_it_intune_p49_pub_evt_disp_idx
  on public.os_it_intune_postmortem_publish_events(disposition, recorded_at desc);

alter table public.os_it_intune_postmortem_publish_events
  enable row level security;
drop policy if exists "os_it_intune_p49_pub_evt_select"
  on public.os_it_intune_postmortem_publish_events;
create policy "os_it_intune_p49_pub_evt_select"
  on public.os_it_intune_postmortem_publish_events for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_postmortem_publish_events to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_postmortem_publish_events
  from public,authenticated,service_role;

-- ---------------------------------------------------------------------------
-- Append-only Phase 49 ops alerts (idempotent window_key)
-- ---------------------------------------------------------------------------
create table if not exists public.os_it_intune_phase49_ops_alerts (
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
  postmortem_id uuid
    references public.os_it_intune_outage_postmortems(postmortem_id),
  suggestion_id uuid
    references public.os_it_intune_postmortem_template_suggestions(suggestion_id),
  apply_id uuid
    references public.os_it_intune_postmortem_apply_requests(apply_id),
  event_id uuid
    references public.os_it_intune_postmortem_publish_events(event_id),
  aggregate_evidence jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_at timestamptz not null default now(),
  constraint os_it_intune_p49_alert_kind_check
    check (alert_kind in (
      'apply_pending_publish',
      'publish_awaiting_second_approval',
      'publish_completed'
    )),
  constraint os_it_intune_p49_alert_severity_check
    check (severity in ('warning','critical')),
  constraint os_it_intune_p49_alert_delivery_check
    check (delivery_status in
      ('delivered','skipped_no_webhook','failed','recorded')),
  constraint os_it_intune_p49_alert_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_it_intune_p49_alert_no_entity_leak check (
    not (aggregate_evidence ? 'entity_id')
    and not (aggregate_evidence ? 'entity_ids')
    and not (aggregate_evidence ? 'entity_scope')
    and not (aggregate_evidence ? 'entity_scopes')
    and coalesce((aggregate_evidence->>'entity_identifiers_included')::boolean,false)=false
  )
);

create index if not exists os_it_intune_p49_alert_kind_recorded_idx
  on public.os_it_intune_phase49_ops_alerts(alert_kind, recorded_at desc);

alter table public.os_it_intune_phase49_ops_alerts
  enable row level security;
drop policy if exists "os_it_intune_p49_alert_select"
  on public.os_it_intune_phase49_ops_alerts;
create policy "os_it_intune_p49_alert_select"
  on public.os_it_intune_phase49_ops_alerts for select to authenticated
  using (public.is_firm_wide_access());

grant select on public.os_it_intune_phase49_ops_alerts to authenticated;
revoke insert,update,delete,truncate on
  public.os_it_intune_phase49_ops_alerts
  from public,authenticated,service_role;

create or replace function public.prevent_it_intune_phase49_ops_mutation()
returns trigger language plpgsql set search_path=public as $$
begin
  raise exception 'Phase 49 Intune apply/publish-gate evidence is append-only';
end;
$$;

drop trigger if exists os_it_intune_p49_apply_append_only
  on public.os_it_intune_postmortem_apply_requests;
create trigger os_it_intune_p49_apply_append_only
  before update or delete
  on public.os_it_intune_postmortem_apply_requests
  for each row execute function public.prevent_it_intune_phase49_ops_mutation();
drop trigger if exists os_it_intune_p49_apply_no_truncate
  on public.os_it_intune_postmortem_apply_requests;
create trigger os_it_intune_p49_apply_no_truncate
  before truncate
  on public.os_it_intune_postmortem_apply_requests
  for each statement execute function public.prevent_it_intune_phase49_ops_mutation();

drop trigger if exists os_it_intune_p49_pub_appr_append_only
  on public.os_it_intune_postmortem_publish_approvals;
create trigger os_it_intune_p49_pub_appr_append_only
  before update or delete
  on public.os_it_intune_postmortem_publish_approvals
  for each row execute function public.prevent_it_intune_phase49_ops_mutation();
drop trigger if exists os_it_intune_p49_pub_appr_no_truncate
  on public.os_it_intune_postmortem_publish_approvals;
create trigger os_it_intune_p49_pub_appr_no_truncate
  before truncate
  on public.os_it_intune_postmortem_publish_approvals
  for each statement execute function public.prevent_it_intune_phase49_ops_mutation();

drop trigger if exists os_it_intune_p49_pub_evt_append_only
  on public.os_it_intune_postmortem_publish_events;
create trigger os_it_intune_p49_pub_evt_append_only
  before update or delete
  on public.os_it_intune_postmortem_publish_events
  for each row execute function public.prevent_it_intune_phase49_ops_mutation();
drop trigger if exists os_it_intune_p49_pub_evt_no_truncate
  on public.os_it_intune_postmortem_publish_events;
create trigger os_it_intune_p49_pub_evt_no_truncate
  before truncate
  on public.os_it_intune_postmortem_publish_events
  for each statement execute function public.prevent_it_intune_phase49_ops_mutation();

drop trigger if exists os_it_intune_p49_alert_append_only
  on public.os_it_intune_phase49_ops_alerts;
create trigger os_it_intune_p49_alert_append_only
  before update or delete
  on public.os_it_intune_phase49_ops_alerts
  for each row execute function public.prevent_it_intune_phase49_ops_mutation();
drop trigger if exists os_it_intune_p49_alert_no_truncate
  on public.os_it_intune_phase49_ops_alerts;
create trigger os_it_intune_p49_alert_no_truncate
  before truncate
  on public.os_it_intune_phase49_ops_alerts
  for each statement execute function public.prevent_it_intune_phase49_ops_mutation();

-- ---------------------------------------------------------------------------
-- Human-apply a Phase 48 template suggestion onto its draft postmortem.
-- Appends the suggested notes fragment to blameless_notes; never touches
-- status, never publishes, never closes/resets breakers.
-- ---------------------------------------------------------------------------
create or replace function public.request_it_intune_postmortem_apply_phase49(
  p_suggestion_id uuid,
  p_actor_id uuid,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_sugg public.os_it_intune_postmortem_template_suggestions%rowtype;
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_fragment text;
  v_notes text;
  v_hash text;
  v_evidence jsonb;
  v_id uuid;
begin
  select * into v_sugg
  from public.os_it_intune_postmortem_template_suggestions
  where suggestion_id=p_suggestion_id;
  if not found then
    raise exception 'Unknown template suggestion';
  end if;

  select * into v_pm
  from public.os_it_intune_outage_postmortems
  where postmortem_id=v_sugg.postmortem_id
  for update;
  if not found or not public.it_intune_manual_review_actor_allowed(p_actor_id,null) then
    raise exception 'Postmortem apply denied';
  end if;

  if exists (
    select 1 from public.os_it_intune_postmortem_apply_requests a
    where a.suggestion_id=p_suggestion_id
      and a.postmortem_id=v_sugg.postmortem_id
      and a.status='applied'
  ) then
    return jsonb_build_object(
      'applied',false,
      'status','skipped_duplicate',
      'postmortem_id',v_pm.postmortem_id,
      'auto_publish',false);
  end if;

  if v_pm.status<>'draft' or v_pm.row_version<>p_expected_row_version then
    v_evidence:=public.it_intune_phase49_sanitize_aggregate(jsonb_build_object(
      'evidence_version','phase49-v1',
      'suggestion_id',p_suggestion_id,
      'postmortem_id',v_pm.postmortem_id,
      'postmortem_status',v_pm.status,
      'auto_publish',false
    ));
    v_hash:=public.os_sha256_hex(v_evidence::text);
    insert into public.os_it_intune_postmortem_apply_requests(
      suggestion_id,postmortem_id,actor_id,applied_notes_fragment_sha256,
      status,aggregate_evidence,evidence_sha256
    ) values (
      p_suggestion_id,v_sugg.postmortem_id,p_actor_id,
      public.os_sha256_hex(''),'skipped_not_draft',v_evidence,v_hash
    )
    on conflict (suggestion_id,postmortem_id) do nothing;
    return jsonb_build_object(
      'applied',false,
      'status','skipped_not_draft',
      'postmortem_id',v_pm.postmortem_id,
      'auto_publish',false);
  end if;

  v_fragment:=coalesce(v_sugg.suggested_fields->>'suggested_notes_fragment','');
  v_notes:=trim(
    coalesce(v_pm.blameless_notes,'')
    || E'\n\n[Phase 49 template-applied]: ' || v_fragment
  );
  v_hash:=public.os_sha256_hex(v_notes);

  update public.os_it_intune_outage_postmortems set
    blameless_notes=v_notes,
    blameless_notes_sha256=v_hash,
    row_version=row_version+1,
    updated_at=now()
  where postmortem_id=v_pm.postmortem_id
  returning * into v_pm;

  insert into public.os_it_intune_outage_postmortem_events(
    postmortem_id,event_type,actor_id,evidence_sha256,detail
  ) values (
    v_pm.postmortem_id,'updated',p_actor_id,v_hash,
    jsonb_build_object('phase49_template_applied',true,
      'suggestion_id',p_suggestion_id,'entity_identifiers_included',false)
  );

  v_evidence:=public.it_intune_phase49_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase49-v1',
    'suggestion_id',p_suggestion_id,
    'postmortem_id',v_pm.postmortem_id,
    'notes_fragment_sha256',public.os_sha256_hex(v_fragment),
    'auto_publish',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_postmortem_apply_requests(
    suggestion_id,postmortem_id,actor_id,applied_notes_fragment_sha256,
    status,aggregate_evidence,evidence_sha256
  ) values (
    p_suggestion_id,v_pm.postmortem_id,p_actor_id,
    public.os_sha256_hex(v_fragment),'applied',v_evidence,v_hash
  )
  on conflict (suggestion_id,postmortem_id) do nothing
  returning apply_id into v_id;

  return jsonb_build_object(
    'applied',true,
    'apply_id',v_id,
    'status','applied',
    'postmortem_id',v_pm.postmortem_id,
    'row_version',v_pm.row_version,
    'auto_publish',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual distinct-actor approval gate. Only after 2 distinct 'approve' votes
-- does this call the EXISTING independent maker-checker publish RPC.
-- ---------------------------------------------------------------------------
create or replace function public.approve_it_intune_postmortem_publish_phase49(
  p_postmortem_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_statement text
) returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_pm public.os_it_intune_outage_postmortems%rowtype;
  v_decision text:=coalesce(nullif(trim(lower(p_decision)),''),'approve');
  v_statement text:=trim(coalesce(p_statement,''));
  v_id uuid;
  v_distinct integer:=0;
  v_evidence jsonb;
  v_hash text;
  v_publish_result jsonb;
  v_block_reason text;
begin
  if p_postmortem_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or length(v_statement) < 20 or length(v_statement) > 1000
    or not public.it_intune_manual_review_actor_allowed(p_actor_id,null) then
    raise exception 'Phase 49 postmortem publish approval is invalid or denied';
  end if;

  select * into v_pm
  from public.os_it_intune_outage_postmortems
  where postmortem_id=p_postmortem_id;
  if not found or v_pm.status<>'draft' then
    raise exception 'Postmortem is not an open draft';
  end if;

  v_evidence:=public.it_intune_phase49_sanitize_aggregate(jsonb_build_object(
    'evidence_version','phase49-v1',
    'postmortem_id',p_postmortem_id,
    'decision',v_decision,
    'statement_sha256',public.os_sha256_hex(v_statement),
    'auto_publish',false
  ));
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_postmortem_publish_approvals(
    postmortem_id,actor_id,decision,statement,aggregate_evidence,evidence_sha256
  ) values (
    p_postmortem_id,p_actor_id,v_decision,v_statement,v_evidence,v_hash
  )
  on conflict (postmortem_id,actor_id) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'postmortem_id',p_postmortem_id,
      'auto_publish',false);
  end if;

  if v_decision='reject' then
    insert into public.os_it_intune_postmortem_publish_events(
      postmortem_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_postmortem_id,'recorded_reject',0,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','recorded_reject',
      'postmortem_id',p_postmortem_id,
      'auto_publish',false);
  end if;

  select count(distinct actor_id)::integer into v_distinct
  from public.os_it_intune_postmortem_publish_approvals
  where postmortem_id=p_postmortem_id and decision='approve';

  if v_distinct < 2 then
    insert into public.os_it_intune_postmortem_publish_events(
      postmortem_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_postmortem_id,'awaiting_second_approval',v_distinct,null,v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','awaiting_second_approval',
      'postmortem_id',p_postmortem_id,
      'distinct_approvers',v_distinct,
      'auto_publish',false);
  end if;

  -- Dual-human gate satisfied. This is the ONLY path that calls the
  -- existing independent maker-checker publish RPC — never auto-published.
  begin
    v_publish_result:=public.publish_it_intune_outage_postmortem(
      p_postmortem_id, p_actor_id, v_statement, v_pm.row_version
    );
  exception when others then
    v_block_reason:=sqlerrm;
    v_publish_result:=null;
  end;

  if v_publish_result is null then
    insert into public.os_it_intune_postmortem_publish_events(
      postmortem_id,disposition,distinct_approvers,block_reason,
      aggregate_evidence,evidence_sha256
    ) values (
      p_postmortem_id,'blocked',v_distinct,
      coalesce(v_block_reason,'publish_denied'),v_evidence,v_hash
    );
    return jsonb_build_object(
      'disposition','blocked',
      'postmortem_id',p_postmortem_id,
      'block_reason',coalesce(v_block_reason,'publish_denied'),
      'distinct_approvers',v_distinct,
      'auto_publish',false);
  end if;

  insert into public.os_it_intune_postmortem_publish_events(
    postmortem_id,disposition,distinct_approvers,block_reason,
    aggregate_evidence,evidence_sha256
  ) values (
    p_postmortem_id,'published',v_distinct,null,v_evidence,v_hash
  );

  return jsonb_build_object(
    'disposition','published',
    'postmortem_id',p_postmortem_id,
    'distinct_approvers',v_distinct,
    'auto_publish',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Critical windows + alert recording
-- ---------------------------------------------------------------------------
create or replace function public.list_it_intune_phase49_critical_windows(
  p_window_hours integer default 24)
returns jsonb
language plpgsql
security definer
set search_path=public as $$
declare
  v_hours integer:=least(greatest(coalesce(p_window_hours,24),1),168);
  v_bucket text;
  v_pending jsonb:='[]'::jsonb;
  v_part jsonb;
begin
  v_bucket:=to_char(
    to_timestamp(
      (floor(extract(epoch from now())/(v_hours*3600.0))
        *(v_hours*3600))::bigint
    ),
    'YYYYMMDD"T"HH24'
  );

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','apply_pending_publish',
      'window_key','applypend:'||a.apply_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',a.postmortem_id,
      'apply_id',a.apply_id
    ) order by a.recorded_at desc)
    from public.os_it_intune_postmortem_apply_requests a
    join public.os_it_intune_outage_postmortems p on p.postmortem_id=a.postmortem_id
    where a.status='applied'
      and p.status='draft'
      and a.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase49_ops_alerts x
        where x.window_key=
          'applypend:'||a.apply_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','publish_awaiting_second_approval',
      'window_key','pubwait:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',e.postmortem_id,
      'event_id',e.event_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_postmortem_publish_events e
    where e.disposition='awaiting_second_approval'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase49_ops_alerts x
        where x.window_key=
          'pubwait:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  select coalesce((
    select jsonb_agg(jsonb_build_object(
      'alert_kind','publish_completed',
      'window_key','pubdone:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text,
      'severity','warning',
      'postmortem_id',e.postmortem_id,
      'event_id',e.event_id
    ) order by e.recorded_at desc)
    from public.os_it_intune_postmortem_publish_events e
    where e.disposition='published'
      and e.recorded_at>=now()-make_interval(hours => v_hours)
      and not exists (
        select 1 from public.os_it_intune_phase49_ops_alerts x
        where x.window_key=
          'pubdone:'||e.event_id::text||':'||v_bucket||'h'||v_hours::text
      )
    limit 25
  ), '[]'::jsonb) into v_part;
  v_pending:=v_pending||coalesce(v_part,'[]'::jsonb);

  return jsonb_build_object(
    'version','phase49-v1',
    'window_hours',v_hours,
    'window_bucket',v_bucket,
    'pending',coalesce(v_pending,'[]'::jsonb),
    'closes_or_resets_breaker',false,
    'auto_publish',false,
    'entity_identifiers_included',false
  );
end;
$$;

create or replace function public.record_it_intune_phase49_ops_alert(p_alert jsonb)
returns jsonb
language plpgsql security definer set search_path=public as $$
declare
  v_kind text;
  v_window text;
  v_dest text;
  v_delivery text;
  v_code integer;
  v_severity text;
  v_pm uuid;
  v_sug uuid;
  v_apply uuid;
  v_event uuid;
  v_evidence jsonb;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_alert,'{}'::jsonb))<>'object' then
    raise exception 'Phase 49 ops alert payload must be a JSON object';
  end if;

  v_kind:=coalesce(p_alert->>'alert_kind','');
  v_window:=coalesce(p_alert->>'window_key','');
  v_dest:=coalesce(nullif(p_alert->>'destination_key',''),'ops_alerts');
  v_delivery:=coalesce(p_alert->>'delivery_status','recorded');
  v_code:=nullif(p_alert->>'response_code','')::integer;
  v_severity:=coalesce(nullif(p_alert->>'severity',''),'warning');
  v_pm:=nullif(p_alert->>'postmortem_id','')::uuid;
  v_sug:=nullif(p_alert->>'suggestion_id','')::uuid;
  v_apply:=nullif(p_alert->>'apply_id','')::uuid;
  v_event:=nullif(p_alert->>'event_id','')::uuid;

  if v_kind not in (
      'apply_pending_publish','publish_awaiting_second_approval',
      'publish_completed')
    or v_window !~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'
    or v_dest !~ '^[a-z][a-z0-9_]{0,62}$'
    or v_delivery not in
      ('delivered','skipped_no_webhook','failed','recorded')
    or v_severity not in ('warning','critical') then
    raise exception 'Phase 49 ops alert contract is invalid';
  end if;

  v_evidence:=public.it_intune_phase49_sanitize_aggregate(
    coalesce(p_alert->'aggregate_evidence','{}'::jsonb)
    || jsonb_build_object(
      'evidence_version','phase49-v1',
      'alert_kind',v_kind,
      'window_key',v_window,
      'severity',v_severity,
      'destination_key',v_dest,
      'delivery_status',v_delivery,
      'response_code',v_code,
      'postmortem_id',v_pm,
      'suggestion_id',v_sug,
      'apply_id',v_apply,
      'event_id',v_event,
      'auto_publish',false
    )
  );
  v_hash:=public.os_sha256_hex(v_evidence::text);

  insert into public.os_it_intune_phase49_ops_alerts(
    alert_kind,window_key,severity,destination_key,delivery_status,
    response_code,postmortem_id,suggestion_id,apply_id,event_id,
    aggregate_evidence,evidence_sha256
  ) values (
    v_kind,v_window,v_severity,v_dest,v_delivery,v_code,
    v_pm,v_sug,v_apply,v_event,v_evidence,v_hash
  )
  on conflict (window_key) do nothing
  returning alert_id into v_id;

  if v_id is null then
    select alert_id into v_id
    from public.os_it_intune_phase49_ops_alerts
    where window_key=v_window;
    return jsonb_build_object(
      'inserted',false,
      'alert_id',v_id,
      'window_key',v_window,
      'auto_publish',false);
  end if;

  return jsonb_build_object(
    'inserted',true,
    'alert_id',v_id,
    'window_key',v_window,
    'auto_publish',false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ops report: suggested vs applied vs published visibility
-- ---------------------------------------------------------------------------
create or replace function public.get_it_intune_phase49_ops_report()
returns jsonb
language plpgsql
stable
security definer
set search_path=public as $$
declare
  v_applied_count integer:=0;
  v_pending_publish_count integer:=0;
  v_awaiting_second_count integer:=0;
  v_published_count integer:=0;
  v_blocked_count integer:=0;
  v_apply_requests jsonb;
  v_publish_events jsonb;
  v_alerts jsonb;
begin
  select count(*)::integer into v_applied_count
  from public.os_it_intune_postmortem_apply_requests where status='applied';

  select count(distinct a.postmortem_id)::integer into v_pending_publish_count
  from public.os_it_intune_postmortem_apply_requests a
  join public.os_it_intune_outage_postmortems p on p.postmortem_id=a.postmortem_id
  where a.status='applied' and p.status='draft';

  select count(*)::integer into v_awaiting_second_count
  from public.os_it_intune_postmortem_publish_events
  where disposition='awaiting_second_approval';

  select count(*)::integer into v_published_count
  from public.os_it_intune_postmortem_publish_events
  where disposition='published';

  select count(*)::integer into v_blocked_count
  from public.os_it_intune_postmortem_publish_events
  where disposition='blocked';

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_apply_requests
  from (
    select a.apply_id,a.suggestion_id,a.postmortem_id,a.status,
      a.evidence_sha256,a.recorded_at
    from public.os_it_intune_postmortem_apply_requests a
    order by a.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_publish_events
  from (
    select e.event_id,e.postmortem_id,e.disposition,e.distinct_approvers,
      e.block_reason,e.evidence_sha256,e.recorded_at
    from public.os_it_intune_postmortem_publish_events e
    order by e.recorded_at desc
    limit 50
  ) x;

  select coalesce(jsonb_agg(row_to_json(x)::jsonb order by x.recorded_at desc),
    '[]'::jsonb)
  into v_alerts
  from (
    select al.alert_id,al.alert_kind,al.window_key,al.severity,
      al.destination_key,al.delivery_status,al.response_code,
      al.postmortem_id,al.suggestion_id,al.apply_id,al.event_id,
      al.evidence_sha256,al.recorded_at
    from public.os_it_intune_phase49_ops_alerts al
    order by al.recorded_at desc
    limit 50
  ) x;

  return jsonb_build_object(
    'version','phase49-v1',
    'applied_count',v_applied_count,
    'pending_publish_count',v_pending_publish_count,
    'awaiting_second_approval_count',v_awaiting_second_count,
    'published_count',v_published_count,
    'blocked_count',v_blocked_count,
    'apply_requests',v_apply_requests,
    'publish_events',v_publish_events,
    'ops_alerts',v_alerts,
    'destination_key','ops_alerts',
    'requires_dual_approval',true,
    'auto_publish',false,
    'closes_or_resets_breaker',false,
    'entity_identifiers_included',false
  );
end;
$$;

revoke all on function public.it_intune_phase49_sanitize_aggregate(jsonb)
  from public,authenticated,service_role;
revoke all on function public.request_it_intune_postmortem_apply_phase49(uuid,uuid,bigint)
  from public;
revoke all on function public.approve_it_intune_postmortem_publish_phase49(uuid,uuid,text,text)
  from public;
revoke all on function public.list_it_intune_phase49_critical_windows(integer)
  from public,authenticated;
revoke all on function public.record_it_intune_phase49_ops_alert(jsonb)
  from public,authenticated;
revoke all on function public.get_it_intune_phase49_ops_report()
  from public,authenticated;
revoke all on function public.prevent_it_intune_phase49_ops_mutation()
  from public,authenticated,service_role;

grant execute on function public.request_it_intune_postmortem_apply_phase49(uuid,uuid,bigint),
  public.approve_it_intune_postmortem_publish_phase49(uuid,uuid,text,text)
  to authenticated, service_role;

grant execute on function public.list_it_intune_phase49_critical_windows(integer),
  public.record_it_intune_phase49_ops_alert(jsonb),
  public.get_it_intune_phase49_ops_report()
  to service_role;

grant execute on function public.list_it_intune_phase49_critical_windows(integer),
  public.get_it_intune_phase49_ops_report()
  to authenticated;
