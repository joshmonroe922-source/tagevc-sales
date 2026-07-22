-- Phase 42: DocuSign archive campaign ops readiness.
-- Depends on phase41_docusign_archive_campaigns.sql.
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

create or replace function public.phase42_docusign_ops_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
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

create table if not exists public.os_docusign_archive_campaign_ops_events (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  event_kind text not null,
  campaign_id uuid
    references public.os_docusign_archive_campaigns(campaign_id),
  campaign_kind text,
  gate_reason text,
  remaining_unhashed integer not null default 0,
  quarantine_backlog integer not null default 0,
  quarantine_oldest_days integer not null default 0,
  progress_pct numeric(5,2) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_camp_ops_kind_check
    check (event_kind in (
      'backfill_completed',
      'backfill_gate_cleared',
      'quarterly_first_milestone',
      'quarterly_completed',
      'campaign_gated',
      'quarantine_aging_breach',
      'quarantine_aged_cleared'
    )),
  constraint os_docusign_archive_camp_ops_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_camp_ops_pct_check
    check (progress_pct >= 0 and progress_pct <= 100),
  constraint os_docusign_archive_camp_ops_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase42_docusign_ops_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_archive_camp_ops_created_idx
  on public.os_docusign_archive_campaign_ops_events(created_at desc);
create index if not exists os_docusign_archive_camp_ops_kind_idx
  on public.os_docusign_archive_campaign_ops_events(event_kind, created_at desc);
create index if not exists os_docusign_archive_camp_ops_camp_idx
  on public.os_docusign_archive_campaign_ops_events(campaign_id, created_at desc);

alter table public.os_docusign_archive_campaign_ops_events
  enable row level security;
drop policy if exists "os_docusign_archive_camp_ops_select"
  on public.os_docusign_archive_campaign_ops_events;
create policy "os_docusign_archive_camp_ops_select"
  on public.os_docusign_archive_campaign_ops_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_docusign_archive_campaigns c
      where c.campaign_id=os_docusign_archive_campaign_ops_events.campaign_id
        and c.entity_id is not null
        and public.can_access_entity(c.entity_id)
    )
  );
revoke all on public.os_docusign_archive_campaign_ops_events
  from public, anon, authenticated;
grant select on public.os_docusign_archive_campaign_ops_events
  to authenticated;

create or replace function public.reject_docusign_phase42_ops_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 42 DocuSign archive campaign ops events are append-only';
end;
$$;
drop trigger if exists os_docusign_archive_camp_ops_immutable
  on public.os_docusign_archive_campaign_ops_events;
create trigger os_docusign_archive_camp_ops_immutable
  before update or delete on public.os_docusign_archive_campaign_ops_events
  for each row execute function public.reject_docusign_phase42_ops_mutation();
drop trigger if exists os_docusign_archive_camp_ops_no_truncate
  on public.os_docusign_archive_campaign_ops_events;
create trigger os_docusign_archive_camp_ops_no_truncate
  before truncate on public.os_docusign_archive_campaign_ops_events
  for each statement execute function public.reject_docusign_phase42_ops_mutation();

create or replace function public.docusign_archive_quarantine_age_bucket(
  p_age_days integer
) returns text
language sql
immutable
parallel safe
as $$
  select case
    when coalesce(p_age_days, 0) <= 7 then '0_7'
    when p_age_days <= 30 then '8_30'
    when p_age_days <= 45 then '31_45'
    else 'over_45'
  end;
$$;

create or replace function public.list_docusign_archive_quarantine_aging_phase42(
  p_limit integer default 25,
  p_entity_id text default null
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select jsonb_agg(to_jsonb(q) order by q.age_days desc, q.opened_at)
    from (
      select
        z.quarantine_id,
        z.manifest_id,
        z.envelope_id,
        z.document_id,
        z.entity_id,
        z.file_kind,
        z.status,
        z.reason_code,
        z.expected_sha256,
        z.observed_sha256,
        z.row_version,
        z.opened_at,
        greatest(
          ceil(extract(epoch from (now() - z.opened_at)) / 86400)::integer,
          0
        ) as age_days,
        public.docusign_archive_quarantine_age_bucket(
          greatest(
            ceil(extract(epoch from (now() - z.opened_at)) / 86400)::integer,
            0
          )
        ) as age_bucket
      from public.os_docusign_archive_quarantine z
      where z.status='manual_review'
        and (p_entity_id is null or z.entity_id is not distinct from p_entity_id)
      order by z.opened_at asc
      limit least(greatest(coalesce(p_limit,25),1),100)
    ) q
  ), '[]'::jsonb);
$$;

