-- Phase 36: DocuSign replay safety, replacement intent binding, recovery
-- dispositions, and intent-aware reconciliation evidence.

alter table public.os_docusign_send_intents
  add column if not exists candidate_envelope_id text,
  add column if not exists candidate_provider_status text,
  add column if not exists last_lookup_at timestamptz,
  add column if not exists last_lookup_disposition text,
  add column if not exists manual_review_reason text,
  add column if not exists payload_schema_version integer not null default 1;
alter table public.os_docusign_send_intents
  drop constraint if exists os_docusign_intent_lookup_disposition_check;
alter table public.os_docusign_send_intents
  add constraint os_docusign_intent_lookup_disposition_check check (
    last_lookup_disposition is null or last_lookup_disposition in (
      'exact_match','not_found','multiple_matches','evidence_mismatch',
      'lookup_error','finalization_conflict'
    )
  );

alter table public.os_docusign_envelope_lineage
  add column if not exists send_intent_id uuid
    references public.os_docusign_send_intents(intent_id);
create unique index if not exists os_docusign_lineage_send_intent_unique
  on public.os_docusign_envelope_lineage (send_intent_id)
  where send_intent_id is not null;
alter table public.os_docusign_envelope_lineage
  drop constraint if exists os_docusign_lineage_status_check;
alter table public.os_docusign_envelope_lineage
  add constraint os_docusign_lineage_status_check check (
    status in ('requested','created','failed','reconciled','manual_review','cancelled')
  );
drop index if exists public.os_docusign_lineage_active_source_unique;
create unique index os_docusign_lineage_active_source_unique
  on public.os_docusign_envelope_lineage (source_envelope_id)
  where status in ('requested','created','manual_review');

alter table public.os_docusign_reconciliation_runs
  add column if not exists pages_scanned integer not null default 0,
  add column if not exists truncated boolean not null default false,
  add column if not exists next_start_position integer,
  add column if not exists intents_matched integer not null default 0,
  add column if not exists intent_conflicts integer not null default 0;

drop policy if exists "os_docusign_lineage_select"
  on public.os_docusign_envelope_lineage;
create policy "os_docusign_lineage_select"
  on public.os_docusign_envelope_lineage for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );

create or replace function public.prepare_docusign_send(
  p_request_id uuid,
  p_operation_kind text,
  p_doc_id text,
  p_entity_id text,
  p_template_id text,
  p_source_envelope_id text,
  p_email_subject text,
  p_role_map_sha256 text,
  p_content_sha256 text,
  p_explicit_human_approval boolean,
  p_actor_id uuid
) returns public.os_docusign_send_intents
language plpgsql security definer set search_path = public
as $$
declare
  v_intent public.os_docusign_send_intents%rowtype;
  v_fingerprint text;
  v_doc record;
  v_bound integer;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_request_id::text, 0));
  if p_actor_id is null or not p_explicit_human_approval then
    raise exception 'Actor and explicit human approval are required';
  end if;
  if (p_operation_kind = 'document_send' and
      (p_doc_id is null or p_entity_id is null or p_source_envelope_id is not null))
     or (p_operation_kind = 'template_send' and p_template_id is null)
     or (p_operation_kind = 'replacement' and
      (p_template_id is null or p_source_envelope_id is null))
     or p_operation_kind not in ('document_send','template_send','replacement') then
    raise exception 'Invalid DocuSign operation shape';
  end if;
  if p_operation_kind = 'document_send' then
    select doc_id, entity_id, status, envelope_id into v_doc
    from public.os_documents where doc_id = p_doc_id for update;
    if not found or v_doc.entity_id is distinct from p_entity_id
       or v_doc.envelope_id is not null then
      raise exception 'Document is not eligible for send';
    end if;
  end if;
  v_fingerprint := encode(digest(concat_ws('|', 'phase36-v2',
    p_operation_kind, coalesce(p_doc_id,''), coalesce(p_entity_id,''),
    coalesce(p_template_id,''), coalesce(p_source_envelope_id,''),
    coalesce(p_email_subject,''), coalesce(p_role_map_sha256,''),
    coalesce(p_content_sha256,''), p_explicit_human_approval::text,
    p_actor_id::text), 'sha256'), 'hex');
  select * into v_intent from public.os_docusign_send_intents
  where request_id = p_request_id;
  if found then
    if v_intent.payload_schema_version < 2 then
      raise exception 'Legacy DocuSign request IDs cannot be replayed; use a new request ID';
    end if;
    if v_intent.request_fingerprint <> v_fingerprint then
      raise exception 'DocuSign request ID was reused with different input or actor';
    end if;
    if p_operation_kind = 'replacement' and v_intent.state <> 'finalized' then
      update public.os_docusign_envelope_lineage set
        send_intent_id = v_intent.intent_id, updated_at = now()
      where request_id = p_request_id::text
        and source_envelope_id = p_source_envelope_id
        and template_id = p_template_id and status = 'requested'
        and (send_intent_id is null or send_intent_id = v_intent.intent_id);
      get diagnostics v_bound = row_count;
      if v_bound <> 1 then
        raise exception 'Replacement lineage binding conflict';
      end if;
    end if;
    return v_intent;
  end if;
  insert into public.os_docusign_send_intents (
    request_id, request_fingerprint, operation_kind, doc_id, entity_id,
    template_id, source_envelope_id, provider_transaction_id, email_subject,
    role_map_sha256, content_sha256, explicit_human_approval, actor_id,
    payload_schema_version
  ) values (
    p_request_id, v_fingerprint, p_operation_kind, p_doc_id, p_entity_id,
    p_template_id, p_source_envelope_id, p_request_id::text, p_email_subject,
    p_role_map_sha256, p_content_sha256, p_explicit_human_approval, p_actor_id, 2
  ) returning * into v_intent;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, to_state, source, actor_id, evidence
  ) values (
    v_intent.intent_id, v_intent.intent_id::text || ':prepared', 'prepared',
    'application', p_actor_id,
    jsonb_build_object('operation_kind', p_operation_kind,
      'request_fingerprint', v_fingerprint, 'payload_schema_version', 2)
  );
  if p_operation_kind = 'replacement' then
    update public.os_docusign_envelope_lineage set
      send_intent_id = v_intent.intent_id, updated_at = now()
    where request_id = p_request_id::text
      and source_envelope_id = p_source_envelope_id
      and template_id = p_template_id and status = 'requested'
      and send_intent_id is null;
    get diagnostics v_bound = row_count;
    if v_bound <> 1 then
      raise exception 'Replacement lineage binding conflict';
    end if;
  end if;
  return v_intent;
