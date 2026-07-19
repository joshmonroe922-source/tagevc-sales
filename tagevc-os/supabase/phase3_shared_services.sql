-- Phase 3: Shared Services tickets + agent audit (§7)

create table if not exists public.ss_tickets (
  id uuid primary key default gen_random_uuid(),
  ticket_id text not null unique,
  title text not null,
  description text,
  desired_outcome text,
  service text not null,
  priority text not null,
  status text not null,
  requester_name text,
  assignee_name text,
  entity_id text,
  company_name text,
  links text,
  sla_due_at timestamptz,
  autonomy_band text not null,
  confidence numeric not null,
  diagnose_reasoning text not null,
  proposed_action text,
  forbid_hits text[] not null default '{}',
  on_allow_list boolean not null default false,
  draft_approval text not null default 'n/a',
  recommendation text,
  policy_version text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz
);

create table if not exists public.agent_audit_log (
  id uuid primary key default gen_random_uuid(),
  audit_id text not null unique,
  ticket_id text not null,
  band text not null,
  confidence numeric not null,
  action text not null,
  reasoning text not null,
  forbid_hits text[] not null default '{}',
  approval text,
  payload_hash text,
  actor text not null,
  created_at timestamptz not null default now()
);
