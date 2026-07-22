-- Phase 40: governed legacy archive backfill and long-term integrity scans.
-- Depends on phase39_docusign_mapping_archive.sql and Phase 38 reconciliation.
-- Evidence is metadata-only: document and certificate bytes are never stored here.

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

create table if not exists public.os_docusign_archive_governance_runs (
  run_id uuid primary key default gen_random_uuid(),
  run_kind text not null,
  scan_mode text not null,
  trigger_source text not null,
  requested_by uuid,
  status text not null default 'running',
  cursor_key text not null default '',
  lease_token uuid,
  lease_expires_at timestamptz,
  fence_version bigint not null default 0,
  worker_id text,
  invocation_count integer not null default 0,
  claimed_count integer not null default 0,
  succeeded_count integer not null default 0,
  unavailable_count integer not null default 0,
  drift_count integer not null default 0,
  quarantined_count integer not null default 0,
  retry_attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz,
  last_error_code text,
  last_error_detail text,
  started_at timestamptz not null default now(),
  last_checkpoint_at timestamptz,
  completed_at timestamptz,
  constraint os_docusign_archive_gov_kind_check
    check (run_kind in ('legacy_backfill','integrity_scan')),
  constraint os_docusign_archive_gov_mode_check check (
    (run_kind='legacy_backfill' and scan_mode='full')
    or (run_kind='integrity_scan' and scan_mode in ('sample','full'))
  ),
  constraint os_docusign_archive_gov_trigger_check
    check (trigger_source in ('cron','manual')),
  constraint os_docusign_archive_gov_status_check
    check (status in ('running','retry_wait','completed','partial','failed')),
  constraint os_docusign_archive_gov_lease_check
    check ((lease_token is null)=(lease_expires_at is null)),
  constraint os_docusign_archive_gov_attempt_check
    check (retry_attempts between 0 and max_attempts and max_attempts between 1 and 20)
);
create index if not exists os_docusign_archive_gov_claim_idx
  on public.os_docusign_archive_governance_runs(
    run_kind,scan_mode,status,next_attempt_at,lease_expires_at,started_at);
create unique index if not exists os_docusign_archive_gov_one_active
  on public.os_docusign_archive_governance_runs(run_kind,scan_mode)
  where status in ('running','retry_wait');

create table if not exists public.os_docusign_archive_governance_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  run_id uuid not null
    references public.os_docusign_archive_governance_runs(run_id),
  work_kind text not null,
  envelope_id text not null,
  document_id text not null,
  entity_id text references public.entities(entity_id),
  completed_event_id text not null,
  lineage_id uuid references public.os_docusign_envelope_lineage(lineage_id),
  manifest_id uuid references public.os_docusign_archive_manifests(manifest_id),
  signed_file_id uuid references public.os_docusign_signed_files(id),
  file_kind text,
  outcome text not null,
  expected_length bigint,
  expected_sha256 text,
  observed_length bigint,
  observed_sha256 text,
  error_code text,
  evidence_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_gov_receipt_kind_check
    check (work_kind in ('legacy_backfill','integrity_scan')),
  constraint os_docusign_archive_gov_receipt_file_kind_check
    check (file_kind is null or file_kind in ('combined','certificate')),
  constraint os_docusign_archive_gov_receipt_outcome_check check (
    outcome in ('archived','verified','provider_unavailable',
      'storage_unavailable','content_drift','quarantined')
  ),
  constraint os_docusign_archive_gov_receipt_hash_check check (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
    and (expected_sha256 is null or expected_sha256 ~ '^[0-9a-f]{64}$')
    and (observed_sha256 is null or observed_sha256 ~ '^[0-9a-f]{64}$')
  )
);
create index if not exists os_docusign_archive_gov_receipt_entity_idx
  on public.os_docusign_archive_governance_receipts(entity_id,created_at desc);
create index if not exists os_docusign_archive_gov_receipt_manifest_idx
  on public.os_docusign_archive_governance_receipts(manifest_id,created_at desc);

create table if not exists public.os_docusign_archive_governance_events (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  run_id uuid not null
    references public.os_docusign_archive_governance_runs(run_id),
  event_type text not null,
  worker_id text,
  fence_version bigint not null,
  cursor_key text not null,
  detail jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_gov_event_type_check check (
    event_type in ('run_created','lease_claimed','run_checkpointed',
      'run_completed','run_partial','run_deferred','run_failed')
  ),
  constraint os_docusign_archive_gov_event_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$')
);
create index if not exists os_docusign_archive_gov_event_run_idx
  on public.os_docusign_archive_governance_events(run_id,created_at);

