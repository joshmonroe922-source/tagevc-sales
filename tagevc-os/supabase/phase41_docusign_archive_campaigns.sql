-- Phase 41: DocuSign archive campaign advances (backfill completion + quarterly full).
-- Depends on phase40_docusign_archive_governance.sql.
-- Workers never create/void/resend envelopes. Evidence = digests/metadata only.
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

-- Remaining completed envelopes missing combined or certificate archive hashes.
create or replace function public.docusign_archive_remaining_unhashed_count(
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
    );
$$;

create or replace function public.docusign_archive_quarantine_backlog_count(
  p_entity_id text default null
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select count(*)::integer
  from public.os_docusign_archive_quarantine q
  where q.status='manual_review'
    and (p_entity_id is null or q.entity_id is not distinct from p_entity_id);
$$;

create or replace function public.docusign_archive_quarantine_oldest_age_days(
  p_entity_id text default null
) returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    ceil(extract(epoch from (now() - min(q.opened_at))) / 86400)::integer,
    0
  )
  from public.os_docusign_archive_quarantine q
  where q.status='manual_review'
    and (p_entity_id is null or q.entity_id is not distinct from p_entity_id);
$$;

create table if not exists public.os_docusign_archive_campaigns (
  campaign_id uuid primary key default gen_random_uuid(),
  campaign_kind text not null,
  status text not null default 'open',
  trigger_source text not null,
  requested_by uuid,
  entity_id text references public.entities(entity_id),
  schedule_window_start timestamptz not null,
  schedule_window_end timestamptz not null,
  gate_remaining_unhashed integer not null default 0,
  gate_quarantine_backlog integer not null default 0,
  gate_quarantine_oldest_days integer not null default 0,
  gate_blocked boolean not null default false,
  gate_reason text,
  lease_token uuid,
  lease_expires_at timestamptz,
  fence_version bigint not null default 0,
  worker_id text,
  invocation_count integer not null default 0,
  linked_run_count integer not null default 0,
  last_governance_run_id uuid
    references public.os_docusign_archive_governance_runs(run_id),
  progress_pct numeric(5,2) not null default 0,
  evidence_sha256 text not null,
  opened_at timestamptz not null default now(),
  last_checkpoint_at timestamptz,
  completed_at timestamptz,
  constraint os_docusign_archive_camp_kind_check
    check (campaign_kind in (
      'legacy_backfill_completion','quarterly_full_integrity')),
  constraint os_docusign_archive_camp_status_check
    check (status in (
      'open','running','gated','not_due','completed','partial','failed')),
  constraint os_docusign_archive_camp_trigger_check
    check (trigger_source in ('cron','manual')),
  constraint os_docusign_archive_camp_window_check
    check (schedule_window_end > schedule_window_start),
  constraint os_docusign_archive_camp_lease_check
    check ((lease_token is null)=(lease_expires_at is null)),
  constraint os_docusign_archive_camp_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_camp_pct_check
    check (progress_pct >= 0 and progress_pct <= 100)
);
create index if not exists os_docusign_archive_camp_claim_idx
  on public.os_docusign_archive_campaigns(
    campaign_kind,status,lease_expires_at,opened_at);
create unique index if not exists os_docusign_archive_camp_one_active
  on public.os_docusign_archive_campaigns(campaign_kind)
  where status in ('open','running','gated');
create index if not exists os_docusign_archive_camp_entity_idx
  on public.os_docusign_archive_campaigns(entity_id,opened_at desc);

create table if not exists public.os_docusign_archive_campaign_receipts (
  receipt_id uuid primary key default gen_random_uuid(),
  receipt_key text not null unique,
  campaign_id uuid not null
    references public.os_docusign_archive_campaigns(campaign_id),
  governance_run_id uuid not null
    references public.os_docusign_archive_governance_runs(run_id),
  outcome text not null,
  gate_remaining_unhashed integer not null default 0,
  gate_quarantine_backlog integer not null default 0,
  progress_pct numeric(5,2) not null default 0,
  evidence_sha256 text not null,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_camp_receipt_outcome_check
    check (outcome in (
      'linked_run','checkpointed','completed','partial','gated','failed')),
  constraint os_docusign_archive_camp_receipt_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_camp_receipt_pct_check
    check (progress_pct >= 0 and progress_pct <= 100)
);
create index if not exists os_docusign_archive_camp_receipt_camp_idx
  on public.os_docusign_archive_campaign_receipts(campaign_id,created_at desc);
