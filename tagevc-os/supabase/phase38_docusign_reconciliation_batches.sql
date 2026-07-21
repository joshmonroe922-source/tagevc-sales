-- Phase 38: leased, resumable, evidence-bound DocuSign reconciliation batches.
-- Provider page evidence contains identifiers/status metadata only; no subjects,
-- recipient names, recipient email addresses, or document content are accepted.

alter table public.os_docusign_reconciliation_runs
  add column if not exists cursor_start_position integer not null default 0,
  add column if not exists next_page_no integer not null default 0,
  add column if not exists provider_total integer,
  add column if not exists lease_token uuid,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists worker_id text,
  add column if not exists invocation_count integer not null default 0,
  add column if not exists committed_pages integer not null default 0,
  add column if not exists replay_conflicts integer not null default 0,
  add column if not exists drift_failures integer not null default 0,
  add column if not exists last_checkpoint_at timestamptz,
  add column if not exists last_failure_at timestamptz,
  add column if not exists last_failure_code text,
  add column if not exists window_from timestamptz,
  add column if not exists window_to timestamptz,
  add column if not exists next_attempt_at timestamptz,
  add column if not exists retry_attempts integer not null default 0,
  add column if not exists max_attempts integer not null default 8;
update public.os_docusign_reconciliation_runs set
  window_to=coalesce(window_to,started_at),
  window_from=coalesce(window_from,
    started_at-make_interval(days=>least(greatest(window_days,1),90)))
where window_from is null or window_to is null;
alter table public.os_docusign_reconciliation_runs
  alter column window_from set not null,
  alter column window_to set not null;
alter table public.os_docusign_reconciliation_runs
  drop constraint if exists os_docusign_reconcile_run_status_check;
alter table public.os_docusign_reconciliation_runs
  add constraint os_docusign_reconcile_run_status_check check (
    status in ('running','retry_wait','completed','partial','failed')
  );
alter table public.os_docusign_reconciliation_runs
  drop constraint if exists os_docusign_reconcile_run_lease_check;
alter table public.os_docusign_reconciliation_runs
  add constraint os_docusign_reconcile_run_lease_check check (
    (lease_token is null) = (lease_expires_at is null)
  );
alter table public.os_docusign_reconciliation_runs
  drop constraint if exists os_docusign_reconcile_window_check;
alter table public.os_docusign_reconciliation_runs
  add constraint os_docusign_reconcile_window_check check (
    window_from < window_to and retry_attempts between 0 and max_attempts
    and max_attempts between 1 and 20
  );
create index if not exists os_docusign_reconcile_claim_idx
  on public.os_docusign_reconciliation_runs(
    status,next_attempt_at,lease_expires_at,started_at);
do $$
begin
  if (select count(*) from public.os_docusign_reconciliation_runs
      where status in ('running','retry_wait')) > 1 then
    raise exception 'Multiple active DocuSign reconciliation runs require review';
  end if;
end;
$$;
create unique index if not exists os_docusign_one_active_reconciliation
  on public.os_docusign_reconciliation_runs ((true))
  where status in ('running','retry_wait');

create table if not exists public.os_docusign_reconciliation_pages (
  page_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_docusign_reconciliation_runs(run_id),
  page_no integer not null,
  start_position integer not null,
  next_start_position integer,
  provider_total integer not null,
  result_count integer not null,
  end_position integer not null,
  page_sha256 text not null,
  committed_at timestamptz not null default now(),
  constraint os_docusign_reconcile_page_count_check
    check (result_count between 0 and 100),
  constraint os_docusign_reconcile_page_position_check
    check (
      (result_count=0 and provider_total=0 and start_position=0
        and end_position in (-1,0))
      or (result_count>0
        and end_position=start_position+result_count-1)
    ),
  constraint os_docusign_reconcile_page_hash_check
    check (page_sha256 ~ '^[0-9a-f]{64}$'),
  unique(run_id, page_no),
  unique(run_id, start_position)
);

