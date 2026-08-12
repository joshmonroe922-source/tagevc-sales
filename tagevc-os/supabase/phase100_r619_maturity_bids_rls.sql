-- Phase 100: Enable RLS on R619 maturity / bids / autonomy tables.
-- Clears Supabase advisor rls_disabled_in_public on project opdqybaatfbwkokbzwli (tagevc-os).
-- Tables were created in recruit619-portal phase90–92 without RLS; patterns match
-- phase98_r619_placement_credits_rls.sql / other r619 desk tables.
-- Safe to re-run. Service role bypasses RLS (portal/server routes keep working).
-- No anon USING (true) policies.

-- ---------------------------------------------------------------------------
-- Parent tables with entity_id
-- ---------------------------------------------------------------------------

alter table public.r619_commissions enable row level security;
alter table public.r619_exceptions enable row level security;
alter table public.r619_checklists enable row level security;
alter table public.r619_bids enable row level security;
alter table public.r619_kb_claims enable row level security;
alter table public.r619_bid_fulfillment_links enable row level security;
alter table public.r619_skill_autonomy enable row level security;
alter table public.r619_learner_outcomes enable row level security;
alter table public.r619_eval_runs enable row level security;

-- Child tables (scope via parent)
alter table public.r619_checklist_items enable row level security;
alter table public.r619_bid_compliance_items enable row level security;
alter table public.r619_bid_documents enable row level security;
alter table public.r619_bid_staffing_matches enable row level security;

-- commissions
drop policy if exists "r619_commissions_select" on public.r619_commissions;
drop policy if exists "r619_commissions_write" on public.r619_commissions;
create policy "r619_commissions_select"
  on public.r619_commissions for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_commissions_write"
  on public.r619_commissions for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- exceptions
drop policy if exists "r619_exceptions_select" on public.r619_exceptions;
drop policy if exists "r619_exceptions_write" on public.r619_exceptions;
create policy "r619_exceptions_select"
  on public.r619_exceptions for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_exceptions_write"
  on public.r619_exceptions for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- checklists
drop policy if exists "r619_checklists_select" on public.r619_checklists;
drop policy if exists "r619_checklists_write" on public.r619_checklists;
create policy "r619_checklists_select"
  on public.r619_checklists for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_checklists_write"
  on public.r619_checklists for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- checklist_items (via checklist)
drop policy if exists "r619_checklist_items_select" on public.r619_checklist_items;
drop policy if exists "r619_checklist_items_write" on public.r619_checklist_items;
create policy "r619_checklist_items_select"
  on public.r619_checklist_items for select to authenticated
  using (
    exists (
      select 1
      from public.r619_checklists c
      where c.id = checklist_id
        and (public.is_firm_wide_access() or public.can_access_entity(c.entity_id))
    )
  );
create policy "r619_checklist_items_write"
  on public.r619_checklist_items for all to authenticated
  using (
    exists (
      select 1
      from public.r619_checklists c
      where c.id = checklist_id
        and (public.is_firm_wide_access() or public.can_access_entity(c.entity_id))
    )
  )
  with check (
    exists (
      select 1
      from public.r619_checklists c
      where c.id = checklist_id
        and c.entity_id = 'ENT-R619'
        and (public.is_firm_wide_access() or public.can_access_entity(c.entity_id))
    )
  );

-- bids
drop policy if exists "r619_bids_select" on public.r619_bids;
drop policy if exists "r619_bids_write" on public.r619_bids;
create policy "r619_bids_select"
  on public.r619_bids for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_bids_write"
  on public.r619_bids for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- bid children (via bid)
drop policy if exists "r619_bid_compliance_items_select" on public.r619_bid_compliance_items;
drop policy if exists "r619_bid_compliance_items_write" on public.r619_bid_compliance_items;
create policy "r619_bid_compliance_items_select"
  on public.r619_bid_compliance_items for select to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );
create policy "r619_bid_compliance_items_write"
  on public.r619_bid_compliance_items for all to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  )
  with check (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and b.entity_id = 'ENT-R619'
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );

drop policy if exists "r619_bid_documents_select" on public.r619_bid_documents;
drop policy if exists "r619_bid_documents_write" on public.r619_bid_documents;
create policy "r619_bid_documents_select"
  on public.r619_bid_documents for select to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );
create policy "r619_bid_documents_write"
  on public.r619_bid_documents for all to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  )
  with check (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and b.entity_id = 'ENT-R619'
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );

drop policy if exists "r619_bid_staffing_matches_select" on public.r619_bid_staffing_matches;
drop policy if exists "r619_bid_staffing_matches_write" on public.r619_bid_staffing_matches;
create policy "r619_bid_staffing_matches_select"
  on public.r619_bid_staffing_matches for select to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );
create policy "r619_bid_staffing_matches_write"
  on public.r619_bid_staffing_matches for all to authenticated
  using (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  )
  with check (
    exists (
      select 1
      from public.r619_bids b
      where b.id = bid_id
        and b.entity_id = 'ENT-R619'
        and (public.is_firm_wide_access() or public.can_access_entity(b.entity_id))
    )
  );

-- kb_claims
drop policy if exists "r619_kb_claims_select" on public.r619_kb_claims;
drop policy if exists "r619_kb_claims_write" on public.r619_kb_claims;
create policy "r619_kb_claims_select"
  on public.r619_kb_claims for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_kb_claims_write"
  on public.r619_kb_claims for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- bid_fulfillment_links
drop policy if exists "r619_bid_fulfillment_links_select" on public.r619_bid_fulfillment_links;
drop policy if exists "r619_bid_fulfillment_links_write" on public.r619_bid_fulfillment_links;
create policy "r619_bid_fulfillment_links_select"
  on public.r619_bid_fulfillment_links for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_bid_fulfillment_links_write"
  on public.r619_bid_fulfillment_links for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- skill_autonomy / learner_outcomes / eval_runs
drop policy if exists "r619_skill_autonomy_select" on public.r619_skill_autonomy;
drop policy if exists "r619_skill_autonomy_write" on public.r619_skill_autonomy;
create policy "r619_skill_autonomy_select"
  on public.r619_skill_autonomy for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_skill_autonomy_write"
  on public.r619_skill_autonomy for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists "r619_learner_outcomes_select" on public.r619_learner_outcomes;
drop policy if exists "r619_learner_outcomes_write" on public.r619_learner_outcomes;
create policy "r619_learner_outcomes_select"
  on public.r619_learner_outcomes for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_learner_outcomes_write"
  on public.r619_learner_outcomes for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

drop policy if exists "r619_eval_runs_select" on public.r619_eval_runs;
drop policy if exists "r619_eval_runs_write" on public.r619_eval_runs;
create policy "r619_eval_runs_select"
  on public.r619_eval_runs for select to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id));
create policy "r619_eval_runs_write"
  on public.r619_eval_runs for all to authenticated
  using (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  with check (
    entity_id = 'ENT-R619'
    and (public.is_firm_wide_access() or public.can_access_entity(entity_id))
  );

-- Grants already exist for authenticated/service_role from table creation; keep explicit.
grant select, insert, update, delete on public.r619_commissions to authenticated, service_role;
grant select, insert, update, delete on public.r619_exceptions to authenticated, service_role;
grant select, insert, update, delete on public.r619_checklists to authenticated, service_role;
grant select, insert, update, delete on public.r619_checklist_items to authenticated, service_role;
grant select, insert, update, delete on public.r619_bids to authenticated, service_role;
grant select, insert, update, delete on public.r619_bid_compliance_items to authenticated, service_role;
grant select, insert, update, delete on public.r619_bid_documents to authenticated, service_role;
grant select, insert, update, delete on public.r619_bid_staffing_matches to authenticated, service_role;
grant select, insert, update, delete on public.r619_kb_claims to authenticated, service_role;
grant select, insert, update, delete on public.r619_bid_fulfillment_links to authenticated, service_role;
grant select, insert, update, delete on public.r619_skill_autonomy to authenticated, service_role;
grant select, insert, update, delete on public.r619_learner_outcomes to authenticated, service_role;
grant select, insert, update, delete on public.r619_eval_runs to authenticated, service_role;

-- Ensure anon has no table privileges (advisor surface).
revoke all on public.r619_commissions from anon;
revoke all on public.r619_exceptions from anon;
revoke all on public.r619_checklists from anon;
revoke all on public.r619_checklist_items from anon;
revoke all on public.r619_bids from anon;
revoke all on public.r619_bid_compliance_items from anon;
revoke all on public.r619_bid_documents from anon;
revoke all on public.r619_bid_staffing_matches from anon;
revoke all on public.r619_kb_claims from anon;
revoke all on public.r619_bid_fulfillment_links from anon;
revoke all on public.r619_skill_autonomy from anon;
revoke all on public.r619_learner_outcomes from anon;
revoke all on public.r619_eval_runs from anon;
