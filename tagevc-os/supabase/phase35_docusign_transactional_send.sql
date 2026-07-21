-- Phase 35: durable DocuSign send intent, atomic local finalization, and recovery.

create table if not exists public.os_docusign_send_intents (
  intent_id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  request_fingerprint text not null,
  operation_kind text not null,
  state text not null default 'prepared',
  doc_id text,
  entity_id text references public.entities(entity_id),
  template_id text,
  source_envelope_id text,
  provider_transaction_id text not null unique,
  provider_envelope_id text unique,
  expected_provider_status text not null default 'sent',
  provider_status text,
  email_subject text,
  role_map_sha256 text,
  content_sha256 text,
  explicit_human_approval boolean not null default false,
  actor_id uuid not null,
  dispatch_attempts integer not null default 0,
  recovery_attempts integer not null default 0,
  lease_token uuid,
  lease_expires_at timestamptz,
  worker_id text,
  next_recovery_at timestamptz,
  last_error_class text,
  last_error_code text,
  last_error_message text,
  last_http_status integer,
  last_trace_token text,
  requested_at timestamptz not null default now(),
  dispatch_started_at timestamptz,
  provider_observed_at timestamptz,
  finalized_at timestamptz,
  failed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint os_docusign_intent_operation_check check (
    operation_kind in ('document_send', 'template_send', 'replacement')
  ),
  constraint os_docusign_intent_state_check check (
    state in ('prepared', 'dispatching', 'provider_unknown', 'retry_wait',
      'recovering', 'finalized', 'failed', 'manual_review', 'cancelled')
  ),
  constraint os_docusign_intent_hash_check
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_intent_lease_check
    check ((lease_token is null) = (lease_expires_at is null))
);
create index if not exists os_docusign_intent_recovery_idx
  on public.os_docusign_send_intents (state, next_recovery_at);
create index if not exists os_docusign_intent_entity_idx
  on public.os_docusign_send_intents (entity_id, requested_at desc);
create unique index if not exists os_docusign_active_document_send_unique
  on public.os_docusign_send_intents (doc_id)
  where operation_kind = 'document_send'
    and state in ('prepared','dispatching','provider_unknown','retry_wait','recovering','finalized');