create table if not exists public.os_docusign_archive_quarantine (
  quarantine_id uuid primary key default gen_random_uuid(),
  manifest_id uuid not null references public.os_docusign_archive_manifests(manifest_id),
  receipt_id uuid not null
    references public.os_docusign_archive_governance_receipts(receipt_id),
  envelope_id text not null,
  document_id text not null,
  entity_id text references public.entities(entity_id),
  file_kind text not null,
  status text not null default 'manual_review',
  reason_code text not null,
  expected_sha256 text not null,
  observed_sha256 text,
  row_version bigint not null default 0,
  opened_at timestamptz not null default now(),
  reviewed_by uuid,
  reviewer_note text,
  reviewed_at timestamptz,
  constraint os_docusign_archive_quarantine_status_check
    check (status in ('manual_review','acknowledged','resolved')),
  constraint os_docusign_archive_quarantine_hash_check
    check (expected_sha256 ~ '^[0-9a-f]{64}$'
      and (observed_sha256 is null or observed_sha256 ~ '^[0-9a-f]{64}$'))
);
create index if not exists os_docusign_archive_quarantine_entity_idx
  on public.os_docusign_archive_quarantine(entity_id,status,opened_at desc);
alter table public.os_docusign_archive_quarantine
  alter column observed_sha256 drop not null;
alter table public.os_docusign_archive_quarantine
  drop constraint if exists os_docusign_archive_quarantine_manifest_id_key;
create unique index if not exists os_docusign_archive_one_active_quarantine
  on public.os_docusign_archive_quarantine(manifest_id)
  where status='manual_review';

alter table public.os_docusign_archive_governance_runs enable row level security;
alter table public.os_docusign_archive_governance_receipts enable row level security;
alter table public.os_docusign_archive_governance_events enable row level security;
alter table public.os_docusign_archive_quarantine enable row level security;
drop policy if exists "os_docusign_archive_gov_run_select"
  on public.os_docusign_archive_governance_runs;
drop policy if exists "os_docusign_archive_gov_receipt_select"
  on public.os_docusign_archive_governance_receipts;
drop policy if exists "os_docusign_archive_gov_event_select"
  on public.os_docusign_archive_governance_events;
drop policy if exists "os_docusign_archive_quarantine_select"
  on public.os_docusign_archive_quarantine;
create policy "os_docusign_archive_gov_run_select"
  on public.os_docusign_archive_governance_runs for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_docusign_archive_gov_receipt_select"
  on public.os_docusign_archive_governance_receipts for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
create policy "os_docusign_archive_gov_event_select"
  on public.os_docusign_archive_governance_events for select to authenticated
  using (public.is_firm_wide_access());
create policy "os_docusign_archive_quarantine_select"
  on public.os_docusign_archive_quarantine for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
revoke all on public.os_docusign_archive_governance_runs,
  public.os_docusign_archive_governance_receipts,
  public.os_docusign_archive_governance_events,
  public.os_docusign_archive_quarantine from public,anon,authenticated;
grant select on public.os_docusign_archive_governance_runs,
  public.os_docusign_archive_governance_receipts,
  public.os_docusign_archive_governance_events,
  public.os_docusign_archive_quarantine to authenticated;

create or replace function public.reject_docusign_phase40_evidence_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 40 DocuSign archive evidence is append-only';
end;
$$;
drop trigger if exists os_docusign_archive_gov_receipts_immutable
  on public.os_docusign_archive_governance_receipts;
create trigger os_docusign_archive_gov_receipts_immutable
  before update or delete on public.os_docusign_archive_governance_receipts
  for each row execute function public.reject_docusign_phase40_evidence_mutation();
drop trigger if exists os_docusign_archive_gov_receipts_no_truncate
  on public.os_docusign_archive_governance_receipts;
create trigger os_docusign_archive_gov_receipts_no_truncate
  before truncate on public.os_docusign_archive_governance_receipts
  for each statement execute function public.reject_docusign_phase40_evidence_mutation();
drop trigger if exists os_docusign_archive_gov_events_immutable
  on public.os_docusign_archive_governance_events;
create trigger os_docusign_archive_gov_events_immutable
  before update or delete on public.os_docusign_archive_governance_events
  for each row execute function public.reject_docusign_phase40_evidence_mutation();
drop trigger if exists os_docusign_archive_gov_events_no_truncate
  on public.os_docusign_archive_governance_events;
create trigger os_docusign_archive_gov_events_no_truncate
  before truncate on public.os_docusign_archive_governance_events
  for each statement execute function public.reject_docusign_phase40_evidence_mutation();
drop trigger if exists os_docusign_archive_quarantine_no_truncate
  on public.os_docusign_archive_quarantine;
create trigger os_docusign_archive_quarantine_no_truncate
  before truncate on public.os_docusign_archive_quarantine
  for each statement execute function public.reject_docusign_phase40_evidence_mutation();

