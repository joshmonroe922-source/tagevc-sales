-- Phase 43: DocuSign first quarterly gated ops.
-- Depends on phase42_docusign_campaign_ops.sql.
-- Unlock when backfill remaining=0 and quarantine aging/backlog clear.
-- Runbook evidence + CTA eligibility. Never create/void/resend envelopes.
-- Evidence = digests/metadata only. Safe to re-run.

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
  -- Bootstrap if Phase 42 DocuSign SQL was not applied yet.
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

create or replace function public.phase43_docusign_runbook_safe_metadata(p_detail jsonb)
returns boolean
language sql
immutable
parallel safe
as $$
  select public.phase42_docusign_ops_safe_metadata(p_detail);
$$;

create table if not exists public.os_docusign_first_quarterly_runbook_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  evidence_key text not null unique,
  step_kind text not null,
  remaining_unhashed integer not null default 0,
  quarantine_backlog integer not null default 0,
  quarantine_oldest_days integer not null default 0,
  gates_unlocked boolean not null default false,
  cta_eligible boolean not null default false,
  campaign_id uuid
    references public.os_docusign_archive_campaigns(campaign_id),
  metadata jsonb not null default '{}'::jsonb,
  evidence_sha256 text not null,
  recorded_by uuid,
  created_at timestamptz not null default now(),
  constraint os_docusign_fq_runbook_step_check
    check (step_kind in (
      'gates_evaluated',
      'unlock_recorded',
      'runbook_ack',
      'first_quarterly_started',
      'first_quarterly_completed'
    )),
  constraint os_docusign_fq_runbook_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_fq_runbook_meta_check
    check (
      jsonb_typeof(metadata)='object'
      and public.phase43_docusign_runbook_safe_metadata(metadata)
    )
);
create index if not exists os_docusign_fq_runbook_created_idx
  on public.os_docusign_first_quarterly_runbook_evidence(created_at desc);
create index if not exists os_docusign_fq_runbook_step_idx
  on public.os_docusign_first_quarterly_runbook_evidence(step_kind, created_at desc);
create index if not exists os_docusign_fq_runbook_camp_idx
  on public.os_docusign_first_quarterly_runbook_evidence(campaign_id, created_at desc);

alter table public.os_docusign_first_quarterly_runbook_evidence
  enable row level security;
drop policy if exists "os_docusign_fq_runbook_select"
  on public.os_docusign_first_quarterly_runbook_evidence;
create policy "os_docusign_fq_runbook_select"
  on public.os_docusign_first_quarterly_runbook_evidence for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_docusign_archive_campaigns c
      where c.campaign_id=os_docusign_first_quarterly_runbook_evidence.campaign_id
        and c.entity_id is not null
        and public.can_access_entity(c.entity_id)
    )
  );
revoke all on public.os_docusign_first_quarterly_runbook_evidence
  from public, anon, authenticated;
grant select on public.os_docusign_first_quarterly_runbook_evidence
  to authenticated;

create or replace function public.reject_docusign_phase43_runbook_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 43 DocuSign first quarterly runbook evidence is append-only';
end;
$$;
drop trigger if exists os_docusign_fq_runbook_immutable
  on public.os_docusign_first_quarterly_runbook_evidence;
create trigger os_docusign_fq_runbook_immutable
  before update or delete on public.os_docusign_first_quarterly_runbook_evidence
  for each row execute function public.reject_docusign_phase43_runbook_mutation();
drop trigger if exists os_docusign_fq_runbook_no_truncate
  on public.os_docusign_first_quarterly_runbook_evidence;
create trigger os_docusign_fq_runbook_no_truncate
  before truncate on public.os_docusign_first_quarterly_runbook_evidence
  for each statement execute function public.reject_docusign_phase43_runbook_mutation();

