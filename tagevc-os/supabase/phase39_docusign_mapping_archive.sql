-- Phase 39: independent mapping review and content-bound signed archives.
-- Depends on Phase 37 DocuSign manual review and Phase 38 reconciliation batches.
-- Mapping review never changes send intents and never authorizes a send or resend.

alter table public.os_docusign_envelopes
  add column if not exists row_version bigint not null default 0,
  add column if not exists mapping_resolution_id uuid,
  add column if not exists mapping_claims_sha256 text;
alter table public.os_docusign_envelopes
  drop constraint if exists os_docusign_mapping_claims_hash_check;
alter table public.os_docusign_envelopes
  add constraint os_docusign_mapping_claims_hash_check check (
    mapping_claims_sha256 is null
    or mapping_claims_sha256 ~ '^[0-9a-f]{64}$'
  );

create or replace function public.bump_docusign_envelope_row_version()
returns trigger language plpgsql set search_path = public as $$
begin
  new.row_version := old.row_version + 1;
  return new;
end;
$$;
drop trigger if exists os_docusign_envelope_row_version
  on public.os_docusign_envelopes;
create trigger os_docusign_envelope_row_version
  before update on public.os_docusign_envelopes
  for each row execute function public.bump_docusign_envelope_row_version();

create table if not exists public.os_docusign_mapping_review_resolutions (
  resolution_id uuid primary key default gen_random_uuid(),
  request_id uuid not null unique,
  envelope_id text not null
    references public.os_docusign_envelopes(envelope_id),
  source_item_id uuid not null
    references public.os_docusign_reconciliation_items(item_id),
  source_run_id uuid not null
    references public.os_docusign_reconciliation_runs(run_id),
  entity_id text references public.entities(entity_id),
  decision text not null,
  status text not null default 'awaiting_review',
  target_entity_id text references public.entities(entity_id),
  target_doc_id text,
  target_send_intent_id uuid
    references public.os_docusign_send_intents(intent_id),
  target_lineage_id uuid
    references public.os_docusign_envelope_lineage(lineage_id),
  provider_evidence jsonb not null,
  evidence_sha256 text not null,
  proposal_sha256 text not null,
  proposal_contract_version text not null default 'phase39-v2',
  proposed_envelope_version bigint not null,
  proposed_by uuid not null,
  proposed_reason text not null,
  proposed_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes'),
  reviewed_by uuid,
  reviewer_statement text,
  reviewed_at timestamptz,
  review_request_id uuid,
  row_version bigint not null default 0,
  constraint os_docusign_mapping_decision_check
    check (decision in ('assign_identity','retain_quarantine')),
  constraint os_docusign_mapping_status_check
    check (status in ('awaiting_review','approved','rejected','expired',
      'projection_conflict')),
  constraint os_docusign_mapping_target_check check (
    (decision='assign_identity' and target_entity_id is not null)
    or (decision='retain_quarantine' and target_entity_id is null
      and target_doc_id is null and target_send_intent_id is null
      and target_lineage_id is null)
  ),
  constraint os_docusign_mapping_hash_check check (
    evidence_sha256 ~ '^[0-9a-f]{64}$'
    and proposal_sha256 ~ '^[0-9a-f]{64}$'
  ),
  constraint os_docusign_mapping_actor_check
    check (reviewed_by is null or reviewed_by <> proposed_by)
);
alter table public.os_docusign_mapping_review_resolutions
  add column if not exists proposal_contract_version text;
update public.os_docusign_mapping_review_resolutions
set proposal_contract_version='phase39-v1'
where proposal_contract_version is null;
alter table public.os_docusign_mapping_review_resolutions
  alter column proposal_contract_version set default 'phase39-v2',
  alter column proposal_contract_version set not null;
alter table public.os_docusign_mapping_review_resolutions
  drop constraint if exists os_docusign_mapping_contract_version_check;
alter table public.os_docusign_mapping_review_resolutions
  add constraint os_docusign_mapping_contract_version_check check (
    proposal_contract_version in ('phase39-v1','phase39-v2')
  );
create unique index if not exists os_docusign_one_pending_mapping_review
  on public.os_docusign_mapping_review_resolutions(envelope_id)
  where status='awaiting_review';
create index if not exists os_docusign_mapping_review_entity_idx
  on public.os_docusign_mapping_review_resolutions(entity_id,proposed_at desc);
alter table public.os_docusign_envelopes
  drop constraint if exists os_docusign_envelope_mapping_resolution_fkey;
alter table public.os_docusign_envelopes
  add constraint os_docusign_envelope_mapping_resolution_fkey
  foreign key(mapping_resolution_id)
  references public.os_docusign_mapping_review_resolutions(resolution_id);

create or replace function public.preserve_docusign_adjudicated_mapping()
returns trigger language plpgsql set search_path = public as $$
declare
  v_resolution public.os_docusign_mapping_review_resolutions%rowtype;
  v_latest_claims jsonb;
  v_latest_hash text;
begin
  if old.mapping_resolution_id is null
     or old.mapping_claims_sha256 is null
     or old.reconciliation_state<>'repaired'
     or new.reconciliation_state<>'manual_review'
     or new.issue_code not in ('identity_ambiguity','identity_conflict',
       'send_intent_conflict','duplicate_document_mapping') then
    return new;
  end if;
  select * into v_resolution
  from public.os_docusign_mapping_review_resolutions
  where resolution_id=old.mapping_resolution_id
    and status='approved' and decision='assign_identity';
  if not found then return new; end if;
  select i.identity_claims into v_latest_claims
  from public.os_docusign_reconciliation_items i
  where i.envelope_id=old.envelope_id
  order by i.committed_at desc,i.item_id desc limit 1;
  v_latest_hash := encode(digest(coalesce(v_latest_claims,'{}'::jsonb)::text,
    'sha256'),'hex');
  if v_latest_hash=old.mapping_claims_sha256 then
    new.entity_id := old.entity_id;
    new.doc_id := old.doc_id;
    new.send_intent_id := old.send_intent_id;
    new.lineage_id := old.lineage_id;
    new.operation_kind := old.operation_kind;
    new.reconciliation_state := 'repaired';
    new.issue_code := null;
    new.mapping_resolution_id := old.mapping_resolution_id;
    new.mapping_claims_sha256 := old.mapping_claims_sha256;
  end if;
  return new;