create or replace function public.docusign_phase40_completed_binding(
  p_envelope_id text,
  p_document_id text,
  p_entity_id text,
  p_event_id text,
  p_lineage_id uuid
) returns boolean
language sql stable set search_path = public as $$
  select exists (
    select 1
    from public.os_documents d
    join public.os_docusign_envelopes e
      on e.envelope_id=d.envelope_id
     and e.doc_id=d.doc_id
     and e.entity_id is not distinct from d.entity_id
    join public.os_docusign_events ev
      on ev.event_id::text=p_event_id
     and ev.envelope_id=e.envelope_id
     and ev.doc_id=d.doc_id
     and ev.entity_id is not distinct from d.entity_id
     and lower(ev.status) in ('completed','signed')
    where d.envelope_id=p_envelope_id
      and d.doc_id=p_document_id
      and d.entity_id is not distinct from p_entity_id
      and lower(d.status) in ('completed','signed','executed')
      and (
        (p_lineage_id is null and not exists (
          select 1 from public.os_docusign_envelope_lineage lx
          where lx.status in ('created','reconciled')
            and (lx.source_envelope_id=p_envelope_id
              or lx.replacement_envelope_id=p_envelope_id)
        ))
        or exists (
          select 1 from public.os_docusign_envelope_lineage l
          where l.lineage_id=p_lineage_id
            and l.status in ('created','reconciled')
            and l.entity_id is not distinct from p_entity_id
            and l.source_doc_id is not distinct from p_document_id
            and (l.source_envelope_id=p_envelope_id
              or l.replacement_envelope_id=p_envelope_id)
        )
      )
  )
$$;

