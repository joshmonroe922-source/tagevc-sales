-- Phase 58: Marketing Production Hardening.
-- Approval SLA reliability, publishing controls, entity brand-voice enforcement,
-- campaign/performance dashboards, Recruit acquisition intelligence (Appcast/
-- careers) for ENT-R619. Extends /shared-services/marketing + revenue surfaces.
-- Apply after Phase 57. Safe to re-run.
-- Append-only evidence only. Never auto-approves money. Never mutates
-- snapshot retirement tables.

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

create or replace function public.phase58_marketing_safe_detail(p_detail jsonb)
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

create or replace function public.reject_marketing_phase58_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'Marketing Phase 58 evidence is append-only';
end;
$$;

-- ---------------------------------------------------------------------------
-- Approval SLA reliability snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_approval_sla_phase58_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  in_review_count integer not null default 0 check (in_review_count >= 0),
  overdue_count integer not null default 0 check (overdue_count >= 0),
  due_soon_count integer not null default 0 check (due_soon_count >= 0),
  approved_count integer not null default 0 check (approved_count >= 0),
  sla_reliability_pct numeric(5,2)
    check (sla_reliability_pct is null or (sla_reliability_pct >= 0 and sla_reliability_pct <= 100)),
  board_status text not null default 'unknown'
    check (board_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_mkt_sla_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_sla_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false)
);

create index if not exists os_mkt_sla_p58_entity_created_idx
  on public.os_marketing_approval_sla_phase58_snapshots(entity_id, created_at desc);
create index if not exists os_mkt_sla_p58_created_idx
  on public.os_marketing_approval_sla_phase58_snapshots(created_at desc);

alter table public.os_marketing_approval_sla_phase58_snapshots
  enable row level security;
drop policy if exists "os_mkt_sla_p58_select"
  on public.os_marketing_approval_sla_phase58_snapshots;
create policy "os_mkt_sla_p58_select"
  on public.os_marketing_approval_sla_phase58_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_approval_sla_phase58_snapshots
  from public, anon, authenticated;
grant select on public.os_marketing_approval_sla_phase58_snapshots
  to authenticated;

drop trigger if exists os_mkt_sla_p58_immutable
  on public.os_marketing_approval_sla_phase58_snapshots;
create trigger os_mkt_sla_p58_immutable
  before update or delete on public.os_marketing_approval_sla_phase58_snapshots
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_sla_p58_no_truncate
  on public.os_marketing_approval_sla_phase58_snapshots;
create trigger os_mkt_sla_p58_no_truncate
  before truncate on public.os_marketing_approval_sla_phase58_snapshots
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Publishing controls events.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_publishing_controls_phase58_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  pending_jobs integer not null default 0 check (pending_jobs >= 0),
  failed_jobs integer not null default 0 check (failed_jobs >= 0),
  posted_jobs integer not null default 0 check (posted_jobs >= 0),
  gated_pending integer not null default 0 check (gated_pending >= 0),
  control_status text not null default 'missing'
    check (control_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_pub_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_pub_p58_no_publish_exec_check
    check (coalesce((detail->>'publish_executed')::boolean,false)=false),
  constraint os_mkt_pub_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false)
);

create index if not exists os_mkt_pub_p58_entity_created_idx
  on public.os_marketing_publishing_controls_phase58_events(entity_id, created_at desc);

alter table public.os_marketing_publishing_controls_phase58_events
  enable row level security;
drop policy if exists "os_mkt_pub_p58_select"
  on public.os_marketing_publishing_controls_phase58_events;
create policy "os_mkt_pub_p58_select"
  on public.os_marketing_publishing_controls_phase58_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_publishing_controls_phase58_events
  from public, anon, authenticated;
grant select on public.os_marketing_publishing_controls_phase58_events
  to authenticated;

drop trigger if exists os_mkt_pub_p58_immutable
  on public.os_marketing_publishing_controls_phase58_events;
create trigger os_mkt_pub_p58_immutable
  before update or delete on public.os_marketing_publishing_controls_phase58_events
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_pub_p58_no_truncate
  on public.os_marketing_publishing_controls_phase58_events;
create trigger os_mkt_pub_p58_no_truncate
  before truncate on public.os_marketing_publishing_controls_phase58_events
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Brand-voice enforcement evidence.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_brand_voice_phase58_enforcement (
  evidence_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  voices_configured integer not null default 0 check (voices_configured >= 0),
  content_without_voice integer not null default 0 check (content_without_voice >= 0),
  enforcement_status text not null default 'missing'
    check (enforcement_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_mkt_voice_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase58_marketing_safe_detail(detail)
    )
);

create index if not exists os_mkt_voice_p58_entity_created_idx
  on public.os_marketing_brand_voice_phase58_enforcement(entity_id, created_at desc);

alter table public.os_marketing_brand_voice_phase58_enforcement
  enable row level security;
drop policy if exists "os_mkt_voice_p58_select"
  on public.os_marketing_brand_voice_phase58_enforcement;
create policy "os_mkt_voice_p58_select"
  on public.os_marketing_brand_voice_phase58_enforcement for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_brand_voice_phase58_enforcement
  from public, anon, authenticated;
grant select on public.os_marketing_brand_voice_phase58_enforcement
  to authenticated;

drop trigger if exists os_mkt_voice_p58_immutable
  on public.os_marketing_brand_voice_phase58_enforcement;
create trigger os_mkt_voice_p58_immutable
  before update or delete on public.os_marketing_brand_voice_phase58_enforcement
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_voice_p58_no_truncate
  on public.os_marketing_brand_voice_phase58_enforcement;
create trigger os_mkt_voice_p58_no_truncate
  before truncate on public.os_marketing_brand_voice_phase58_enforcement
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Campaign / performance dashboard snapshots.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_campaign_perf_phase58_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  active_campaigns integer not null default 0 check (active_campaigns >= 0),
  paid_campaigns integer not null default 0 check (paid_campaigns >= 0),
  organic_campaigns integer not null default 0 check (organic_campaigns >= 0),
  performance_status text not null default 'missing'
    check (performance_status in ('ok','partial','missing','unknown')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_mkt_perf_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_perf_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false)
);

create index if not exists os_mkt_perf_p58_entity_created_idx
  on public.os_marketing_campaign_perf_phase58_snapshots(entity_id, created_at desc);

alter table public.os_marketing_campaign_perf_phase58_snapshots
  enable row level security;
drop policy if exists "os_mkt_perf_p58_select"
  on public.os_marketing_campaign_perf_phase58_snapshots;
create policy "os_mkt_perf_p58_select"
  on public.os_marketing_campaign_perf_phase58_snapshots for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_campaign_perf_phase58_snapshots
  from public, anon, authenticated;
grant select on public.os_marketing_campaign_perf_phase58_snapshots
  to authenticated;

