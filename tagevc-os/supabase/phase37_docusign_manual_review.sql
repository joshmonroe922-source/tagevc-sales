-- Phase 37: two-actor, evidence-bound resolution for ambiguous DocuSign sends.
-- Resolution never creates or resends an envelope.

alter table public.os_docusign_send_intents
  add column if not exists row_version bigint not null default 0,
  add column if not exists resolution_id uuid,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolution_disposition text,
  add column if not exists resolution_evidence_sha256 text;
alter table public.os_docusign_send_intents
  drop constraint if exists os_docusign_resolution_disposition_check;
alter table public.os_docusign_send_intents
  add constraint os_docusign_resolution_disposition_check check (
    resolution_disposition is null or resolution_disposition in
      ('candidate_finalized','intent_cancelled')
  );

create table if not exists public.os_docusign_manual_review_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.os_docusign_send_intents(intent_id),
  entity_id text references public.entities(entity_id),
  decision text not null,
  status text not null default 'awaiting_review',
  candidate_envelope_id text,
  candidate_provider_status text,
  provider_evidence jsonb not null,
  evidence_sha256 text not null,
  proposed_intent_version bigint not null,
  proposed_by uuid not null,
  proposed_reason text not null,
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  reviewed_by uuid,
  reviewer_statement text,
  reviewer_provider_evidence jsonb,
  reviewer_evidence_sha256 text,
  reviewed_at timestamptz,
  row_version bigint not null default 0,
  constraint os_docusign_resolution_decision_check
    check (decision in ('finalize_candidate','cancel_intent')),
  constraint os_docusign_resolution_status_check
    check (status in ('awaiting_review','approved','rejected','expired')),
  constraint os_docusign_resolution_candidate_check check (
    (decision = 'finalize_candidate' and candidate_envelope_id is not null)
    or decision = 'cancel_intent'
  ),
  constraint os_docusign_resolution_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_resolution_actor_check
    check (reviewed_by is null or reviewed_by <> proposed_by)
);
create unique index if not exists os_docusign_one_pending_resolution
  on public.os_docusign_manual_review_resolutions(intent_id)
  where status = 'awaiting_review';
create index if not exists os_docusign_resolution_entity_idx
  on public.os_docusign_manual_review_resolutions(entity_id, proposed_at desc);

create table if not exists public.os_docusign_manual_review_events (
  event_id uuid primary key default gen_random_uuid(),
  resolution_id uuid not null
    references public.os_docusign_manual_review_resolutions(resolution_id),
  intent_id uuid not null references public.os_docusign_send_intents(intent_id),
  entity_id text references public.entities(entity_id),
  event_type text not null,
  actor_id uuid not null,
  from_status text,
  to_status text not null,
  evidence_sha256 text not null,
  intent_version bigint not null,
  resolution_version bigint not null,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint os_docusign_manual_event_type_check check (
    event_type in ('proposal_created','review_approved','review_rejected',
      'proposal_expired','candidate_finalized','intent_cancelled',
      'projection_conflict')
  )
);

alter table public.os_docusign_manual_review_resolutions enable row level security;
alter table public.os_docusign_manual_review_events enable row level security;
drop policy if exists "os_docusign_resolution_select"
  on public.os_docusign_manual_review_resolutions;
drop policy if exists "os_docusign_manual_event_select"
  on public.os_docusign_manual_review_events;
create policy "os_docusign_resolution_select"
  on public.os_docusign_manual_review_resolutions for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_docusign_manual_event_select"
  on public.os_docusign_manual_review_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
revoke select on public.os_docusign_manual_review_resolutions
  from authenticated;
grant select (
  resolution_id,intent_id,entity_id,decision,status,candidate_envelope_id,
  candidate_provider_status,evidence_sha256,proposed_intent_version,
  proposed_by,proposed_reason,proposed_at,expires_at,reviewed_by,
  reviewer_statement,reviewed_at,row_version
) on public.os_docusign_manual_review_resolutions to authenticated;
grant select on public.os_docusign_manual_review_events to authenticated;

drop index if exists public.os_docusign_active_document_send_unique;
do $$
begin
  if exists (
    select 1 from public.os_docusign_send_intents
    where operation_kind='document_send' and doc_id is not null and (
      state in ('prepared','dispatching','provider_unknown','retry_wait',
        'recovering','finalized','manual_review')
      or (state='cancelled' and dispatch_attempts>0))
    group by doc_id having count(*)>1
  ) then raise exception 'Duplicate document-send tombstones require review'; end if;
  if exists (
    select 1 from public.os_docusign_send_intents
    where operation_kind='replacement' and source_envelope_id is not null and (
      state in ('prepared','dispatching','provider_unknown','retry_wait',
        'recovering','finalized','manual_review')
      or (state='cancelled' and dispatch_attempts>0))
    group by source_envelope_id having count(*)>1
  ) then raise exception 'Duplicate replacement tombstones require review'; end if;