create index if not exists os_docusign_archive_camp_receipt_run_idx
  on public.os_docusign_archive_campaign_receipts(governance_run_id);

-- Quarterly full integrity is due when no completed campaign exists in the
-- current calendar quarter (UTC).
create or replace function public.is_docusign_quarterly_full_integrity_due(
  p_as_of timestamptz default now()
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (
    select 1
    from public.os_docusign_archive_campaigns c
    where c.campaign_kind='quarterly_full_integrity'
      and c.status in ('completed','partial')
      and c.completed_at is not null
      and date_trunc('quarter', c.completed_at at time zone 'utc')
        = date_trunc('quarter', coalesce(p_as_of, now()) at time zone 'utc')
  );
$$;

alter table public.os_docusign_archive_campaigns enable row level security;
alter table public.os_docusign_archive_campaign_receipts enable row level security;
drop policy if exists "os_docusign_archive_camp_select"
  on public.os_docusign_archive_campaigns;
drop policy if exists "os_docusign_archive_camp_receipt_select"
  on public.os_docusign_archive_campaign_receipts;
create policy "os_docusign_archive_camp_select"
  on public.os_docusign_archive_campaigns for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
create policy "os_docusign_archive_camp_receipt_select"
  on public.os_docusign_archive_campaign_receipts for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_docusign_archive_campaigns c
      where c.campaign_id=os_docusign_archive_campaign_receipts.campaign_id
        and c.entity_id is not null
        and public.can_access_entity(c.entity_id)
    )
  );
revoke all on public.os_docusign_archive_campaigns,
  public.os_docusign_archive_campaign_receipts from public,anon,authenticated;
grant select on public.os_docusign_archive_campaigns,
  public.os_docusign_archive_campaign_receipts to authenticated;

create or replace function public.reject_docusign_phase41_campaign_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 41 DocuSign archive campaign receipts are append-only';
end;
$$;
drop trigger if exists os_docusign_archive_camp_receipts_immutable
  on public.os_docusign_archive_campaign_receipts;
create trigger os_docusign_archive_camp_receipts_immutable
  before update or delete on public.os_docusign_archive_campaign_receipts
  for each row execute function public.reject_docusign_phase41_campaign_mutation();
drop trigger if exists os_docusign_archive_camp_receipts_no_truncate
  on public.os_docusign_archive_campaign_receipts;
create trigger os_docusign_archive_camp_receipts_no_truncate
  before truncate on public.os_docusign_archive_campaign_receipts
  for each statement execute function public.reject_docusign_phase41_campaign_mutation();

create or replace function public.docusign_archive_campaign_progress_pct(
  p_campaign_kind text,
  p_remaining_unhashed integer,
  p_entity_id text default null
) returns numeric
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_remaining integer := greatest(coalesce(p_remaining_unhashed,0),0);
  v_manifests integer;
  v_total integer;
begin
  if p_campaign_kind='legacy_backfill_completion' then
    select count(*)::integer into v_manifests
    from public.os_docusign_archive_manifests m
    where m.file_kind='combined'
      and m.envelope_id not like 'ENV-%'
      and (p_entity_id is null or m.entity_id is not distinct from p_entity_id);
    v_total := v_manifests + v_remaining;
    if v_total <= 0 then
      return 100;
    end if;
    return round(((v_manifests::numeric / v_total::numeric) * 100), 2);
  end if;
  -- quarterly_full_integrity: progress from verified receipts in window
  if p_campaign_kind='quarterly_full_integrity' then
    select count(*)::integer into v_total
    from public.os_docusign_archive_manifests m
    where m.source='docusign'
      and m.envelope_id not like 'ENV-%'
      and (p_entity_id is null or m.entity_id is not distinct from p_entity_id);
    if v_total <= 0 then
      return 100;
    end if;
    select count(*)::integer into v_manifests
    from public.os_docusign_archive_manifests m
    where m.source='docusign'
      and m.envelope_id not like 'ENV-%'
      and (p_entity_id is null or m.entity_id is not distinct from p_entity_id)
      and exists (
        select 1 from public.os_docusign_archive_governance_receipts r
        where r.manifest_id=m.manifest_id
          and r.work_kind='integrity_scan'
          and r.outcome='verified'
          and r.created_at >= date_trunc('quarter', now() at time zone 'utc')
      );
    return round(((v_manifests::numeric / v_total::numeric) * 100), 2);
  end if;
  return 0;