drop trigger if exists os_mkt_perf_p58_immutable
  on public.os_marketing_campaign_perf_phase58_snapshots;
create trigger os_mkt_perf_p58_immutable
  before update or delete on public.os_marketing_campaign_perf_phase58_snapshots
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_perf_p58_no_truncate
  on public.os_marketing_campaign_perf_phase58_snapshots;
create trigger os_mkt_perf_p58_no_truncate
  before truncate on public.os_marketing_campaign_perf_phase58_snapshots
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Recruit acquisition intelligence (job boards / careers) — ENT-R619 first.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_recruit_acquisition_phase58_events (
  event_id uuid primary key default gen_random_uuid(),
  entity_id text not null
    check (entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  source_kind text not null
    check (source_kind in ('job_board','careers','combined','manual_stub')),
  applications integer not null default 0 check (applications >= 0),
  clicks integer not null default 0 check (clicks >= 0),
  spend_observe numeric(14,2)
    check (spend_observe is null or spend_observe >= 0),
  feed_status text not null default 'missing'
    check (feed_status in ('ok','partial','missing','unknown')),
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_mkt_acq_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_acq_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false)
);

create index if not exists os_mkt_acq_p58_entity_created_idx
  on public.os_marketing_recruit_acquisition_phase58_events(entity_id, created_at desc);

alter table public.os_marketing_recruit_acquisition_phase58_events
  enable row level security;
drop policy if exists "os_mkt_acq_p58_select"
  on public.os_marketing_recruit_acquisition_phase58_events;