end;
$$;
drop trigger if exists os_docusign_envelope_mapping_sticky
  on public.os_docusign_envelopes;
create trigger os_docusign_envelope_mapping_sticky
  before update on public.os_docusign_envelopes
  for each row execute function public.preserve_docusign_adjudicated_mapping();

create table if not exists public.os_docusign_mapping_review_events (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  resolution_id uuid not null
    references public.os_docusign_mapping_review_resolutions(resolution_id),
  envelope_id text not null,
  entity_id text references public.entities(entity_id),
  event_type text not null,
  actor_id uuid not null,
  from_status text,
  to_status text not null,
  evidence_sha256 text not null,
  envelope_version bigint not null,
  resolution_version bigint not null,
  detail jsonb not null default '{}'::jsonb,
  reason text not null,
  created_at timestamptz not null default now(),
  constraint os_docusign_mapping_event_type_check check (
    event_type in ('proposal_created','review_approved','review_rejected',
      'proposal_expired','projection_committed','projection_conflict',
      'retain_quarantine')
  ),
  constraint os_docusign_mapping_event_hash_check
    check (evidence_sha256 ~ '^[0-9a-f]{64}$')
);
alter table public.os_docusign_mapping_review_events
  drop constraint if exists os_docusign_mapping_event_hash_check;
alter table public.os_docusign_mapping_review_events
  add constraint os_docusign_mapping_event_hash_check
  check (evidence_sha256 ~ '^[0-9a-f]{64}$');

alter table public.os_docusign_mapping_review_resolutions enable row level security;
alter table public.os_docusign_mapping_review_events enable row level security;
drop policy if exists "os_docusign_mapping_review_select"
  on public.os_docusign_mapping_review_resolutions;
drop policy if exists "os_docusign_mapping_event_select"
  on public.os_docusign_mapping_review_events;
create policy "os_docusign_mapping_review_select"
  on public.os_docusign_mapping_review_resolutions for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
create policy "os_docusign_mapping_event_select"
  on public.os_docusign_mapping_review_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id))
  );
revoke all on public.os_docusign_mapping_review_resolutions,
  public.os_docusign_mapping_review_events from public,anon,authenticated;
grant select (
  resolution_id,request_id,envelope_id,source_item_id,source_run_id,entity_id,
  decision,status,target_entity_id,target_doc_id,target_send_intent_id,
  target_lineage_id,evidence_sha256,proposal_sha256,proposed_envelope_version,
  proposal_contract_version,proposed_by,proposed_reason,proposed_at,expires_at,reviewed_by,
  reviewer_statement,reviewed_at,review_request_id,row_version
) on public.os_docusign_mapping_review_resolutions to authenticated;
grant select on public.os_docusign_mapping_review_events to authenticated;

create or replace function public.reject_docusign_phase39_evidence_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Phase 39 DocuSign evidence is append-only';
end;
$$;
drop trigger if exists os_docusign_mapping_events_immutable
  on public.os_docusign_mapping_review_events;
create trigger os_docusign_mapping_events_immutable
  before update or delete on public.os_docusign_mapping_review_events
  for each row execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_mapping_events_no_truncate
  on public.os_docusign_mapping_review_events;
create trigger os_docusign_mapping_events_no_truncate
  before truncate on public.os_docusign_mapping_review_events
  for each statement execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_mapping_evidence_frozen
  on public.os_docusign_mapping_review_resolutions;
create trigger os_docusign_mapping_evidence_frozen
  before update of request_id,envelope_id,source_item_id,source_run_id,
    provider_evidence,evidence_sha256,proposal_sha256,decision,target_entity_id,
    target_doc_id,target_send_intent_id,target_lineage_id,proposed_envelope_version,
    proposal_contract_version,proposed_by,proposed_reason,proposed_at
  on public.os_docusign_mapping_review_resolutions
  for each row execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_mapping_resolutions_no_truncate
  on public.os_docusign_mapping_review_resolutions;
create trigger os_docusign_mapping_resolutions_no_truncate
  before truncate on public.os_docusign_mapping_review_resolutions
  for each statement execute function public.reject_docusign_phase39_evidence_mutation();

create or replace function public.expire_docusign_mapping_reviews()
returns integer
language plpgsql security definer set search_path = public as $$
declare v_count integer;
begin
  with expired as (
    update public.os_docusign_mapping_review_resolutions
    set status='expired',row_version=row_version+1
    where status='awaiting_review' and expires_at<=now()
    returning *
  ), events as (
    insert into public.os_docusign_mapping_review_events(
      event_key,resolution_id,envelope_id,entity_id,event_type,actor_id,
      from_status,to_status,evidence_sha256,envelope_version,
      resolution_version,reason)
    select 'mapping:'||e.resolution_id::text||':expired',e.resolution_id,
      e.envelope_id,e.entity_id,'proposal_expired',e.proposed_by,
      'awaiting_review','expired',e.evidence_sha256,
      e.proposed_envelope_version,e.row_version,
      'Mapping-review proposal expired before independent review'
    from expired e on conflict(event_key) do nothing returning 1
  )
  select count(*) into v_count from events;
  return v_count;
end;
$$;