end;
$$;

create or replace view public.os_docusign_archive_campaign_progress
with (security_invoker=true) as
select
  c.campaign_id,
  c.campaign_kind,
  c.status,
  c.entity_id,
  c.schedule_window_start,
  c.schedule_window_end,
  c.gate_remaining_unhashed,
  c.gate_quarantine_backlog,
  c.gate_quarantine_oldest_days,
  c.gate_blocked,
  c.gate_reason,
  c.progress_pct,
  c.linked_run_count,
  c.last_governance_run_id,
  c.opened_at,
  c.last_checkpoint_at,
  c.completed_at,
  public.docusign_archive_remaining_unhashed_count(c.entity_id)
    as live_remaining_unhashed,
  public.docusign_archive_quarantine_backlog_count(c.entity_id)
    as live_quarantine_backlog,
  public.docusign_archive_quarantine_oldest_age_days(c.entity_id)
    as live_quarantine_oldest_days,
  public.is_docusign_quarterly_full_integrity_due()
    as quarterly_full_due
from public.os_docusign_archive_campaigns c;

grant execute on function public.docusign_archive_remaining_unhashed_count(text)
  to authenticated, service_role;
grant execute on function public.docusign_archive_quarantine_backlog_count(text)
  to authenticated, service_role;
grant execute on function public.docusign_archive_quarantine_oldest_age_days(text)
  to authenticated, service_role;
grant execute on function public.is_docusign_quarterly_full_integrity_due(timestamptz)
  to authenticated, service_role;
grant execute on function public.docusign_archive_campaign_progress_pct(text,integer,text)
  to authenticated, service_role;
grant select on public.os_docusign_archive_campaign_progress
  to authenticated, service_role;