create or replace function public.evaluate_docusign_first_quarterly_gates_phase43(
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
  v_aging_ok boolean;
  v_backlog_ok boolean;
  v_unlocked boolean;
  v_first_done boolean;
  v_first_at timestamptz;
  v_cta_eligible boolean;
  v_unlock_recorded boolean;
  v_runbook_ack boolean;
begin
  v_remaining := public.docusign_archive_remaining_unhashed_count(p_entity_id);
  v_quarantine := public.docusign_archive_quarantine_backlog_count(p_entity_id);
  v_oldest := public.docusign_archive_quarantine_oldest_age_days(p_entity_id);
  v_quarterly_due := public.is_docusign_quarterly_full_integrity_due();
  v_backfill_complete := v_remaining <= 0;
  v_aging_ok := v_oldest <= 45;
  v_backlog_ok := v_quarantine <= 25;
  v_unlocked := v_backfill_complete and v_aging_ok and v_backlog_ok;

  select min(e.created_at) into v_first_at
  from public.os_docusign_archive_campaign_ops_events e
  where e.event_kind in ('quarterly_first_milestone','quarterly_completed');
  v_first_done := v_first_at is not null;

  select exists (
    select 1 from public.os_docusign_first_quarterly_runbook_evidence r
    where r.step_kind='unlock_recorded' and r.gates_unlocked
  ) into v_unlock_recorded;

  select exists (
    select 1 from public.os_docusign_first_quarterly_runbook_evidence r
    where r.step_kind='runbook_ack'
  ) into v_runbook_ack;

  v_cta_eligible := v_unlocked and not v_first_done;

  return jsonb_build_object(
    'contract_version', 'phase43-v1',
    'remaining_unhashed', v_remaining,
    'quarantine_backlog', v_quarantine,
    'quarantine_oldest_days', v_oldest,
    'aging_sla_days', 45,
    'quarantine_backlog_gate', 25,
    'backfill_complete', v_backfill_complete,
    'quarantine_aged', v_aging_ok,
    'quarantine_backlog_ok', v_backlog_ok,
    'quarterly_unlocked', v_unlocked,
    'quarterly_full_due', v_quarterly_due,
    'first_quarterly_completed', v_first_done,
    'first_quarterly_milestone_at', v_first_at,
    'unlock_recorded', v_unlock_recorded,
    'runbook_ack_recorded', v_runbook_ack,
    'cta_eligible', v_cta_eligible
  );
end;
$$;

create or replace function public.record_docusign_first_quarterly_runbook_phase43(
  p_step_kind text,
  p_campaign_id uuid default null,
  p_recorded_by uuid default null,
  p_metadata jsonb default '{}'::jsonb,
  p_idempotency_key text default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := nullif(trim(p_step_kind), '');
  v_gates jsonb;
  v_unlocked boolean;
  v_cta boolean;
  v_remaining integer;
  v_quarantine integer;
  v_oldest integer;
  v_key text;
  v_hash text;
  v_meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  v_existing public.os_docusign_first_quarterly_runbook_evidence%rowtype;
  v_row public.os_docusign_first_quarterly_runbook_evidence%rowtype;
  v_camp public.os_docusign_archive_campaigns%rowtype;
begin
  if v_kind is null or v_kind not in (
       'gates_evaluated',
       'unlock_recorded',
       'runbook_ack',
       'first_quarterly_started',
       'first_quarterly_completed'
     )
     or not public.phase43_docusign_runbook_safe_metadata(v_meta) then
    raise exception 'Invalid Phase 43 DocuSign first quarterly runbook step';
  end if;

  if p_campaign_id is not null then
    select * into v_camp
    from public.os_docusign_archive_campaigns
    where campaign_id=p_campaign_id;
    if not found then
      raise exception 'Phase 43 runbook requires a known campaign_id';
    end if;
  end if;

  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(p_entity_id);
  v_unlocked := coalesce((v_gates->>'quarterly_unlocked')::boolean, false);
  v_cta := coalesce((v_gates->>'cta_eligible')::boolean, false);
  v_remaining := coalesce((v_gates->>'remaining_unhashed')::integer, 0);
  v_quarantine := coalesce((v_gates->>'quarantine_backlog')::integer, 0);
  v_oldest := coalesce((v_gates->>'quarantine_oldest_days')::integer, 0);

  if v_kind='unlock_recorded' and not v_unlocked then
    raise exception 'Phase 43 unlock_recorded requires backfill=0 and quarantine aged';
  end if;

  if v_kind in ('first_quarterly_started','first_quarterly_completed')
     and not v_unlocked then
    raise exception 'Phase 43 first quarterly runbook requires unlocked gates';
  end if;

  v_key := coalesce(
    nullif(trim(p_idempotency_key), ''),
    'phase43:fq:'||v_kind||':'||coalesce(p_campaign_id::text,'none')
      ||':'||coalesce(to_char(date_trunc('day', now() at time zone 'utc'),
        'YYYYMMDD'),'')
  );

  select * into v_existing
  from public.os_docusign_first_quarterly_runbook_evidence
  where evidence_key=v_key;
  if found then
    return jsonb_build_object(
      'disposition','already_recorded',
      'evidence_id',v_existing.evidence_id,
      'evidence_key',v_existing.evidence_key,
      'step_kind',v_existing.step_kind,
      'gates_unlocked',v_existing.gates_unlocked,
      'cta_eligible',v_existing.cta_eligible,
      'evidence_sha256',v_existing.evidence_sha256);
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase43-v1',
    'step_kind',v_kind,
    'evidence_key',v_key,
    'campaign_id',p_campaign_id,
    'remaining',v_remaining,
    'quarantine',v_quarantine,
    'oldest_days',v_oldest,
    'gates_unlocked',v_unlocked,
    'cta_eligible',v_cta,
    'metadata',v_meta
  )::text);

  insert into public.os_docusign_first_quarterly_runbook_evidence(
    evidence_key,step_kind,remaining_unhashed,quarantine_backlog,
    quarantine_oldest_days,gates_unlocked,cta_eligible,campaign_id,
    metadata,evidence_sha256,recorded_by)
  values(
    v_key,v_kind,v_remaining,v_quarantine,v_oldest,v_unlocked,v_cta,
    p_campaign_id,v_meta,v_hash,p_recorded_by)
  on conflict(evidence_key) do nothing
  returning * into v_row;

  if v_row.evidence_id is null then
    select * into v_row
    from public.os_docusign_first_quarterly_runbook_evidence
    where evidence_key=v_key;
  end if;

  return jsonb_build_object(
    'disposition','recorded',
    'evidence_id',v_row.evidence_id,
    'evidence_key',v_row.evidence_key,
    'step_kind',v_row.step_kind,
    'gates_unlocked',v_row.gates_unlocked,
    'cta_eligible',v_row.cta_eligible,
    'evidence_sha256',v_row.evidence_sha256,
    'remaining_unhashed',v_row.remaining_unhashed,
    'quarantine_backlog',v_row.quarantine_backlog,
    'quarantine_oldest_days',v_row.quarantine_oldest_days);
