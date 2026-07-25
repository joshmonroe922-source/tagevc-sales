-- Phase 76: Ticket AI diagnose loop extensions (additive on existing autonomy_band).
-- Safe to re-run. Does NOT drop os_store_snapshots. Does NOT weaken forbid-list.
-- Extends os_tickets with proposed_actions, auto_result, source provenance, metrics.

alter table public.os_tickets
  add column if not exists diagnose_summary text not null default '',
  add column if not exists proposed_actions jsonb not null default '[]'::jsonb,
  add column if not exists auto_attempted_at timestamptz,
  add column if not exists auto_result text
    check (auto_result is null or auto_result in ('success', 'partial', 'failed', 'skipped')),
  add column if not exists escalation_reason text not null default '',
  add column if not exists source_system text not null default 'tage'
    check (source_system in ('tage', 'recruit619', 'instantnda', 'system')),
  add column if not exists source_ref text;

do $$ begin
  alter table public.os_tickets
    add constraint os_tickets_proposed_actions_obj
    check (jsonb_typeof(proposed_actions) = 'array');
exception when duplicate_object then null;
end $$;

create index if not exists os_tickets_source_system_idx
  on public.os_tickets (source_system);
create index if not exists os_tickets_auto_result_idx
  on public.os_tickets (auto_result)
  where auto_result is not null;

-- Lightweight automation metrics (logged counters)
create table if not exists public.os_automation_metrics (
  id uuid primary key default gen_random_uuid(),
  metric_key text not null,
  metric_value numeric not null default 1,
  ticket_id text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists os_automation_metrics_key_idx
  on public.os_automation_metrics (metric_key, created_at desc);

alter table public.os_automation_metrics enable row level security;

drop policy if exists os_automation_metrics_select on public.os_automation_metrics;
create policy os_automation_metrics_select on public.os_automation_metrics
  for select to authenticated
  using (public.is_firm_wide_access());

drop policy if exists os_automation_metrics_insert on public.os_automation_metrics;
create policy os_automation_metrics_insert on public.os_automation_metrics
  for insert to authenticated
  with check (public.is_firm_wide_access());

revoke all on public.os_automation_metrics from public, anon;
grant select, insert on public.os_automation_metrics to authenticated;

comment on column public.os_tickets.diagnose_summary is
  'Phase 76: AI-written human-readable diagnose summary.';
comment on column public.os_tickets.proposed_actions is
  'Phase 76: jsonb array of safe proposed steps (never money/legal/HR destructive).';
comment on column public.os_tickets.auto_result is
  'Phase 76: outcome of allow-listed AUTO attempt.';
comment on table public.os_automation_metrics is
  'Phase 76: lightweight counters for auto-resolved, draft approvals, diagnose latency.';
