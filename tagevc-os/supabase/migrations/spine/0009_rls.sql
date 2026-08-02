-- C1 / 0009_rls — JWT claim helpers + RLS (Entra claims; service_role bypasses)
create or replace function public.fn_is_tage_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() ->> 'is_tage_admin')::boolean, false);
$$;

create or replace function public.fn_org_ids()
returns uuid[]
language plpgsql
stable
as $$
declare
  raw jsonb;
  out uuid[] := '{}';
  elem text;
begin
  raw := auth.jwt() -> 'org_ids';
  if raw is null then
    return out;
  end if;
  if jsonb_typeof(raw) = 'array' then
    for elem in select jsonb_array_elements_text(raw)
    loop
      begin
        out := array_append(out, elem::uuid);
      exception when others then
        null;
      end;
    end loop;
  end if;
  return out;
end;
$$;

create or replace function public.fn_has_org(oid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin() or oid = any (public.fn_org_ids());
$$;

create or replace function public.fn_can_see_account(aid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin()
    or exists (
      select 1
      from public.account_org_links l
      where l.account_id = aid
        and (
          l.org_id = any (public.fn_org_ids())
          or l.visibility in ('shared', 'network')
        )
    );
$$;

create or replace function public.fn_can_see_contact(cid uuid)
returns boolean
language sql
stable
as $$
  select public.fn_is_tage_admin()
    or exists (
      select 1
      from public.contact_org_links l
      where l.contact_id = cid
        and (
          l.org_id = any (public.fn_org_ids())
          or l.visibility in ('shared', 'network')
        )
    );
$$;

alter table public.organizations enable row level security;
alter table public.user_profiles enable row level security;
alter table public.memberships enable row level security;
alter table public.accounts enable row level security;
alter table public.contacts enable row level security;
alter table public.employments enable row level security;
alter table public.org_edges enable row level security;
alter table public.account_org_links enable row level security;
alter table public.contact_org_links enable row level security;
alter table public.field_provenance enable row level security;
alter table public.contact_field_history enable row level security;
alter table public.suggested_updates enable row level security;
alter table public.enrichment_jobs enable row level security;
alter table public.enrichment_evidence enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.activities enable row level security;
alter table public.recruit_job_reqs enable row level security;
alter table public.recruit_candidates enable row level security;
alter table public.recruit_submissions enable row level security;
alter table public.nda_envelopes enable row level security;
alter table public.nda_signers enable row level security;
alter table public.spine_signent_engagements enable row level security;

-- organizations
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select using (public.fn_has_org(id));

drop policy if exists organizations_admin_write on public.organizations;
create policy organizations_admin_write on public.organizations
  for all using (public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin());

-- accounts / contacts
drop policy if exists accounts_select on public.accounts;
create policy accounts_select on public.accounts
  for select using (public.fn_can_see_account(id));

drop policy if exists accounts_write on public.accounts;
create policy accounts_write on public.accounts
  for all using (public.fn_can_see_account(id) or public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin() or public.fn_org_ids() is not null);

drop policy if exists contacts_select on public.contacts;
create policy contacts_select on public.contacts
  for select using (public.fn_can_see_contact(id));

drop policy if exists contacts_write on public.contacts;
create policy contacts_write on public.contacts
  for all using (public.fn_can_see_contact(id) or public.fn_is_tage_admin())
  with check (public.fn_is_tage_admin() or public.fn_org_ids() is not null);

-- employments / edges via parent account
drop policy if exists employments_all on public.employments;
create policy employments_all on public.employments
  for all using (public.fn_can_see_account(account_id))
  with check (public.fn_can_see_account(account_id));

drop policy if exists org_edges_all on public.org_edges;
create policy org_edges_all on public.org_edges
  for all using (public.fn_can_see_account(account_id))
  with check (public.fn_can_see_account(account_id));

drop policy if exists account_org_links_all on public.account_org_links;
create policy account_org_links_all on public.account_org_links
  for all using (public.fn_has_org(org_id) or public.fn_is_tage_admin())
  with check (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists contact_org_links_all on public.contact_org_links;
create policy contact_org_links_all on public.contact_org_links
  for all using (public.fn_has_org(org_id) or public.fn_is_tage_admin())
  with check (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists enrichment_jobs_all on public.enrichment_jobs;
create policy enrichment_jobs_all on public.enrichment_jobs
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists enrichment_evidence_select on public.enrichment_evidence;
create policy enrichment_evidence_select on public.enrichment_evidence
  for select using (
    exists (
      select 1 from public.enrichment_jobs j
      where j.id = job_id and public.fn_has_org(j.org_id)
    )
  );

drop policy if exists credit_ledger_select on public.credit_ledger;
create policy credit_ledger_select on public.credit_ledger
  for select using (public.fn_has_org(org_id) or public.fn_is_tage_admin());

drop policy if exists suggested_updates_all on public.suggested_updates;
create policy suggested_updates_all on public.suggested_updates
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists activities_all on public.activities;
create policy activities_all on public.activities
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists field_provenance_select on public.field_provenance;
create policy field_provenance_select on public.field_provenance
  for select using (
    (entity_type = 'account' and public.fn_can_see_account(entity_id))
    or (entity_type = 'contact' and public.fn_can_see_contact(entity_id))
    or public.fn_is_tage_admin()
  );

drop policy if exists recruit_job_reqs_all on public.recruit_job_reqs;
create policy recruit_job_reqs_all on public.recruit_job_reqs
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists recruit_candidates_all on public.recruit_candidates;
create policy recruit_candidates_all on public.recruit_candidates
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists recruit_submissions_all on public.recruit_submissions;
create policy recruit_submissions_all on public.recruit_submissions
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists nda_envelopes_all on public.nda_envelopes;
create policy nda_envelopes_all on public.nda_envelopes
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));

drop policy if exists nda_signers_select on public.nda_signers;
create policy nda_signers_select on public.nda_signers
  for all using (
    exists (
      select 1 from public.nda_envelopes e
      where e.id = envelope_id and public.fn_has_org(e.org_id)
    )
  )
  with check (
    exists (
      select 1 from public.nda_envelopes e
      where e.id = envelope_id and public.fn_has_org(e.org_id)
    )
  );

drop policy if exists spine_signent_engagements_all on public.spine_signent_engagements;
create policy spine_signent_engagements_all on public.spine_signent_engagements
  for all using (public.fn_has_org(org_id))
  with check (public.fn_has_org(org_id));