create table if not exists public.os_docusign_send_intent_events (
  event_id uuid primary key default gen_random_uuid(),
  intent_id uuid not null references public.os_docusign_send_intents(intent_id)
    on delete cascade,
  transition_key text not null unique,
  from_state text,
  to_state text not null,
  source text not null,
  actor_id uuid,
  worker_id text,
  attempt_no integer,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.os_docusign_envelopes
  add column if not exists send_intent_id uuid
    references public.os_docusign_send_intents(intent_id),
  add column if not exists provider_transaction_id text,
  add column if not exists expected_provider_status text;
create unique index if not exists os_docusign_envelope_intent_unique
  on public.os_docusign_envelopes (send_intent_id)
  where send_intent_id is not null;
create unique index if not exists os_docusign_envelope_transaction_unique
  on public.os_docusign_envelopes (provider_transaction_id)
  where provider_transaction_id is not null;
alter table public.os_docusign_events
  add column if not exists send_intent_id uuid
    references public.os_docusign_send_intents(intent_id);

alter table public.os_docusign_send_intents enable row level security;
alter table public.os_docusign_send_intent_events enable row level security;
drop policy if exists "os_docusign_intent_select"
  on public.os_docusign_send_intents;
create policy "os_docusign_intent_select" on public.os_docusign_send_intents
  for select to authenticated using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
drop policy if exists "os_docusign_intent_event_select"
  on public.os_docusign_send_intent_events;
create policy "os_docusign_intent_event_select"
  on public.os_docusign_send_intent_events for select to authenticated using (
    exists (
      select 1 from public.os_docusign_send_intents i
      where i.intent_id = os_docusign_send_intent_events.intent_id
        and (
          public.is_firm_wide_access()
          or (i.entity_id is not null and public.can_access_entity(i.entity_id))
        )
    )
  );
grant select on public.os_docusign_send_intents,
  public.os_docusign_send_intent_events to authenticated;

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
begin
  if p_operation_kind not in ('document_send','template_send','replacement') then
    raise exception 'Unsupported DocuSign send operation';
  end if;
  if p_operation_kind = 'document_send' then
    select doc_id, entity_id, status, envelope_id into v_doc
    from public.os_documents where doc_id = p_doc_id for update;
    if not found or v_doc.entity_id is distinct from p_entity_id
       or v_doc.envelope_id is not null then
      raise exception 'Document is not eligible for send';
    end if;
  end if;
  v_fingerprint := encode(digest(concat_ws('|', p_operation_kind,
    coalesce(p_doc_id,''), coalesce(p_entity_id,''), coalesce(p_template_id,''),
    coalesce(p_source_envelope_id,''), coalesce(p_email_subject,''),
    coalesce(p_role_map_sha256,''), coalesce(p_content_sha256,'')), 'sha256'), 'hex');
  select * into v_intent from public.os_docusign_send_intents
  where request_id = p_request_id;
  if found then
    if v_intent.request_fingerprint <> v_fingerprint then
      raise exception 'DocuSign request ID was reused with different input';
    end if;
    return v_intent;
  end if;
  insert into public.os_docusign_send_intents (
    request_id, request_fingerprint, operation_kind, doc_id, entity_id,
    template_id, source_envelope_id, provider_transaction_id, email_subject,
    role_map_sha256, content_sha256, explicit_human_approval, actor_id
  ) values (
    p_request_id, v_fingerprint, p_operation_kind, p_doc_id, p_entity_id,
    p_template_id, p_source_envelope_id, p_request_id::text, p_email_subject,
    p_role_map_sha256, p_content_sha256, p_explicit_human_approval, p_actor_id
  ) returning * into v_intent;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, to_state, source, actor_id, evidence
  ) values (
    v_intent.intent_id, v_intent.intent_id::text || ':prepared', 'prepared',
    'application', p_actor_id,
    jsonb_build_object('operation_kind', p_operation_kind,
      'request_fingerprint', v_fingerprint)
  );
  return v_intent;
end;
$$;

create or replace function public.claim_docusign_send(
  p_intent_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 90
) returns public.os_docusign_send_intents
language plpgsql security definer set search_path = public
as $$
declare v_intent public.os_docusign_send_intents%rowtype;
begin
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found then raise exception 'DocuSign intent not found'; end if;
  if v_intent.state = 'finalized' then return v_intent; end if;
  if v_intent.state <> 'prepared' then raise exception 'Intent cannot be dispatched'; end if;
  update public.os_docusign_send_intents set
    state = 'dispatching', dispatch_attempts = dispatch_attempts + 1,
    dispatch_started_at = now(), lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds,30),180)),
    worker_id = p_worker_id, updated_at = now()
  where intent_id = p_intent_id returning * into v_intent;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source, worker_id, attempt_no
  ) values (
    p_intent_id, p_intent_id::text || ':dispatch:' || v_intent.dispatch_attempts,
    'prepared', 'dispatching', 'application', p_worker_id, v_intent.dispatch_attempts
  );
  return v_intent;
end;
$$;