create or replace function public.claim_docusign_archive_governance_work(
  p_run_kind text,
  p_scan_mode text,
  p_trigger_source text,
  p_requested_by uuid,
  p_worker_id text,
  p_limit integer default 5,
  p_lease_seconds integer default 240
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.os_docusign_archive_governance_runs%rowtype;
  v_items jsonb := '[]'::jsonb;
  v_limit integer := least(greatest(coalesce(p_limit,5),1),10);
  v_event_type text;
begin
  if p_run_kind not in ('legacy_backfill','integrity_scan')
     or (p_run_kind='legacy_backfill' and p_scan_mode<>'full')
     or (p_run_kind='integrity_scan' and p_scan_mode not in ('sample','full'))
     or p_trigger_source not in ('cron','manual')
     or nullif(trim(p_worker_id),'') is null then
    raise exception 'Invalid Phase 40 archive work claim';
  end if;
  if p_trigger_source='manual' and (
    p_requested_by is null or not exists (
      select 1 from public.profiles p where p.id=p_requested_by and p.active
        and p.role in ('visionary','admin','counsel_ops')
    )
  ) then raise exception 'Phase 40 archive permission denied'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'docusign-archive-governance:'||p_run_kind||':'||p_scan_mode,0));
  select * into v_run
  from public.os_docusign_archive_governance_runs
  where run_kind=p_run_kind and scan_mode=p_scan_mode
    and status in ('running','retry_wait')
  order by started_at limit 1 for update;
  if found then
    if v_run.status='running' and v_run.lease_expires_at>now() then
      return jsonb_build_object('disposition','busy','run_id',v_run.run_id,
        'retry_at',v_run.lease_expires_at);
    end if;
    if v_run.status='retry_wait' and v_run.next_attempt_at>now() then
      return jsonb_build_object('disposition','retry_not_due','run_id',v_run.run_id,
        'retry_at',v_run.next_attempt_at);
    end if;
    if v_run.retry_attempts>=v_run.max_attempts then
      update public.os_docusign_archive_governance_runs set
        status='failed',completed_at=now(),lease_token=null,
        lease_expires_at=null,worker_id=null,last_error_code='retry_exhausted'
      where run_id=v_run.run_id;
      return jsonb_build_object('disposition','exhausted','run_id',v_run.run_id);
    end if;
    update public.os_docusign_archive_governance_runs set
      status='running',lease_token=gen_random_uuid(),
      lease_expires_at=now()+make_interval(
        secs=>least(greatest(coalesce(p_lease_seconds,240),60),300)),
      fence_version=fence_version+1,worker_id=left(trim(p_worker_id),100),
      invocation_count=invocation_count+1,next_attempt_at=null
    where run_id=v_run.run_id returning * into v_run;
    v_event_type := 'lease_claimed';
  else
    insert into public.os_docusign_archive_governance_runs(
      run_kind,scan_mode,trigger_source,requested_by,status,lease_token,
      lease_expires_at,fence_version,worker_id,invocation_count)
    values(p_run_kind,p_scan_mode,p_trigger_source,p_requested_by,'running',
      gen_random_uuid(),now()+make_interval(
        secs=>least(greatest(coalesce(p_lease_seconds,240),60),300)),
      1,left(trim(p_worker_id),100),1)
    returning * into v_run;
    v_event_type := 'run_created';
  end if;

  if p_run_kind='legacy_backfill' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.item_cursor),'[]'::jsonb)
      into v_items
    from (
      select concat_ws(chr(31),e.envelope_id,d.doc_id) item_cursor,
        e.envelope_id,d.doc_id document_id,d.entity_id,
        lower(e.provider_status) provider_status,
        ev.event_id::text completed_event_id,l.lineage_id
      from public.os_documents d
      join public.os_docusign_envelopes e
        on e.envelope_id=d.envelope_id and e.doc_id=d.doc_id
       and e.entity_id is not distinct from d.entity_id
      join lateral (
        select x.event_id from public.os_docusign_events x
        where x.envelope_id=e.envelope_id and x.doc_id=d.doc_id
          and x.entity_id is not distinct from d.entity_id
          and lower(x.status) in ('completed','signed')
        order by x.received_at desc,x.event_id desc limit 1
      ) ev on true
      left join lateral (
        select x.lineage_id from public.os_docusign_envelope_lineage x
        where x.status in ('created','reconciled')
          and x.entity_id is not distinct from d.entity_id
          and x.source_doc_id is not distinct from d.doc_id
          and (x.source_envelope_id=e.envelope_id
            or x.replacement_envelope_id=e.envelope_id)
        order by x.updated_at desc,x.lineage_id desc limit 1
      ) l on true
      where lower(d.status) in ('completed','signed','executed')
        and lower(coalesce(e.provider_status,'')) in ('completed','signed')
        and e.envelope_id not like 'ENV-%'
        and concat_ws(chr(31),e.envelope_id,d.doc_id)>v_run.cursor_key
        and (
          not exists (
            select 1 from public.os_docusign_archive_manifests m
            where m.envelope_id=e.envelope_id and m.document_id=d.doc_id
              and m.file_kind='combined'
          )
          or not exists (
            select 1 from public.os_docusign_archive_manifests m
            where m.envelope_id=e.envelope_id and m.document_id=d.doc_id
              and m.file_kind='certificate'
          )
        )
        and public.docusign_phase40_completed_binding(
          e.envelope_id,d.doc_id,d.entity_id,ev.event_id::text,l.lineage_id)
      order by item_cursor limit v_limit
    ) q;
  else
    select coalesce(jsonb_agg(to_jsonb(q) order by q.item_cursor),'[]'::jsonb)
      into v_items
    from (
      select m.manifest_id::text item_cursor,m.manifest_id,m.envelope_id,
        m.document_id,m.entity_id,m.file_kind,m.content_length,
        m.content_sha256,s.id signed_file_id,s.storage_path,
        ev.event_id::text completed_event_id,l.lineage_id
      from public.os_docusign_archive_manifests m
      join public.os_docusign_signed_files s
        on s.archive_manifest_id=m.manifest_id
      join lateral (
        select x.event_id from public.os_docusign_events x
        where x.envelope_id=m.envelope_id and x.doc_id=m.document_id
          and x.entity_id is not distinct from m.entity_id
          and lower(x.status) in ('completed','signed')
        order by x.received_at desc,x.event_id desc limit 1
      ) ev on true
      left join lateral (
        select x.lineage_id from public.os_docusign_envelope_lineage x
        where x.status in ('created','reconciled')
          and x.entity_id is not distinct from m.entity_id
          and x.source_doc_id is not distinct from m.document_id
          and (x.source_envelope_id=m.envelope_id
            or x.replacement_envelope_id=m.envelope_id)
        order by x.updated_at desc,x.lineage_id desc limit 1
      ) l on true
      where m.manifest_id::text>v_run.cursor_key
        and m.source='docusign'
        and m.envelope_id not like 'ENV-%'
        and not exists (
          select 1 from public.os_docusign_archive_quarantine z
          where z.manifest_id=m.manifest_id and z.status='manual_review'
        )
        and (
          (p_scan_mode='full' and not exists (
            select 1 from public.os_docusign_archive_governance_receipts r
            where r.manifest_id=m.manifest_id and r.outcome='verified'
              and r.created_at>now()-interval '90 days'
          ))
          or (p_scan_mode='sample'
            and mod((hashtextextended(m.manifest_id::text||
              to_char(date_trunc('week',now()),'YYYY-MM-DD'),0)
              & 9223372036854775807),10)=0
            and not exists (
              select 1 from public.os_docusign_archive_governance_receipts r
              where r.manifest_id=m.manifest_id
                and r.work_kind='integrity_scan'
                and r.created_at>now()-interval '7 days'
            ))
        )
        and public.docusign_phase40_completed_binding(
          m.envelope_id,m.document_id,m.entity_id,ev.event_id::text,l.lineage_id)
      order by item_cursor limit v_limit
    ) q;
  end if;
  update public.os_docusign_archive_governance_runs
    set claimed_count=claimed_count+jsonb_array_length(v_items)
  where run_id=v_run.run_id;
  insert into public.os_docusign_archive_governance_events(
    event_key,run_id,event_type,worker_id,fence_version,cursor_key,detail,
    evidence_sha256)
  values('phase40:run:'||v_run.run_id::text||':fence:'||
    v_run.fence_version::text,v_run.run_id,v_event_type,v_run.worker_id,
    v_run.fence_version,v_run.cursor_key,
    jsonb_build_object('run_kind',v_run.run_kind,'scan_mode',v_run.scan_mode,
      'claimed',jsonb_array_length(v_items)),
    public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',v_run.run_id,'event_type',v_event_type,
      'fence_version',v_run.fence_version,'cursor',v_run.cursor_key,
      'claimed',jsonb_array_length(v_items))::text))
  on conflict(event_key) do nothing;
  return jsonb_build_object('disposition','claimed','run_id',v_run.run_id,
    'lease_token',v_run.lease_token,'fence_version',v_run.fence_version,
    'run_kind',v_run.run_kind,'scan_mode',v_run.scan_mode,'items',v_items);