create policy "os_mkt_acq_p58_select"
  on public.os_marketing_recruit_acquisition_phase58_events for select to authenticated
  using (
    public.is_firm_wide_access()
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_recruit_acquisition_phase58_events
  from public, anon, authenticated;
grant select on public.os_marketing_recruit_acquisition_phase58_events
  to authenticated;

drop trigger if exists os_mkt_acq_p58_immutable
  on public.os_marketing_recruit_acquisition_phase58_events;
create trigger os_mkt_acq_p58_immutable
  before update or delete on public.os_marketing_recruit_acquisition_phase58_events
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_acq_p58_no_truncate
  on public.os_marketing_recruit_acquisition_phase58_events;
create trigger os_mkt_acq_p58_no_truncate
  before truncate on public.os_marketing_recruit_acquisition_phase58_events
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Money-impacting publish dual-approve proposals.
-- NEVER auto-approves money. NEVER executes publish from this gate.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_publish_phase58_proposals (
  proposal_id uuid primary key default gen_random_uuid(),
  proposal_key text not null unique
    check (proposal_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  action_kind text not null
    check (action_kind in (
      'paid_publish','budget_change','campaign_go_live',
      'brand_voice_override','other_money_impact'
    )),
  summary text not null check (char_length(summary) between 2 and 500),
  proposed_by uuid not null,
  status text not null default 'pending'
    check (status in (
      'pending','rejected','dual_approved','blocked','superseded'
    )),
  source_proposal_id uuid,
  block_reason text,
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_pubprop_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=8192
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_pubprop_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false),
  constraint os_mkt_pubprop_p58_no_publish_exec_check
    check (coalesce((detail->>'publish_executed')::boolean,false)=false),
  constraint os_mkt_pubprop_p58_dual_required_check
    check (coalesce((detail->>'dual_approve_required')::boolean,true)=true)
);

create unique index if not exists os_mkt_pubprop_p58_one_pending_per_key
  on public.os_marketing_publish_phase58_proposals(proposal_key)
  where status = 'pending';

create index if not exists os_mkt_pubprop_p58_status_created_idx
  on public.os_marketing_publish_phase58_proposals(status, created_at desc);
create index if not exists os_mkt_pubprop_p58_entity_idx
  on public.os_marketing_publish_phase58_proposals(entity_id, created_at desc);

alter table public.os_marketing_publish_phase58_proposals
  enable row level security;
drop policy if exists "os_mkt_pubprop_p58_select"
  on public.os_marketing_publish_phase58_proposals;
create policy "os_mkt_pubprop_p58_select"
  on public.os_marketing_publish_phase58_proposals for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_publish_phase58_proposals
  from public, anon, authenticated;
grant select on public.os_marketing_publish_phase58_proposals
  to authenticated;

drop trigger if exists os_mkt_pubprop_p58_immutable
  on public.os_marketing_publish_phase58_proposals;
create trigger os_mkt_pubprop_p58_immutable
  before update or delete on public.os_marketing_publish_phase58_proposals
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_pubprop_p58_no_truncate
  on public.os_marketing_publish_phase58_proposals;
create trigger os_mkt_pubprop_p58_no_truncate
  before truncate on public.os_marketing_publish_phase58_proposals
  for each statement execute function public.reject_marketing_phase58_mutation();

create table if not exists public.os_marketing_publish_phase58_approvals (
  approval_id uuid primary key default gen_random_uuid(),
  approval_key text not null unique
    check (approval_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  proposal_id uuid not null
    references public.os_marketing_publish_phase58_proposals(proposal_id),
  actor_id uuid not null,
  decision text not null check (decision in ('approve','reject')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_pubappr_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase58_marketing_safe_detail(detail)
    )
);

create index if not exists os_mkt_pubappr_p58_proposal_idx
  on public.os_marketing_publish_phase58_approvals(proposal_id, created_at desc);

alter table public.os_marketing_publish_phase58_approvals
  enable row level security;
drop policy if exists "os_mkt_pubappr_p58_select"
  on public.os_marketing_publish_phase58_approvals;
create policy "os_mkt_pubappr_p58_select"
  on public.os_marketing_publish_phase58_approvals for select to authenticated
  using (true);
revoke all on public.os_marketing_publish_phase58_approvals
  from public, anon, authenticated;
grant select on public.os_marketing_publish_phase58_approvals
  to authenticated;

drop trigger if exists os_mkt_pubappr_p58_immutable
  on public.os_marketing_publish_phase58_approvals;
create trigger os_mkt_pubappr_p58_immutable
  before update or delete on public.os_marketing_publish_phase58_approvals
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_pubappr_p58_no_truncate
  on public.os_marketing_publish_phase58_approvals;
create trigger os_mkt_pubappr_p58_no_truncate
  before truncate on public.os_marketing_publish_phase58_approvals
  for each statement execute function public.reject_marketing_phase58_mutation();

-- ---------------------------------------------------------------------------
-- Ops alerts.
-- ---------------------------------------------------------------------------
create table if not exists public.os_marketing_phase58_ops_alerts (
  alert_id uuid primary key default gen_random_uuid(),
  entity_id text
    check (entity_id is null or entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  alert_kind text not null
    check (alert_kind in (
      'approval_sla_gap','publishing_control_gap','brand_voice_gap',
      'campaign_perf_gap','recruit_feed_missing','dual_approve_required',
      'refresh_failed'
    )),
  reference_id uuid,
  window_key text not null unique
    check (window_key ~ '^[A-Za-z0-9][A-Za-z0-9:._-]{7,199}$'),
  severity text not null default 'warning'
    check (severity in ('info','warning','critical')),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint os_mkt_ops_p58_detail_check
    check (
      jsonb_typeof(detail)='object'
      and pg_column_size(detail)<=4096
      and public.phase58_marketing_safe_detail(detail)
    ),
  constraint os_mkt_ops_p58_no_money_auto_check
    check (coalesce((detail->>'money_auto_approved')::boolean,false)=false)
);

create index if not exists os_mkt_ops_p58_created_idx
  on public.os_marketing_phase58_ops_alerts(created_at desc);

alter table public.os_marketing_phase58_ops_alerts enable row level security;
drop policy if exists "os_mkt_ops_p58_select"
  on public.os_marketing_phase58_ops_alerts;
create policy "os_mkt_ops_p58_select"
  on public.os_marketing_phase58_ops_alerts for select to authenticated
  using (
    public.is_firm_wide_access()
    or entity_id is null
    or public.can_access_entity(entity_id)
  );
revoke all on public.os_marketing_phase58_ops_alerts
  from public, anon, authenticated;
grant select on public.os_marketing_phase58_ops_alerts
  to authenticated;

drop trigger if exists os_mkt_ops_p58_immutable
  on public.os_marketing_phase58_ops_alerts;
create trigger os_mkt_ops_p58_immutable
  before update or delete on public.os_marketing_phase58_ops_alerts
  for each row execute function public.reject_marketing_phase58_mutation();
drop trigger if exists os_mkt_ops_p58_no_truncate
  on public.os_marketing_phase58_ops_alerts;
create trigger os_mkt_ops_p58_no_truncate
  before truncate on public.os_marketing_phase58_ops_alerts
  for each statement execute function public.reject_marketing_phase58_mutation();


-- ---------------------------------------------------------------------------
-- Propose money-impacting publish / budget action (NEVER executes).
-- ---------------------------------------------------------------------------
create or replace function public.propose_marketing_publish_phase58(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_kind text := nullif(trim(coalesce(p_payload->>'action_kind','')),'');
  v_summary text := nullif(trim(coalesce(p_payload->>'summary','')),'');
  v_actor uuid := nullif(p_payload->>'proposed_by','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_key text;
  v_hash text;
  v_row public.os_marketing_publish_phase58_proposals%rowtype;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 58 publish proposal payload must be a JSON object';
  end if;
  if v_actor is null
    or v_summary is null or char_length(v_summary) < 2
    or v_kind is null
    or v_kind not in (
      'paid_publish','budget_change','campaign_go_live',
      'brand_voice_override','other_money_impact'
    )
    or not public.phase58_marketing_safe_detail(v_meta) then
    raise exception 'Phase 58 publish proposal requires proposed_by, summary, action_kind, and safe detail';
  end if;
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 58 publish proposal';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 58 publish proposal';
  end if;

  -- Never auto-approve money / never execute publish from this gate.
  v_key := left(
    'mpub58:' || coalesce(v_entity,'firm') || ':' || v_kind || ':'
      || public.os_sha256_hex(v_summary || '|' || v_actor::text),
    200
  );

  select * into v_row
  from public.os_marketing_publish_phase58_proposals
  where proposal_key = v_key and status = 'pending'
  order by created_at desc
  limit 1;
  if v_row.proposal_id is not null then
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','unchanged',
      'status','pending',
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'money_auto_approved',false,
      'publish_executed',false,
      'dual_approve_required',true
    );
  end if;

  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase58-v1',
    'kind','publish_proposal',
    'proposal_key',v_key,
    'entity_id',v_entity,
    'action_kind',v_kind,
    'proposed_by',v_actor
  )::text);

  insert into public.os_marketing_publish_phase58_proposals (
    proposal_key, entity_id, action_kind, summary, proposed_by,
    status, metrics_sha256, detail
  ) values (
    v_key, v_entity, v_kind, left(v_summary,500), v_actor,
    'pending', v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'publish_executed',false,
      'dual_approve_required',true,
      'operator_must_execute_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_row;

  if v_row.proposal_id is null then
    select * into v_row
    from public.os_marketing_publish_phase58_proposals
    where proposal_key = v_key
    order by created_at desc
    limit 1;
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','unchanged',
      'status',v_row.status,
      'proposal_id',v_row.proposal_id,
      'proposal_key',v_row.proposal_key,
      'money_auto_approved',false,
      'publish_executed',false,
      'dual_approve_required',true
    );
  end if;

  insert into public.os_marketing_phase58_ops_alerts (
    entity_id, alert_kind, reference_id, window_key, severity,
    metrics_sha256, detail
  ) values (
    v_entity, 'dual_approve_required', v_row.proposal_id,
    left('phase58:alert:dual_approve:' || v_row.proposal_id::text, 200),
    'warning', v_hash,
    jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'publish_executed',false,
      'proposal_id',v_row.proposal_id,
      'action_kind',v_kind
    )
  ) on conflict (window_key) do nothing;

  return jsonb_build_object(
    'version','phase58-v1',
    'disposition','proposed',
    'status','pending',
    'proposal_id',v_row.proposal_id,
    'proposal_key',v_row.proposal_key,
    'money_auto_approved',false,
    'publish_executed',false,
    'dual_approve_required',true
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Dual-human approval for money-impacting publish proposals.
-- After 2 DISTINCT approvers (neither is the proposer), status becomes
-- dual_approved. Tage NEVER auto-approves money or executes publish here.
-- ---------------------------------------------------------------------------
create or replace function public.approve_marketing_publish_phase58(
  p_proposal_id uuid,
  p_actor_id uuid,
  p_decision text default 'approve',
  p_detail jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_meta jsonb := coalesce(p_detail, '{}'::jsonb);
  v_decision text := coalesce(nullif(trim(lower(p_decision)), ''), 'approve');
  v_proposal public.os_marketing_publish_phase58_proposals%rowtype;
  v_approval_key text;
  v_hash text;
  v_id uuid;
  v_distinct_approvers integer := 0;
  v_result_key text;
  v_result_row public.os_marketing_publish_phase58_proposals%rowtype;
begin
  if p_proposal_id is null or p_actor_id is null
    or v_decision not in ('approve','reject')
    or not public.phase58_marketing_safe_detail(v_meta) then
    raise exception 'Phase 58 dual-approve publish contract is invalid or unsafe';
  end if;

  select * into v_proposal
  from public.os_marketing_publish_phase58_proposals
  where proposal_id = p_proposal_id;
  if v_proposal.proposal_id is null then
    raise exception 'Phase 58 publish proposal is unknown';
  end if;
  if v_proposal.proposed_by = p_actor_id then
    raise exception 'Proposer may not also approve their own Phase 58 publish proposal';
  end if;
  if v_proposal.status <> 'pending' then
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','unchanged',
      'status',v_proposal.status,
      'proposal_id',v_proposal.proposal_id,
      'money_auto_approved',false,
      'publish_executed',false
    );
  end if;

  v_approval_key := left(p_proposal_id::text || ':' || p_actor_id::text, 200);
  v_hash := public.os_sha256_hex(jsonb_build_object(
    'version','phase58-v1',
    'kind','publish_approval',
    'proposal_id',p_proposal_id,
    'actor_id',p_actor_id,
    'decision',v_decision
  )::text);

  insert into public.os_marketing_publish_phase58_approvals (
    approval_key, proposal_id, actor_id, decision, metrics_sha256, detail
  ) values (
    v_approval_key, p_proposal_id, p_actor_id, v_decision, v_hash,
    v_meta || jsonb_build_object('contract_version','phase58-v1')
  )
  on conflict (approval_key) do nothing
  returning approval_id into v_id;

  if v_id is null then
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','unchanged',
      'status','duplicate_actor_decision',
      'proposal_id',p_proposal_id,
      'money_auto_approved',false,
      'publish_executed',false
    );
  end if;

  if v_decision = 'reject' then
    v_result_key := left('mpub58:rejected:' || p_proposal_id::text, 200);
    insert into public.os_marketing_publish_phase58_proposals (
      proposal_key, source_proposal_id, entity_id, action_kind,
      summary, proposed_by, status, block_reason, metrics_sha256, detail
    ) values (
      v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
      v_proposal.summary, v_proposal.proposed_by, 'rejected',
      'rejected_by_approver',
      public.os_sha256_hex('reject:' || p_proposal_id::text),
      v_meta || jsonb_build_object(
        'contract_version','phase58-v1',
        'money_auto_approved',false,
        'publish_executed',false,
        'dual_approve_required',true
      )
    )
    on conflict (proposal_key) do nothing;
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','rejected',
      'status','rejected',
      'proposal_id',p_proposal_id,
      'money_auto_approved',false,
      'publish_executed',false
    );
  end if;

  select count(distinct actor_id)::integer into v_distinct_approvers
  from public.os_marketing_publish_phase58_approvals
  where proposal_id = p_proposal_id
    and decision = 'approve'
    and actor_id <> v_proposal.proposed_by;

  if v_distinct_approvers < 2 then
    return jsonb_build_object(
      'version','phase58-v1',
      'disposition','awaiting_second_approval',
      'status','pending',
      'proposal_id',p_proposal_id,
      'distinct_approvers',v_distinct_approvers,
      'money_auto_approved',false,
      'publish_executed',false
    );
  end if;

  -- Dual-human gate satisfied. NEVER auto-approve money / execute publish.
  v_result_key := left('mpub58:dual_approved:' || p_proposal_id::text, 200);
  insert into public.os_marketing_publish_phase58_proposals (
    proposal_key, source_proposal_id, entity_id, action_kind,
    summary, proposed_by, status, metrics_sha256, detail
  ) values (
    v_result_key, p_proposal_id, v_proposal.entity_id, v_proposal.action_kind,
    v_proposal.summary, v_proposal.proposed_by, 'dual_approved',
    public.os_sha256_hex('dual_approved:' || p_proposal_id::text),
    v_meta || jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'publish_executed',false,
      'dual_approve_required',true,
      'dual_approved',true,
      'operator_must_execute_after_dual_approve',true
    )
  )
  on conflict (proposal_key) do nothing
  returning * into v_result_row;

  return jsonb_build_object(
    'version','phase58-v1',
    'disposition','dual_approved',
    'status','dual_approved',
    'proposal_id',coalesce(v_result_row.proposal_id,p_proposal_id),
    'source_proposal_id',p_proposal_id,
    'distinct_approvers',v_distinct_approvers,
    'money_auto_approved',false,
    'publish_executed',false,
    'todo','Operator executes money-impacting publish after dual-approve (never auto-approve money)'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Record Recruit acquisition intake stub (job boards / careers) — observe only.
-- ---------------------------------------------------------------------------
create or replace function public.record_recruit_acquisition_intake_phase58(
  p_payload jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_payload->>'entity_id','')),'');
  v_source text := nullif(trim(coalesce(p_payload->>'source_kind','')),'');
  v_apps integer := coalesce((p_payload->>'applications')::integer, 0);
  v_clicks integer := coalesce((p_payload->>'clicks')::integer, 0);
  v_spend numeric := nullif(p_payload->>'spend_observe','')::numeric;
  v_feed text := nullif(trim(coalesce(p_payload->>'feed_status','')),'');
  v_actor uuid := nullif(p_payload->>'actor_id','')::uuid;
  v_meta jsonb := coalesce(p_payload->'detail', '{}'::jsonb);
  v_window text;
  v_hash text;
  v_id uuid;
