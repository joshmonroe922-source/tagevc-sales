-- Phase 39: entity-bound paid-attribution revenue evidence and settlement lag.
-- Depends on phase34_marketing_analytics.sql and phase38_marketing_paid_reconciliation.sql.
-- Safe to re-run. Revenue evidence is append-only; corrections are new revisions.

create table if not exists public.os_marketing_paid_revenue_evidence (
  evidence_id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  lineage_key text not null,
  revision integer not null check (revision between 1 and 10000),
  supersedes_evidence_id uuid references
    public.os_marketing_paid_revenue_evidence(evidence_id),
  entity_id text not null references public.entities(entity_id),
  provider text not null check (provider in ('meta_ads','linkedin_ads')),
  ad_account_id text not null references
    public.os_marketing_social_accounts(account_id),
  external_account_id text not null,
  campaign_id text not null references
    public.os_marketing_campaigns(campaign_id),
  external_campaign_id text not null,
  revenue_event_id text not null,
  revenue_occurred_at timestamptz not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  attributed_amount_micros bigint not null
    check (attributed_amount_micros >= 0),
  settled_amount_micros bigint not null
    check (settled_amount_micros >= 0),
  settlement_status text not null check (settlement_status in
    ('pending','partial','settled','reversed')),
  expected_settlement_at timestamptz,
  settled_at timestamptz,
  attribution_window_days integer not null
    check (attribution_window_days between 1 and 90),
  attribution_model text not null check (attribution_model in
    ('first_touch','last_touch','linear','position_based','provider_reported')),
  attribution_model_version text not null,
  source_system text not null,
  source_record_id text not null,
  source_recorded_at timestamptz not null,
  source_payload jsonb,
  source_payload_sha256 text not null
    check (source_payload_sha256 ~ '^[0-9a-f]{64}$'),
  source_payload_verified boolean not null default false,
  evidence_contract_version text not null default 'phase39-v1',
  binding_sha256 text,
  evidence_sha256 text not null
    check (evidence_sha256 ~ '^[0-9a-f]{64}$'),
  received_at timestamptz not null default now(),
  created_by uuid,
  constraint os_mkt_revenue_lineage_revision_unique
    unique (lineage_key, revision),
  constraint os_mkt_revenue_source_revision_unique
    unique (provider, external_account_id, external_campaign_id,
      source_system, source_record_id, revision),
  constraint os_mkt_revenue_settlement_amount_check check (
    settled_amount_micros <= attributed_amount_micros
    or settlement_status = 'reversed'
  ),
  constraint os_mkt_revenue_settlement_state_check check (
    (settlement_status = 'pending'
      and settled_amount_micros = 0 and settled_at is null)
    or (settlement_status = 'partial'
      and settled_amount_micros > 0
      and settled_amount_micros < attributed_amount_micros
      and settled_at is null)
    or (settlement_status = 'settled'
      and settled_amount_micros = attributed_amount_micros
      and settled_at is not null)
    or (settlement_status = 'reversed'
      and settled_amount_micros = 0)
  ),
  constraint os_mkt_revenue_supersession_check check (
    (revision = 1 and supersedes_evidence_id is null)
    or (revision > 1 and supersedes_evidence_id is not null)
  )
);

alter table public.os_marketing_paid_revenue_evidence
  add column if not exists source_payload jsonb,
  add column if not exists source_payload_verified boolean not null default false,
  add column if not exists evidence_contract_version text not null
    default 'phase39-v1',
  add column if not exists binding_sha256 text;
alter table public.os_marketing_paid_revenue_evidence
  drop constraint if exists os_mkt_revenue_verified_source_check,
  drop constraint if exists os_mkt_revenue_binding_hash_check,
  drop constraint if exists os_mkt_revenue_source_revision_unique;