end;
$$;

create or replace function public.commit_docusign_archive_backfill_result(
  p_run_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_item_cursor text,
  p_envelope_id text,
  p_document_id text,
  p_entity_id text,
  p_completed_event_id text,
  p_lineage_id uuid,
  p_combined_manifest_id uuid,
  p_certificate_manifest_id uuid,
  p_error_code text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.os_docusign_archive_governance_runs%rowtype;
  v_manifest public.os_docusign_archive_manifests%rowtype;
  v_signed public.os_docusign_signed_files%rowtype;
  v_id uuid;
  v_outcome text;
  v_count integer := 0;
  v_hash text;
begin
  select * into v_run from public.os_docusign_archive_governance_runs
    where run_id=p_run_id for update;
  if not found or v_run.run_kind<>'legacy_backfill' or v_run.status<>'running'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.fence_version<>p_fence_version
     or v_run.lease_expires_at<=now() or p_item_cursor<=v_run.cursor_key
     or not public.docusign_phase40_completed_binding(p_envelope_id,
       p_document_id,p_entity_id,p_completed_event_id,p_lineage_id) then
    raise exception 'Phase 40 backfill lease, fence, cursor, or binding mismatch';
  end if;
  if p_combined_manifest_id is null then
    v_outcome := 'provider_unavailable';
    v_hash := public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',p_run_id,'cursor',p_item_cursor,'envelope_id',p_envelope_id,
      'document_id',p_document_id,'entity_id',p_entity_id,
      'event_id',p_completed_event_id,'lineage_id',p_lineage_id,
      'outcome',v_outcome,'error_code',left(coalesce(p_error_code,'provider_unavailable'),100)
    )::text);
    insert into public.os_docusign_archive_governance_receipts(
      receipt_key,run_id,work_kind,envelope_id,document_id,entity_id,
      completed_event_id,lineage_id,outcome,error_code,evidence_sha256)
    values('phase40:backfill:'||p_run_id::text||':'||p_envelope_id||':'||
      p_document_id||':unavailable',
      p_run_id,'legacy_backfill',p_envelope_id,p_document_id,p_entity_id,
      p_completed_event_id,p_lineage_id,v_outcome,
      left(coalesce(p_error_code,'provider_unavailable'),100),v_hash)
    on conflict(receipt_key) do nothing;
    update public.os_docusign_archive_governance_runs set
      cursor_key=p_item_cursor,unavailable_count=unavailable_count+1,
      last_checkpoint_at=now()
    where run_id=p_run_id;
    return jsonb_build_object('ok',false,'outcome',v_outcome);
  end if;
  foreach v_id in array array[p_combined_manifest_id,p_certificate_manifest_id] loop
    if v_id is null then continue; end if;
    select * into v_manifest from public.os_docusign_archive_manifests
      where manifest_id=v_id;
    select * into v_signed from public.os_docusign_signed_files
      where archive_manifest_id=v_id;
    if not found or v_manifest.envelope_id<>p_envelope_id
       or v_manifest.document_id<>p_document_id
       or v_manifest.entity_id is distinct from p_entity_id
       or v_signed.archive_manifest_id is null
       or v_signed.envelope_id<>p_envelope_id
       or v_signed.doc_id is distinct from p_document_id
       or v_signed.entity_id is distinct from p_entity_id then
      raise exception 'Phase 40 archived bytes lack exact manifest/file binding';
    end if;
    v_hash := public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',p_run_id,'envelope_id',p_envelope_id,'document_id',p_document_id,
      'entity_id',p_entity_id,'event_id',p_completed_event_id,
      'lineage_id',p_lineage_id,'manifest_id',v_manifest.manifest_id,
      'signed_file_id',v_signed.id,'file_kind',v_manifest.file_kind,
      'content_length',v_manifest.content_length,
      'content_sha256',v_manifest.content_sha256,'outcome','archived'
    )::text);
    insert into public.os_docusign_archive_governance_receipts(
      receipt_key,run_id,work_kind,envelope_id,document_id,entity_id,
      completed_event_id,lineage_id,manifest_id,signed_file_id,file_kind,
      outcome,expected_length,expected_sha256,observed_length,observed_sha256,
      evidence_sha256)
    values('phase40:backfill:'||p_envelope_id||':'||p_document_id||':'||
      v_manifest.file_kind,p_run_id,'legacy_backfill',p_envelope_id,
      p_document_id,p_entity_id,p_completed_event_id,p_lineage_id,
      v_manifest.manifest_id,v_signed.id,v_manifest.file_kind,'archived',
      v_manifest.content_length,v_manifest.content_sha256,
      v_manifest.content_length,v_manifest.content_sha256,v_hash)
    on conflict(receipt_key) do nothing;
    v_count := v_count+1;
  end loop;
  if p_certificate_manifest_id is null and p_error_code is not null then
    v_outcome := 'provider_unavailable';
    v_hash := public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',p_run_id,'cursor',p_item_cursor,'envelope_id',p_envelope_id,
      'document_id',p_document_id,'entity_id',p_entity_id,
      'event_id',p_completed_event_id,'lineage_id',p_lineage_id,
      'file_kind','certificate','outcome',v_outcome,
      'error_code',left(p_error_code,100))::text);
    insert into public.os_docusign_archive_governance_receipts(
      receipt_key,run_id,work_kind,envelope_id,document_id,entity_id,
      completed_event_id,lineage_id,file_kind,outcome,error_code,evidence_sha256)
    values('phase40:backfill:'||p_run_id::text||':'||p_envelope_id||':'||
      p_document_id||':certificate-unavailable',p_run_id,'legacy_backfill',
      p_envelope_id,p_document_id,p_entity_id,p_completed_event_id,p_lineage_id,
      'certificate',v_outcome,left(p_error_code,100),v_hash)
    on conflict(receipt_key) do nothing;
  else
    v_outcome := 'archived';
  end if;
  update public.os_docusign_archive_governance_runs set
    cursor_key=p_item_cursor,
    succeeded_count=succeeded_count+case when v_outcome='archived' then 1 else 0 end,
    unavailable_count=unavailable_count+
      case when v_outcome='provider_unavailable' then 1 else 0 end,
    last_checkpoint_at=now()
  where run_id=p_run_id;
  return jsonb_build_object('ok',v_outcome='archived','outcome',v_outcome,
    'receipts',v_count);