create or replace function public.open_docusign_archive_campaign(
  p_campaign_kind text,
  p_trigger_source text,
  p_requested_by uuid,
  p_entity_id text default null,
  p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_camp public.os_docusign_archive_campaigns%rowtype;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_blocked boolean := false;
  v_reason text := null;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_due boolean;
  v_hash text;
  v_pct numeric;
begin
  if p_campaign_kind not in (
       'legacy_backfill_completion','quarterly_full_integrity')
     or p_trigger_source not in ('cron','manual') then
    raise exception 'Invalid Phase 41 archive campaign open';
  end if;
  if p_trigger_source='manual' and (
    p_requested_by is null or not exists (
      select 1 from public.profiles p where p.id=p_requested_by and p.active
        and p.role in ('visionary','admin','counsel_ops')
    )
  ) then raise exception 'Phase 41 archive campaign permission denied'; end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'docusign-archive-campaign:'||p_campaign_kind,0));

  select * into v_camp
  from public.os_docusign_archive_campaigns
  where campaign_kind=p_campaign_kind
    and status in ('open','running','gated')
  order by opened_at limit 1 for update;
  if found then
    return jsonb_build_object(
      'disposition','already_open','campaign_id',v_camp.campaign_id,
      'status',v_camp.status,'progress_pct',v_camp.progress_pct,
      'gate_blocked',v_camp.gate_blocked,'gate_reason',v_camp.gate_reason);
  end if;

  if p_campaign_kind='quarterly_full_integrity' then
    v_due := public.is_docusign_quarterly_full_integrity_due();
    if not v_due and not coalesce(p_force,false) then
      return jsonb_build_object(
        'disposition','not_due',
        'campaign_kind',p_campaign_kind,
        'quarterly_full_due',false);
    end if;
    v_window_start := date_trunc('quarter', now() at time zone 'utc');
    v_window_end := v_window_start + interval '3 months';
  else
    v_window_start := now();
    v_window_end := now() + interval '90 days';
  end if;

  v_remaining := public.docusign_archive_remaining_unhashed_count(p_entity_id);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(p_entity_id);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(p_entity_id);

  if p_campaign_kind='quarterly_full_integrity' then
    if v_remaining > 0 then
      v_blocked := true;
      v_reason := 'legacy_backfill_incomplete';
    elsif v_quarantine > 25 then
      v_blocked := true;
      v_reason := 'quarantine_backlog_high';
    elsif v_oldest > 45 then
      v_blocked := true;
      v_reason := 'quarantine_aging';
    end if;
  end if;

  v_pct := public.docusign_archive_campaign_progress_pct(
    p_campaign_kind, v_remaining, p_entity_id);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase41-v1',
    'campaign_kind',p_campaign_kind,
    'trigger',p_trigger_source,
    'entity_id',p_entity_id,
    'window_start',v_window_start,
    'window_end',v_window_end,
    'remaining',v_remaining,
    'quarantine',v_quarantine,
    'oldest_days',v_oldest,
    'blocked',v_blocked,
    'reason',v_reason,
    'progress_pct',v_pct
  )::text);

  insert into public.os_docusign_archive_campaigns(
    campaign_kind,status,trigger_source,requested_by,entity_id,
    schedule_window_start,schedule_window_end,
    gate_remaining_unhashed,gate_quarantine_backlog,gate_quarantine_oldest_days,
    gate_blocked,gate_reason,progress_pct,evidence_sha256)
  values(
    p_campaign_kind,
    case when v_blocked then 'gated' else 'open' end,
    p_trigger_source,p_requested_by,p_entity_id,
    v_window_start,v_window_end,
    v_remaining,v_quarantine,v_oldest,
    v_blocked,v_reason,v_pct,v_hash)
  returning * into v_camp;

  return jsonb_build_object(
    'disposition',case when v_blocked then 'gated' else 'opened' end,
    'campaign_id',v_camp.campaign_id,
    'status',v_camp.status,
    'progress_pct',v_camp.progress_pct,
    'gate_blocked',v_camp.gate_blocked,
    'gate_reason',v_camp.gate_reason,
    'gate_remaining_unhashed',v_camp.gate_remaining_unhashed,
    'gate_quarantine_backlog',v_camp.gate_quarantine_backlog,
    'schedule_window_start',v_camp.schedule_window_start,
    'schedule_window_end',v_camp.schedule_window_end);
end;
$$;