end;
$$;
create unique index if not exists os_docusign_document_send_tombstone
  on public.os_docusign_send_intents(doc_id)
  where operation_kind = 'document_send' and (
    state in ('prepared','dispatching','provider_unknown','retry_wait',
      'recovering','finalized','manual_review')
    or (state = 'cancelled' and dispatch_attempts > 0)
  );
create unique index if not exists os_docusign_replacement_send_tombstone
  on public.os_docusign_send_intents(source_envelope_id)
  where operation_kind = 'replacement' and (
    state in ('prepared','dispatching','provider_unknown','retry_wait',
      'recovering','finalized','manual_review')
    or (state = 'cancelled' and dispatch_attempts > 0)
  );

create or replace function public.sync_docusign_replacement_lineage()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_lineage public.os_docusign_envelope_lineage%rowtype;
begin
  if new.operation_kind <> 'replacement' or new.state = old.state then
    return new;
  end if;
  if new.state = 'finalized' then
    update public.os_docusign_envelope_lineage set
      replacement_envelope_id = new.provider_envelope_id,
      status = 'created', error = null, created_at = coalesce(created_at,now()),
      updated_at = now()
    where send_intent_id = new.intent_id
      and status in ('requested','manual_review')
    returning * into v_lineage;
    if not found then
      raise exception 'Replacement lineage finalization conflict';
    end if;
    insert into public.os_docusign_events (
      event_id,envelope_id,status,event_type,doc_id,entity_id,raw_payload,
      dedupe_key,source,processing_status,processed_at,send_intent_id
    ) values
      ('replacement-created-'||new.intent_id::text,new.provider_envelope_id,
       coalesce(new.provider_status,'sent'),'envelope-replacement-created',
       v_lineage.source_doc_id,v_lineage.entity_id,
       jsonb_build_object('source_envelope_id',v_lineage.source_envelope_id,
         'lineage_id',v_lineage.lineage_id),
       'send:'||new.intent_id::text||':replacement-created',
       'transactional_send','recorded',now(),new.intent_id),
      ('replacement-source-'||new.intent_id::text,v_lineage.source_envelope_id,
       'replaced','envelope-replaced',v_lineage.source_doc_id,v_lineage.entity_id,
       jsonb_build_object('replacement_envelope_id',new.provider_envelope_id,
         'lineage_id',v_lineage.lineage_id),
       'send:'||new.intent_id::text||':source-replaced',
       'transactional_send','recorded',now(),new.intent_id)
    on conflict (event_id) do nothing;
  elsif new.state = 'failed' then
    update public.os_docusign_envelope_lineage set
      status='failed',error=new.last_error_message,updated_at=now()
    where send_intent_id=new.intent_id
      and status in ('requested','manual_review');
  elsif new.state = 'manual_review' then
    update public.os_docusign_envelope_lineage set
      status='manual_review',error=new.manual_review_reason,updated_at=now()
    where send_intent_id=new.intent_id and status='requested';
  elsif new.state = 'cancelled' then
    update public.os_docusign_envelope_lineage set
      status='cancelled',
      error=case when old.state='manual_review'
        then 'Ambiguous replacement closed locally; resend blocked'
        else 'Send intent expired before dispatch' end,
      updated_at=now()
    where send_intent_id=new.intent_id
      and status in ('requested','manual_review');
  end if;
  return new;
end;
$$;

create or replace function public.expire_docusign_manual_reviews()
returns integer
language plpgsql security definer set search_path = public
as $$
declare v_count integer;
begin
  with expired as (
    update public.os_docusign_manual_review_resolutions set
      status = 'expired', row_version = row_version + 1
    where status = 'awaiting_review' and expires_at <= now()
    returning *
  ), events as (
    insert into public.os_docusign_manual_review_events (
      resolution_id, intent_id, entity_id, event_type, actor_id,
      from_status, to_status, evidence_sha256, intent_version,
      resolution_version, reason
    )
    select e.resolution_id, e.intent_id, e.entity_id, 'proposal_expired',
      e.proposed_by, 'awaiting_review', 'expired', e.evidence_sha256,
      e.proposed_intent_version, e.row_version,
      'Manual-review proposal expired before independent review'
    from expired e returning 1
  )
  select count(*) into v_count from events;
  return v_count;