end;
$$;

drop policy if exists "os_docusign_lineage_write"
  on public.os_docusign_envelope_lineage;
revoke insert, update, delete on public.os_docusign_envelope_lineage
  from authenticated;

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
      status = 'created', error = null, created_at = coalesce(created_at, now()),
      updated_at = now()
    where send_intent_id = new.intent_id and status = 'requested'
    returning * into v_lineage;
    if not found then
      raise exception 'Replacement lineage finalization conflict';
    end if;
    insert into public.os_docusign_events (
      event_id, envelope_id, status, event_type, doc_id, entity_id,
      raw_payload, dedupe_key, source, processing_status, processed_at,
      send_intent_id
    ) values
      ('replacement-created-' || new.intent_id::text,
       new.provider_envelope_id, coalesce(new.provider_status,'sent'),
       'envelope-replacement-created', v_lineage.source_doc_id,
       v_lineage.entity_id,
       jsonb_build_object('source_envelope_id', v_lineage.source_envelope_id,
         'lineage_id', v_lineage.lineage_id),
       'send:' || new.intent_id::text || ':replacement-created',
       'transactional_send', 'recorded', now(), new.intent_id),
      ('replacement-source-' || new.intent_id::text,
       v_lineage.source_envelope_id, 'replaced', 'envelope-replaced',
       v_lineage.source_doc_id, v_lineage.entity_id,
       jsonb_build_object('replacement_envelope_id', new.provider_envelope_id,
         'lineage_id', v_lineage.lineage_id),
       'send:' || new.intent_id::text || ':source-replaced',
       'transactional_send', 'recorded', now(), new.intent_id)
    on conflict (event_id) do nothing;
  elsif new.state = 'failed' then
    update public.os_docusign_envelope_lineage set
      status = 'failed', error = new.last_error_message, updated_at = now()
    where send_intent_id = new.intent_id and status = 'requested';
  elsif new.state = 'manual_review' then
    update public.os_docusign_envelope_lineage set
      status = 'manual_review', error = new.manual_review_reason, updated_at = now()
    where send_intent_id = new.intent_id and status = 'requested';
  elsif new.state = 'cancelled' then
    update public.os_docusign_envelope_lineage set
      status = 'cancelled', error = 'Send intent expired before dispatch',
      updated_at = now()
    where send_intent_id = new.intent_id and status = 'requested';
  end if;
  return new;
end;
$$;
drop trigger if exists os_docusign_replacement_lineage_sync
  on public.os_docusign_send_intents;
create trigger os_docusign_replacement_lineage_sync
after update of state on public.os_docusign_send_intents
for each row execute function public.sync_docusign_replacement_lineage();