create or replace function public.claim_docusign_archive_campaign_work(
  p_campaign_kind text,
  p_trigger_source text,
  p_requested_by uuid,
  p_worker_id text,
  p_lease_seconds integer default 300,
  p_force boolean default false
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_camp public.os_docusign_archive_campaigns%rowtype;
  v_open jsonb;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_blocked boolean := false;
  v_reason text := null;
  v_run_kind text;
  v_scan_mode text;
  v_pct numeric;
begin
  if p_campaign_kind not in (
       'legacy_backfill_completion','quarterly_full_integrity')
     or p_trigger_source not in ('cron','manual')
     or nullif(trim(p_worker_id),'') is null then
    raise exception 'Invalid Phase 41 archive campaign claim';
  end if;
  if p_trigger_source='manual' and (
    p_requested_by is null or not exists (
      select 1 from public.profiles p where p.id=p_requested_by and p.active
        and p.role in ('visionary','admin','counsel_ops')
    )
  ) then raise exception 'Phase 41 archive campaign permission denied'; end if;

  if p_campaign_kind='quarterly_full_integrity'
     and not public.is_docusign_quarterly_full_integrity_due()
     and not coalesce(p_force,false) then
    select * into v_camp
    from public.os_docusign_archive_campaigns
    where campaign_kind=p_campaign_kind
      and status in ('open','running','gated')
    order by opened_at limit 1;
    if not found then
      return jsonb_build_object(
        'disposition','not_due',
        'campaign_kind',p_campaign_kind,
        'quarterly_full_due',false);
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'docusign-archive-campaign:'||p_campaign_kind,0));

  select * into v_camp
  from public.os_docusign_archive_campaigns
  where campaign_kind=p_campaign_kind
    and status in ('open','running','gated')
  order by opened_at limit 1 for update;

  if not found then
    v_open := public.open_docusign_archive_campaign(
      p_campaign_kind,p_trigger_source,p_requested_by,null,p_force);
    if v_open->>'disposition'='not_due' then
      return v_open;
    end if;
    select * into v_camp
    from public.os_docusign_archive_campaigns
    where campaign_id=(v_open->>'campaign_id')::uuid for update;
  end if;

  if v_camp.status='running' and v_camp.lease_expires_at>now() then
    return jsonb_build_object(
      'disposition','busy','campaign_id',v_camp.campaign_id,
      'retry_at',v_camp.lease_expires_at,'status',v_camp.status);
  end if;

  v_remaining := public.docusign_archive_remaining_unhashed_count(v_camp.entity_id);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(v_camp.entity_id);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(v_camp.entity_id);
  v_pct := public.docusign_archive_campaign_progress_pct(
    v_camp.campaign_kind, v_remaining, v_camp.entity_id);

  if v_camp.campaign_kind='legacy_backfill_completion' then
    if v_remaining <= 0 then
      update public.os_docusign_archive_campaigns set
        status='completed',
        gate_remaining_unhashed=0,
        gate_quarantine_backlog=v_quarantine,
        gate_quarantine_oldest_days=v_oldest,
        gate_blocked=false,
        gate_reason=null,
        progress_pct=100,
        lease_token=null,
        lease_expires_at=null,
        worker_id=null,
        completed_at=now(),
        last_checkpoint_at=now()
      where campaign_id=v_camp.campaign_id
      returning * into v_camp;
      return jsonb_build_object(
        'disposition','already_complete','campaign_id',v_camp.campaign_id,
        'status','completed','progress_pct',100,
        'gate_remaining_unhashed',0,
        'gate_quarantine_backlog',v_quarantine);
    end if;
    v_run_kind := 'legacy_backfill';
    v_scan_mode := 'full';
  else
    if v_remaining > 0 then
      v_blocked := true;
      v_reason := 'legacy_backfill_incomplete';
    elsif v_quarantine > 25 then
      v_blocked := true;
      v_reason := 'quarantine_backlog_high';
    elsif v_oldest > 45 then
      v_blocked := true;
      v_reason := 'quarantine_aging';
    end if;
    if v_blocked then
      update public.os_docusign_archive_campaigns set
        status='gated',
        gate_remaining_unhashed=v_remaining,
        gate_quarantine_backlog=v_quarantine,
        gate_quarantine_oldest_days=v_oldest,
        gate_blocked=true,
        gate_reason=v_reason,
        progress_pct=v_pct,
        lease_token=null,
        lease_expires_at=null,
        worker_id=null,
        last_checkpoint_at=now()
      where campaign_id=v_camp.campaign_id
      returning * into v_camp;
      return jsonb_build_object(
        'disposition','gated','campaign_id',v_camp.campaign_id,
        'status','gated','gate_reason',v_reason,
        'gate_remaining_unhashed',v_remaining,
        'gate_quarantine_backlog',v_quarantine,
        'gate_quarantine_oldest_days',v_oldest,
        'progress_pct',v_pct);
    end if;
    if v_pct >= 100 then
      update public.os_docusign_archive_campaigns set
        status='completed',
        gate_remaining_unhashed=v_remaining,
        gate_quarantine_backlog=v_quarantine,
        gate_quarantine_oldest_days=v_oldest,
        gate_blocked=false,
        gate_reason=null,
        progress_pct=100,
        lease_token=null,
        lease_expires_at=null,
        worker_id=null,
        completed_at=now(),
        last_checkpoint_at=now()
      where campaign_id=v_camp.campaign_id
      returning * into v_camp;
      return jsonb_build_object(
        'disposition','already_complete','campaign_id',v_camp.campaign_id,
        'status','completed','progress_pct',100);
    end if;
    v_run_kind := 'integrity_scan';
    v_scan_mode := 'full';
  end if;

  update public.os_docusign_archive_campaigns set
    status='running',
    lease_token=gen_random_uuid(),
    lease_expires_at=now()+make_interval(
      secs=>least(greatest(coalesce(p_lease_seconds,300),60),600)),
    fence_version=fence_version+1,
    worker_id=left(trim(p_worker_id),100),
    invocation_count=invocation_count+1,
    gate_remaining_unhashed=v_remaining,
    gate_quarantine_backlog=v_quarantine,
    gate_quarantine_oldest_days=v_oldest,
    gate_blocked=false,
    gate_reason=null,
    progress_pct=v_pct
  where campaign_id=v_camp.campaign_id
  returning * into v_camp;

  return jsonb_build_object(
    'disposition','claimed',
    'campaign_id',v_camp.campaign_id,
    'campaign_kind',v_camp.campaign_kind,
    'status',v_camp.status,
    'lease_token',v_camp.lease_token,
    'fence_version',v_camp.fence_version,
    'run_kind',v_run_kind,
    'scan_mode',v_scan_mode,
    'progress_pct',v_camp.progress_pct,
    'gate_remaining_unhashed',v_remaining,
    'gate_quarantine_backlog',v_quarantine,
    'schedule_window_start',v_camp.schedule_window_start,
    'schedule_window_end',v_camp.schedule_window_end);