create or replace function public.propose_docusign_mapping_review_resolution(
  p_request_id uuid,
  p_source_item_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_target_entity_id text,
  p_target_doc_id text,
  p_target_send_intent_id uuid,
  p_target_lineage_id uuid,
  p_reason text,
  p_expected_envelope_version bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_item public.os_docusign_reconciliation_items%rowtype;
  v_envelope public.os_docusign_envelopes%rowtype;
  v_existing public.os_docusign_mapping_review_resolutions%rowtype;
  v_resolution public.os_docusign_mapping_review_resolutions%rowtype;
  v_evidence jsonb;
  v_evidence_hash text;
  v_proposal_hash text;
  v_claims jsonb;
begin
  select * into v_profile from public.profiles
  where id=p_actor_id and active;
  if not found or v_profile.role not in ('visionary','admin','counsel_ops') then
    raise exception 'DocuSign mapping-review permission denied';
  end if;
  if p_request_id is null then
    raise exception 'Mapping-review request id is required';
  end if;
  select * into v_existing from public.os_docusign_mapping_review_resolutions
  where request_id=p_request_id;
  if found then
    v_proposal_hash := encode(digest(
      case when v_existing.proposal_contract_version='phase39-v1' then
        jsonb_build_object(
          'request_id',p_request_id,'source_item_id',p_source_item_id,
          'decision',p_decision,'target_entity_id',p_target_entity_id,
          'target_doc_id',p_target_doc_id,
          'target_send_intent_id',p_target_send_intent_id,
          'target_lineage_id',p_target_lineage_id,'reason',trim(p_reason),
          'expected_envelope_version',p_expected_envelope_version,
          'evidence_sha256',v_existing.evidence_sha256)
      else jsonb_build_object(
          'contract_version','phase39-v2','request_id',p_request_id,
          'source_item_id',p_source_item_id,'actor_id',p_actor_id,
          'decision',p_decision,'target_entity_id',p_target_entity_id,
          'target_doc_id',p_target_doc_id,
          'target_send_intent_id',p_target_send_intent_id,
          'target_lineage_id',p_target_lineage_id,'reason',trim(p_reason),
          'expected_envelope_version',p_expected_envelope_version,
          'evidence_sha256',v_existing.evidence_sha256)
      end::text,'sha256'),'hex');
    if v_existing.proposal_sha256<>v_proposal_hash then
      raise exception 'Mapping-review request replayed with different intent';
    end if;
    return jsonb_build_object('resolution_id',v_existing.resolution_id,
      'status',v_existing.status,'replayed',true,
      'evidence_sha256',v_existing.evidence_sha256);
  end if;
  perform public.expire_docusign_mapping_reviews();
  select * into v_item from public.os_docusign_reconciliation_items
  where item_id=p_source_item_id;
  if not found or v_item.identity_state not in ('ambiguous','sticky_ambiguous')
     or v_item.reconciliation_state<>'manual_review'
     or v_item.committed_at<now()-interval '30 minutes'
     or not exists (
       select 1 from public.os_docusign_reconciliation_runs r
       where r.run_id=v_item.run_id and r.status in ('completed','partial')
     )
     or exists (
       select 1 from public.os_docusign_reconciliation_items newer
       where newer.envelope_id=v_item.envelope_id
         and (newer.committed_at,newer.item_id)>
           (v_item.committed_at,v_item.item_id)
     ) then
    raise exception 'Immutable ambiguous reconciliation evidence is required';
  end if;
  select * into v_envelope from public.os_docusign_envelopes
  where envelope_id=v_item.envelope_id for update;
  if not found or v_envelope.reconciliation_state<>'manual_review'
     or v_envelope.issue_code not in ('identity_ambiguity','identity_conflict',
       'send_intent_conflict','duplicate_document_mapping')
     or v_envelope.row_version<>p_expected_envelope_version then
    raise exception 'Sticky mapping conflict state or version changed';
  end if;
  if v_profile.entity_id is not null and v_profile.entity_id<>'ENT-FIRM'
     and (
       (v_envelope.entity_id is not null
         and v_envelope.entity_id is distinct from v_profile.entity_id)
       or (p_target_entity_id is not null
         and p_target_entity_id is distinct from v_profile.entity_id)
     ) then
    raise exception 'DocuSign mapping-review entity access denied';
  end if;
  if p_decision not in ('assign_identity','retain_quarantine')
     or length(trim(coalesce(p_reason,'')))<20 then
    raise exception 'Invalid mapping-review proposal';
  end if;
  if p_decision='assign_identity' then
    if p_target_entity_id is null then
      raise exception 'An entity is required for identity assignment';
    end if;
    v_claims := v_item.identity_claims;
    if jsonb_typeof(v_claims)<>'object'
       or jsonb_typeof(v_claims->'entity_ids')<>'array'
       or jsonb_typeof(v_claims->'doc_ids')<>'array'
       or jsonb_typeof(v_claims->'send_intent_ids')<>'array'
       or jsonb_typeof(v_claims->'lineage_ids')<>'array'
       or jsonb_array_length(v_claims->'entity_ids')=0
       or not (v_claims->'entity_ids' @> to_jsonb(p_target_entity_id)) then
      raise exception 'Target entity is not bound to frozen identity claims';
    end if;
    if jsonb_array_length(v_claims->'doc_ids')>0 and (
       p_target_doc_id is null
       or not (v_claims->'doc_ids' @> to_jsonb(p_target_doc_id))) then
      raise exception 'Target document is not bound to frozen identity claims';
    end if;
    if jsonb_array_length(v_claims->'send_intent_ids')>0 and (
       p_target_send_intent_id is null
       or not (v_claims->'send_intent_ids'
         @> to_jsonb(p_target_send_intent_id::text))) then
      raise exception 'Target send intent is not bound to frozen identity claims';
    end if;
    if jsonb_array_length(v_claims->'lineage_ids')>0 and (
       p_target_lineage_id is null
       or not (v_claims->'lineage_ids'
         @> to_jsonb(p_target_lineage_id::text))) then
      raise exception 'Target lineage is not bound to frozen identity claims';
    end if;
    if p_target_doc_id is not null and not exists (
      select 1 from public.os_documents d where d.doc_id=p_target_doc_id
        and d.entity_id is not distinct from p_target_entity_id
    ) then raise exception 'Target document does not belong to target entity'; end if;
    if p_target_send_intent_id is not null and not exists (
      select 1 from public.os_docusign_send_intents i
      where i.intent_id=p_target_send_intent_id
        and i.entity_id is not distinct from p_target_entity_id
        and i.doc_id is not distinct from p_target_doc_id
        and (i.provider_envelope_id is null
          or i.provider_envelope_id=v_envelope.envelope_id)
    ) then raise exception 'Target send intent conflicts with target identity'; end if;
    if p_target_lineage_id is not null and not exists (
      select 1 from public.os_docusign_envelope_lineage l
      where l.lineage_id=p_target_lineage_id
        and l.entity_id is not distinct from p_target_entity_id
        and l.source_doc_id is not distinct from p_target_doc_id
        and l.send_intent_id is not distinct from p_target_send_intent_id
        and (l.source_envelope_id=v_envelope.envelope_id
          or l.replacement_envelope_id=v_envelope.envelope_id)
    ) then raise exception 'Target lineage conflicts with target identity'; end if;
  elsif p_target_entity_id is not null or p_target_doc_id is not null
     or p_target_send_intent_id is not null or p_target_lineage_id is not null then
    raise exception 'Retain-quarantine cannot assign identity';
  end if;
  v_evidence := jsonb_build_object(
    'evidence_version','phase39-v1','source_item_id',v_item.item_id,
    'source_run_id',v_item.run_id,'page_id',v_item.page_id,
    'envelope_id',v_item.envelope_id,'provider_status',v_item.provider_status,
    'provider_status_at',v_item.provider_status_at,
    'item_sha256',v_item.item_sha256,'identity_state',v_item.identity_state,
    'issue_code',v_item.issue_code,'identity_claims',v_item.identity_claims,
    'committed_at',v_item.committed_at);
  v_evidence_hash := encode(digest(v_evidence::text,'sha256'),'hex');
  v_proposal_hash := encode(digest(jsonb_build_object(
    'contract_version','phase39-v2','request_id',p_request_id,
    'source_item_id',p_source_item_id,'actor_id',p_actor_id,
    'decision',p_decision,'target_entity_id',p_target_entity_id,
    'target_doc_id',p_target_doc_id,'target_send_intent_id',p_target_send_intent_id,
    'target_lineage_id',p_target_lineage_id,'reason',trim(p_reason),
    'expected_envelope_version',p_expected_envelope_version,
    'evidence_sha256',v_evidence_hash)::text,'sha256'),'hex');
  insert into public.os_docusign_mapping_review_resolutions(
    request_id,envelope_id,source_item_id,source_run_id,entity_id,decision,
    target_entity_id,target_doc_id,target_send_intent_id,target_lineage_id,
    provider_evidence,evidence_sha256,proposal_sha256,proposal_contract_version,
    proposed_envelope_version,proposed_by,proposed_reason)
  values(p_request_id,v_envelope.envelope_id,v_item.item_id,v_item.run_id,
    coalesce(v_envelope.entity_id,p_target_entity_id),p_decision,
    p_target_entity_id,p_target_doc_id,p_target_send_intent_id,
    p_target_lineage_id,v_evidence,v_evidence_hash,v_proposal_hash,
    'phase39-v2',v_envelope.row_version,p_actor_id,trim(p_reason))
  returning * into v_resolution;
  insert into public.os_docusign_mapping_review_events(
    event_key,resolution_id,envelope_id,entity_id,event_type,actor_id,
    from_status,to_status,evidence_sha256,envelope_version,
    resolution_version,detail,reason)
  values('mapping:'||p_request_id::text||':proposed',v_resolution.resolution_id,
    v_resolution.envelope_id,v_resolution.entity_id,'proposal_created',
    p_actor_id,null,'awaiting_review',v_evidence_hash,v_envelope.row_version,0,
    jsonb_build_object('decision',p_decision,'source_item_id',p_source_item_id),
    trim(p_reason));
  return jsonb_build_object('resolution_id',v_resolution.resolution_id,
    'status','awaiting_review','replayed',false,
    'evidence_sha256',v_evidence_hash);
end;
$$;

create or replace function public.review_docusign_mapping_review_resolution(
  p_review_request_id uuid,
  p_resolution_id uuid,
  p_actor_id uuid,
  p_review_decision text,
  p_statement text,
  p_expected_resolution_version bigint,
  p_expected_envelope_version bigint
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_profile public.profiles%rowtype;
  v_resolution public.os_docusign_mapping_review_resolutions%rowtype;
  v_envelope public.os_docusign_envelopes%rowtype;
  v_event public.os_docusign_mapping_review_events%rowtype;
  v_conflict text;
  v_final_event text;
  v_review_hash text;
  v_claims_hash text;
begin
  select * into v_profile from public.profiles where id=p_actor_id and active;
  if not found or v_profile.role not in ('visionary','admin','counsel_ops') then
    raise exception 'DocuSign mapping-review permission denied';
  end if;
  if p_review_request_id is null then
    raise exception 'Mapping-review decision request id is required';
  end if;
  v_review_hash := encode(digest(jsonb_build_object(
    'contract_version','phase39-v2','review_request_id',p_review_request_id,
    'resolution_id',p_resolution_id,'actor_id',p_actor_id,
    'review_decision',p_review_decision,'statement',trim(p_statement),
    'expected_resolution_version',p_expected_resolution_version,
    'expected_envelope_version',p_expected_envelope_version)::text,
    'sha256'),'hex');
  select * into v_event from public.os_docusign_mapping_review_events
  where event_key='mapping-review:'||p_review_request_id::text;
  if found then
    if v_event.resolution_id<>p_resolution_id or v_event.actor_id<>p_actor_id
       or v_event.detail->>'review_decision' is distinct from p_review_decision
       or (v_event.detail->>'review_sha256' is not null
         and v_event.detail->>'review_sha256'<>v_review_hash) then
      raise exception 'Mapping-review replay conflicts with prior decision';
    end if;
    return jsonb_build_object('resolution_id',p_resolution_id,
      'status',v_event.to_status,'replayed',true);
  end if;
  select * into v_resolution
  from public.os_docusign_mapping_review_resolutions
  where resolution_id=p_resolution_id for update;
  if not found or v_resolution.status<>'awaiting_review'
     or v_resolution.expires_at<=now()
     or v_resolution.proposed_by=p_actor_id
     or v_resolution.row_version<>p_expected_resolution_version
     or p_review_decision not in ('approve','reject')
     or length(trim(coalesce(p_statement,'')))<20 then
    raise exception 'Mapping review actor, state, version, or expiry changed';
  end if;
  if v_profile.entity_id is not null and v_profile.entity_id<>'ENT-FIRM'
     and v_resolution.entity_id is distinct from v_profile.entity_id then
    raise exception 'DocuSign mapping-review entity access denied';
  end if;
  select * into v_envelope from public.os_docusign_envelopes
  where envelope_id=v_resolution.envelope_id for update;
  if not found then
    v_conflict := 'Envelope mapping projection no longer exists';
  elsif v_envelope.row_version<>p_expected_envelope_version
     or v_envelope.row_version<>v_resolution.proposed_envelope_version
     or v_envelope.reconciliation_state<>'manual_review'
     or v_envelope.issue_code not in ('identity_ambiguity','identity_conflict',
       'send_intent_conflict','duplicate_document_mapping') then
    v_conflict := 'Sticky mapping projection changed after proposal';
  end if;
  if p_review_decision='approve' and v_conflict is null
     and v_resolution.decision='assign_identity' then
    if v_resolution.target_doc_id is not null and exists (
      select 1 from public.os_documents d
      where d.doc_id=v_resolution.target_doc_id
        and d.envelope_id is not null
        and d.envelope_id<>v_resolution.envelope_id
    ) then v_conflict := 'Target document already maps to another envelope'; end if;
    if v_resolution.target_send_intent_id is not null and exists (
      select 1 from public.os_docusign_envelopes e
      where e.send_intent_id=v_resolution.target_send_intent_id
        and e.envelope_id<>v_resolution.envelope_id
    ) then v_conflict := 'Target send intent already maps to another envelope'; end if;
  end if;
  if v_conflict is not null then
    update public.os_docusign_mapping_review_resolutions set
      status='projection_conflict',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),reviewed_at=now(),
      review_request_id=p_review_request_id,row_version=row_version+1
    where resolution_id=p_resolution_id;
    insert into public.os_docusign_mapping_review_events(
      event_key,resolution_id,envelope_id,entity_id,event_type,actor_id,
      from_status,to_status,evidence_sha256,envelope_version,
      resolution_version,detail,reason)
    values('mapping-review:'||p_review_request_id::text,p_resolution_id,
      v_resolution.envelope_id,v_resolution.entity_id,'projection_conflict',
      p_actor_id,'awaiting_review','projection_conflict',
      v_resolution.evidence_sha256,
      coalesce(v_envelope.row_version,p_expected_envelope_version),
      v_resolution.row_version+1,
      jsonb_build_object('review_decision',p_review_decision,
        'review_sha256',v_review_hash,'no_send_side_effect',true),v_conflict);
    return jsonb_build_object('resolution_id',p_resolution_id,
      'status','projection_conflict','replayed',false,'error',v_conflict);
  end if;
  if p_review_decision='reject' then
    update public.os_docusign_mapping_review_resolutions set
      status='rejected',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),reviewed_at=now(),
      review_request_id=p_review_request_id,row_version=row_version+1
    where resolution_id=p_resolution_id;
    v_final_event := 'review_rejected';
  elsif v_resolution.decision='retain_quarantine' then
    update public.os_docusign_mapping_review_resolutions set
      status='approved',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),reviewed_at=now(),
      review_request_id=p_review_request_id,row_version=row_version+1
    where resolution_id=p_resolution_id;
    update public.os_docusign_envelopes set
      mapping_resolution_id=p_resolution_id,updated_at=now()
    where envelope_id=v_resolution.envelope_id;
    v_final_event := 'retain_quarantine';
  else
    v_claims_hash := encode(digest(
      coalesce(v_resolution.provider_evidence->'identity_claims',
        '{}'::jsonb)::text,'sha256'),'hex');
    update public.os_docusign_envelopes set
      entity_id=v_resolution.target_entity_id,
      doc_id=v_resolution.target_doc_id,
      send_intent_id=v_resolution.target_send_intent_id,
      lineage_id=v_resolution.target_lineage_id,
      operation_kind=coalesce((
        select i.operation_kind from public.os_docusign_send_intents i
        where i.intent_id=v_resolution.target_send_intent_id
      ),operation_kind),
      reconciliation_state='repaired',issue_code=null,last_error=null,
      mapping_resolution_id=p_resolution_id,
      mapping_claims_sha256=v_claims_hash,
      last_reconciled_at=now(),updated_at=now()
    where envelope_id=v_resolution.envelope_id;
    if v_resolution.target_doc_id is not null then
      update public.os_documents set
        envelope_id=v_resolution.envelope_id,updated_at=now()
      where doc_id=v_resolution.target_doc_id
        and entity_id is not distinct from v_resolution.target_entity_id
        and (envelope_id is null or envelope_id=v_resolution.envelope_id);
      if not found then raise exception 'Atomic document projection failed'; end if;
    end if;
    update public.os_docusign_mapping_review_resolutions set
      status='approved',reviewed_by=p_actor_id,
      reviewer_statement=trim(p_statement),reviewed_at=now(),
      review_request_id=p_review_request_id,row_version=row_version+1
    where resolution_id=p_resolution_id;
    v_final_event := 'projection_committed';
  end if;
  insert into public.os_docusign_mapping_review_events(
    event_key,resolution_id,envelope_id,entity_id,event_type,actor_id,
    from_status,to_status,evidence_sha256,envelope_version,
    resolution_version,detail,reason)
  values('mapping-review:'||p_review_request_id::text,p_resolution_id,
    v_resolution.envelope_id,v_resolution.entity_id,v_final_event,p_actor_id,
    'awaiting_review',case when p_review_decision='reject'
      then 'rejected' else 'approved' end,v_resolution.evidence_sha256,
    case when p_review_decision='approve' then v_envelope.row_version+1
      else v_envelope.row_version end,v_resolution.row_version+1,
    jsonb_build_object('review_decision',p_review_decision,
      'review_sha256',v_review_hash,'decision',v_resolution.decision,
      'no_send_side_effect',true),
    trim(p_statement));
  return jsonb_build_object('resolution_id',p_resolution_id,
    'status',case when p_review_decision='reject' then 'rejected'
      else 'approved' end,'replayed',false);