begin
  if jsonb_typeof(coalesce(p_payload,'{}'::jsonb)) <> 'object' then
    raise exception 'Phase 58 recruit acquisition payload must be a JSON object';
  end if;
  if v_entity is null then
    v_entity := 'ENT-R619';
  end if;
  if v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 58 recruit acquisition';
  end if;
  if v_source is null then
    v_source := 'manual_stub';
  end if;
  if v_source not in ('job_board','careers','combined','manual_stub') then
    raise exception 'Invalid source_kind for Phase 58 recruit acquisition';
  end if;
  if v_feed is null then
    v_feed := 'missing';
  end if;
  if v_feed not in ('ok','partial','missing','unknown')
    or v_apps < 0 or v_clicks < 0
    or (v_spend is not null and v_spend < 0)
    or not public.phase58_marketing_safe_detail(v_meta) then
    raise exception 'Phase 58 recruit acquisition contract is invalid or unsafe';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 58 recruit acquisition';
  end if;

  v_window := left(
    'phase58:acq:' || v_entity || ':' || v_source || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24MI'),
    200
  );
  v_hash := public.os_sha256_hex(
    v_entity || '|' || v_source || '|' || v_feed || '|' || v_window
  );

  insert into public.os_marketing_recruit_acquisition_phase58_events (
    entity_id, source_kind, applications, clicks, spend_observe,
    feed_status, window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, v_source, v_apps, v_clicks, v_spend, v_feed,
    v_window, v_hash,
    v_meta || jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'todo', case
        when v_feed = 'missing'
          then 'TODO: wire job boards / careers feed for ENT-R619'
        else null
      end
    ),
    v_actor
  )
  on conflict (window_key) do nothing
  returning event_id into v_id;

  if v_id is null then
    select event_id into v_id
    from public.os_marketing_recruit_acquisition_phase58_events
    where window_key = v_window;
  end if;

  if v_feed = 'missing' then
    insert into public.os_marketing_phase58_ops_alerts (
      entity_id, alert_kind, reference_id, window_key, severity,
      metrics_sha256, detail
    ) values (
      v_entity, 'recruit_feed_missing', v_id,
      left('phase58:alert:acq_missing:' || v_entity || ':' ||
        to_char(now() at time zone 'utc','YYYY-MM-DD'), 200),
      'warning', v_hash,
      jsonb_build_object(
        'contract_version','phase58-v1',
        'source_kind', v_source,
        'money_auto_approved', false,
        'todo', 'TODO: wire job boards / careers feed for ENT-R619'
      )
    ) on conflict (window_key) do nothing;
  end if;

  return jsonb_build_object(
    'event_id', v_id,
    'entity_id', v_entity,
    'source_kind', v_source,
    'feed_status', v_feed,
    'money_auto_approved', false,
    'contract_version', 'phase58-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Refresh Marketing hardening board (observe + evidence only).
-- Never auto-approves money. Never executes publish.
-- ---------------------------------------------------------------------------
create or replace function public.refresh_marketing_hardening_phase58(
  p_actor_id uuid default null,
  p_entity_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_in_review integer := 0;
  v_overdue integer := 0;
  v_due_soon integer := 0;
  v_approved integer := 0;
  v_pending_jobs integer := 0;
  v_failed_jobs integer := 0;
  v_posted_jobs integer := 0;
  v_voices integer := 0;
  v_content_no_voice integer := 0;
  v_active_camp integer := 0;
  v_paid_camp integer := 0;
  v_organic_camp integer := 0;
  v_pending_pub integer := 0;
  v_sla_pct numeric(5,2);
  v_board text := 'missing';
  v_pub_status text := 'missing';
  v_voice_status text := 'missing';
  v_perf_status text := 'missing';
  v_acq_status text := 'missing';
  v_window text;
  v_hash text;
  v_id uuid;
  v_has_content boolean := false;
  v_has_schedule boolean := false;
  v_has_voices boolean := false;
  v_has_campaigns boolean := false;
  v_den integer := 0;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 58 marketing refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 58 marketing refresh';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 58 marketing refresh';
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_marketing_content'
  ) into v_has_content;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_marketing_schedule_jobs'
  ) into v_has_schedule;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_marketing_brand_voices'
  ) into v_has_voices;
  select exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='os_marketing_campaigns'
  ) into v_has_campaigns;

  if v_has_content then
    begin
      execute
        'select
           count(*) filter (where status = ''review'')::integer,
           count(*) filter (
             where status = ''review''
               and approval_due_at is not null
               and approval_due_at < now()
           )::integer,
           count(*) filter (
             where status = ''review''
               and approval_due_at is not null
               and approval_due_at >= now()
               and approval_due_at < now() + interval ''24 hours''
           )::integer,
           count(*) filter (where status = ''approved'')::integer
         from public.os_marketing_content
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_in_review, v_overdue, v_due_soon, v_approved
      using v_entity;
    exception when others then
      v_in_review := 0;
      v_overdue := 0;
      v_due_soon := 0;
      v_approved := 0;
    end;
  end if;

  if v_has_schedule then
    begin
      execute
        'select
           count(*) filter (where status in (''pending'',''queued'',''running''))::integer,
           count(*) filter (where status = ''failed'')::integer,
           count(*) filter (where status in (''posted'',''completed'',''done''))::integer
         from public.os_marketing_schedule_jobs
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_pending_jobs, v_failed_jobs, v_posted_jobs
      using v_entity;
    exception when others then
      v_pending_jobs := 0;
      v_failed_jobs := 0;
      v_posted_jobs := 0;
    end;
  end if;

  if v_has_voices then
    begin
      execute
        'select count(*)::integer
         from public.os_marketing_brand_voices
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_voices
      using v_entity;
    exception when others then
      v_voices := 0;
    end;
  end if;

  if v_has_content and v_has_voices then
    begin
      execute
        'select count(*)::integer
         from public.os_marketing_content c
         where c.status in (''draft'',''review'',''approved'')
           and ($1::text is null or c.entity_id = $1 or c.entity_id is null)
           and not exists (
             select 1 from public.os_marketing_brand_voices v
             where coalesce(v.entity_id, ) = coalesce(c.entity_id, )
           )'
      into v_content_no_voice
      using v_entity;
    exception when others then
      v_content_no_voice := 0;
    end;
  end if;

  if v_has_campaigns then
    begin
      execute
        'select
           count(*) filter (
             where status in (''active'',''live'',''running'',''scheduled'')
           )::integer,
           count(*) filter (where channel = ''paid'')::integer,
           count(*) filter (
             where coalesce(channel, ''organic'') = ''organic''
           )::integer
         from public.os_marketing_campaigns
         where ($1::text is null or entity_id = $1 or entity_id is null)'
      into v_active_camp, v_paid_camp, v_organic_camp
      using v_entity;
    exception when others then
      begin
        execute
          'select
             count(*) filter (
               where status in (''active'',''live'',''running'',''scheduled'')
             )::integer,
             0::integer,
             count(*)::integer
           from public.os_marketing_campaigns
           where ($1::text is null or entity_id = $1 or entity_id is null)'
        into v_active_camp, v_paid_camp, v_organic_camp
        using v_entity;
      exception when others then
        v_active_camp := 0;
        v_paid_camp := 0;
        v_organic_camp := 0;
      end;
    end;
  end if;

  select count(*)::integer into v_pending_pub
  from public.os_marketing_publish_phase58_proposals p
  where p.status = 'pending'
    and p.source_proposal_id is null
    and (v_entity is null or p.entity_id = v_entity)
    and not exists (
      select 1
      from public.os_marketing_publish_phase58_proposals c
      where c.source_proposal_id = p.proposal_id
        and c.status in ('dual_approved','rejected','blocked','superseded')
    );

  v_den := coalesce(v_in_review,0) + coalesce(v_approved,0);
  if v_den > 0 then
    v_sla_pct := round(
      ((v_den - coalesce(v_overdue,0))::numeric / v_den::numeric) * 100,
      2
    );
    if coalesce(v_overdue,0) = 0 and coalesce(v_in_review,0) >= 0 then
      if coalesce(v_due_soon,0) = 0 then
        v_board := 'ok';
      else
        v_board := 'partial';
      end if;
    else
      v_board := 'partial';
    end if;
  else
    -- TODO: seed approval queue when marketing content enters review.
    v_board := 'missing';
    v_sla_pct := null;
  end if;

  if coalesce(v_pending_jobs,0) + coalesce(v_failed_jobs,0) + coalesce(v_posted_jobs,0) > 0 then
    if coalesce(v_failed_jobs,0) = 0 and coalesce(v_pending_pub,0) = 0 then
      v_pub_status := 'ok';
    else
      v_pub_status := 'partial';
    end if;
  elsif v_has_schedule then
    v_pub_status := 'partial';
  else
    v_pub_status := 'missing';
  end if;

  if coalesce(v_voices,0) > 0 and coalesce(v_content_no_voice,0) = 0 then
    v_voice_status := 'ok';
  elsif coalesce(v_voices,0) > 0 then
    v_voice_status := 'partial';
  else
    v_voice_status := 'missing';
  end if;

  if coalesce(v_active_camp,0) + coalesce(v_paid_camp,0) + coalesce(v_organic_camp,0) > 0 then
    v_perf_status := 'partial';
    if coalesce(v_active_camp,0) > 0 then
      v_perf_status := 'ok';
    end if;
  else
    v_perf_status := 'missing';
  end if;

  -- Publishing controls evidence
  insert into public.os_marketing_publishing_controls_phase58_events (
    entity_id, pending_jobs, failed_jobs, posted_jobs, gated_pending,
    control_status, window_key, metrics_sha256, detail
  ) values (
    v_entity,
    coalesce(v_pending_jobs,0), coalesce(v_failed_jobs,0),
    coalesce(v_posted_jobs,0), coalesce(v_pending_pub,0),
    v_pub_status,
    left(
      'phase58:pub:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex(
      'pub|' || coalesce(v_entity,'firm') || '|' || v_pub_status || '|'
      || coalesce(v_pending_jobs,0)::text
    ),
    jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'publish_executed',false,
      'dual_approve_required',true,
      'source','refresh_marketing_hardening_phase58'
    )
  ) on conflict (window_key) do nothing;

  -- Brand voice enforcement
  insert into public.os_marketing_brand_voice_phase58_enforcement (
    entity_id, voices_configured, content_without_voice, enforcement_status,
    window_key, metrics_sha256, detail, actor_id
  ) values (
    v_entity, coalesce(v_voices,0), coalesce(v_content_no_voice,0),
    v_voice_status,
    left(
      'phase58:voice:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex(
      'voice|' || coalesce(v_entity,'firm') || '|' || v_voice_status || '|'
      || coalesce(v_voices,0)::text
    ),
    jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'todo', case
        when v_voice_status = 'missing'
          then 'TODO: configure entity brand voice'
        else null
      end
    ),
    p_actor_id
  ) on conflict (window_key) do nothing;

  -- Campaign performance snapshot
  insert into public.os_marketing_campaign_perf_phase58_snapshots (
    entity_id, window_key, active_campaigns, paid_campaigns, organic_campaigns,
    performance_status, metrics_sha256, detail, actor_id
  ) values (
    v_entity,
    left(
      'phase58:perf:' || coalesce(v_entity,'firm') || ':'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    coalesce(v_active_camp,0), coalesce(v_paid_camp,0),
    coalesce(v_organic_camp,0), v_perf_status,
    public.os_sha256_hex(
      'perf|' || coalesce(v_entity,'firm') || '|' || v_perf_status || '|'
      || coalesce(v_active_camp,0)::text
    ),
    jsonb_build_object(
      'contract_version','phase58-v1',
      'money_auto_approved',false,
      'extends_revenue_phases',true,
      'todo', case
        when v_perf_status = 'missing'
          then 'TODO: create campaigns for performance dashboard'
        else null
      end
    ),
    p_actor_id
  ) on conflict (window_key) do nothing;

  -- Recruit acquisition stub for ENT-R619 (fail-soft when feed absent)
  select feed_status into v_acq_status
  from public.os_marketing_recruit_acquisition_phase58_events
  where entity_id = 'ENT-R619'
  order by created_at desc
  limit 1;
  if v_acq_status is null then
    v_acq_status := 'missing';
  end if;

  insert into public.os_marketing_recruit_acquisition_phase58_events (
    entity_id, source_kind, applications, clicks, spend_observe,
    feed_status, window_key, metrics_sha256, detail, actor_id
  ) values (
    'ENT-R619', 'combined', 0, 0, null, v_acq_status,
    left(
      'phase58:acq:ENT-R619:combined:'
        || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
      200
    ),
    public.os_sha256_hex('acq|ENT-R619|' || v_acq_status),
    jsonb_build_object(
      'contract_version','phase58-v1',
      'name','Recruit 619',
      'priority',1,
      'money_auto_approved',false,
      'todo', case
        when v_acq_status = 'missing'
          then 'TODO: wire job boards / careers feed for ENT-R619'
        else null
      end
    ),
    p_actor_id
  ) on conflict (window_key) do nothing;

  if v_board in ('missing','partial') then
    insert into public.os_marketing_phase58_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'approval_sla_gap',
      left(
        'phase58:alert:sla_gap:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      case when coalesce(v_overdue,0) > 0 then 'critical' else 'warning' end,
      public.os_sha256_hex('sla_gap|' || coalesce(v_entity,'firm') || '|' || v_board),
      jsonb_build_object(
        'contract_version','phase58-v1',
        'board_status', v_board,
        'overdue_count', coalesce(v_overdue,0),
        'money_auto_approved', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_voice_status = 'missing' then
    insert into public.os_marketing_phase58_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'brand_voice_gap',
      left(
        'phase58:alert:voice_gap:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('voice_gap|' || coalesce(v_entity,'firm')),
      jsonb_build_object(
        'contract_version','phase58-v1',
        'money_auto_approved', false,
        'todo', 'TODO: configure entity brand voice'
      )
    ) on conflict (window_key) do nothing;
  end if;

  if v_acq_status = 'missing' then
    insert into public.os_marketing_phase58_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      'ENT-R619', 'recruit_feed_missing',
      left(
        'phase58:alert:acq_gap:ENT-R619:'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('acq_gap|ENT-R619'),
      jsonb_build_object(
        'contract_version','phase58-v1',
        'money_auto_approved', false,
        'todo', 'TODO: wire job boards / careers feed for ENT-R619'
      )
    ) on conflict (window_key) do nothing;
  end if;

  if coalesce(v_pending_pub,0) > 0 then
    insert into public.os_marketing_phase58_ops_alerts (
      entity_id, alert_kind, window_key, severity, metrics_sha256, detail
    ) values (
      v_entity, 'dual_approve_required',
      left(
        'phase58:alert:pub_pending:' || coalesce(v_entity,'firm') || ':'
          || to_char(now() at time zone 'utc','YYYY-MM-DD'),
        200
      ),
      'warning',
      public.os_sha256_hex('pub_pending|' || coalesce(v_pending_pub,0)::text),
      jsonb_build_object(
        'contract_version','phase58-v1',
        'pending_count', v_pending_pub,
        'money_auto_approved', false,
        'publish_executed', false
      )
    ) on conflict (window_key) do nothing;
  end if;

  v_window := left(
    'phase58:sla:' || coalesce(v_entity,'firm') || ':'
      || to_char(now() at time zone 'utc','YYYY-MM-DD"T"HH24'),
    200
  );
  v_hash := public.os_sha256_hex(
    coalesce(v_entity,'firm') || '|' || coalesce(v_in_review,0)::text || '|'
    || coalesce(v_overdue,0)::text || '|' || v_board || '|' || v_window
  );

  insert into public.os_marketing_approval_sla_phase58_snapshots (
    entity_id, window_key, in_review_count, overdue_count, due_soon_count,
    approved_count, sla_reliability_pct, board_status, metrics_sha256,
    detail, actor_id
  ) values (
    v_entity, v_window,
    coalesce(v_in_review,0), coalesce(v_overdue,0), coalesce(v_due_soon,0),
    coalesce(v_approved,0), v_sla_pct, v_board, v_hash,
    jsonb_build_object(
      'contract_version','phase58-v1',
      'source','refresh_marketing_hardening_phase58',
      'publishing_control_status', v_pub_status,
      'brand_voice_status', v_voice_status,
      'performance_status', v_perf_status,
      'pending_jobs', coalesce(v_pending_jobs,0),
      'failed_jobs', coalesce(v_failed_jobs,0),
      'posted_jobs', coalesce(v_posted_jobs,0),
      'voices_configured', coalesce(v_voices,0),
      'content_without_voice', coalesce(v_content_no_voice,0),
      'active_campaigns', coalesce(v_active_camp,0),
      'paid_campaigns', coalesce(v_paid_camp,0),
      'organic_campaigns', coalesce(v_organic_camp,0),
      'pending_publish_proposals', coalesce(v_pending_pub,0),
      'recruit_feed_status', v_acq_status,
      'money_auto_approved', false,
      'publish_executed', false,
      'dual_approve_required', true,
      'never_auto_approve_money', true,
      'entity_filter_hint','ENT-R619'
    ),
    p_actor_id
  )
  on conflict (window_key) do nothing
  returning snapshot_id into v_id;

  if v_id is null then
    select snapshot_id into v_id
    from public.os_marketing_approval_sla_phase58_snapshots
    where window_key = v_window;
  end if;

  return jsonb_build_object(
    'snapshot_id', v_id,
    'entity_id', v_entity,
    'in_review_count', coalesce(v_in_review,0),
    'overdue_count', coalesce(v_overdue,0),
    'due_soon_count', coalesce(v_due_soon,0),
    'approved_count', coalesce(v_approved,0),
    'sla_reliability_pct', v_sla_pct,
    'board_status', v_board,
    'publishing_control_status', v_pub_status,
    'brand_voice_status', v_voice_status,
    'performance_status', v_perf_status,
    'pending_jobs', coalesce(v_pending_jobs,0),
    'failed_jobs', coalesce(v_failed_jobs,0),
    'posted_jobs', coalesce(v_posted_jobs,0),
    'voices_configured', coalesce(v_voices,0),
    'content_without_voice', coalesce(v_content_no_voice,0),
    'active_campaigns', coalesce(v_active_camp,0),
    'paid_campaigns', coalesce(v_paid_camp,0),
    'organic_campaigns', coalesce(v_organic_camp,0),
    'pending_publish_proposals', coalesce(v_pending_pub,0),
    'recruit_feed_status', v_acq_status,
    'money_auto_approved', false,
    'publish_executed', false,
    'dual_approve_required', true,
    'never_auto_approve_money', true,
    'contract_version', 'phase58-v1'
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: Marketing hardening board.
-- ---------------------------------------------------------------------------
create or replace function public.get_marketing_hardening_phase58_report(
  p_entity_id text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_entity text := nullif(trim(coalesce(p_entity_id,'')),'');
  v_latest public.os_marketing_approval_sla_phase58_snapshots%rowtype;
  v_pub public.os_marketing_publishing_controls_phase58_events%rowtype;
  v_voice public.os_marketing_brand_voice_phase58_enforcement%rowtype;
  v_perf public.os_marketing_campaign_perf_phase58_snapshots%rowtype;
  v_acq public.os_marketing_recruit_acquisition_phase58_events%rowtype;
  v_proposals jsonb := '[]'::jsonb;
  v_ops_alerts jsonb := '[]'::jsonb;
  v_acq_events jsonb := '[]'::jsonb;
begin
  if v_entity is not null and v_entity !~ '^ENT-[A-Z0-9-]{1,32}$' then
    raise exception 'Invalid entity_id for Phase 58 marketing report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is not null
     and not public.can_access_entity(v_entity) then
    raise exception 'Entity access required for Phase 58 marketing report';
  end if;

  if auth.role() is not null
     and auth.role() is distinct from 'service_role'
     and not public.is_firm_wide_access()
     and v_entity is null then
    raise exception 'Firm-wide access or entity filter required for Phase 58 marketing report';
  end if;

  select * into v_latest
  from public.os_marketing_approval_sla_phase58_snapshots s
  where (v_entity is null and s.entity_id is null)
     or (v_entity is not null and s.entity_id = v_entity)
  order by s.created_at desc
  limit 1;

  select * into v_pub
  from public.os_marketing_publishing_controls_phase58_events e
  where (v_entity is null and e.entity_id is null)
     or (v_entity is not null and e.entity_id = v_entity)
  order by e.created_at desc
  limit 1;

  select * into v_voice
  from public.os_marketing_brand_voice_phase58_enforcement e
  where (v_entity is null and e.entity_id is null)
     or (v_entity is not null and e.entity_id = v_entity)
  order by e.created_at desc
  limit 1;

  select * into v_perf
  from public.os_marketing_campaign_perf_phase58_snapshots e
  where (v_entity is null and e.entity_id is null)
     or (v_entity is not null and e.entity_id = v_entity)
  order by e.created_at desc
  limit 1;

  select * into v_acq
  from public.os_marketing_recruit_acquisition_phase58_events e
  where e.entity_id = 'ENT-R619'
  order by e.created_at desc
  limit 1;

  select coalesce(jsonb_agg(row_to_json(p)::jsonb order by p.created_at desc), '[]'::jsonb)
  into v_proposals
  from (
    select pr.proposal_id, pr.entity_id, pr.action_kind, pr.summary,
           pr.proposed_by, pr.status, pr.created_at
    from public.os_marketing_publish_phase58_proposals pr
    where (v_entity is null or pr.entity_id = v_entity)
      and (
        (
          pr.status = 'pending'
          and pr.source_proposal_id is null
          and not exists (
            select 1
            from public.os_marketing_publish_phase58_proposals c
            where c.source_proposal_id = pr.proposal_id
              and c.status in ('dual_approved','rejected','blocked','superseded')
          )
        )
        or (
          pr.status in ('dual_approved','rejected','blocked')
          and pr.source_proposal_id is not null
        )
      )
    order by pr.created_at desc
    limit 40
  ) p;

  select coalesce(jsonb_agg(row_to_json(o)::jsonb order by o.created_at desc), '[]'::jsonb)
  into v_ops_alerts
  from (
    select oa.alert_id, oa.alert_kind, oa.severity, oa.entity_id, oa.created_at
    from public.os_marketing_phase58_ops_alerts oa
    where (v_entity is null or oa.entity_id = v_entity or oa.entity_id = 'ENT-R619')
    order by oa.created_at desc
    limit 12
  ) o;

  select coalesce(jsonb_agg(row_to_json(a)::jsonb order by a.created_at desc), '[]'::jsonb)
  into v_acq_events
  from (
    select ev.event_id, ev.entity_id, ev.source_kind, ev.applications,
           ev.clicks, ev.spend_observe, ev.feed_status, ev.created_at,
           ev.detail->>'todo' as todo
    from public.os_marketing_recruit_acquisition_phase58_events ev
    where ev.entity_id = 'ENT-R619'
    order by ev.created_at desc
    limit 12
  ) a;

  if v_latest.snapshot_id is null then
    return jsonb_build_object(
      'entity_id', v_entity,
      'in_review_count', 0,
      'overdue_count', 0,
      'due_soon_count', 0,
      'approved_count', 0,
      'sla_reliability_pct', null,
      'board_status', 'missing',
      'publishing_control_status', coalesce(v_pub.control_status, 'missing'),
      'brand_voice_status', coalesce(v_voice.enforcement_status, 'missing'),
      'performance_status', coalesce(v_perf.performance_status, 'missing'),
      'pending_jobs', coalesce(v_pub.pending_jobs, 0),
      'failed_jobs', coalesce(v_pub.failed_jobs, 0),
      'posted_jobs', coalesce(v_pub.posted_jobs, 0),
      'voices_configured', coalesce(v_voice.voices_configured, 0),
      'content_without_voice', coalesce(v_voice.content_without_voice, 0),
      'active_campaigns', coalesce(v_perf.active_campaigns, 0),
      'paid_campaigns', coalesce(v_perf.paid_campaigns, 0),
      'organic_campaigns', coalesce(v_perf.organic_campaigns, 0),
      'pending_publish_proposals', 0,
      'recruit_feed_status', coalesce(v_acq.feed_status, 'missing'),
      'recruit_applications', coalesce(v_acq.applications, 0),
      'recruit_clicks', coalesce(v_acq.clicks, 0),
      'snapshot_id', null,
      'captured_at', null,
      'publish_proposals', v_proposals,
      'recruit_acquisition', v_acq_events,
      'recent_alerts', v_ops_alerts,
      'entity_filter_hint', 'ENT-R619',
      'todo', 'Refresh Marketing hardening board; wire job boards / careers for ENT-R619',
      'money_auto_approved', false,
      'publish_executed', false,
      'dual_approve_required', true,
      'never_auto_approve_money', true,
      'contract_version', 'phase58-v1'
    );
  end if;

  return jsonb_build_object(
    'entity_id', v_entity,
    'in_review_count', v_latest.in_review_count,
    'overdue_count', v_latest.overdue_count,
    'due_soon_count', v_latest.due_soon_count,
    'approved_count', v_latest.approved_count,
    'sla_reliability_pct', v_latest.sla_reliability_pct,
    'board_status', v_latest.board_status,
    'publishing_control_status',
      coalesce(v_latest.detail->>'publishing_control_status',
               v_pub.control_status, 'missing'),
    'brand_voice_status',
      coalesce(v_latest.detail->>'brand_voice_status',
               v_voice.enforcement_status, 'missing'),
    'performance_status',
      coalesce(v_latest.detail->>'performance_status',
               v_perf.performance_status, 'missing'),
    'pending_jobs',
      coalesce((v_latest.detail->>'pending_jobs')::integer,
               v_pub.pending_jobs, 0),
    'failed_jobs',
      coalesce((v_latest.detail->>'failed_jobs')::integer,
               v_pub.failed_jobs, 0),
    'posted_jobs',
      coalesce((v_latest.detail->>'posted_jobs')::integer,
               v_pub.posted_jobs, 0),
    'voices_configured',
      coalesce((v_latest.detail->>'voices_configured')::integer,
               v_voice.voices_configured, 0),
    'content_without_voice',
      coalesce((v_latest.detail->>'content_without_voice')::integer,
               v_voice.content_without_voice, 0),
    'active_campaigns',
      coalesce((v_latest.detail->>'active_campaigns')::integer,
               v_perf.active_campaigns, 0),
    'paid_campaigns',
      coalesce((v_latest.detail->>'paid_campaigns')::integer,
               v_perf.paid_campaigns, 0),
    'organic_campaigns',
      coalesce((v_latest.detail->>'organic_campaigns')::integer,
               v_perf.organic_campaigns, 0),
    'pending_publish_proposals',
      coalesce((v_latest.detail->>'pending_publish_proposals')::integer, 0),
    'recruit_feed_status',
      coalesce(v_latest.detail->>'recruit_feed_status',
               v_acq.feed_status, 'missing'),
    'recruit_applications', coalesce(v_acq.applications, 0),
    'recruit_clicks', coalesce(v_acq.clicks, 0),
    'snapshot_id', v_latest.snapshot_id,
    'captured_at', v_latest.created_at,
    'publish_proposals', v_proposals,
    'recruit_acquisition', v_acq_events,
    'recent_alerts', v_ops_alerts,
    'entity_filter_hint', 'ENT-R619',
    'todo', 'Money-impacting publish requires dual-approve; never auto-approve money',
    'money_auto_approved', false,
    'publish_executed', false,
    'dual_approve_required', true,
    'never_auto_approve_money', true,
    'contract_version', 'phase58-v1'
  );
end;
$$;

revoke all on function public.propose_marketing_publish_phase58(jsonb)
  from public, anon, authenticated;
revoke all on function public.approve_marketing_publish_phase58(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.record_recruit_acquisition_intake_phase58(jsonb)
  from public, anon, authenticated;
revoke all on function public.refresh_marketing_hardening_phase58(uuid, text)
  from public, anon, authenticated;
revoke all on function public.get_marketing_hardening_phase58_report(text)
  from public, anon, authenticated;

grant execute on function public.propose_marketing_publish_phase58(jsonb)
  to authenticated, service_role;
grant execute on function public.approve_marketing_publish_phase58(uuid, uuid, text, jsonb)
  to authenticated, service_role;
grant execute on function public.record_recruit_acquisition_intake_phase58(jsonb)
  to authenticated, service_role;
grant execute on function public.refresh_marketing_hardening_phase58(uuid, text)
  to authenticated, service_role;
grant execute on function public.get_marketing_hardening_phase58_report(text)
  to authenticated, service_role;