end;
$$;

create or replace function public.finish_docusign_archive_campaign(
  p_campaign_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_governance_run_id uuid,
  p_has_more boolean
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_camp public.os_docusign_archive_campaigns%rowtype;
  v_run public.os_docusign_archive_governance_runs%rowtype;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_pct numeric;
  v_outcome text;
  v_status text;
  v_hash text;
begin
  select * into v_camp from public.os_docusign_archive_campaigns
    where campaign_id=p_campaign_id for update;
  if not found or v_camp.status<>'running'
     or v_camp.lease_token is distinct from p_lease_token
     or v_camp.fence_version<>p_fence_version then
    raise exception 'Phase 41 archive campaign finish lease or fence mismatch';
  end if;

  select * into v_run from public.os_docusign_archive_governance_runs
    where run_id=p_governance_run_id;
  if v_run.run_id is null then
    raise exception 'Phase 41 campaign finish requires a governance run_id';
  end if;

  v_remaining := public.docusign_archive_remaining_unhashed_count(v_camp.entity_id);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(v_camp.entity_id);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(v_camp.entity_id);
  v_pct := public.docusign_archive_campaign_progress_pct(
    v_camp.campaign_kind, v_remaining, v_camp.entity_id);

  if p_has_more then
    v_status := 'open';
    v_outcome := 'checkpointed';
  elsif v_camp.campaign_kind='legacy_backfill_completion' then
    if v_remaining <= 0 then
      v_status := 'completed';
      v_outcome := 'completed';
      v_pct := 100;
    else
      v_status := 'open';
      v_outcome := 'partial';
    end if;
  else
    if v_pct >= 100 then
      v_status := 'completed';
      v_outcome := 'completed';
      v_pct := 100;
    elsif v_run.drift_count > 0 or v_run.unavailable_count > 0 then
      v_status := 'open';
      v_outcome := 'partial';
    else
      v_status := 'open';
      v_outcome := 'linked_run';
    end if;
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase41-v1',
    'campaign_id',p_campaign_id,
    'governance_run_id',p_governance_run_id,
    'outcome',v_outcome,
    'remaining',v_remaining,
    'quarantine',v_quarantine,
    'progress_pct',v_pct,
    'has_more',p_has_more,
    'run_status',v_run.status
  )::text);

  insert into public.os_docusign_archive_campaign_receipts(
    receipt_key,campaign_id,governance_run_id,outcome,
    gate_remaining_unhashed,gate_quarantine_backlog,progress_pct,evidence_sha256)
  values(
    'phase41:campaign:'||p_campaign_id::text||':run:'||p_governance_run_id::text
      ||':fence:'||p_fence_version::text,
    p_campaign_id,p_governance_run_id,v_outcome,
    v_remaining,v_quarantine,v_pct,v_hash)
  on conflict(receipt_key) do nothing;

  update public.os_docusign_archive_campaigns set
    status=v_status,
    linked_run_count=linked_run_count+1,
    last_governance_run_id=p_governance_run_id,
    gate_remaining_unhashed=v_remaining,
    gate_quarantine_backlog=v_quarantine,
    gate_quarantine_oldest_days=v_oldest,
    gate_blocked=false,
    gate_reason=null,
    progress_pct=v_pct,
    lease_token=null,
    lease_expires_at=null,
    worker_id=null,
    last_checkpoint_at=now(),
    completed_at=case when v_status='completed' then now() else null end,
    evidence_sha256=v_hash
  where campaign_id=p_campaign_id
  returning * into v_camp;

  return jsonb_build_object(
    'campaign_id',v_camp.campaign_id,
    'status',v_camp.status,
    'outcome',v_outcome,
    'progress_pct',v_camp.progress_pct,
    'gate_remaining_unhashed',v_remaining,
    'gate_quarantine_backlog',v_quarantine,
    'linked_run_count',v_camp.linked_run_count,
    'governance_run_id',p_governance_run_id);