end;
$$;

alter table public.os_docusign_signed_files
  add column if not exists archive_manifest_id uuid;

create table if not exists public.os_docusign_archive_manifests (
  manifest_id uuid primary key default gen_random_uuid(),
  envelope_id text not null,
  document_id text not null,
  entity_id text references public.entities(entity_id),
  file_kind text not null,
  provider_status text not null,
  content_length bigint not null,
  content_sha256 text not null,
  downloaded_at timestamptz not null,
  source_request_id text not null,
  source text not null,
  archive_contract_version text not null default 'phase39-v2',
  replaces_manifest_id uuid,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_kind_check
    check (file_kind in ('combined','certificate')),
  constraint os_docusign_archive_length_check check (
    (archive_contract_version='phase39-v1' and content_length>=0)
    or (archive_contract_version='phase39-v2'
      and content_length between 1 and (
        case when file_kind='combined' then 26214400 else 5242880 end
      ))
  ),
  constraint os_docusign_archive_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$'),
  constraint os_docusign_archive_request_length_check
    check (length(source_request_id) between 1 and 200),
  unique(envelope_id,document_id,file_kind)
);
-- A prior Phase 39 run may already have installed the immutable trigger.
-- Drop it only inside this migration transaction so additive contract metadata
-- can be backfilled, then recreate it below before any RPC is granted.
drop trigger if exists os_docusign_archive_manifests_immutable
  on public.os_docusign_archive_manifests;