end;
$$;

create or replace function public.commit_docusign_archive_integrity_result(
  p_run_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_item_cursor text,
  p_manifest_id uuid,
  p_completed_event_id text,
  p_lineage_id uuid,
  p_observed_length bigint,
  p_observed_sha256 text,
  p_availability_code text,
  p_validation_code text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.os_docusign_archive_governance_runs%rowtype;
  v_manifest public.os_docusign_archive_manifests%rowtype;
  v_signed public.os_docusign_signed_files%rowtype;
  v_receipt_id uuid;
  v_outcome text;
  v_hash text;
begin
  select * into v_run from public.os_docusign_archive_governance_runs
    where run_id=p_run_id for update;
  select * into v_manifest from public.os_docusign_archive_manifests
    where manifest_id=p_manifest_id;
  select * into v_signed from public.os_docusign_signed_files
    where archive_manifest_id=p_manifest_id;
  if v_run.run_id is null or v_run.run_kind<>'integrity_scan'
     or v_run.status<>'running' or v_run.lease_token is distinct from p_lease_token
     or v_run.fence_version<>p_fence_version or v_run.lease_expires_at<=now()
     or p_item_cursor<=v_run.cursor_key or v_manifest.manifest_id is null
     or v_signed.id is null
     or not public.docusign_phase40_completed_binding(v_manifest.envelope_id,
       v_manifest.document_id,v_manifest.entity_id,p_completed_event_id,p_lineage_id) then
    raise exception 'Phase 40 integrity lease, fence, cursor, or binding mismatch';
  end if;
  if p_availability_code is not null then
    v_outcome := 'storage_unavailable';
  elsif p_validation_code is not null and p_observed_sha256 is null then
    v_outcome := 'quarantined';
  elsif p_validation_code is not null then
    v_outcome := 'content_drift';
  elsif p_observed_length is null or p_observed_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Observed archive byte evidence is invalid';
  elsif p_observed_length=v_manifest.content_length
     and p_observed_sha256=v_manifest.content_sha256 then
    v_outcome := 'verified';
  else
    v_outcome := 'content_drift';
  end if;
  v_hash := public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
    'run_id',p_run_id,'scan_mode',v_run.scan_mode,
    'manifest_id',v_manifest.manifest_id,'signed_file_id',v_signed.id,
    'envelope_id',v_manifest.envelope_id,'document_id',v_manifest.document_id,
    'entity_id',v_manifest.entity_id,'event_id',p_completed_event_id,
    'lineage_id',p_lineage_id,'file_kind',v_manifest.file_kind,
    'expected_length',v_manifest.content_length,
    'expected_sha256',v_manifest.content_sha256,
    'observed_length',p_observed_length,'observed_sha256',p_observed_sha256,
    'outcome',v_outcome,'error_code',
      left(coalesce(p_availability_code,p_validation_code),100)
  )::text);
  insert into public.os_docusign_archive_governance_receipts(
    receipt_key,run_id,work_kind,envelope_id,document_id,entity_id,
    completed_event_id,lineage_id,manifest_id,signed_file_id,file_kind,
    outcome,expected_length,expected_sha256,observed_length,observed_sha256,
    error_code,evidence_sha256)
  values('phase40:integrity:'||p_run_id::text||':'||p_manifest_id::text,
    p_run_id,'integrity_scan',v_manifest.envelope_id,v_manifest.document_id,
    v_manifest.entity_id,p_completed_event_id,p_lineage_id,p_manifest_id,
    v_signed.id,v_manifest.file_kind,v_outcome,v_manifest.content_length,
    v_manifest.content_sha256,p_observed_length,p_observed_sha256,
    left(coalesce(p_availability_code,p_validation_code),100),v_hash)
  on conflict(receipt_key) do nothing returning receipt_id into v_receipt_id;
  if v_receipt_id is null then
    select receipt_id into v_receipt_id
    from public.os_docusign_archive_governance_receipts
    where receipt_key='phase40:integrity:'||p_run_id::text||':'||p_manifest_id::text;
  end if;
  if v_outcome in ('content_drift','quarantined') then
    insert into public.os_docusign_archive_quarantine(
      manifest_id,receipt_id,envelope_id,document_id,entity_id,file_kind,
      reason_code,expected_sha256,observed_sha256)
    values(p_manifest_id,v_receipt_id,v_manifest.envelope_id,
      v_manifest.document_id,v_manifest.entity_id,v_manifest.file_kind,
      case when v_outcome='content_drift' then 'archive_content_drift'
        else left(coalesce(p_validation_code,'archive_validation_failed'),100)
      end,v_manifest.content_sha256,p_observed_sha256)
    on conflict(manifest_id) where status='manual_review' do nothing;
  end if;
  update public.os_docusign_archive_governance_runs set
    cursor_key=p_item_cursor,last_checkpoint_at=now(),
    succeeded_count=succeeded_count+case when v_outcome='verified' then 1 else 0 end,
    unavailable_count=unavailable_count+
      case when v_outcome='storage_unavailable' then 1 else 0 end,
    drift_count=drift_count+case when v_outcome='content_drift' then 1 else 0 end,
    quarantined_count=quarantined_count+
      case when v_outcome in ('content_drift','quarantined') then 1 else 0 end
  where run_id=p_run_id;
  return jsonb_build_object('ok',v_outcome='verified','outcome',v_outcome,
    'receipt_id',v_receipt_id);