create or replace function public.finalize_docusign_send(
  p_intent_id uuid,
  p_lease_token uuid,
  p_envelope_id text,
  p_provider_status text,
  p_recovered boolean default false
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_intent public.os_docusign_send_intents%rowtype;
  v_now timestamptz := now();
begin
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found then raise exception 'DocuSign intent not found'; end if;
  if v_intent.state = 'finalized' and v_intent.provider_envelope_id = p_envelope_id then
    return jsonb_build_object('intent_id', p_intent_id, 'envelope_id', p_envelope_id);
  end if;
  if v_intent.lease_token is distinct from p_lease_token then
    raise exception 'DocuSign intent lease mismatch';
  end if;
  update public.os_docusign_send_intents set
    state = 'finalized', provider_envelope_id = p_envelope_id,
    provider_status = lower(p_provider_status), provider_observed_at = v_now,
    finalized_at = v_now, lease_token = null, lease_expires_at = null,
    worker_id = null, next_recovery_at = null, updated_at = v_now
  where intent_id = p_intent_id;
  insert into public.os_docusign_envelopes (
    envelope_id, operation_kind, doc_id, entity_id, provider_status,
    provider_observed_at, reconciliation_state, send_intent_id,
    provider_transaction_id, expected_provider_status, last_reconciled_at,
    updated_at
  ) values (
    p_envelope_id, v_intent.operation_kind, v_intent.doc_id, v_intent.entity_id,
    lower(p_provider_status), v_now, 'in_sync', v_intent.intent_id,
    v_intent.provider_transaction_id, v_intent.expected_provider_status, v_now, v_now
  ) on conflict (envelope_id) do update set
    send_intent_id = excluded.send_intent_id,
    provider_transaction_id = excluded.provider_transaction_id,
    provider_status = excluded.provider_status,
    provider_observed_at = excluded.provider_observed_at,
    updated_at = excluded.updated_at;
  if v_intent.operation_kind = 'document_send' then
    update public.os_documents set
      envelope_id = p_envelope_id, status = 'Sent', sent_at = v_now,
      sent_by = v_intent.actor_id::text, updated_at = v_now
    where doc_id = v_intent.doc_id and entity_id is not distinct from v_intent.entity_id
      and (envelope_id is null or envelope_id = p_envelope_id);
    if not found then raise exception 'Document finalization conflict'; end if;
  end if;
  insert into public.os_docusign_events (
    event_id, envelope_id, status, event_type, doc_id, entity_id,
    raw_payload, dedupe_key, source, processing_status, processed_at,
    send_intent_id
  ) values (
    'send-' || v_intent.intent_id, p_envelope_id, lower(p_provider_status),
    'envelope-sent', v_intent.doc_id, v_intent.entity_id,
    jsonb_build_object('intent_id', v_intent.intent_id,
      'transaction_id', v_intent.provider_transaction_id,
      'recovered', p_recovered),
    'send:' || v_intent.intent_id::text || ':finalized', 'transactional_send',
    'recorded', v_now, v_intent.intent_id
  ) on conflict (event_id) do nothing;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source, evidence
  ) values (
    v_intent.intent_id, v_intent.intent_id::text || ':finalized',
    v_intent.state, 'finalized',
    case when p_recovered then 'recovery' else 'application' end,
    jsonb_build_object('envelope_id', p_envelope_id,
      'provider_status', p_provider_status)
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('intent_id', p_intent_id, 'envelope_id', p_envelope_id);
end;
$$;

create or replace function public.finish_docusign_send_attempt(
  p_intent_id uuid,
  p_lease_token uuid,
  p_outcome text,
  p_error_class text,
  p_error_code text,
  p_error_message text,
  p_http_status integer,
  p_trace_token text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_intent public.os_docusign_send_intents%rowtype; v_state text;
begin
  select * into v_intent from public.os_docusign_send_intents
  where intent_id = p_intent_id for update;
  if not found or v_intent.lease_token is distinct from p_lease_token then
    raise exception 'DocuSign intent lease mismatch';
  end if;
  v_state := case when p_outcome = 'definitive_failure' then 'failed'
                  else 'provider_unknown' end;
  update public.os_docusign_send_intents set
    state = v_state, lease_token = null, lease_expires_at = null, worker_id = null,
    next_recovery_at = case when v_state = 'provider_unknown'
      then now() + interval '1 minute' else null end,
    failed_at = case when v_state = 'failed' then now() else null end,
    last_error_class = left(p_error_class,100),
    last_error_code = left(p_error_code,100),
    last_error_message = left(p_error_message,500),
    last_http_status = p_http_status, last_trace_token = left(p_trace_token,100),
    updated_at = now()
  where intent_id = p_intent_id;
  insert into public.os_docusign_send_intent_events (
    intent_id, transition_key, from_state, to_state, source, evidence
  ) values (
    p_intent_id, p_intent_id::text || ':' || v_state || ':' || v_intent.dispatch_attempts,
    v_intent.state, v_state, 'application',
    jsonb_build_object('error_class', p_error_class, 'error_code', p_error_code,
      'http_status', p_http_status, 'trace_token', p_trace_token)
  ) on conflict (transition_key) do nothing;
  return jsonb_build_object('intent_id', p_intent_id, 'state', v_state);
end;
$$;

create or replace function public.claim_docusign_send_recovery(
  p_worker_id text,
  p_limit integer default 20,
  p_lease_seconds integer default 90
) returns setof public.os_docusign_send_intents
language plpgsql security definer set search_path = public
as $$
begin
  return query
  with due as (
    select intent_id from public.os_docusign_send_intents
    where (
      (state = 'dispatching' and lease_expires_at < now())
      or (state in ('provider_unknown','retry_wait')
        and coalesce(next_recovery_at, now()) <= now())
      or (state = 'recovering' and lease_expires_at < now())
    ) and recovery_attempts < 8
    order by requested_at for update skip locked
    limit least(greatest(p_limit,1),20)
  )
  update public.os_docusign_send_intents i set
    state = 'recovering', recovery_attempts = recovery_attempts + 1,
    lease_token = gen_random_uuid(),
    lease_expires_at = now() + make_interval(secs => least(greatest(p_lease_seconds,30),180)),
    worker_id = p_worker_id, updated_at = now()
  from due where i.intent_id = due.intent_id returning i.*;
end;
$$;

create or replace function public.defer_docusign_send_recovery(
  p_intent_id uuid,
  p_lease_token uuid,
  p_error_message text
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_attempts integer;
begin
  update public.os_docusign_send_intents set
    state = case when recovery_attempts >= 8 then 'manual_review' else 'retry_wait' end,
    next_recovery_at = case when recovery_attempts >= 8 then null
      else now() + make_interval(mins => least(360, greatest(1, recovery_attempts * 5))) end,
    lease_token = null, lease_expires_at = null, worker_id = null,
    last_error_message = left(p_error_message,500), updated_at = now()
  where intent_id = p_intent_id and lease_token = p_lease_token
  returning recovery_attempts into v_attempts;
  if not found then raise exception 'DocuSign recovery lease mismatch'; end if;
  return jsonb_build_object('intent_id', p_intent_id, 'attempts', v_attempts);
end;
$$;

revoke all on function public.prepare_docusign_send(uuid,text,text,text,text,text,text,text,text,boolean,uuid)
  from public, authenticated;
revoke all on function public.claim_docusign_send(uuid,text,integer)
  from public, authenticated;
revoke all on function public.finalize_docusign_send(uuid,uuid,text,text,boolean)
  from public, authenticated;
revoke all on function public.finish_docusign_send_attempt(uuid,uuid,text,text,text,text,integer,text)
  from public, authenticated;
revoke all on function public.claim_docusign_send_recovery(text,integer,integer)
  from public, authenticated;
revoke all on function public.defer_docusign_send_recovery(uuid,uuid,text)
  from public, authenticated;
grant execute on function public.prepare_docusign_send(uuid,text,text,text,text,text,text,text,text,boolean,uuid)
  to service_role;
grant execute on function public.claim_docusign_send(uuid,text,integer)
  to service_role;
grant execute on function public.finalize_docusign_send(uuid,uuid,text,text,boolean)
  to service_role;
grant execute on function public.finish_docusign_send_attempt(uuid,uuid,text,text,text,text,integer,text)
  to service_role;
grant execute on function public.claim_docusign_send_recovery(text,integer,integer)
  to service_role;
grant execute on function public.defer_docusign_send_recovery(uuid,uuid,text)
  to service_role;