alter table public.os_docusign_archive_manifests
  add column if not exists replaces_manifest_id uuid,
  add column if not exists archive_contract_version text;
update public.os_docusign_archive_manifests
set archive_contract_version='phase39-v1'
where archive_contract_version is null;
alter table public.os_docusign_archive_manifests
  alter column archive_contract_version set default 'phase39-v2',
  alter column archive_contract_version set not null;
alter table public.os_docusign_archive_manifests
  drop constraint if exists os_docusign_archive_contract_version_check;
alter table public.os_docusign_archive_manifests
  add constraint os_docusign_archive_contract_version_check check (
    archive_contract_version in ('phase39-v1','phase39-v2')
  );
alter table public.os_docusign_archive_manifests
  drop constraint if exists os_docusign_archive_request_length_check;
alter table public.os_docusign_archive_manifests
  add constraint os_docusign_archive_request_length_check
  check (length(source_request_id) between 1 and 200);
alter table public.os_docusign_archive_manifests
  drop constraint if exists os_docusign_archive_replaces_fkey;
alter table public.os_docusign_archive_manifests
  add constraint os_docusign_archive_replaces_fkey
  foreign key(replaces_manifest_id)
  references public.os_docusign_archive_manifests(manifest_id);
alter table public.os_docusign_archive_manifests
  drop constraint if exists os_docusign_archive_length_check;