end;
$$;

create or replace function public.finish_docusign_archive_governance_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_has_more boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_run public.os_docusign_archive_governance_runs%rowtype;
  v_event_type text;
begin
  select * into v_run from public.os_docusign_archive_governance_runs
    where run_id=p_run_id for update;
  if not found or v_run.status<>'running'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.fence_version<>p_fence_version then
    raise exception 'Phase 40 archive finish lease or fence mismatch';
  end if;
  update public.os_docusign_archive_governance_runs set
    status=case when p_has_more then 'retry_wait'
      when drift_count>0 or unavailable_count>0 then 'partial'
      else 'completed' end,
    next_attempt_at=case when p_has_more then now() else null end,
    completed_at=case when p_has_more then null else now() end,
    lease_token=null,lease_expires_at=null,worker_id=null
  where run_id=p_run_id returning * into v_run;
  v_event_type := case when p_has_more then 'run_checkpointed'
    when v_run.status='partial' then 'run_partial' else 'run_completed' end;
  insert into public.os_docusign_archive_governance_events(
    event_key,run_id,event_type,worker_id,fence_version,cursor_key,detail,
    evidence_sha256)
  values('phase40:run:'||v_run.run_id::text||':finish:'||
    v_run.fence_version::text,v_run.run_id,v_event_type,null,
    v_run.fence_version,v_run.cursor_key,
    jsonb_build_object('status',v_run.status,'succeeded',v_run.succeeded_count,
      'unavailable',v_run.unavailable_count,'drift',v_run.drift_count),
    public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',v_run.run_id,'event_type',v_event_type,
      'fence_version',v_run.fence_version,'cursor',v_run.cursor_key,
      'status',v_run.status,'succeeded',v_run.succeeded_count,
      'unavailable',v_run.unavailable_count,'drift',v_run.drift_count
    )::text))
  on conflict(event_key) do nothing;
  return jsonb_build_object('run_id',v_run.run_id,'status',v_run.status,
    'succeeded',v_run.succeeded_count,'unavailable',v_run.unavailable_count,
    'drift',v_run.drift_count,'quarantined',v_run.quarantined_count,
    'cursor',v_run.cursor_key);
end;
$$;

