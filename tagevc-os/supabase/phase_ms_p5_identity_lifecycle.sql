-- Multi-subsidiary readiness P5: Central identity lifecycle (joiner/mover/leaver).
-- Microsoft-tied orchestration control center with failed-step retry evidence.
-- Apply after phase_ms_p4. Safe to re-run. Additive only.
-- Same engine for ENT-R619 and ENT-INDA. Never auto-approves money.
-- Never mutates snapshot retirement tables. Revoke-first on leaver.

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

create or replace function public.phase_ms_p5_safe_detail(p_detail jsonb)
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
        '"[^"]*(payload|secret|token|password|authorization|cookie|body|bytes|base64|webhook_url)[^"]*"\s*:'
      and p_detail::text !~*
        '(-----BEGIN|bearer[[:space:]]+|postgres(ql)?://|https?://[^/[:space:]]+:[^@[:space:]]+@)'
    );
$$;

create table if not exists public.os_identity_lifecycle_runs (
  run_id uuid primary key default gen_random_uuid(),
  lifecycle_kind text not null
    check (lifecycle_kind in ('joiner','mover','leaver')),
  user_id uuid,
  email text,
  home_entity_id text
    check (home_entity_id is null or home_entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  previous_entity_id text
    check (previous_entity_id is null or previous_entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  target_entity_id text
    check (target_entity_id is null or target_entity_id ~ '^ENT-[A-Z0-9-]{1,32}$'),
  target_role text,
  status text not null default 'open'
    check (status in (
      'open','in_progress','completed','failed','cancelled','needs_retry'
    )),
  checklist jsonb not null default '[]'::jsonb,
  ticket_id text,
  source text not null default 'manual'
    check (source in (
      'manual','hr_ticket','status_change','microsoft_sync','api'
    )),
  microsoft_oid text,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint os_id_life_checklist_check
    check (
      jsonb_typeof(checklist)='array'
      and pg_column_size(checklist)<=16384
    ),
  constraint os_id_life_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p5_safe_detail(detail)
    ),
  constraint os_id_life_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_id_life_status_idx
  on public.os_identity_lifecycle_runs(status, created_at desc);
create index if not exists os_id_life_entity_idx
  on public.os_identity_lifecycle_runs(home_entity_id, created_at desc);
create index if not exists os_id_life_user_idx
  on public.os_identity_lifecycle_runs(user_id, created_at desc);

alter table public.os_identity_lifecycle_runs enable row level security;
drop policy if exists "os_id_life_select" on public.os_identity_lifecycle_runs;
create policy "os_id_life_select"
  on public.os_identity_lifecycle_runs for select to authenticated
  using (
    public.is_firm_wide_access()
    or (home_entity_id is not null and public.can_access_entity(home_entity_id))
    or (target_entity_id is not null and public.can_access_entity(target_entity_id))
    or user_id = auth.uid()
  );
revoke all on public.os_identity_lifecycle_runs
  from public, anon, authenticated;
grant select on public.os_identity_lifecycle_runs to authenticated;

-- Append-only step evidence (retry / revoke proof).
create table if not exists public.os_identity_lifecycle_step_audits (
  audit_id uuid primary key default gen_random_uuid(),
  run_id uuid not null
    references public.os_identity_lifecycle_runs(run_id) on delete cascade,
  step_key text not null
    check (step_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  step_status text not null
    check (step_status in (
      'pending','running','done','failed','skipped','retrying'
    )),
  attempt integer not null default 1 check (attempt >= 1),
  metrics_sha256 text not null check (metrics_sha256 ~ '^[0-9a-f]{64}$'),
  detail jsonb not null default '{}'::jsonb,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint os_id_life_step_detail_check
    check (
      jsonb_typeof(detail)='object'
      and public.phase_ms_p5_safe_detail(detail)
    ),
  constraint os_id_life_step_no_money_approve_check
    check (coalesce((detail->>'money_auto_approve')::boolean,false)=false)
);

create index if not exists os_id_life_step_run_idx
  on public.os_identity_lifecycle_step_audits(run_id, created_at desc);
create index if not exists os_id_life_step_failed_idx
  on public.os_identity_lifecycle_step_audits(step_status, created_at desc)
  where step_status in ('failed','retrying');

alter table public.os_identity_lifecycle_step_audits enable row level security;
drop policy if exists "os_id_life_step_select"
  on public.os_identity_lifecycle_step_audits;
create policy "os_id_life_step_select"
  on public.os_identity_lifecycle_step_audits for select to authenticated
  using (
    public.is_firm_wide_access()
    or exists (
      select 1 from public.os_identity_lifecycle_runs r
      where r.run_id = os_identity_lifecycle_step_audits.run_id
        and (
          r.user_id = auth.uid()
          or (r.home_entity_id is not null and public.can_access_entity(r.home_entity_id))
        )
    )
  );
revoke all on public.os_identity_lifecycle_step_audits
  from public, anon, authenticated;
grant select on public.os_identity_lifecycle_step_audits to authenticated;

create or replace function public.reject_os_id_life_step_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'Identity lifecycle step audits are append-only';
end;
$$;

drop trigger if exists os_id_life_step_immutable
  on public.os_identity_lifecycle_step_audits;
create trigger os_id_life_step_immutable
  before update or delete on public.os_identity_lifecycle_step_audits
  for each row execute function public.reject_os_id_life_step_mutation();
drop trigger if exists os_id_life_step_no_truncate
  on public.os_identity_lifecycle_step_audits;
create trigger os_id_life_step_no_truncate
  before truncate on public.os_identity_lifecycle_step_audits
  for each statement execute function public.reject_os_id_life_step_mutation();

create or replace function public.ms_p5_default_checklist(
  p_kind text,
  p_entity_id text
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_entity text := coalesce(nullif(trim(p_entity_id),''),'ENT-FIRM');
begin
  if p_kind = 'joiner' then
    return jsonb_build_array(
      jsonb_build_object('id','profile_create','label','Create/update Tage profile','status','pending'),
      jsonb_build_object('id','home_entity_role','label','Set home entity + role ('|| v_entity ||')','status','pending'),
      jsonb_build_object('id','provision_messaging','label','Provision messaging membership + default channels','status','pending'),
      jsonb_build_object('id','provision_ticketing','label','Scope ticketing to home entity','status','pending'),
      jsonb_build_object('id','onboarding_checklist','label','IT onboarding checklist (hardware/license/MDM)','status','pending'),
      jsonb_build_object('id','microsoft_groups','label','Microsoft Entra group assign','status','pending')
    );
  elsif p_kind = 'mover' then
    return jsonb_build_array(
      jsonb_build_object('id','update_entity_role','label','Update entity + role','status','pending'),
      jsonb_build_object('id','rescope_messaging','label','Re-scope messaging memberships','status','pending'),
      jsonb_build_object('id','rescope_ticketing','label','Re-scope ticketing visibility','status','pending'),
      jsonb_build_object('id','microsoft_groups','label','Update Microsoft Entra groups','status','pending')
    );
  else
    -- leaver: revoke-first
    return jsonb_build_array(
      jsonb_build_object('id','revoke_portal','label','Revoke portal/SSO access (first)','status','pending'),
      jsonb_build_object('id','revoke_messaging','label','Deprovision messaging memberships','status','pending'),
      jsonb_build_object('id','revoke_ticketing','label','Revoke ticketing write scope','status','pending'),
      jsonb_build_object('id','offboarding_checklist','label','IT offboarding (MDM wipe / licenses)','status','pending'),
      jsonb_build_object('id','evidence_pack','label','Capture leaver evidence pack','status','pending')
    );
  end if;
end;
$$;

create or replace function public.start_identity_lifecycle_ms_p5(
  p_kind text,
  p_user_id uuid,
  p_email text default null,
  p_home_entity_id text default null,
  p_previous_entity_id text default null,
  p_target_entity_id text default null,
  p_target_role text default null,
  p_ticket_id text default null,
  p_source text default 'manual',
  p_microsoft_oid text default null,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_kind text := lower(trim(p_kind));
  v_home text := public.resolve_canonical_entity_id(p_home_entity_id);
  v_prev text := public.resolve_canonical_entity_id(p_previous_entity_id);
  v_target text := public.resolve_canonical_entity_id(
    coalesce(p_target_entity_id, p_home_entity_id)
  );
  v_run_id uuid := gen_random_uuid();
  v_checklist jsonb;
  v_step record;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;
  if v_kind not in ('joiner','mover','leaver') then
    raise exception 'invalid lifecycle_kind';
  end if;
  if p_user_id is null and coalesce(nullif(trim(p_email),''),'') = '' then
    raise exception 'user_id or email required';
  end if;

  if v_kind = 'joiner' then
    v_home := coalesce(v_home, v_target, 'ENT-FIRM');
  elsif v_kind = 'mover' then
    v_home := coalesce(v_target, v_home);
  else
    v_home := coalesce(v_home, v_prev, v_target);
  end if;

  v_checklist := public.ms_p5_default_checklist(v_kind, coalesce(v_target, v_home));

  insert into public.os_identity_lifecycle_runs (
    run_id, lifecycle_kind, user_id, email, home_entity_id,
    previous_entity_id, target_entity_id, target_role, status,
    checklist, ticket_id, source, microsoft_oid, detail
  ) values (
    v_run_id, v_kind, p_user_id, p_email, v_home,
    v_prev, v_target, p_target_role, 'open',
    v_checklist, p_ticket_id, coalesce(nullif(trim(p_source),''),'manual'),
    p_microsoft_oid,
    jsonb_build_object(
      'money_auto_approve',false,
      'contract_version','ms-p5-v1',
      'revoke_first', v_kind = 'leaver'
    )
  );

  for v_step in
    select value->>'id' as step_key
    from jsonb_array_elements(v_checklist)
  loop
    insert into public.os_identity_lifecycle_step_audits (
      run_id, step_key, step_status, attempt, metrics_sha256, detail, actor_id
    ) values (
      v_run_id,
      v_step.step_key,
      'pending',
      1,
      public.os_sha256_hex(v_run_id::text || ':' || v_step.step_key || ':pending'),
      jsonb_build_object('money_auto_approve',false,'contract_version','ms-p5-v1'),
      p_actor_id
    );
  end loop;

  return jsonb_build_object(
    'ok',true,
    'run_id',v_run_id,
    'lifecycle_kind',v_kind,
    'home_entity_id',v_home,
    'target_entity_id',v_target,
    'money_auto_approve',false,
    'contract_version','ms-p5-v1'
  );
end;
$$;

revoke all on function public.start_identity_lifecycle_ms_p5(
  text, uuid, text, text, text, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.start_identity_lifecycle_ms_p5(
  text, uuid, text, text, text, text, text, text, text, text, uuid
) to authenticated, service_role;

create or replace function public.record_identity_lifecycle_step_ms_p5(
  p_run_id uuid,
  p_step_key text,
  p_step_status text,
  p_detail jsonb default '{}'::jsonb,
  p_actor_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_attempt integer := 1;
  v_status text := lower(trim(p_step_status));
  v_safe jsonb;
  v_failed integer;
  v_pending integer;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;
  if p_run_id is null or nullif(trim(p_step_key),'') is null then
    raise exception 'run_id and step_key required';
  end if;
  if v_status not in ('pending','running','done','failed','skipped','retrying') then
    raise exception 'invalid step_status';
  end if;

  select coalesce(max(attempt),0) + 1 into v_attempt
  from public.os_identity_lifecycle_step_audits
  where run_id = p_run_id and step_key = p_step_key;

  v_safe := coalesce(p_detail, '{}'::jsonb)
    || jsonb_build_object('money_auto_approve', false, 'contract_version', 'ms-p5-v1');

  insert into public.os_identity_lifecycle_step_audits (
    run_id, step_key, step_status, attempt, metrics_sha256, detail, actor_id
  ) values (
    p_run_id,
    trim(p_step_key),
    v_status,
    v_attempt,
    public.os_sha256_hex(
      p_run_id::text || ':' || trim(p_step_key) || ':' || v_status || ':' || v_attempt::text
    ),
    v_safe,
    p_actor_id
  );

  update public.os_identity_lifecycle_runs
  set
    checklist = (
      select coalesce(jsonb_agg(
        case
          when elem->>'id' = trim(p_step_key)
            then jsonb_set(elem, '{status}', to_jsonb(v_status), true)
          else elem
        end
      ), checklist)
      from jsonb_array_elements(checklist) elem
    ),
    status = case
      when v_status = 'failed' then 'needs_retry'
      when v_status = 'retrying' then 'in_progress'
      else status
    end,
    updated_at = now()
  where run_id = p_run_id;

  select
    count(*) filter (where elem->>'status' = 'failed'),
    count(*) filter (where elem->>'status' in ('pending','running','retrying'))
  into v_failed, v_pending
  from public.os_identity_lifecycle_runs r,
       jsonb_array_elements(r.checklist) elem
  where r.run_id = p_run_id;

  if v_failed = 0 and v_pending = 0 then
    update public.os_identity_lifecycle_runs
    set status = 'completed', completed_at = now(), updated_at = now()
    where run_id = p_run_id;
  end if;

  return jsonb_build_object(
    'ok',true,
    'run_id',p_run_id,
    'step_key',trim(p_step_key),
    'step_status',v_status,
    'attempt',v_attempt,
    'money_auto_approve',false,
    'contract_version','ms-p5-v1'
  );
end;
$$;

revoke all on function public.record_identity_lifecycle_step_ms_p5(
  uuid, text, text, jsonb, uuid
) from public, anon;
grant execute on function public.record_identity_lifecycle_step_ms_p5(
  uuid, text, text, jsonb, uuid
) to authenticated, service_role;

create or replace function public.list_identity_lifecycle_control_center_ms_p5(
  p_limit integer default 50
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_limit integer := greatest(1, least(coalesce(p_limit,50), 200));
  v_runs jsonb;
  v_failed jsonb;
begin
  if auth.role() <> 'service_role' and not public.is_firm_wide_access() then
    raise exception 'not authorized';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at desc), '[]'::jsonb)
  into v_runs
  from (
    select *
    from public.os_identity_lifecycle_runs
    order by created_at desc
    limit v_limit
  ) r;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb)
  into v_failed
  from (
    select *
    from public.os_identity_lifecycle_step_audits
    where step_status in ('failed','retrying')
    order by created_at desc
    limit v_limit
  ) a;

  return jsonb_build_object(
    'contract_version','ms-p5-v1',
    'money_auto_approve',false,
    'runs',v_runs,
    'failed_steps',v_failed,
    'supported_entities', jsonb_build_array('ENT-R619','ENT-INDA','ENT-FIRM')
  );
end;
$$;

revoke all on function public.list_identity_lifecycle_control_center_ms_p5(integer)
  from public, anon;
grant execute on function public.list_identity_lifecycle_control_center_ms_p5(integer)
  to authenticated, service_role;