alter table public.os_docusign_archive_manifests
  add constraint os_docusign_archive_length_check check (
    (archive_contract_version='phase39-v1' and content_length>=0)
    or (archive_contract_version='phase39-v2'
      and content_length between 1 and (
        case when file_kind='combined' then 26214400 else 5242880 end
      ))
  );
do $$
begin
  if exists (
    select 1 from public.os_docusign_archive_manifests
    group by source_request_id,file_kind having count(*)>1
  ) then
    raise exception 'Duplicate DocuSign archive request identities require review';
  end if;
end;
$$;
create unique index if not exists os_docusign_archive_request_unique
  on public.os_docusign_archive_manifests(source_request_id,file_kind);
alter table public.os_docusign_signed_files
  drop constraint if exists os_docusign_signed_manifest_fkey;
alter table public.os_docusign_signed_files
  add constraint os_docusign_signed_manifest_fkey foreign key(archive_manifest_id)
    references public.os_docusign_archive_manifests(manifest_id);
create unique index if not exists os_docusign_signed_manifest_unique
  on public.os_docusign_signed_files(archive_manifest_id)
  where archive_manifest_id is not null;

create or replace function public.validate_docusign_signed_manifest_binding()
returns trigger language plpgsql set search_path = public as $$
declare
  v_manifest public.os_docusign_archive_manifests%rowtype;
  v_bytes bytea;
begin
  if tg_op='DELETE' then
    if old.archive_manifest_id is not null then
      raise exception 'Manifest-bound signed archives are immutable';
    end if;
    return old;
  end if;
  if new.archive_manifest_id is null then return new; end if;
  select * into v_manifest from public.os_docusign_archive_manifests
  where manifest_id=new.archive_manifest_id;
  if not found
     or new.envelope_id<>v_manifest.envelope_id
     or new.doc_id is distinct from v_manifest.document_id
     or new.entity_id is distinct from v_manifest.entity_id
     or coalesce(new.file_kind,'combined')<>v_manifest.file_kind
     or new.source<>v_manifest.source
     or new.size_bytes is distinct from v_manifest.content_length then
    raise exception 'Signed file does not match its immutable archive manifest';
  end if;
  if new.content_base64 is not null then
    begin
      v_bytes := decode(new.content_base64,'base64');
    exception when others then
      raise exception 'Signed archive inline content is not valid base64';
    end;
    if octet_length(v_bytes)<>v_manifest.content_length
       or encode(digest(v_bytes,'sha256'),'hex')<>v_manifest.content_sha256 then
      raise exception 'Signed archive bytes do not match immutable manifest';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists os_docusign_signed_manifest_binding
  on public.os_docusign_signed_files;
create trigger os_docusign_signed_manifest_binding
  before insert or update of envelope_id,doc_id,entity_id,file_kind,source,
    size_bytes,content_base64,archive_manifest_id
  on public.os_docusign_signed_files
  for each row execute function public.validate_docusign_signed_manifest_binding();
drop trigger if exists os_docusign_signed_manifest_no_delete
  on public.os_docusign_signed_files;
create trigger os_docusign_signed_manifest_no_delete
  before delete on public.os_docusign_signed_files
  for each row execute function public.validate_docusign_signed_manifest_binding();