create or replace function public.quarantine_docusign_send_recovery(
  p_intent_id uuid,
  p_lease_token uuid,
  p_disposition text,
  p_reason text,
  p_candidate_envelope_id text default null,
  p_candidate_provider_status text default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_intent public.os_docusign_send_intents%rowtype;
begin
  if p_disposition is null
     or p_disposition not in ('multiple_matches','evidence_mismatch','finalization_conflict')
     or nullif(trim(p_reason),'') is null then
    raise exception 'Disposition does not require quarantine';
  end if;
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found or v_intent.state <> 'recovering'
     or v_intent.lease_token is distinct from p_lease_token
     or v_intent.lease_expires_at is null
     or v_intent.lease_expires_at <= now() then
    raise exception 'DocuSign recovery lease mismatch';
  end if;
  update public.os_docusign_send_intents set
    state = 'manual_review', candidate_envelope_id = p_candidate_envelope_id,
    candidate_provider_status = p_candidate_provider_status,
    last_lookup_at = now(), last_lookup_disposition = p_disposition,
    manual_review_reason = left(p_reason,500),
    lease_token = null, lease_expires_at = null, worker_id = null,
    next_recovery_at = null, updated_at = now()
  where intent_id = p_intent_id;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source,
    attempt_no, evidence
  ) values (
    p_intent_id, p_intent_id::text || ':manual-review:' ||
      v_intent.recovery_attempts,
    'recovering', 'manual_review', 'recovery', v_intent.recovery_attempts,
    jsonb_build_object('disposition', p_disposition, 'reason', left(p_reason,500),
      'candidate_envelope_id', p_candidate_envelope_id)
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('intent_id', p_intent_id, 'state', 'manual_review');
end;
$$;

create or replace function public.defer_docusign_send_recovery_v2(
  p_intent_id uuid,
  p_lease_token uuid,
  p_disposition text,
  p_error_message text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_intent public.os_docusign_send_intents%rowtype; v_next text;
begin
  if p_disposition is null or p_disposition not in ('not_found','lookup_error')
     or nullif(trim(p_error_message),'') is null then
    raise exception 'A retryable recovery disposition and reason are required';
  end if;
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found or v_intent.state <> 'recovering'
     or v_intent.lease_token is distinct from p_lease_token
     or v_intent.lease_expires_at is null
     or v_intent.lease_expires_at <= now() then
    raise exception 'DocuSign recovery lease mismatch or expired';
  end if;
  v_next := case when v_intent.recovery_attempts >= 8
    then 'manual_review' else 'retry_wait' end;
  update public.os_docusign_send_intents set
    state = v_next, next_recovery_at = case when v_next = 'manual_review'
      then null else now() + make_interval(
        mins => least(360, greatest(1, recovery_attempts * 5))) end,
    lease_token = null, lease_expires_at = null, worker_id = null,
    last_lookup_at = now(), last_lookup_disposition = p_disposition,
    manual_review_reason = case when v_next = 'manual_review'
      then left(p_error_message,500) else null end,
    last_error_message = left(p_error_message,500), updated_at = now()
  where intent_id = p_intent_id;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source,
    attempt_no, evidence
  ) values (
    p_intent_id, p_intent_id::text || ':defer:' ||
      v_intent.recovery_attempts, 'recovering', v_next, 'recovery',
    v_intent.recovery_attempts,
    jsonb_build_object('disposition', p_disposition,
      'reason', left(p_error_message,500))
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('intent_id', p_intent_id,
    'attempts', v_intent.recovery_attempts, 'state', v_next);
end;
$$;

create or replace function public.sweep_docusign_send_intents()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_cancelled integer; v_review integer;
begin
  with stale as (
    select intent_id from public.os_docusign_send_intents
    where state = 'prepared' and requested_at < now() - interval '15 minutes'
    for update skip locked
  )
  update public.os_docusign_send_intents i set
    state = 'cancelled', last_error_code = 'dispatch_not_started',
    last_error_message = 'Prepared intent expired before provider dispatch',
    failed_at = now(), updated_at = now()
  from stale where i.intent_id = stale.intent_id;
  get diagnostics v_cancelled = row_count;
  with exhausted as (
    select intent_id from public.os_docusign_send_intents
    where state = 'recovering' and recovery_attempts >= 8
      and lease_expires_at < now()
    for update skip locked
  )
  update public.os_docusign_send_intents i set
    state = 'manual_review', manual_review_reason =
      'Recovery attempts exhausted after an ambiguous provider outcome',
    last_lookup_at = now(), last_lookup_disposition = 'not_found',
    lease_token = null, lease_expires_at = null, worker_id = null,
    next_recovery_at = null, updated_at = now()
  from exhausted where i.intent_id = exhausted.intent_id;
  get diagnostics v_review = row_count;
  return jsonb_build_object('cancelled_prepared', v_cancelled,
    'manual_review', v_review);
end;
$$;

revoke all on function public.quarantine_docusign_send_recovery(uuid,uuid,text,text,text,text)
  from public, authenticated;
revoke all on function public.sweep_docusign_send_intents()
  from public, authenticated;
grant execute on function public.quarantine_docusign_send_recovery(uuid,uuid,text,text,text,text)
  to service_role;
grant execute on function public.sweep_docusign_send_intents()
  to service_role;
revoke all on function public.defer_docusign_send_recovery(uuid,uuid,text)
  from public, authenticated, service_role;
revoke all on function public.defer_docusign_send_recovery_v2(uuid,uuid,text,text)
  from public, authenticated;
grant execute on function public.defer_docusign_send_recovery_v2(uuid,uuid,text,text)
  to service_role;