create or replace function public.fail_docusign_archive_governance_run(
  p_run_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_error_code text,
  p_error_detail text,
  p_retryable boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_run public.os_docusign_archive_governance_runs%rowtype;
begin
  select * into v_run from public.os_docusign_archive_governance_runs
    where run_id=p_run_id for update;
  if not found or v_run.status<>'running'
     or v_run.lease_token is distinct from p_lease_token
     or v_run.fence_version<>p_fence_version then
    raise exception 'Phase 40 archive failure lease or fence mismatch';
  end if;
  update public.os_docusign_archive_governance_runs set
    retry_attempts=least(max_attempts,retry_attempts+1),
    status=case when p_retryable and retry_attempts+1<max_attempts
      then 'retry_wait' else 'failed' end,
    next_attempt_at=case when p_retryable and retry_attempts+1<max_attempts
      then now()+make_interval(secs=>least(3600,
        (30*power(2,retry_attempts))::integer)) else null end,
    completed_at=case when p_retryable and retry_attempts+1<max_attempts
      then null else now() end,
    last_error_code=left(coalesce(p_error_code,'unknown'),100),
    last_error_detail=left(coalesce(p_error_detail,'Archive worker failed'),500),
    lease_token=null,lease_expires_at=null,worker_id=null
  where run_id=p_run_id returning * into v_run;
  insert into public.os_docusign_archive_governance_events(
    event_key,run_id,event_type,worker_id,fence_version,cursor_key,detail,
    evidence_sha256)
  values('phase40:run:'||v_run.run_id::text||':failure:'||
    v_run.fence_version::text,v_run.run_id,
    case when v_run.status='retry_wait' then 'run_deferred' else 'run_failed' end,
    null,v_run.fence_version,v_run.cursor_key,
    jsonb_build_object('status',v_run.status,
      'error_code',v_run.last_error_code,'retry_attempts',v_run.retry_attempts),
    public.os_sha256_hex(jsonb_build_object('version','phase40-v1',
      'run_id',v_run.run_id,'event_type',
        case when v_run.status='retry_wait' then 'run_deferred' else 'run_failed' end,
      'fence_version',v_run.fence_version,'cursor',v_run.cursor_key,
      'status',v_run.status,'error_code',v_run.last_error_code,
      'retry_attempts',v_run.retry_attempts)::text))
  on conflict(event_key) do nothing;
  return jsonb_build_object('run_id',v_run.run_id,'status',v_run.status,
    'next_attempt_at',v_run.next_attempt_at);
end;
$$;

create or replace function public.review_docusign_archive_quarantine(
  p_quarantine_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_note text,
  p_expected_row_version bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row public.os_docusign_archive_quarantine%rowtype;
  v_profile public.profiles%rowtype;
begin
  select * into v_profile from public.profiles
    where id=p_actor_id and active;
  if p_decision not in ('acknowledge','resolve')
     or length(trim(coalesce(p_note,'')))<20
     or v_profile.id is null
     or v_profile.role not in ('visionary','admin','counsel_ops')
     then raise exception 'Invalid archive quarantine review'; end if;
  select * into v_row from public.os_docusign_archive_quarantine
    where quarantine_id=p_quarantine_id for update;
  if not found or v_row.status<>'manual_review'
     or v_row.row_version<>p_expected_row_version then
    raise exception 'Archive quarantine state changed';
  end if;
  if v_profile.entity_id is not null and v_profile.entity_id<>'ENT-FIRM'
     and v_profile.entity_id is distinct from v_row.entity_id then
    raise exception 'Archive quarantine entity access denied';
  end if;
  update public.os_docusign_archive_quarantine set
    status=case when p_decision='resolve' then 'resolved' else 'acknowledged' end,
    reviewed_by=p_actor_id,reviewer_note=trim(p_note),reviewed_at=now(),
    row_version=row_version+1
  where quarantine_id=p_quarantine_id returning * into v_row;
  return jsonb_build_object('quarantine_id',v_row.quarantine_id,
    'status',v_row.status,'row_version',v_row.row_version);
end;
$$;

revoke all on function public.claim_docusign_archive_governance_work(
  text,text,text,uuid,text,integer,integer) from public,anon,authenticated;
revoke all on function public.commit_docusign_archive_backfill_result(
  uuid,uuid,bigint,text,text,text,text,text,uuid,uuid,uuid,text)
  from public,anon,authenticated;
revoke all on function public.commit_docusign_archive_integrity_result(
  uuid,uuid,bigint,text,uuid,text,uuid,bigint,text,text,text)
  from public,anon,authenticated;
revoke all on function public.finish_docusign_archive_governance_run(
  uuid,uuid,bigint,boolean) from public,anon,authenticated;
revoke all on function public.fail_docusign_archive_governance_run(
  uuid,uuid,bigint,text,text,boolean) from public,anon,authenticated;
revoke all on function public.review_docusign_archive_quarantine(
  uuid,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.claim_docusign_archive_governance_work(
  text,text,text,uuid,text,integer,integer) to service_role;
grant execute on function public.commit_docusign_archive_backfill_result(
  uuid,uuid,bigint,text,text,text,text,text,uuid,uuid,uuid,text)
  to service_role;
grant execute on function public.commit_docusign_archive_integrity_result(
  uuid,uuid,bigint,text,uuid,text,uuid,bigint,text,text,text) to service_role;
grant execute on function public.finish_docusign_archive_governance_run(
  uuid,uuid,bigint,boolean) to service_role;
grant execute on function public.fail_docusign_archive_governance_run(
  uuid,uuid,bigint,text,text,boolean) to service_role;
grant execute on function public.review_docusign_archive_quarantine(
  uuid,uuid,text,text,bigint) to service_role;