create table if not exists public.os_docusign_archive_events (
  event_id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  manifest_id uuid references public.os_docusign_archive_manifests(manifest_id),
  envelope_id text not null,
  document_id text not null,
  entity_id text references public.entities(entity_id),
  file_kind text not null,
  event_type text not null,
  source_request_id text not null,
  content_length bigint not null,
  content_sha256 text not null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_docusign_archive_event_type_check
    check (event_type in ('manifest_recorded','manifest_replayed',
      'replacement_manifest_recorded','content_replacement_blocked',
      'metadata_drift_blocked','request_identity_drift_blocked')),
  constraint os_docusign_archive_event_hash_check
    check (content_sha256 ~ '^[0-9a-f]{64}$' and content_length>=0)
);
alter table public.os_docusign_archive_events
  drop constraint if exists os_docusign_archive_event_type_check;
alter table public.os_docusign_archive_events
  add constraint os_docusign_archive_event_type_check check (
    event_type in ('manifest_recorded','manifest_replayed',
      'replacement_manifest_recorded','content_replacement_blocked',
      'metadata_drift_blocked','request_identity_drift_blocked')
  );
alter table public.os_docusign_archive_events
  drop constraint if exists os_docusign_archive_event_hash_check;
alter table public.os_docusign_archive_events
  add constraint os_docusign_archive_event_hash_check
  check (content_sha256 ~ '^[0-9a-f]{64}$' and content_length>=0);
create index if not exists os_docusign_archive_event_envelope_idx
  on public.os_docusign_archive_events(envelope_id,created_at desc);

alter table public.os_docusign_archive_manifests enable row level security;
alter table public.os_docusign_archive_events enable row level security;
drop policy if exists "os_docusign_archive_manifest_select"
  on public.os_docusign_archive_manifests;
drop policy if exists "os_docusign_archive_event_select"
  on public.os_docusign_archive_events;
create policy "os_docusign_archive_manifest_select"
  on public.os_docusign_archive_manifests for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
create policy "os_docusign_archive_event_select"
  on public.os_docusign_archive_events for select to authenticated
  using (public.is_firm_wide_access()
    or (entity_id is not null and public.can_access_entity(entity_id)));
revoke all on public.os_docusign_archive_manifests,
  public.os_docusign_archive_events from public,anon,authenticated;
grant select on public.os_docusign_archive_manifests,
  public.os_docusign_archive_events to authenticated;
drop trigger if exists os_docusign_archive_manifests_immutable
  on public.os_docusign_archive_manifests;
create trigger os_docusign_archive_manifests_immutable
  before update or delete on public.os_docusign_archive_manifests
  for each row execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_archive_manifests_no_truncate
  on public.os_docusign_archive_manifests;
create trigger os_docusign_archive_manifests_no_truncate
  before truncate on public.os_docusign_archive_manifests
  for each statement execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_archive_events_immutable
  on public.os_docusign_archive_events;
create trigger os_docusign_archive_events_immutable
  before update or delete on public.os_docusign_archive_events
  for each row execute function public.reject_docusign_phase39_evidence_mutation();
drop trigger if exists os_docusign_archive_events_no_truncate
  on public.os_docusign_archive_events;
create trigger os_docusign_archive_events_no_truncate
  before truncate on public.os_docusign_archive_events
  for each statement execute function public.reject_docusign_phase39_evidence_mutation();