create table if not exists public.os_docusign_reconciliation_items (
  item_id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.os_docusign_reconciliation_pages(page_id),
  run_id uuid not null references public.os_docusign_reconciliation_runs(run_id),
  envelope_id text not null,
  provider_status text not null,
  provider_status_at timestamptz,
  item_sha256 text not null,
  identity_state text not null,
  resolved_entity_id text,
  resolved_doc_id text,
  resolved_send_intent_id uuid,
  resolved_lineage_id uuid,
  reconciliation_state text not null,
  issue_code text,
  identity_claims jsonb not null default '{}'::jsonb,
  committed_at timestamptz not null default now(),
  constraint os_docusign_reconcile_item_hash_check
    check (item_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_reconcile_identity_state_check
    check (identity_state in ('resolved','unmapped','ambiguous','sticky_ambiguous')),
  unique(page_id, envelope_id),
  unique(run_id, envelope_id)
);
alter table public.os_docusign_reconciliation_pages
  add column if not exists end_position integer;
alter table public.os_docusign_reconciliation_items
  add column if not exists reconciliation_state text,
  add column if not exists issue_code text;
update public.os_docusign_reconciliation_pages
  set end_position=case when result_count=0 then 0
    else start_position+result_count-1 end
  where end_position is null;
update public.os_docusign_reconciliation_items set
  reconciliation_state=case
    when identity_state in ('ambiguous','sticky_ambiguous') then 'manual_review'
    when identity_state='unmapped' then 'unmapped_expected'
    else 'in_sync' end
where reconciliation_state is null;
alter table public.os_docusign_reconciliation_pages
  alter column end_position set not null;
alter table public.os_docusign_reconciliation_items
  alter column reconciliation_state set not null;
alter table public.os_docusign_reconciliation_pages
  drop constraint if exists os_docusign_reconcile_page_position_check;
alter table public.os_docusign_reconciliation_pages
  add constraint os_docusign_reconcile_page_position_check
    check (
      (result_count=0 and provider_total=0 and start_position=0
        and end_position in (-1,0))
      or (result_count>0
        and end_position=start_position+result_count-1)
    );
alter table public.os_docusign_reconciliation_items
  drop constraint if exists os_docusign_reconcile_item_projection_check;
alter table public.os_docusign_reconciliation_items
  add constraint os_docusign_reconcile_item_projection_check check (
    reconciliation_state in ('in_sync','unmapped_expected','manual_review')
  );
do $$
begin
  if exists (
    select 1 from public.os_docusign_reconciliation_items
    group by run_id,envelope_id having count(*)>1
  ) then
    raise exception 'Duplicate run-wide DocuSign envelope evidence requires review';
  end if;
end;
$$;
create unique index if not exists os_docusign_reconcile_item_run_envelope
  on public.os_docusign_reconciliation_items(run_id,envelope_id);

create table if not exists public.os_docusign_reconciliation_events (
  event_id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.os_docusign_reconciliation_runs(run_id),
  page_id uuid references public.os_docusign_reconciliation_pages(page_id),
  event_type text not null,
  worker_id text,
  evidence_sha256 text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_reconcile_event_type_check check (
    event_type in ('batch_created','lease_claimed','page_committed',
      'page_replayed','replay_conflict','cursor_drift','batch_deferred',
      'batch_completed','batch_failed')
  )
);
create index if not exists os_docusign_reconcile_item_run_idx
  on public.os_docusign_reconciliation_items(run_id, committed_at);
create index if not exists os_docusign_reconcile_event_run_idx
  on public.os_docusign_reconciliation_events(run_id, created_at);

alter table public.os_docusign_reconciliation_pages enable row level security;
alter table public.os_docusign_reconciliation_items enable row level security;
alter table public.os_docusign_reconciliation_events enable row level security;
drop policy if exists "os_docusign_reconcile_page_select"
  on public.os_docusign_reconciliation_pages;
drop policy if exists "os_docusign_reconcile_item_select"
  on public.os_docusign_reconciliation_items;
drop policy if exists "os_docusign_reconcile_event_select"
  on public.os_docusign_reconciliation_events;
create policy "os_docusign_reconcile_page_select"
  on public.os_docusign_reconciliation_pages for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_docusign_reconcile_item_select"
  on public.os_docusign_reconciliation_items for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_docusign_reconcile_event_select"
  on public.os_docusign_reconciliation_events for select to authenticated
  using (public.is_firm_wide_access());
grant select on public.os_docusign_reconciliation_pages,
  public.os_docusign_reconciliation_items,
  public.os_docusign_reconciliation_events to authenticated;
revoke insert, update, delete on public.os_docusign_reconciliation_pages,
  public.os_docusign_reconciliation_items,
  public.os_docusign_reconciliation_events from authenticated;

create or replace function public.reject_docusign_reconciliation_evidence_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'DocuSign reconciliation evidence is immutable';
end;
$$;
drop trigger if exists os_docusign_reconcile_pages_immutable
  on public.os_docusign_reconciliation_pages;
create trigger os_docusign_reconcile_pages_immutable
  before update or delete on public.os_docusign_reconciliation_pages
  for each row execute function public.reject_docusign_reconciliation_evidence_mutation();
drop trigger if exists os_docusign_reconcile_items_immutable
  on public.os_docusign_reconciliation_items;
create trigger os_docusign_reconcile_items_immutable
  before update or delete on public.os_docusign_reconciliation_items
  for each row execute function public.reject_docusign_reconciliation_evidence_mutation();
drop trigger if exists os_docusign_reconcile_events_immutable
  on public.os_docusign_reconciliation_events;
create trigger os_docusign_reconcile_events_immutable
  before update or delete on public.os_docusign_reconciliation_events
  for each row execute function public.reject_docusign_reconciliation_evidence_mutation();

create or replace function public.docusign_statuses_compatible(
  p_provider_status text,
  p_local_status text
) returns boolean language sql immutable parallel safe as $$
  select case
    when nullif(trim(p_local_status),'') is null then true
    when lower(trim(p_provider_status))='created'
      then lower(trim(p_local_status)) in ('created','draft')
    when lower(trim(p_provider_status))='sent'
      then lower(trim(p_local_status))='sent'
    when lower(trim(p_provider_status))='delivered'
      then lower(trim(p_local_status)) in ('sent','delivered')
    when lower(trim(p_provider_status))='completed'
      then lower(trim(p_local_status)) in ('signed','completed','executed')
    when lower(trim(p_provider_status))='voided'
      then lower(trim(p_local_status))='voided'
    when lower(trim(p_provider_status))='declined'
      then lower(trim(p_local_status))='declined'
    else lower(trim(p_provider_status))=lower(trim(p_local_status))
  end
$$;

drop function if exists public.claim_docusign_reconciliation_batch(
  text,uuid,text,integer,integer);
create or replace function public.claim_docusign_reconciliation_batch(
  p_trigger_source text,
  p_requested_by uuid,
  p_worker_id text,
  p_window_days integer default 30,
  p_lease_seconds integer default 120
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_docusign_reconciliation_runs%rowtype;
  v_days integer := least(greatest(coalesce(p_window_days,30),1),90);
  v_window_to timestamptz := clock_timestamp();
begin
  if p_trigger_source not in ('cron','manual','webhook_recovery')
     or nullif(trim(p_worker_id),'') is null then
    raise exception 'Invalid DocuSign reconciliation claim';
  end if;
  if p_trigger_source = 'manual' and (
    p_requested_by is null or not exists (
      select 1 from public.profiles p where p.id=p_requested_by and p.active
        and p.role in ('visionary','admin','counsel_ops')
    )
  ) then
    raise exception 'DocuSign reconciliation permission denied';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('docusign-reconciliation',0));
  select * into v_run
  from public.os_docusign_reconciliation_runs
  where status in ('running','retry_wait')
  order by started_at
  for update limit 1;
  if found then
    if v_run.status='running' and v_run.lease_expires_at > now() then
      return jsonb_build_object('disposition','busy','run_id',v_run.run_id,
        'retry_at',v_run.lease_expires_at);
    end if;
    if v_run.status='retry_wait'
       and coalesce(v_run.next_attempt_at,now()) > now() then
      return jsonb_build_object('disposition','retry_not_due',
        'run_id',v_run.run_id,'retry_at',v_run.next_attempt_at);
    end if;
    if v_run.retry_attempts >= v_run.max_attempts then
      update public.os_docusign_reconciliation_runs set
        status='failed',completed_at=now(),lease_token=null,
        lease_expires_at=null,worker_id=null,
        error='Retry attempt cap exhausted',
        last_failure_code='retry_exhausted'
      where run_id=v_run.run_id;
      insert into public.os_docusign_reconciliation_events(
        run_id,event_type,worker_id,detail)
      values(v_run.run_id,'batch_failed',v_run.worker_id,
        jsonb_build_object('error_code','retry_exhausted',
          'retry_attempts',v_run.retry_attempts));
      return jsonb_build_object('disposition','exhausted',
        'run_id',v_run.run_id,'retry_attempts',v_run.retry_attempts);
    else
    update public.os_docusign_reconciliation_runs set
      status='running', lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(
        secs=>least(greatest(coalesce(p_lease_seconds,120),30),300)),
      worker_id=left(trim(p_worker_id),100),
      invocation_count=invocation_count+1,
      retry_attempts=retry_attempts+
        case when v_run.status='running' then 1 else 0 end,
      next_attempt_at=null,error=null
    where run_id=v_run.run_id returning * into v_run;
    insert into public.os_docusign_reconciliation_events(
      run_id,event_type,worker_id,detail)
    values(v_run.run_id,'lease_claimed',v_run.worker_id,
      jsonb_build_object('cursor',v_run.cursor_start_position,
        'page_no',v_run.next_page_no,'invocation',v_run.invocation_count));
    return jsonb_build_object('disposition','claimed','run',to_jsonb(v_run));
    end if;
  end if;
  insert into public.os_docusign_reconciliation_runs(
    trigger_source,status,window_days,requested_by,lease_token,
    lease_expires_at,worker_id,invocation_count,window_from,window_to)
  values(p_trigger_source,'running',v_days,p_requested_by,gen_random_uuid(),
    now()+make_interval(
      secs=>least(greatest(coalesce(p_lease_seconds,120),30),300)),
    left(trim(p_worker_id),100),1,
    v_window_to-make_interval(days=>v_days),v_window_to)
  returning * into v_run;
  insert into public.os_docusign_reconciliation_events(
    run_id,event_type,worker_id,detail)
  values(v_run.run_id,'batch_created',v_run.worker_id,
    jsonb_build_object('window_from',v_run.window_from,
      'window_to',v_run.window_to));
  return jsonb_build_object('disposition','claimed','run',to_jsonb(v_run));
end;
$$;

drop function if exists public.commit_docusign_reconciliation_page(
  uuid,uuid,integer,integer,integer,integer,jsonb);
create or replace function public.commit_docusign_reconciliation_page(
  p_run_id uuid,
  p_lease_token uuid,
  p_page_no integer,
  p_start_position integer,
  p_next_start_position integer,
  p_provider_total integer,
  p_result_count integer,
  p_end_position integer,
  p_items jsonb
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_docusign_reconciliation_runs%rowtype;
  v_page public.os_docusign_reconciliation_pages%rowtype;
  v_existing public.os_docusign_envelopes%rowtype;
  v_item jsonb;
  v_page_hash text;
  v_item_hash text;
  v_envelope_id text;
  v_status text;
  v_projection_status text;
  v_status_at timestamptz;
  v_entities text[];
  v_docs text[];
  v_intents uuid[];
  v_lineages uuid[];
  v_operations text[];
  v_event_ids text[];
  v_local_status text;
  v_identity_state text;
  v_issue text;
  v_reconciliation_state text;
  v_entity text;
  v_doc text;
  v_intent uuid;
  v_lineage uuid;
  v_operation text;
  v_count integer;
  v_matched integer := 0;
  v_unmapped integer := 0;
  v_review integer := 0;
begin
  select * into v_run from public.os_docusign_reconciliation_runs
  where run_id=p_run_id for update;
  if not found or v_run.status <> 'running'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.lease_expires_at <= now() then
    raise exception 'DocuSign reconciliation lease mismatch or expired';
  end if;
  if jsonb_typeof(p_items) <> 'array' then
    raise exception 'DocuSign reconciliation items must be an array';
  end if;
  v_count := jsonb_array_length(p_items);
  if v_count > 100 or p_page_no < 0 or p_page_no >= 100
     or p_start_position < 0 or p_start_position >= 10000
     or p_provider_total < 0 or p_provider_total > 10000
     or (select count(*) from public.os_docusign_reconciliation_items
         where run_id=p_run_id)+v_count > 10000
     or p_result_count is distinct from v_count
     or (v_count=0 and not (
       p_provider_total=0 and p_start_position=0
       and p_end_position in (-1,0) and p_next_start_position is null))
     or (v_count>0 and (
       p_end_position is distinct from p_start_position+v_count-1
       or p_end_position >= p_provider_total
       or (p_next_start_position is null
         and p_end_position <> p_provider_total-1)
       or (p_next_start_position is not null and (
         p_next_start_position <> p_end_position+1
         or p_end_position >= p_provider_total-1))))
     or (select count(*) from jsonb_array_elements(p_items)
         where jsonb_typeof(value) <> 'object'
           or nullif(trim(value->>'envelope_id'),'') is null
           or nullif(trim(value->>'provider_status'),'') is null
           or length(value->>'envelope_id') > 200
           or length(value->>'provider_status') > 100
           or (value - array['envelope_id','provider_status',
             'provider_status_at']) <> '{}'::jsonb)
     or (select count(*) from jsonb_array_elements(p_items)) <>
        (select count(distinct value->>'envelope_id')
         from jsonb_array_elements(p_items)) then
    update public.os_docusign_reconciliation_runs set
      status='failed', drift_failures=drift_failures+1,
      last_failure_at=now(), last_failure_code='cursor_page_drift',
      completed_at=now(), lease_token=null, lease_expires_at=null,
      worker_id=null, error='Provider cursor/page evidence failed validation'
    where run_id=p_run_id;
    insert into public.os_docusign_reconciliation_events(
      run_id,event_type,worker_id,detail)
    values(p_run_id,'cursor_drift',v_run.worker_id,
      jsonb_build_object('expected_cursor',v_run.cursor_start_position,
        'received_cursor',p_start_position,'expected_page',v_run.next_page_no,
        'received_page',p_page_no));
    return jsonb_build_object('ok',false,'error_code','cursor_page_drift');
  end if;
  v_page_hash := encode(digest(jsonb_build_object(
    'version','phase38-v2','run_id',p_run_id,'page_no',p_page_no,
    'start_position',p_start_position,
    'next_start_position',p_next_start_position,
    'provider_total',p_provider_total,'result_count',p_result_count,
    'end_position',p_end_position,'items',p_items)::text,'sha256'),'hex');
  select * into v_page from public.os_docusign_reconciliation_pages
  where run_id=p_run_id and
    (page_no=p_page_no or start_position=p_start_position) limit 1;
  if found then
    if v_page.page_sha256 <> v_page_hash then
      update public.os_docusign_reconciliation_runs set
        status='failed', replay_conflicts=replay_conflicts+1,
        last_failure_at=now(), last_failure_code='replay_conflict',
        completed_at=now(), lease_token=null, lease_expires_at=null,
        worker_id=null, error='Committed provider page replayed with different evidence'
      where run_id=p_run_id;
      insert into public.os_docusign_reconciliation_events(
        run_id,page_id,event_type,worker_id,evidence_sha256,detail)
      values(p_run_id,v_page.page_id,'replay_conflict',v_run.worker_id,
        v_page_hash,jsonb_build_object('committed_sha256',v_page.page_sha256));
      return jsonb_build_object('ok',false,'error_code','replay_conflict');
    end if;
    insert into public.os_docusign_reconciliation_events(
      run_id,page_id,event_type,worker_id,evidence_sha256)
    values(p_run_id,v_page.page_id,'page_replayed',v_run.worker_id,v_page_hash);
    return jsonb_build_object('ok',true,'run_id',p_run_id,'page_id',v_page.page_id,
      'page_sha256',v_page_hash,'replayed',true,
      'next_start_position',v_page.next_start_position);
  end if;
  if p_start_position <> v_run.cursor_start_position
     or p_page_no <> v_run.next_page_no
     or (v_run.provider_total is not null
       and v_run.provider_total <> p_provider_total) then
    update public.os_docusign_reconciliation_runs set
      status='failed', drift_failures=drift_failures+1,
      last_failure_at=now(), last_failure_code='cursor_page_drift',
      completed_at=now(), lease_token=null, lease_expires_at=null,
      worker_id=null, error='Provider cursor or total changed between pages'
    where run_id=p_run_id;
    insert into public.os_docusign_reconciliation_events(
      run_id,event_type,worker_id,evidence_sha256,detail)
    values(p_run_id,'cursor_drift',v_run.worker_id,v_page_hash,
      jsonb_build_object('expected_cursor',v_run.cursor_start_position,
        'received_cursor',p_start_position,'expected_page',v_run.next_page_no,
        'received_page',p_page_no,'expected_total',v_run.provider_total,
        'received_total',p_provider_total));
    return jsonb_build_object('ok',false,'error_code','cursor_page_drift');
  end if;
  if exists (
    select 1 from public.os_docusign_reconciliation_items i
    join jsonb_array_elements(p_items) incoming
      on incoming->>'envelope_id'=i.envelope_id
    where i.run_id=p_run_id
  ) then
    update public.os_docusign_reconciliation_runs set
      status='failed',drift_failures=drift_failures+1,
      last_failure_at=now(),last_failure_code='duplicate_envelope_drift',
      completed_at=now(),lease_token=null,lease_expires_at=null,
      worker_id=null,error='Provider repeated an envelope across run pages'
    where run_id=p_run_id;
    insert into public.os_docusign_reconciliation_events(
      run_id,event_type,worker_id,evidence_sha256,detail)
    values(p_run_id,'cursor_drift',v_run.worker_id,v_page_hash,
      jsonb_build_object('error_code','duplicate_envelope_drift',
        'page_no',p_page_no,'start_position',p_start_position));
    return jsonb_build_object(
      'ok',false,'error_code','duplicate_envelope_drift');
  end if;
  insert into public.os_docusign_reconciliation_pages(
    run_id,page_no,start_position,next_start_position,provider_total,
    result_count,end_position,page_sha256)
  values(p_run_id,p_page_no,p_start_position,p_next_start_position,
    p_provider_total,v_count,p_end_position,v_page_hash) returning * into v_page;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_envelope_id := trim(v_item->>'envelope_id');
    v_status := lower(trim(v_item->>'provider_status'));
    v_status_at := nullif(v_item->>'provider_status_at','')::timestamptz;
    v_item_hash := encode(digest(jsonb_build_object(
      'version','phase38-v2','envelope_id',v_envelope_id,
      'provider_status',v_status,'provider_status_at',v_status_at)::text,
      'sha256'),'hex');
    select * into v_existing from public.os_docusign_envelopes
      where envelope_id=v_envelope_id for update;
    v_projection_status := case
      when v_existing.envelope_id is not null
        and (v_status_at is null or
          (v_existing.provider_status_at is not null
            and v_existing.provider_status_at >= v_status_at))
      then v_existing.provider_status else v_status end;
    select
      array_remove(array_agg(distinct q.entity_id),null),
      array_remove(array_agg(distinct q.doc_id),null),
      array_remove(array_agg(distinct q.intent_id),null),
      array_remove(array_agg(distinct q.lineage_id),null),
      array_remove(array_agg(distinct q.operation_kind),null),
      array_remove(array_agg(distinct q.event_id),null),
      max(q.local_status)
    into v_entities,v_docs,v_intents,v_lineages,v_operations,
      v_event_ids,v_local_status
    from (
      select i.entity_id,i.doc_id,i.intent_id,null::uuid lineage_id,
        i.operation_kind,null::text event_id,null::text local_status
      from public.os_docusign_send_intents i
      where i.provider_envelope_id=v_envelope_id
      union all
      select e.entity_id,e.doc_id,e.send_intent_id,e.lineage_id,
        e.operation_kind,e.last_event_id,e.local_document_status
      from public.os_docusign_envelopes e where e.envelope_id=v_envelope_id
      union all
      select d.entity_id,d.doc_id,null::uuid,null::uuid,
        'document_send',null::text,d.status
      from public.os_documents d where d.envelope_id=v_envelope_id
      union all
      select l.entity_id,l.source_doc_id,l.send_intent_id,l.lineage_id,
        'replacement',null::text,null::text
      from public.os_docusign_envelope_lineage l
      where l.source_envelope_id=v_envelope_id
         or l.replacement_envelope_id=v_envelope_id
      union all
      select ev.entity_id,ev.doc_id,ev.send_intent_id,null::uuid,
        'connect_discovered',ev.event_id,null::text
      from public.os_docusign_events ev where ev.envelope_id=v_envelope_id
    ) q;
    v_entity := case when cardinality(v_entities)=1 then v_entities[1] end;
    v_doc := case when cardinality(v_docs)=1 then v_docs[1] end;
    v_intent := case when cardinality(v_intents)=1 then v_intents[1] end;
    v_lineage := case when cardinality(v_lineages)=1 then v_lineages[1] end;
    v_operation := coalesce(
      (select i.operation_kind from public.os_docusign_send_intents i
       where i.intent_id=v_intent),
      case when cardinality(v_operations)=1 then v_operations[1] end,
      'legacy');
    if (v_existing.envelope_id is not null
        and v_existing.reconciliation_state='manual_review'
        and v_existing.issue_code in ('identity_ambiguity','identity_conflict',
          'send_intent_conflict','duplicate_document_mapping')) then
      v_identity_state := 'sticky_ambiguous';
      v_issue := v_existing.issue_code;
    elsif cardinality(v_entities)>1 or cardinality(v_docs)>1
       or cardinality(v_intents)>1 or cardinality(v_lineages)>1 then
      v_identity_state := 'ambiguous';
      v_issue := 'identity_ambiguity';
    elsif v_entity is null and v_doc is null and v_intent is null
       and v_lineage is null then
      v_identity_state := 'unmapped';
      v_issue := 'document_missing';
    elsif not public.docusign_statuses_compatible(
      v_projection_status,v_local_status) then
      v_identity_state := 'resolved';
      v_issue := 'status_mismatch';
    else
      v_identity_state := 'resolved';
      v_issue := null;
    end if;
    v_reconciliation_state := case
      when v_identity_state in ('ambiguous','sticky_ambiguous')
          or v_issue='status_mismatch' then 'manual_review'
      when v_identity_state='unmapped' then 'unmapped_expected'
      else 'in_sync' end;
    insert into public.os_docusign_reconciliation_items(
      page_id,run_id,envelope_id,provider_status,provider_status_at,
      item_sha256,identity_state,resolved_entity_id,resolved_doc_id,
      resolved_send_intent_id,resolved_lineage_id,reconciliation_state,
      issue_code,identity_claims)
    values(v_page.page_id,p_run_id,v_envelope_id,v_status,v_status_at,
      v_item_hash,v_identity_state,v_entity,v_doc,v_intent,v_lineage,
      v_reconciliation_state,v_issue,
      jsonb_build_object('entity_ids',to_jsonb(coalesce(v_entities,array[]::text[])),
        'doc_ids',to_jsonb(coalesce(v_docs,array[]::text[])),
        'send_intent_ids',to_jsonb(coalesce(v_intents,array[]::uuid[])),
        'lineage_ids',to_jsonb(coalesce(v_lineages,array[]::uuid[])),
        'event_ids',to_jsonb(coalesce(v_event_ids,array[]::text[]))));
    insert into public.os_docusign_envelopes(
      envelope_id,operation_kind,doc_id,entity_id,lineage_id,send_intent_id,
      provider_status,provider_status_at,provider_observed_at,
      local_document_status,last_event_id,reconciliation_state,issue_code,
      last_error,attempts,last_reconciled_at,next_reconcile_at,updated_at)
    values(v_envelope_id,v_operation,v_doc,v_entity,v_lineage,v_intent,
      v_status,v_status_at,now(),v_local_status,
      case when cardinality(v_event_ids)>0 then v_event_ids[1] end,
      v_reconciliation_state,
      v_issue,null,1,now(),null,now())
    on conflict(envelope_id) do update set
      operation_kind=case
        when excluded.reconciliation_state='manual_review'
          then os_docusign_envelopes.operation_kind
        else excluded.operation_kind end,
      doc_id=case when excluded.reconciliation_state='manual_review'
        then os_docusign_envelopes.doc_id
        else coalesce(os_docusign_envelopes.doc_id,excluded.doc_id) end,
      entity_id=case when excluded.reconciliation_state='manual_review'
        then os_docusign_envelopes.entity_id
        else coalesce(os_docusign_envelopes.entity_id,excluded.entity_id) end,
      lineage_id=case when excluded.reconciliation_state='manual_review'
        then os_docusign_envelopes.lineage_id
        else coalesce(os_docusign_envelopes.lineage_id,excluded.lineage_id) end,
      send_intent_id=case when excluded.reconciliation_state='manual_review'
        then os_docusign_envelopes.send_intent_id
        else coalesce(os_docusign_envelopes.send_intent_id,
          excluded.send_intent_id) end,
      provider_status=case when
        (os_docusign_envelopes.provider_status_at is null
          and excluded.provider_status_at is not null)
        or excluded.provider_status_at >
          os_docusign_envelopes.provider_status_at
        then excluded.provider_status
        else os_docusign_envelopes.provider_status end,
      provider_status_at=case when
        (os_docusign_envelopes.provider_status_at is null
          and excluded.provider_status_at is not null)
        or excluded.provider_status_at >
          os_docusign_envelopes.provider_status_at
        then excluded.provider_status_at
        else os_docusign_envelopes.provider_status_at end,
      provider_observed_at=case when
        (os_docusign_envelopes.provider_status_at is null
          and excluded.provider_status_at is not null)
        or excluded.provider_status_at >
          os_docusign_envelopes.provider_status_at
        then excluded.provider_observed_at
        else os_docusign_envelopes.provider_observed_at end,
      local_document_status=excluded.local_document_status,
      last_event_id=coalesce(excluded.last_event_id,
        os_docusign_envelopes.last_event_id),
      reconciliation_state=case
        when os_docusign_envelopes.reconciliation_state='manual_review'
          and os_docusign_envelopes.issue_code in
            ('identity_ambiguity','identity_conflict','send_intent_conflict',
              'duplicate_document_mapping')
          then 'manual_review' else excluded.reconciliation_state end,
      issue_code=case
        when os_docusign_envelopes.reconciliation_state='manual_review'
          and os_docusign_envelopes.issue_code in
            ('identity_ambiguity','identity_conflict','send_intent_conflict',
              'duplicate_document_mapping')
          then os_docusign_envelopes.issue_code else excluded.issue_code end,
      last_error=null,attempts=os_docusign_envelopes.attempts+1,
      last_reconciled_at=now(),next_reconcile_at=null,updated_at=now();
    if v_identity_state in ('ambiguous','sticky_ambiguous')
       or v_issue='status_mismatch' then v_review := v_review+1;
    elsif v_identity_state='unmapped' then v_unmapped := v_unmapped+1;
    else v_matched := v_matched+1;
    end if;
  end loop;
  update public.os_docusign_reconciliation_runs set
    cursor_start_position=coalesce(p_next_start_position,p_start_position+v_count),
    next_start_position=p_next_start_position,
    next_page_no=next_page_no+1,provider_total=p_provider_total,
    seen=seen+v_count,matched=matched+v_matched,unmapped=unmapped+v_unmapped,
    manual_review=manual_review+v_review,pages_scanned=pages_scanned+1,
    committed_pages=committed_pages+1,truncated=p_next_start_position is not null,
    retry_attempts=0,next_attempt_at=null,last_checkpoint_at=now()
  where run_id=p_run_id;
  insert into public.os_docusign_reconciliation_events(
    run_id,page_id,event_type,worker_id,evidence_sha256,detail)
  values(p_run_id,v_page.page_id,'page_committed',v_run.worker_id,v_page_hash,
    jsonb_build_object('count',v_count,'matched',v_matched,
      'unmapped',v_unmapped,'manual_review',v_review,
      'next_start_position',p_next_start_position));
  return jsonb_build_object('ok',true,'run_id',p_run_id,'page_id',v_page.page_id,
    'page_sha256',v_page_hash,'replayed',false,'seen',v_count,
    'matched',v_matched,'unmapped',v_unmapped,'manual_review',v_review,
    'next_start_position',p_next_start_position,
    'complete',p_next_start_position is null);
end;
$$;

create or replace function public.finish_docusign_reconciliation_batch(
  p_run_id uuid,
  p_lease_token uuid
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_docusign_reconciliation_runs%rowtype;
  v_worker text;
  v_pages integer;
  v_page_items integer;
  v_items integer;
  v_matched integer;
  v_unmapped integer;
  v_review integer;
  v_min_total integer;
  v_max_total integer;
  v_invalid integer;
begin
  select * into v_run from public.os_docusign_reconciliation_runs
    where run_id=p_run_id for update;
  if not found or v_run.status<>'running'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.next_start_position is not null then
    raise exception 'DocuSign reconciliation cannot be finished';
  end if;
  v_worker := v_run.worker_id;
  select count(*),coalesce(sum(result_count),0),
    min(provider_total),max(provider_total)
  into v_pages,v_page_items,v_min_total,v_max_total
  from public.os_docusign_reconciliation_pages where run_id=p_run_id;
  select count(*),
    count(*) filter (where reconciliation_state='in_sync'),
    count(*) filter (where reconciliation_state='unmapped_expected'),
    count(*) filter (where reconciliation_state='manual_review')
  into v_items,v_matched,v_unmapped,v_review
  from public.os_docusign_reconciliation_items where run_id=p_run_id;
  select count(*) into v_invalid
  from public.os_docusign_reconciliation_pages p
  where p.run_id=p_run_id and (
    p.page_no<0
    or (p.page_no=0 and p.start_position<>0)
    or (p.page_no>0 and p.start_position is distinct from (
      select previous.next_start_position
      from public.os_docusign_reconciliation_pages previous
      where previous.run_id=p_run_id and previous.page_no=p.page_no-1))
    or (p.page_no<v_pages-1 and (
      p.next_start_position is null
      or p.next_start_position<>p.end_position+1))
    or (p.page_no=v_pages-1 and (
      p.next_start_position is not null
      or (p.result_count=0 and not (
        p.provider_total=0 and p.start_position=0
        and p.end_position in (-1,0)))
      or (p.result_count>0 and p.end_position<>p.provider_total-1)))
  );
  if v_pages<1 or v_pages>100 or v_items>10000
     or v_page_items<>v_items or v_min_total<>v_max_total
     or v_items<>v_matched+v_unmapped+v_review or v_invalid>0
     or (select min(page_no) from public.os_docusign_reconciliation_pages
          where run_id=p_run_id)<>0
     or (select max(page_no) from public.os_docusign_reconciliation_pages
          where run_id=p_run_id)<>v_pages-1 then
    update public.os_docusign_reconciliation_runs set
      status='failed',drift_failures=drift_failures+1,
      last_failure_at=now(),last_failure_code='finish_integrity_failure',
      completed_at=now(),lease_token=null,lease_expires_at=null,
      worker_id=null,error='Immutable reconciliation evidence is not contiguous'
    where run_id=p_run_id;
    insert into public.os_docusign_reconciliation_events(
      run_id,event_type,worker_id,detail)
    values(p_run_id,'cursor_drift',v_worker,
      jsonb_build_object('error_code','finish_integrity_failure',
        'pages',v_pages,'page_items',v_page_items,'items',v_items,
        'invalid_pages',v_invalid));
    return jsonb_build_object(
      'ok',false,'error_code','finish_integrity_failure');
  end if;
  update public.os_docusign_reconciliation_runs set
    status=case when v_review>0 then 'partial' else 'completed' end,
    seen=v_items,matched=v_matched,unmapped=v_unmapped,
    manual_review=v_review,pages_scanned=v_pages,committed_pages=v_pages,
    provider_total=v_max_total,cursor_start_position=v_max_total,
    truncated=false,completed_at=now(),lease_token=null,
    lease_expires_at=null,worker_id=null
  where run_id=p_run_id returning * into v_run;
  insert into public.os_docusign_reconciliation_events(
    run_id,event_type,worker_id,detail)
  values(p_run_id,'batch_completed',v_worker,
    jsonb_build_object('seen',v_run.seen,'matched',v_run.matched,
      'unmapped',v_run.unmapped,'manual_review',v_run.manual_review,
      'pages',v_run.committed_pages));
  return jsonb_build_object('ok',true,'run_id',p_run_id,'status',v_run.status,
    'seen',v_run.seen,'matched',v_run.matched,'unmapped',v_run.unmapped,
    'manual_review',v_run.manual_review,'pages',v_run.committed_pages);
end;
$$;

create or replace function public.fail_docusign_reconciliation_batch(
  p_run_id uuid,
  p_lease_token uuid,
  p_error_code text,
  p_error_message text,
  p_retryable boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_run public.os_docusign_reconciliation_runs%rowtype;
  v_status text;
  v_worker text;
  v_attempts integer;
  v_checkpoint boolean := p_error_code='invocation_page_limit';
begin
  select * into v_run from public.os_docusign_reconciliation_runs
    where run_id=p_run_id for update;
  if not found or v_run.status<>'running'
     or v_run.lease_token is distinct from p_lease_token then
    raise exception 'DocuSign reconciliation lease mismatch';
  end if;
  v_worker := v_run.worker_id;
  v_attempts := least(v_run.max_attempts,v_run.retry_attempts+
    case when v_checkpoint then 0 else 1 end);
  v_status := case
    when p_retryable and (v_checkpoint or v_attempts<v_run.max_attempts)
      then 'retry_wait'
    else 'failed' end;
  update public.os_docusign_reconciliation_runs set status=v_status,
    retry_attempts=v_attempts,
    next_attempt_at=case
      when v_status<>'retry_wait' then null
      when v_checkpoint then now()
      else now()+make_interval(secs=>least(3600,
        (30*power(2,greatest(v_attempts-1,0)))::integer)) end,
    failed=failed+case when v_checkpoint then 0 else 1 end,
    last_failure_at=case when v_checkpoint then last_failure_at else now() end,
    last_failure_code=left(coalesce(p_error_code,'unknown'),100),
    error=left(coalesce(p_error_message,'Reconciliation failed'),500),
    completed_at=case when v_status='retry_wait' then null else now() end,
    lease_token=null,lease_expires_at=null,worker_id=null
  where run_id=p_run_id returning * into v_run;
  insert into public.os_docusign_reconciliation_events(
    run_id,event_type,worker_id,detail)
  values(p_run_id,case when p_retryable and v_status='retry_wait'
      then 'batch_deferred'
      else 'batch_failed' end,v_worker,
    jsonb_build_object('error_code',v_run.last_failure_code,
      'cursor',v_run.cursor_start_position,'page_no',v_run.next_page_no,
      'retry_attempts',v_run.retry_attempts,
      'next_attempt_at',v_run.next_attempt_at));
  return jsonb_build_object('run_id',p_run_id,'status',v_status,
    'cursor',v_run.cursor_start_position,'page_no',v_run.next_page_no);
end;
$$;

revoke all on function public.claim_docusign_reconciliation_batch(text,uuid,text,integer,integer)
  from public,authenticated;
revoke all on function public.commit_docusign_reconciliation_page(uuid,uuid,integer,integer,integer,integer,integer,integer,jsonb)
  from public,authenticated;
revoke all on function public.finish_docusign_reconciliation_batch(uuid,uuid)
  from public,authenticated;
revoke all on function public.fail_docusign_reconciliation_batch(uuid,uuid,text,text,boolean)
  from public,authenticated;
grant execute on function public.claim_docusign_reconciliation_batch(text,uuid,text,integer,integer)
  to service_role;
grant execute on function public.commit_docusign_reconciliation_page(uuid,uuid,integer,integer,integer,integer,integer,integer,jsonb)
  to service_role;
grant execute on function public.finish_docusign_reconciliation_batch(uuid,uuid)
  to service_role;
grant execute on function public.fail_docusign_reconciliation_batch(uuid,uuid,text,text,boolean)
  to service_role;