alter table public.os_marketing_paid_revenue_evidence
  add constraint os_mkt_revenue_verified_source_check check (
    not source_payload_verified or (
      evidence_contract_version = 'phase39-v2'
      and source_payload_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  add constraint os_mkt_revenue_binding_hash_check check (
    binding_sha256 is null or binding_sha256 ~ '^[0-9a-f]{64}$'
  ),
  add constraint os_mkt_revenue_source_revision_unique
    unique (provider, external_account_id, external_campaign_id,
      source_system, source_record_id, revenue_event_id, revision);

create index if not exists os_mkt_revenue_entity_date_idx
  on public.os_marketing_paid_revenue_evidence
  (entity_id, revenue_occurred_at desc);
create index if not exists os_mkt_revenue_campaign_date_idx
  on public.os_marketing_paid_revenue_evidence
  (campaign_id, revenue_occurred_at desc);
create index if not exists os_mkt_revenue_settlement_idx
  on public.os_marketing_paid_revenue_evidence
  (entity_id, settlement_status, expected_settlement_at);

alter table public.os_marketing_paid_revenue_evidence enable row level security;
drop policy if exists "os_mkt_revenue_evidence_select"
  on public.os_marketing_paid_revenue_evidence;
create policy "os_mkt_revenue_evidence_select"
  on public.os_marketing_paid_revenue_evidence for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
grant select on public.os_marketing_paid_revenue_evidence to authenticated;
grant select on public.os_marketing_paid_revenue_evidence to service_role;
revoke insert, update, delete, truncate, references, trigger
  on public.os_marketing_paid_revenue_evidence
  from public, anon, authenticated, service_role;

create or replace function public.prevent_marketing_revenue_evidence_mutation()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  raise exception 'Paid revenue evidence is append-only; record a revision';
end;
$$;
drop trigger if exists os_mkt_revenue_evidence_immutable
  on public.os_marketing_paid_revenue_evidence;
create trigger os_mkt_revenue_evidence_immutable
before update or delete on public.os_marketing_paid_revenue_evidence
for each row execute function public.prevent_marketing_revenue_evidence_mutation();
drop trigger if exists os_mkt_revenue_evidence_no_truncate
  on public.os_marketing_paid_revenue_evidence;
create trigger os_mkt_revenue_evidence_no_truncate
before truncate on public.os_marketing_paid_revenue_evidence
for each statement execute function
  public.prevent_marketing_revenue_evidence_mutation();

create or replace function public.record_marketing_paid_revenue_evidence(
  p_evidence jsonb,
  p_actor_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_account record;
  v_campaign record;
  v_previous public.os_marketing_paid_revenue_evidence%rowtype;
  v_existing public.os_marketing_paid_revenue_evidence%rowtype;
  v_inserted public.os_marketing_paid_revenue_evidence%rowtype;
  v_provider text;
  v_lineage_key text;
  v_canonical jsonb;
  v_source_payload jsonb;
  v_source_hash text;
  v_binding_hash text;
  v_hash text;
  v_revision integer;
  v_attributed bigint;
  v_settled bigint;
  v_revenue_at timestamptz;
  v_expected_at timestamptz;
  v_settled_at timestamptz;
  v_source_at timestamptz;
begin
  if jsonb_typeof(p_evidence) <> 'object'
     or octet_length(p_evidence::text) > 32768 then
    raise exception 'Revenue evidence must be a bounded JSON object';
  end if;
  if coalesce(p_evidence->>'idempotency_key','') !~
       '^[A-Za-z0-9][A-Za-z0-9:_./-]{7,199}$'
     or coalesce(p_evidence->>'revenue_event_id','') = ''
     or length(p_evidence->>'revenue_event_id') > 200
     or coalesce(p_evidence->>'source_system','') = ''
     or length(p_evidence->>'source_system') > 100
     or coalesce(p_evidence->>'source_record_id','') = ''
     or length(p_evidence->>'source_record_id') > 200
     or coalesce(p_evidence->>'attribution_model_version','') = ''
     or length(p_evidence->>'attribution_model_version') > 100
     or coalesce(p_evidence->>'currency','') !~ '^[A-Za-z]{3}$'
     or coalesce(p_evidence->>'attributed_amount','') !~
       '^\d{1,12}(\.\d{1,6})?$'
     or coalesce(p_evidence->>'settled_amount','') !~
       '^\d{1,12}(\.\d{1,6})?$'
     or octet_length(coalesce(p_evidence->>'source_payload_json',''))
       not between 3 and 16384
     or coalesce(p_evidence->>'settlement_status','') not in
       ('pending','partial','settled','reversed')
     or coalesce(p_evidence->>'attribution_model','') not in
       ('first_touch','last_touch','linear','position_based',
        'provider_reported') then
    raise exception 'Revenue evidence contract is malformed';
  end if;
  v_revision := coalesce((p_evidence->>'revision')::integer, 0);
  if v_revision < 1 or v_revision > 10000 then
    raise exception 'Revenue evidence revision is invalid';
  end if;
  v_attributed := ((p_evidence->>'attributed_amount')::numeric
    * 1000000)::bigint;
  v_settled := ((p_evidence->>'settled_amount')::numeric
    * 1000000)::bigint;
  v_revenue_at := (p_evidence->>'revenue_occurred_at')::timestamptz;
  v_expected_at :=
    nullif(p_evidence->>'expected_settlement_at','')::timestamptz;
  v_settled_at := nullif(p_evidence->>'settled_at','')::timestamptz;
  v_source_at := (p_evidence->>'source_recorded_at')::timestamptz;
  v_source_payload := (p_evidence->>'source_payload_json')::jsonb;
  if jsonb_typeof(v_source_payload) <> 'object'
     or v_source_payload = '{}'::jsonb
     or octet_length(v_source_payload::text) > 16384 then
    raise exception 'Source payload must be a bounded non-empty JSON object';
  end if;
  if v_revenue_at > now() + interval '5 minutes'
     or v_source_at > now() + interval '5 minutes'
     or v_source_at < v_revenue_at
     or (v_expected_at is not null and (
       v_expected_at < v_revenue_at
       or v_expected_at > v_revenue_at + interval '365 days'
     ))
     or (v_settled_at is not null and (
       v_settled_at < v_revenue_at
       or v_settled_at > now() + interval '5 minutes'
       or v_settled_at > v_source_at
     ))
     or (p_evidence->>'settlement_status' <> 'reversed'
       and v_expected_at is null)
     or (p_evidence->>'settlement_status' = 'reversed'
       and (v_attributed <> 0 or v_settled <> 0
         or v_expected_at is not null or v_settled_at is not null))
     or (p_evidence->>'settlement_status' <> 'reversed'
       and v_settled > v_attributed)
     or (p_evidence->>'settlement_status' = 'pending'
       and (v_settled <> 0 or v_settled_at is not null))
     or (p_evidence->>'settlement_status' = 'partial'
       and (v_settled <= 0 or v_settled >= v_attributed
         or v_settled_at is not null))
     or (p_evidence->>'settlement_status' = 'settled'
       and (v_settled <> v_attributed or v_settled_at is null)) then
    raise exception 'Revenue evidence timestamps or settlement state are inconsistent';
  end if;

  select account_id, entity_id, platform, external_account_id, currency,
    account_type, status, scope_status
  into v_account
  from public.os_marketing_social_accounts
  where account_id = p_evidence->>'ad_account_id' for share;
  if not found or v_account.account_type <> 'paid_ads'
     or v_account.status <> 'connected'
     or v_account.scope_status <> 'healthy' then
    raise exception 'Revenue evidence account binding is ineligible';
  end if;
  v_provider := case when v_account.platform = 'facebook' then 'meta_ads'
    when v_account.platform = 'linkedin' then 'linkedin_ads' end;
  if v_provider is null
     or v_provider is distinct from p_evidence->>'provider'
     or v_account.entity_id is distinct from p_evidence->>'entity_id'
     or v_account.external_account_id is distinct from
       p_evidence->>'external_account_id'
     or upper(v_account.currency) is distinct from
       upper(p_evidence->>'currency') then
    raise exception 'Revenue evidence provider/account/entity/currency binding mismatch';
  end if;

  select campaign_id, entity_id, ad_account_id, ad_platform,
    external_campaign_id, channel
  into v_campaign from public.os_marketing_campaigns
  where campaign_id = p_evidence->>'campaign_id' for share;
  if not found or v_campaign.channel <> 'paid'
     or v_campaign.entity_id is distinct from p_evidence->>'entity_id'
     or v_campaign.ad_account_id is distinct from p_evidence->>'ad_account_id'
     or v_campaign.ad_platform is distinct from v_provider
     or v_campaign.external_campaign_id is distinct from
       p_evidence->>'external_campaign_id' then
    raise exception 'Revenue evidence campaign binding mismatch';
  end if;

  v_lineage_key := encode(digest(jsonb_build_array(v_provider,
    v_account.external_account_id, v_campaign.external_campaign_id,
    p_evidence->>'source_system', p_evidence->>'source_record_id',
    p_evidence->>'revenue_event_id')::text, 'sha256'), 'hex');
  v_binding_hash := encode(digest(jsonb_build_object(
    'entity_id',v_account.entity_id,'provider',v_provider,
    'ad_account_id',v_account.account_id,
    'external_account_id',v_account.external_account_id,
    'campaign_id',v_campaign.campaign_id,
    'external_campaign_id',v_campaign.external_campaign_id,
    'currency',upper(v_account.currency)
  )::text, 'sha256'), 'hex');
  v_source_hash := encode(digest(v_source_payload::text, 'sha256'), 'hex');
  v_canonical := jsonb_build_object(
    'contract_version','phase39-v2',
    'lineage_key',v_lineage_key,'revision',v_revision,
    'supersedes_evidence_id',
      nullif(p_evidence->>'supersedes_evidence_id','')::uuid,
    'binding_sha256',v_binding_hash,
    'revenue_event_id',p_evidence->>'revenue_event_id',
    'revenue_occurred_at',to_char(v_revenue_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'currency',upper(v_account.currency),
    'attributed_amount_micros',v_attributed,
    'settled_amount_micros',v_settled,
    'settlement_status',p_evidence->>'settlement_status',
    'expected_settlement_at',case when v_expected_at is null then null
      else to_char(v_expected_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'settled_at',case when v_settled_at is null then null
      else to_char(v_settled_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') end,
    'attribution_window_days',
      (p_evidence->>'attribution_window_days')::integer,
    'attribution_model',p_evidence->>'attribution_model',
    'attribution_model_version',p_evidence->>'attribution_model_version',
    'source_system',p_evidence->>'source_system',
    'source_record_id',p_evidence->>'source_record_id',
    'source_recorded_at',to_char(v_source_at at time zone 'UTC',
      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'source_payload_sha256',v_source_hash
  );
  v_hash := encode(digest(v_canonical::text, 'sha256'), 'hex');

  perform pg_advisory_xact_lock(hashtextextended(
    p_evidence->>'idempotency_key', 38));
  select * into v_existing
  from public.os_marketing_paid_revenue_evidence
  where idempotency_key = p_evidence->>'idempotency_key';
  if found then
    if v_existing.evidence_sha256 <> v_hash then
      raise exception 'Idempotency key was replayed with different evidence';
    end if;
    return jsonb_build_object('evidence_id',v_existing.evidence_id,
      'revision',v_existing.revision,'created',false,
      'disposition','replayed');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_lineage_key, 39));
  select * into v_existing
  from public.os_marketing_paid_revenue_evidence
  where idempotency_key = p_evidence->>'idempotency_key';
  if found then
    if v_existing.evidence_sha256 <> v_hash then
      raise exception 'Idempotency key was replayed with different evidence';
    end if;
    return jsonb_build_object('evidence_id',v_existing.evidence_id,
      'revision',v_existing.revision,'created',false,
      'disposition','replayed');
  end if;
  select * into v_previous
  from public.os_marketing_paid_revenue_evidence
  where lineage_key = v_lineage_key
  order by revision desc limit 1;
  if (v_revision = 1 and found)
     or (v_revision > 1 and (
       not found or v_previous.revision <> v_revision - 1
       or v_previous.evidence_id::text is distinct from
         p_evidence->>'supersedes_evidence_id'
       or v_previous.binding_sha256 is distinct from v_binding_hash
       or not v_previous.source_payload_verified
       or v_previous.evidence_contract_version <> 'phase39-v2'
     )) then
    raise exception 'Revenue evidence revision lineage is inconsistent';
  end if;

  insert into public.os_marketing_paid_revenue_evidence (
    idempotency_key,lineage_key,revision,supersedes_evidence_id,
    entity_id,provider,ad_account_id,external_account_id,campaign_id,
    external_campaign_id,revenue_event_id,revenue_occurred_at,currency,
    attributed_amount_micros,settled_amount_micros,settlement_status,
    expected_settlement_at,settled_at,attribution_window_days,
    attribution_model,attribution_model_version,source_system,
    source_record_id,source_recorded_at,source_payload,
    source_payload_sha256,source_payload_verified,evidence_contract_version,
    binding_sha256,evidence_sha256,created_by
  ) values (
    p_evidence->>'idempotency_key',v_lineage_key,v_revision,
    nullif(p_evidence->>'supersedes_evidence_id','')::uuid,
    p_evidence->>'entity_id',v_provider,p_evidence->>'ad_account_id',
    v_account.external_account_id,p_evidence->>'campaign_id',
    v_campaign.external_campaign_id,p_evidence->>'revenue_event_id',
    v_revenue_at,
    upper(p_evidence->>'currency'),v_attributed,v_settled,
    p_evidence->>'settlement_status',
    v_expected_at,v_settled_at,
    (p_evidence->>'attribution_window_days')::integer,
    p_evidence->>'attribution_model',
    p_evidence->>'attribution_model_version',
    p_evidence->>'source_system',p_evidence->>'source_record_id',
    v_source_at,null,v_source_hash,true,'phase39-v2',
    v_binding_hash,v_hash,p_actor_id
  ) returning * into v_inserted;
  return jsonb_build_object('evidence_id',v_inserted.evidence_id,
    'revision',v_inserted.revision,'created',true,
    'disposition','recorded','evidence_sha256',v_inserted.evidence_sha256);
end;
$$;

create or replace function public.get_marketing_paid_attribution_report(
  p_entity_id text,
  p_days integer
) returns jsonb
language sql stable security invoker set search_path = public
as $$
with settings as (
  select least(greatest(coalesce(p_days,30),1),90) as expected_days,
    (now() at time zone 'UTC')::date
      - (least(greatest(coalesce(p_days,30),1),90) - 1) as start_date
),
ranked_all as (
  select e.*, row_number() over (
    partition by lineage_key order by revision desc, received_at desc,
      evidence_id desc
  ) as current_rank
  from public.os_marketing_paid_revenue_evidence e
  where p_entity_id is null or e.entity_id = p_entity_id
),
latest_window as (
  select r.*
  from ranked_all r, settings s
  where r.current_rank = 1
    and (r.revenue_occurred_at at time zone 'UTC')::date >= s.start_date
),
selected_revisions as (
  select r.* from ranked_all r
  where exists (
    select 1 from latest_window l where l.lineage_key = r.lineage_key
  )
),
current_evidence as (
  select *, case
    when settlement_status = 'settled'
      and expected_settlement_at is not null
      and settled_at > expected_settlement_at then 'settled_late'
    when settlement_status = 'settled' then 'settled_on_time'
    when settlement_status in ('pending','partial')
      and expected_settlement_at < now() then 'overdue'
    when settlement_status = 'reversed' then 'reversed'
    else 'pending' end as lag_status,
    case when settled_at is not null and expected_settlement_at is not null
      then greatest(0,ceil(extract(epoch from
        (settled_at - expected_settlement_at)) / 86400.0))::integer
      when expected_settlement_at is not null and expected_settlement_at < now()
      then greatest(0,ceil(extract(epoch from
        (now() - expected_settlement_at)) / 86400.0))::integer
      else null end as settlement_lag_days
  from latest_window
  where source_payload_verified
    and evidence_contract_version = 'phase39-v2'
),
currency_group_stats as (
  select count(distinct currency)::integer as group_count
  from current_evidence
),
campaign_group_stats as (
  select count(*)::integer as group_count from (
    select 1 from current_evidence
    group by campaign_id,external_campaign_id,provider,ad_account_id,currency,
      attribution_model,attribution_model_version,attribution_window_days
  ) grouped
),
currency_rows as (
  select currency,
    sum(attributed_amount_micros)::text as attributed_amount_micros,
    sum(settled_amount_micros)::text as settled_amount_micros,
    sum(attributed_amount_micros - settled_amount_micros)::text
      as unsettled_amount_micros,
    count(*)::integer as evidence_count,
    count(*) filter (where lag_status = 'overdue')::integer as overdue_count,
    count(*) filter (where lag_status = 'settled_late')::integer
      as settled_late_count
  from current_evidence group by currency
  order by currency limit 50
),
campaign_rows as (
  select campaign_id, external_campaign_id, provider, ad_account_id, currency,
    attribution_model, attribution_model_version, attribution_window_days,
    sum(attributed_amount_micros)::text as attributed_amount_micros,
    sum(settled_amount_micros)::text as settled_amount_micros,
    count(*)::integer as evidence_count,
    count(*) filter (where lag_status = 'overdue')::integer as overdue_count,
    max(settlement_lag_days)::integer as max_lag_days
  from current_evidence
  group by campaign_id,external_campaign_id,provider,ad_account_id,currency,
    attribution_model,attribution_model_version,attribution_window_days
  order by provider,campaign_id,currency,attribution_model,
    attribution_model_version,attribution_window_days
  limit 200
),
lag_rows as (
  select lag_status, count(*)::integer as evidence_count,
    max(settlement_lag_days)::integer as max_lag_days,
    round(avg(settlement_lag_days),2) as average_lag_days
  from current_evidence group by lag_status
  order by lag_status limit 10
)
select jsonb_build_object(
  'version','phase39-v2',
  'expected_days',(select expected_days from settings),
  'coverage_status',case
    when not exists (select 1 from latest_window) then 'unavailable'
    when exists (select 1 from latest_window
      where not source_payload_verified
        or evidence_contract_version <> 'phase39-v2') then 'incomplete'
    when exists (select 1 from current_evidence
      where settlement_status <> 'reversed'
        and expected_settlement_at is null) then 'incomplete'
    else 'complete' end,
  'current_evidence_count',(select count(*) from current_evidence),
  'unverified_current_count',(select count(*) from latest_window
    where not source_payload_verified
      or evidence_contract_version <> 'phase39-v2'),
  'revision_count',(select count(*) from selected_revisions),
  'late_revision_count',(select count(*) from selected_revisions
    where revision > 1),
  'oldest_unsettled_at',(select min(revenue_occurred_at)
    from current_evidence where settlement_status in ('pending','partial')),
  'currency_group_count',(select group_count from currency_group_stats),
  'currency_groups_truncated',
    (select group_count > 50 from currency_group_stats),
  'campaign_group_count',(select group_count from campaign_group_stats),
  'campaign_groups_truncated',
    (select group_count > 200 from campaign_group_stats),
  'currencies',coalesce((select jsonb_agg(to_jsonb(c) order by currency)
    from currency_rows c),'[]'::jsonb),
  'campaigns',coalesce((select jsonb_agg(to_jsonb(c)
    order by provider,campaign_id,currency) from campaign_rows c),'[]'::jsonb),
  'lag',coalesce((select jsonb_agg(to_jsonb(l) order by lag_status)
    from lag_rows l),'[]'::jsonb),
  'recent_evidence',coalesce((select jsonb_agg(jsonb_build_object(
    'evidence_id',evidence_id,'entity_id',entity_id,'campaign_id',campaign_id,
    'provider',provider,'currency',currency,
    'attributed_amount_micros',attributed_amount_micros::text,
    'settled_amount_micros',settled_amount_micros::text,
    'settlement_status',settlement_status,'lag_status',lag_status,
    'settlement_lag_days',settlement_lag_days,'revision',revision,
    'revenue_occurred_at',revenue_occurred_at,
    'expected_settlement_at',expected_settlement_at,'settled_at',settled_at,
    'attribution_model',attribution_model,
    'attribution_model_version',attribution_model_version,
    'attribution_window_days',attribution_window_days,
    'source_system',source_system,'source_record_id',source_record_id,
    'evidence_sha256',evidence_sha256
  ) order by received_at desc) from (
    select * from current_evidence order by received_at desc limit 200
  ) bounded),'[]'::jsonb)
);
$$;

revoke all on function public.record_marketing_paid_revenue_evidence(jsonb,uuid)
  from public, authenticated;
revoke all on function public.get_marketing_paid_attribution_report(text,integer)
  from public, anon, authenticated;
revoke all on function public.prevent_marketing_revenue_evidence_mutation()
  from public, authenticated;
grant execute on function public.record_marketing_paid_revenue_evidence(jsonb,uuid)
  to service_role;
grant execute on function public.get_marketing_paid_attribution_report(text,integer)
  to service_role;