end;
$$;

create or replace function public.get_docusign_first_quarterly_ops_phase43(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_gates jsonb;
  v_runbook jsonb;
  v_phase42 jsonb;
begin
  v_gates := public.evaluate_docusign_first_quarterly_gates_phase43(p_entity_id);
  v_phase42 := public.get_docusign_archive_campaign_ops_phase42(p_entity_id);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_runbook
  from (
    select evidence_id, evidence_key, step_kind, remaining_unhashed,
      quarantine_backlog, quarantine_oldest_days, gates_unlocked,
      cta_eligible, campaign_id, evidence_sha256, created_at
    from public.os_docusign_first_quarterly_runbook_evidence
    order by created_at desc
    limit 12
  ) r;

  return jsonb_build_object(
    'contract_version', 'phase43-v1',
    'gates', v_gates,
    'cta', jsonb_build_object(
      'eligible', coalesce((v_gates->>'cta_eligible')::boolean, false),
      'label', 'Run first quarterly (gated)',
      'quarterly_unlocked', coalesce((v_gates->>'quarterly_unlocked')::boolean, false),
      'first_quarterly_completed',
        coalesce((v_gates->>'first_quarterly_completed')::boolean, false),
      'quarterly_full_due',
        coalesce((v_gates->>'quarterly_full_due')::boolean, false)
    ),
    'runbook', v_runbook,
    'phase42', jsonb_build_object(
      'contract_version', v_phase42->>'contract_version',
      'readiness', v_phase42->'readiness'
    )
  );
end;
$$;

revoke all on function public.reject_docusign_phase43_runbook_mutation()
  from public, anon, authenticated;
revoke all on function public.record_docusign_first_quarterly_runbook_phase43(
  text,uuid,uuid,jsonb,text,text)
  from public, anon, authenticated;
revoke all on function public.evaluate_docusign_first_quarterly_gates_phase43(text)
  from public, anon;
revoke all on function public.get_docusign_first_quarterly_ops_phase43(text)
  from public, anon;

grant execute on function public.phase42_docusign_ops_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.phase43_docusign_runbook_safe_metadata(jsonb)
  to authenticated, service_role;
grant execute on function public.evaluate_docusign_first_quarterly_gates_phase43(text)
  to authenticated, service_role;
grant execute on function public.get_docusign_first_quarterly_ops_phase43(text)
  to authenticated, service_role;
grant execute on function public.record_docusign_first_quarterly_runbook_phase43(
  text,uuid,uuid,jsonb,text,text)
  to service_role;
grant execute on function public.os_sha256_hex(text)
  to authenticated, service_role;