create or replace function public.get_docusign_archive_campaign_ops_phase42(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_quarterly_due boolean;
  v_backfill_complete boolean;
  v_aging_breach boolean;
  v_backlog_high boolean;
  v_quarterly_unlocked boolean;
  v_ops_ready boolean;
  v_first_quarterly timestamptz;
  v_last_event timestamptz;
  v_last_full timestamptz;
  v_milestones jsonb;
begin
  v_remaining := public.docusign_archive_remaining_unhashed_count(p_entity_id);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(p_entity_id);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(p_entity_id);
  v_quarterly_due := public.is_docusign_quarterly_full_integrity_due();
  v_backfill_complete := v_remaining <= 0;
  v_aging_breach := v_oldest > 45;
  v_backlog_high := v_quarantine > 25;
  v_quarterly_unlocked :=
    v_backfill_complete and not v_aging_breach and not v_backlog_high;
  v_ops_ready := v_backfill_complete and not v_aging_breach;

  select min(e.created_at) into v_first_quarterly
  from public.os_docusign_archive_campaign_ops_events e
  where e.event_kind in ('quarterly_first_milestone','quarterly_completed');

  select max(e.created_at) into v_last_event
  from public.os_docusign_archive_campaign_ops_events e;

  select max(r.completed_at) into v_last_full
  from public.os_docusign_archive_governance_runs r
  where r.run_kind='integrity_scan' and r.scan_mode='full'
    and r.status in ('completed','partial');

  select coalesce(jsonb_agg(to_jsonb(m) order by m.created_at desc), '[]'::jsonb)
  into v_milestones
  from (
    select event_id, event_key, event_kind, campaign_id, campaign_kind,
      gate_reason, remaining_unhashed, quarantine_backlog,
      quarantine_oldest_days, progress_pct, evidence_sha256, created_at
    from public.os_docusign_archive_campaign_ops_events
    order by created_at desc
    limit 12
  ) m;

  return jsonb_build_object(
    'contract_version', 'phase42-v1',
    'readiness', jsonb_build_object(
      'backfill_complete', v_backfill_complete,
      'quarterly_unlocked', v_quarterly_unlocked,
      'ops_ready', v_ops_ready,
      'quarantine_aging_breach', v_aging_breach,
      'quarantine_backlog_high', v_backlog_high,
      'remaining_unhashed', v_remaining,
      'quarantine_backlog', v_quarantine,
      'quarantine_oldest_days', v_oldest,
      'quarterly_full_due', v_quarterly_due,
      'aging_sla_days', 45,
      'quarantine_backlog_gate', 25,
      'first_quarterly_milestone_at', v_first_quarterly,
      'last_ops_event_at', v_last_event,
      'last_full_scan_at', v_last_full
    ),
    'milestones', v_milestones,
    'aging_queue', public.list_docusign_archive_quarantine_aging_phase42(12, p_entity_id)
  );
end;
$$;

create or replace function public.record_docusign_campaign_ops_milestone_phase42(
  p_event_kind text,
  p_campaign_id uuid default null,
  p_campaign_kind text default null,
  p_gate_reason text default null,
  p_remaining_unhashed integer default null,
  p_quarantine_backlog integer default null,
  p_quarantine_oldest_days integer default null,
  p_progress_pct numeric default null,
  p_recorded_by uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := nullif(trim(p_event_kind), '');
  v_camp public.os_docusign_archive_campaigns%rowtype;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_pct numeric;
  v_campaign_kind text;
  v_key text;
  v_hash text;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_existing public.os_docusign_archive_campaign_ops_events%rowtype;
  v_first_quarterly boolean := false;
  v_row public.os_docusign_archive_campaign_ops_events%rowtype;
begin
  if v_kind is null or v_kind not in (
       'backfill_completed',
       'backfill_gate_cleared',
       'quarterly_first_milestone',
       'quarterly_completed',
       'campaign_gated',
       'quarantine_aging_breach',
       'quarantine_aged_cleared'
     )
     or not public.phase42_docusign_ops_safe_metadata(v_meta) then
    raise exception 'Invalid Phase 42 DocuSign campaign ops milestone';
  end if;

  if p_campaign_id is not null then
    select * into v_camp
    from public.os_docusign_archive_campaigns
    where campaign_id=p_campaign_id;
    if not found then
      raise exception 'Phase 42 ops milestone requires a known campaign_id';
    end if;
    v_campaign_kind := v_camp.campaign_kind;
  else
    v_campaign_kind := nullif(trim(coalesce(p_campaign_kind,'')), '');
  end if;

  if p_remaining_unhashed is not null then
    v_remaining := p_remaining_unhashed;
  elsif p_campaign_id is not null then
    v_remaining := public.docusign_archive_remaining_unhashed_count(v_camp.entity_id);
  else
    v_remaining := public.docusign_archive_remaining_unhashed_count(null);
  end if;

  if p_quarantine_backlog is not null then
    v_quarantine := p_quarantine_backlog;
  elsif p_campaign_id is not null then
    v_quarantine := public.docusign_archive_quarantine_backlog_count(v_camp.entity_id);
  else
    v_quarantine := public.docusign_archive_quarantine_backlog_count(null);
  end if;

  if p_quarantine_oldest_days is not null then
    v_oldest := p_quarantine_oldest_days;
  elsif p_campaign_id is not null then
    v_oldest := public.docusign_archive_quarantine_oldest_age_days(v_camp.entity_id);
  else
    v_oldest := public.docusign_archive_quarantine_oldest_age_days(null);
  end if;

  if p_progress_pct is not null then
    v_pct := p_progress_pct;
  elsif p_campaign_id is not null then
    v_pct := v_camp.progress_pct;
  else
    v_pct := 0;
  end if;

  if v_kind='quarterly_completed'
     and not exists (
       select 1 from public.os_docusign_archive_campaign_ops_events e
       where e.event_kind in ('quarterly_first_milestone','quarterly_completed')
     ) then
    v_first_quarterly := true;
    v_kind := 'quarterly_first_milestone';
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'phase42:ops:'||v_kind||':'||coalesce(p_campaign_id::text,'none')
      ||':'||coalesce(to_char(date_trunc('day', now() at time zone 'utc'),
        'YYYYMMDD'),'')
  );

  select * into v_existing
  from public.os_docusign_archive_campaign_ops_events
  where event_key=v_key;
  if found then
    return jsonb_build_object(
      'disposition','already_recorded',
      'event_id',v_existing.event_id,
      'event_key',v_existing.event_key,
      'event_kind',v_existing.event_kind,
      'evidence_sha256',v_existing.evidence_sha256);
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase42-v1',
    'event_kind',v_kind,
    'event_key',v_key,
    'campaign_id',p_campaign_id,
    'campaign_kind',v_campaign_kind,
    'gate_reason',left(coalesce(p_gate_reason,''),100),
    'remaining',v_remaining,
    'quarantine',v_quarantine,
    'oldest_days',v_oldest,
    'progress_pct',v_pct,
    'first_quarterly',v_first_quarterly,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_archive_campaign_ops_events(
    event_key,event_kind,campaign_id,campaign_kind,gate_reason,
    remaining_unhashed,quarantine_backlog,quarantine_oldest_days,
    progress_pct,metadata,evidence_sha256,recorded_by)
  values(
    v_key,v_kind,p_campaign_id,v_campaign_kind,
    left(nullif(trim(p_gate_reason),''),100),
    v_remaining,v_quarantine,v_oldest,v_pct,v_meta,v_hash,p_recorded_by)
  on conflict(event_key) do nothing
  returning * into v_row;

  if v_row.event_id is null then
    select * into v_row
    from public.os_docusign_archive_campaign_ops_events
    where event_key=v_key;
  end if;

  return jsonb_build_object(
    'disposition','recorded',
    'event_id',v_row.event_id,
    'event_key',v_row.event_key,
    'event_kind',v_row.event_kind,
    'evidence_sha256',v_row.evidence_sha256,
    'first_quarterly_milestone',v_first_quarterly,
    'remaining_unhashed',v_row.remaining_unhashed,
    'quarantine_backlog',v_row.quarantine_backlog,
    'quarantine_oldest_days',v_row.quarantine_oldest_days);
end;
$$;

revoke all on function public.reject_docusign_phase42_ops_mutation()
  from public, anon, authenticated;
revoke all on function public.record_docusign_campaign_ops_milestone_phase42(
  text,uuid,text,text,integer,integer,integer,numeric,uuid,jsonb,text)
  from public, anon, authenticated;
revoke all on function public.get_docusign_archive_campaign_ops_phase42(text)
  from public, anon;
revoke all on function public.list_docusign_archive_quarantine_aging_phase42(
  integer,text)
  from public, anon;

grant execute on function public.phase42_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.docusign_archive_quarantine_age_bucket(integer)
  to authenticated, service_role;
grant execute on function public.list_docusign_archive_quarantine_aging_phase42(
  integer,text)
  to authenticated, service_role;
grant execute on function public.get_docusign_archive_campaign_ops_phase42(text)
  to authenticated, service_role;
grant execute on function public.record_docusign_campaign_ops_milestone_phase42(
  text,uuid,text,text,integer,integer,integer,numeric,uuid,jsonb,text)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
