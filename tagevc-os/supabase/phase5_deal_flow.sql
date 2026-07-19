-- Phase 5 — Expanded Deal Flow (stub for future Supabase persistence)
-- Excel SSOT: Data Dictionary · Pipeline/Deal/M&A/RE Process Libraries · Portfolio Handoff
-- In-memory stores ship in app; migrate later.

-- VC Deal Tasks Active
-- create table deal_tasks (
--   id uuid primary key,
--   task_id text unique not null, -- DT-###
--   deal_id text not null references deals(deal_id),
--   process_stage text not null,
--   title text not null,
--   priority text not null,
--   status text not null,
--   lib_id text, -- DX-## spawn-once key
--   ...
-- );

-- IC reviews + append-only audit
-- create table ic_reviews (
--   ic_id text primary key, -- IC-###
--   deal_id text not null,
--   status text not null, -- Pending | In Review | Decided
--   decision text, -- Approve | Pass | Defer | Approve with conditions
--   conditions text,
--   ...
-- );
-- create table ic_audit_events (
--   event_id text primary key, -- ICA-###
--   ic_id text not null,
--   deal_id text not null,
--   action text not null,
--   decision text,
--   actor text not null,
--   created_at timestamptz not null
-- );

-- M&A Pipeline (MA-###) + tasks (MT-###)
-- RE Pipeline (RE-###) + tasks (RT-###) with route Residential|Commercial
-- Portfolio Handoff packs (PH-###) — Ready for Portfolio → link ENT-* / PF-* / PFRE-*

select 1;