end;
$$;

create or replace function public.propose_docusign_manual_review_resolution(
  p_intent_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_candidate_envelope_id text,
  p_provider_evidence jsonb,
  p_reason text,
  p_expected_intent_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := p_actor_id;
  v_intent public.os_docusign_send_intents%rowtype;
  v_resolution public.os_docusign_manual_review_resolutions%rowtype;
  v_hash text;
  v_candidate jsonb;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
      and p.role in ('visionary','admin','counsel_ops')
  ) then raise exception 'Manual-review resolution permission denied'; end if;
  perform public.expire_docusign_manual_reviews();
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found or v_intent.state <> 'manual_review'
     or v_intent.row_version <> p_expected_intent_version then
    raise exception 'Intent state, version, or entity access changed';
  end if;
  if p_decision not in ('finalize_candidate','cancel_intent')
     or length(trim(coalesce(p_reason,''))) < 20
     or p_provider_evidence->>'evidence_version' <> 'phase37-v1'
     or p_provider_evidence->>'provider_transaction_id'
       <> v_intent.provider_transaction_id
     or jsonb_typeof(p_provider_evidence->'candidates') <> 'array'
     or jsonb_array_length(p_provider_evidence->'candidates') > 20
     or coalesce((p_provider_evidence->>'truncated')::boolean,true)
     or coalesce((p_provider_evidence->>'total_candidates')::integer,-1)
       <> jsonb_array_length(p_provider_evidence->'candidates')
     or (p_provider_evidence->>'observed_at')::timestamptz
       not between now()-interval '15 minutes' and now()+interval '2 minutes'
     or (select count(*) from jsonb_array_elements(
       p_provider_evidence->'candidates')) <>
       (select count(distinct value->>'envelope_id')
        from jsonb_array_elements(p_provider_evidence->'candidates')) then
    raise exception 'Manual-review proposal evidence is invalid';
  end if;
  if p_decision = 'finalize_candidate' then
    select value into v_candidate
    from jsonb_array_elements(p_provider_evidence->'candidates')
    where value->>'envelope_id' = p_candidate_envelope_id
    limit 1;
    if v_candidate is null
       or v_candidate->'custom_fields'->>'tagevc_send_intent_id'
         <> v_intent.intent_id::text
       or v_candidate->'custom_fields'->>'tagevc_operation_kind'
         <> v_intent.operation_kind
       or (v_candidate->'custom_fields'->>'tagevc_provider_transaction_id'
         is not null and
         v_candidate->'custom_fields'->>'tagevc_provider_transaction_id'
           is distinct from v_intent.provider_transaction_id)
       or v_candidate->'custom_fields'->>'tagevc_entity_id'
         <> coalesce(v_intent.entity_id,'firm')
       or (v_intent.doc_id is not null
         and v_candidate->'custom_fields'->>'tagevc_doc_id' is not null
         and v_candidate->'custom_fields'->>'tagevc_doc_id'
           is distinct from v_intent.doc_id)
       or nullif(v_candidate->>'provider_status','') is null then
      raise exception 'Selected candidate does not match hidden intent evidence';
    end if;
  end if;
  v_hash := encode(digest(
    (p_provider_evidence - 'observed_at')::text, 'sha256'), 'hex');
  insert into public.os_docusign_manual_review_resolutions (
    intent_id, entity_id, decision, candidate_envelope_id,
    candidate_provider_status, provider_evidence, evidence_sha256,
    proposed_intent_version, proposed_by, proposed_reason
  ) values (
    v_intent.intent_id, v_intent.entity_id, p_decision,
    nullif(trim(p_candidate_envelope_id),''),
    v_candidate->>'provider_status', p_provider_evidence, v_hash,
    v_intent.row_version, v_actor, trim(p_reason)
  ) returning * into v_resolution;
  update public.os_docusign_send_intents set
    row_version = row_version + 1, updated_at = now()
  where intent_id = v_intent.intent_id;
  insert into public.os_docusign_manual_review_events (
    resolution_id, intent_id, entity_id, event_type, actor_id,
    from_status, to_status, evidence_sha256, intent_version,
    resolution_version, reason
  ) values (
    v_resolution.resolution_id, v_intent.intent_id, v_intent.entity_id,
    'proposal_created', v_actor, null, 'awaiting_review', v_hash,
    v_intent.row_version + 1, 0, trim(p_reason)
  );
  return jsonb_build_object('resolution_id', v_resolution.resolution_id,
    'status', 'awaiting_review', 'evidence_sha256', v_hash,
    'intent_version', v_intent.row_version + 1);