end;
$$;

create or replace function public.fail_docusign_archive_campaign(
  p_campaign_id uuid,
  p_lease_token uuid,
  p_fence_version bigint,
  p_error_code text,
  p_retryable boolean default true
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_camp public.os_docusign_archive_campaigns%rowtype;
  v_status text;
begin
  select * into v_camp from public.os_docusign_archive_campaigns
    where campaign_id=p_campaign_id for update;
  if not found or v_camp.status<>'running'
     or v_camp.lease_token is distinct from p_lease_token
     or v_camp.fence_version<>p_fence_version then
    raise exception 'Phase 41 archive campaign failure lease or fence mismatch';
  end if;
  if coalesce(p_retryable,true) then
    v_status := 'open';
  else
    v_status := 'failed';
  end if;
  update public.os_docusign_archive_campaigns set
    status=v_status,
    gate_reason=left(coalesce(p_error_code,'campaign_worker_failed'),100),
    lease_token=null,
    lease_expires_at=null,
    worker_id=null,
    last_checkpoint_at=now(),
    completed_at=case when v_status='failed' then now() else null end
  where campaign_id=p_campaign_id
  returning * into v_camp;
  return jsonb_build_object(
    'campaign_id',v_camp.campaign_id,'status',v_camp.status,
    'gate_reason',v_camp.gate_reason);
end;
$$;

create or replace function public.list_docusign_archive_campaign_hub(
  p_limit integer default 8
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'campaigns', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.opened_at desc)
      from (
        select campaign_id,campaign_kind,status,entity_id,
          schedule_window_start,schedule_window_end,
          gate_remaining_unhashed,gate_quarantine_backlog,
          gate_quarantine_oldest_days,gate_blocked,gate_reason,
          progress_pct,linked_run_count,last_governance_run_id,
          opened_at,last_checkpoint_at,completed_at
        from public.os_docusign_archive_campaigns
        order by opened_at desc
        limit least(greatest(coalesce(p_limit,8),1),25)
      ) q
    ), '[]'::jsonb),
    'live', jsonb_build_object(
      'remaining_unhashed', public.docusign_archive_remaining_unhashed_count(null),
      'quarantine_backlog', public.docusign_archive_quarantine_backlog_count(null),
      'quarantine_oldest_days',
        public.docusign_archive_quarantine_oldest_age_days(null),
      'quarterly_full_due', public.is_docusign_quarterly_full_integrity_due()
    ),
    'last_full_scan_at', (
      select max(completed_at)
      from public.os_docusign_archive_governance_runs
      where run_kind='integrity_scan' and scan_mode='full'
        and status in ('completed','partial')
    )
  );
$$;

revoke all on function public.open_docusign_archive_campaign(
  text,text,uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.claim_docusign_archive_campaign_work(
  text,text,uuid,text,integer,boolean) from public,anon,authenticated;
revoke all on function public.finish_docusign_archive_campaign(
  uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated;
revoke all on function public.fail_docusign_archive_campaign(
  uuid,uuid,bigint,text,boolean) from public,anon,authenticated;
revoke all on function public.list_docusign_archive_campaign_hub(integer)
  from public,anon;
grant execute on function public.open_docusign_archive_campaign(
  text,text,uuid,text,boolean) to service_role;
grant execute on function public.claim_docusign_archive_campaign_work(
  text,text,uuid,text,integer,boolean) to service_role;
grant execute on function public.finish_docusign_archive_campaign(
  uuid,uuid,bigint,uuid,boolean) to service_role;
grant execute on function public.fail_docusign_archive_campaign(
  uuid,uuid,bigint,text,boolean) to service_role;
grant execute on function public.list_docusign_archive_campaign_hub(integer)
  to authenticated, service_role;
