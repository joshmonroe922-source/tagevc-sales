-- Phase 4: Documents + DocuSign workflow

create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  doc_id text not null unique,
  entity_id text,
  deal_or_task_id text,
  doc_type text not null,
  template_id text,
  title text not null,
  library_path text not null,
  folder text not null,
  status text not null,
  envelope_id text,
  merged_body text,
  merge_values jsonb not null default '{}',
  signers jsonb not null default '[]',
  sent_by text,
  sent_at timestamptz,
  completed_at timestamptz,
  content_hash text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.doc_audit_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  doc_id text not null,
  action text not null,
  actor text not null,
  detail text not null,
  created_at timestamptz not null default now()
);