end;
$$;

create or replace function public.review_docusign_manual_review_resolution(
  p_resolution_id uuid,
  p_actor_id uuid,
  p_review_decision text,
  p_provider_evidence jsonb,
  p_statement text,
  p_expected_resolution_version bigint,
  p_expected_intent_version bigint
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_actor uuid := p_actor_id;
  v_resolution public.os_docusign_manual_review_resolutions%rowtype;
  v_intent public.os_docusign_send_intents%rowtype;
  v_existing record;
  v_hash text;
  v_event_type text;
begin
  if v_actor is null or not exists (
    select 1 from public.profiles p where p.id = v_actor and p.active
      and p.role in ('visionary','admin','counsel_ops')
  ) then raise exception 'Manual-review resolution permission denied'; end if;
  select * into v_resolution
  from public.os_docusign_manual_review_resolutions
  where resolution_id = p_resolution_id for update;
  if not found then raise exception 'Manual-review proposal not found'; end if;
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = v_resolution.intent_id for update;
  if v_resolution.status <> 'awaiting_review'
     or v_resolution.expires_at <= now()
     or v_resolution.proposed_by = v_actor
     or v_resolution.row_version <> p_expected_resolution_version
     or v_intent.state <> 'manual_review'
     or v_intent.row_version <> p_expected_intent_version
     or length(trim(coalesce(p_statement,''))) < 20
     or p_review_decision not in ('approve','reject') then
    raise exception 'Proposal review actor, state, version, expiry, or access changed';
  end if;
  v_hash := encode(digest(
    (p_provider_evidence - 'observed_at')::text, 'sha256'), 'hex');
  if p_provider_evidence->>'evidence_version' <> 'phase37-v1'
     or p_provider_evidence->>'provider_transaction_id'
       <> v_intent.provider_transaction_id
     or (p_provider_evidence->>'observed_at')::timestamptz
       not between now()-interval '15 minutes' and now()+interval '2 minutes'
     or v_hash <> v_resolution.evidence_sha256 then
    raise exception 'Fresh provider evidence no longer matches the proposal';
  end if;
  if p_review_decision = 'reject' then
    update public.os_docusign_manual_review_resolutions set
      status = 'rejected', reviewed_by = v_actor,
      reviewer_statement = trim(p_statement), reviewed_at = now(),
      reviewer_provider_evidence = p_provider_evidence,
      reviewer_evidence_sha256 = v_hash,
      row_version = row_version + 1
    where resolution_id = p_resolution_id;
    update public.os_docusign_send_intents set
      row_version = row_version + 1, updated_at = now()
    where intent_id = v_intent.intent_id;
    v_event_type := 'review_rejected';
  elsif v_resolution.decision = 'cancel_intent' then
    update public.os_docusign_send_intents set
      state = 'cancelled', resolution_id = p_resolution_id,
      resolved_at = now(), resolved_by = v_actor,
      resolution_disposition = 'intent_cancelled',
      resolution_evidence_sha256 = v_hash,
      lease_token = null, lease_expires_at = null, worker_id = null,
      next_recovery_at = null, row_version = row_version + 1, updated_at = now()
    where intent_id = v_intent.intent_id;
    update public.os_docusign_envelope_lineage set
      status = 'cancelled',
      error = 'Ambiguous replacement closed by two-actor review; resend blocked',
      updated_at = now()
    where send_intent_id = v_intent.intent_id
      and status in ('requested','manual_review');
    v_event_type := 'intent_cancelled';
  else
    select send_intent_id, entity_id, doc_id into v_existing
    from public.os_docusign_envelopes
    where envelope_id = v_resolution.candidate_envelope_id for update;
    if found and (
      v_existing.send_intent_id is distinct from v_intent.intent_id
      or v_existing.entity_id is distinct from v_intent.entity_id
      or v_existing.doc_id is distinct from v_intent.doc_id
    ) then
      raise exception 'Candidate envelope projection conflicts with the intent';
    end if;
    update public.os_docusign_send_intents set
      state = 'finalized',
      provider_envelope_id = v_resolution.candidate_envelope_id,
      provider_status = v_resolution.candidate_provider_status,
      provider_observed_at = now(), finalized_at = now(),
      resolution_id = p_resolution_id, resolved_at = now(),
      resolved_by = v_actor, resolution_disposition = 'candidate_finalized',
      resolution_evidence_sha256 = v_hash,
      lease_token = null, lease_expires_at = null, worker_id = null,
      next_recovery_at = null, row_version = row_version + 1, updated_at = now()
    where intent_id = v_intent.intent_id;
    insert into public.os_docusign_envelopes (
      envelope_id, operation_kind, doc_id, entity_id, lineage_id,
      send_intent_id, provider_transaction_id, expected_provider_status,
      provider_status, provider_observed_at, reconciliation_state,
      issue_code, last_reconciled_at, updated_at
    ) values (
      v_resolution.candidate_envelope_id, v_intent.operation_kind,
      v_intent.doc_id, v_intent.entity_id,
      (select lineage_id from public.os_docusign_envelope_lineage
        where send_intent_id = v_intent.intent_id),
      v_intent.intent_id, v_intent.provider_transaction_id,
      v_intent.expected_provider_status, v_resolution.candidate_provider_status,
      now(), 'in_sync', null, now(), now()
    ) on conflict (envelope_id) do update set
      provider_status = excluded.provider_status,
      provider_observed_at = excluded.provider_observed_at,
      reconciliation_state = 'in_sync', issue_code = null,
      last_reconciled_at = now(), updated_at = now();
    if v_intent.operation_kind = 'document_send' then
      update public.os_documents set
        envelope_id = v_resolution.candidate_envelope_id,
        status = 'Sent', sent_at = coalesce(sent_at,now()),
        sent_by = v_actor::text, updated_at = now()
      where doc_id = v_intent.doc_id
        and entity_id is not distinct from v_intent.entity_id
        and (envelope_id is null
          or envelope_id = v_resolution.candidate_envelope_id);
      if not found then raise exception 'Document finalization conflict'; end if;
    end if;
    update public.os_docusign_envelope_lineage set
      replacement_envelope_id = v_resolution.candidate_envelope_id,
      status = 'created', error = null, created_at = coalesce(created_at,now()),
      updated_at = now()
    where send_intent_id = v_intent.intent_id
      and status in ('requested','manual_review');
    v_event_type := 'candidate_finalized';
  end if;
  if p_review_decision = 'approve' then
    update public.os_docusign_manual_review_resolutions set
      status = 'approved', reviewed_by = v_actor,
      reviewer_statement = trim(p_statement), reviewed_at = now(),
      reviewer_provider_evidence = p_provider_evidence,
      reviewer_evidence_sha256 = v_hash,
      row_version = row_version + 1
    where resolution_id = p_resolution_id;
  end if;
  insert into public.os_docusign_manual_review_events (
    resolution_id, intent_id, entity_id, event_type, actor_id,
    from_status, to_status, evidence_sha256, intent_version,
    resolution_version, reason
  ) values (
    p_resolution_id, v_intent.intent_id, v_intent.entity_id, v_event_type,
    v_actor, 'awaiting_review',
    case when p_review_decision = 'reject' then 'rejected' else 'approved' end,
    v_hash, v_intent.row_version + 1, v_resolution.row_version + 1,
    trim(p_statement)
  );
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source, actor_id, evidence
  ) values (
    v_intent.intent_id,
    v_intent.intent_id::text || ':manual-resolution:' || p_resolution_id::text,
    'manual_review',
    case when p_review_decision = 'reject' then 'manual_review'
      when v_resolution.decision = 'cancel_intent' then 'cancelled'
      else 'finalized' end,
    'manual_review_resolution', v_actor,
    jsonb_build_object('resolution_id', p_resolution_id,
      'decision', v_resolution.decision, 'review_decision', p_review_decision,
      'evidence_sha256', v_hash)
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('resolution_id', p_resolution_id,
    'status', case when p_review_decision = 'reject'
      then 'rejected' else 'approved' end,
    'intent_state', case when p_review_decision = 'reject' then 'manual_review'
      when v_resolution.decision = 'cancel_intent' then 'cancelled'
      else 'finalized' end);
end;
$$;

revoke all on function public.expire_docusign_manual_reviews()
  from public, authenticated;
grant execute on function public.expire_docusign_manual_reviews()
  to service_role;
revoke all on function public.propose_docusign_manual_review_resolution(uuid,uuid,text,text,jsonb,text,bigint)
  from public,authenticated;
revoke all on function public.review_docusign_manual_review_resolution(uuid,uuid,text,jsonb,text,bigint,bigint)
  from public,authenticated;
grant execute on function public.propose_docusign_manual_review_resolution(uuid,uuid,text,text,jsonb,text,bigint)
  to service_role;
grant execute on function public.review_docusign_manual_review_resolution(uuid,uuid,text,jsonb,text,bigint,bigint)
  to service_role;