create or replace function public.register_docusign_archive_manifest(
  p_envelope_id text,
  p_document_id text,
  p_entity_id text,
  p_file_kind text,
  p_provider_status text,
  p_content_length bigint,
  p_content_sha256 text,
  p_downloaded_at timestamptz,
  p_source_request_id text,
  p_source text
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_manifest public.os_docusign_archive_manifests%rowtype;
  v_request_manifest public.os_docusign_archive_manifests%rowtype;
  v_prior_manifest public.os_docusign_archive_manifests%rowtype;
  v_document public.os_documents%rowtype;
  v_projection public.os_docusign_envelopes%rowtype;
  v_event_type text;
  v_disposition text;
  v_event_key text;
begin
  if nullif(trim(p_envelope_id),'') is null
     or nullif(trim(p_document_id),'') is null
     or p_file_kind not in ('combined','certificate')
     or lower(trim(p_provider_status)) not in ('completed','signed')
     or p_content_length<1
     or p_content_length > (
       case when p_file_kind='combined' then 26214400 else 5242880 end
     )
     or p_content_sha256 !~ '^[0-9a-f]{64}$'
     or p_downloaded_at not between now()-interval '1 day' and now()+interval '2 minutes'
     or nullif(trim(p_source_request_id),'') is null
     or length(p_source_request_id)>200
     or p_source not in ('docusign','local_copy') then
    raise exception 'Invalid signed archive manifest';
  end if;
  if p_entity_id is not null and not exists (
    select 1 from public.entities e where e.entity_id=p_entity_id
  ) then raise exception 'Archive entity does not exist'; end if;
  select * into v_document from public.os_documents
  where doc_id=trim(p_document_id) for update;
  if not found
     or v_document.envelope_id is distinct from trim(p_envelope_id)
     or v_document.entity_id is distinct from p_entity_id then
    raise exception 'Archive document, envelope, and entity binding is invalid';
  end if;
  select * into v_projection from public.os_docusign_envelopes
  where envelope_id=trim(p_envelope_id) for update;
  if not found
     or v_projection.doc_id is distinct from trim(p_document_id)
     or v_projection.entity_id is distinct from p_entity_id then
    raise exception 'Archive envelope projection binding is invalid';
  end if;
  if not exists (
    select 1 from public.os_docusign_events e
    where e.envelope_id=trim(p_envelope_id)
      and e.doc_id=trim(p_document_id)
      and e.entity_id is not distinct from p_entity_id
      and lower(e.status) in ('completed','signed')
  ) then
    raise exception 'Durable completed provider event is required before archive';
  end if;
  select * into v_request_manifest
  from public.os_docusign_archive_manifests
  where source_request_id=trim(p_source_request_id)
    and file_kind=p_file_kind for update;
  if found and (
    v_request_manifest.envelope_id<>trim(p_envelope_id)
    or v_request_manifest.document_id<>trim(p_document_id)
    or v_request_manifest.entity_id is distinct from p_entity_id
  ) then
    v_event_key := 'archive-request-drift:'||encode(digest(concat_ws(':',
      trim(p_source_request_id),trim(p_envelope_id),trim(p_document_id),
      p_file_kind,p_content_sha256),'sha256'),'hex');
    insert into public.os_docusign_archive_events(
      event_key,manifest_id,envelope_id,document_id,entity_id,file_kind,
      event_type,source_request_id,content_length,content_sha256,detail)
    values(v_event_key,v_request_manifest.manifest_id,trim(p_envelope_id),
      trim(p_document_id),p_entity_id,p_file_kind,
      'request_identity_drift_blocked',trim(p_source_request_id),
      p_content_length,p_content_sha256,
      jsonb_build_object('canonical_envelope_id',
        v_request_manifest.envelope_id,'canonical_document_id',
        v_request_manifest.document_id))
    on conflict(event_key) do nothing;
    return jsonb_build_object('manifest_id',v_request_manifest.manifest_id,
      'disposition','request_identity_drift','accepted',false,
      'content_sha256',v_request_manifest.content_sha256);
  end if;
  select * into v_manifest from public.os_docusign_archive_manifests
  where envelope_id=trim(p_envelope_id)
    and document_id=trim(p_document_id) and file_kind=p_file_kind
  for update;
  if found then
    if v_manifest.content_sha256<>p_content_sha256
       or v_manifest.content_length<>p_content_length then
      v_event_type := 'content_replacement_blocked';
      v_disposition := 'content_drift';
    elsif v_manifest.entity_id is distinct from p_entity_id
       or lower(v_manifest.provider_status)<>lower(trim(p_provider_status))
       or v_manifest.source<>p_source then
      v_event_type := 'metadata_drift_blocked';
      v_disposition := 'metadata_drift';
    else
      v_event_type := 'manifest_replayed';
      v_disposition := 'replay';
    end if;
  else
    select * into v_prior_manifest
    from public.os_docusign_archive_manifests
    where document_id=trim(p_document_id) and file_kind=p_file_kind
      and envelope_id<>trim(p_envelope_id)
    order by created_at desc,manifest_id desc limit 1;
    if found and not exists (
      select 1 from public.os_docusign_envelope_lineage l
      where l.source_envelope_id=v_prior_manifest.envelope_id
        and l.replacement_envelope_id=trim(p_envelope_id)
        and l.entity_id is not distinct from p_entity_id
        and l.status='created'
    ) then
      raise exception 'Archive envelope replacement lacks approved lineage';
    end if;
    insert into public.os_docusign_archive_manifests(
      envelope_id,document_id,entity_id,file_kind,provider_status,
      content_length,content_sha256,downloaded_at,source_request_id,source,
      archive_contract_version,replaces_manifest_id)
    values(trim(p_envelope_id),trim(p_document_id),p_entity_id,p_file_kind,
      lower(trim(p_provider_status)),p_content_length,p_content_sha256,
      p_downloaded_at,trim(p_source_request_id),p_source,
      'phase39-v2',v_prior_manifest.manifest_id)
    returning * into v_manifest;
    v_event_type := case when v_prior_manifest.manifest_id is null
      then 'manifest_recorded' else 'replacement_manifest_recorded' end;
    v_disposition := 'recorded';
  end if;
  v_event_key := 'archive:'||encode(digest(concat_ws(':',
    trim(p_source_request_id),trim(p_envelope_id),p_file_kind,
    p_content_sha256,p_content_length::text,coalesce(p_entity_id,''),
    lower(trim(p_provider_status)),p_source),'sha256'),'hex');
  insert into public.os_docusign_archive_events(
    event_key,manifest_id,envelope_id,document_id,entity_id,file_kind,
    event_type,source_request_id,content_length,content_sha256,detail)
  values(v_event_key,v_manifest.manifest_id,trim(p_envelope_id),
    trim(p_document_id),p_entity_id,p_file_kind,v_event_type,
    trim(p_source_request_id),p_content_length,p_content_sha256,
    jsonb_build_object('provider_status',lower(trim(p_provider_status)),
      'downloaded_at',p_downloaded_at,'source',p_source,
      'canonical_sha256',v_manifest.content_sha256,
      'canonical_length',v_manifest.content_length,
      'replaces_manifest_id',v_manifest.replaces_manifest_id))
  on conflict(event_key) do nothing;
  return jsonb_build_object('manifest_id',v_manifest.manifest_id,
    'disposition',v_disposition,'accepted',
    v_disposition in ('recorded','replay'),
    'content_sha256',v_manifest.content_sha256);
end;
$$;

revoke insert,update,delete,truncate on public.os_docusign_signed_files
  from public,anon,authenticated;
revoke truncate on public.os_docusign_mapping_review_resolutions,
  public.os_docusign_mapping_review_events,
  public.os_docusign_archive_manifests,
  public.os_docusign_archive_events from public,anon,authenticated;
revoke all on function public.expire_docusign_mapping_reviews()
  from public,anon,authenticated;
revoke all on function public.propose_docusign_mapping_review_resolution(
  uuid,uuid,uuid,text,text,text,uuid,uuid,text,bigint)
  from public,anon,authenticated;
revoke all on function public.review_docusign_mapping_review_resolution(
  uuid,uuid,uuid,text,text,bigint,bigint)
  from public,anon,authenticated;
revoke all on function public.register_docusign_archive_manifest(
  text,text,text,text,text,bigint,text,timestamptz,text,text)
  from public,anon,authenticated;
grant execute on function public.expire_docusign_mapping_reviews()
  to service_role;
grant execute on function public.propose_docusign_mapping_review_resolution(
  uuid,uuid,uuid,text,text,text,uuid,uuid,text,bigint)
  to service_role;
grant execute on function public.review_docusign_mapping_review_resolution(
  uuid,uuid,uuid,text,text,bigint,bigint)
  to service_role;
grant execute on function public.register_docusign_archive_manifest(
  text,text,text,text,text,bigint,text,timestamptz,text,text)
  to service_role;
