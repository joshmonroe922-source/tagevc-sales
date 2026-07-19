-- Legal corporate audit matrix (parent + subsidiaries)
-- Source: docs/legal/Corporate Audit Checklist - 619 Recruiting.docx
-- Run after 0025 on project hqmobgtnedmhzipusert

-- ---------------------------------------------------------------------------
-- Templates (catalog) — used for seed + auto-provision on new ops_entities
-- ---------------------------------------------------------------------------
create table if not exists public.legal_control_templates (
  control_key          text primary key,
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'audit'
                         check (source in ('audit', 'recommended', 'manual')),
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Legal',
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create or replace function public.set_legal_control_templates_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists legal_control_templates_updated_at on public.legal_control_templates;
create trigger legal_control_templates_updated_at
  before update on public.legal_control_templates
  for each row execute function public.set_legal_control_templates_updated_at();

-- ---------------------------------------------------------------------------
-- Controls (matrix rows): entity_id null = parent company
-- ---------------------------------------------------------------------------
create table if not exists public.legal_controls (
  id                   uuid primary key default gen_random_uuid(),
  entity_id            uuid references public.ops_entities (id) on delete cascade,
  control_key          text not null default '',
  title                text not null,
  description          text not null default '',
  area                 text not null default 'General',
  document_kind        text not null default 'RECORDS'
                         check (document_kind in ('POLICY', 'RECORDS')),
  evidence_expectation text not null default '',
  source               text not null default 'manual'
                         check (source in ('audit', 'recommended', 'manual')),
  applies_to_parent    boolean not null default true,
  applies_to_entities  boolean not null default true,
  cadence              text not null default 'annual'
                         check (cadence in ('annual', 'monthly', 'quarterly', 'one_time', 'custom')),
  owner_role           text not null default 'Legal',
  next_due_at          date,
  last_reviewed_at     date,
  status               text not null default 'open'
                         check (status in ('open', 'in_progress', 'compliant', 'gap', 'na')),
  evidence_url         text not null default '',
  evidence_notes       text not null default '',
  notes                text not null default '',
  active               boolean not null default true,
  created_by           uuid references public.sales_users (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists legal_controls_key_scope_uidx
  on public.legal_controls (control_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where control_key <> '' and active = true;

create index if not exists legal_controls_area_idx
  on public.legal_controls (area)
  where active = true;

create index if not exists legal_controls_status_idx
  on public.legal_controls (status)
  where active = true;

create index if not exists legal_controls_entity_idx
  on public.legal_controls (entity_id)
  where active = true;

create or replace function public.set_legal_controls_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists legal_controls_updated_at on public.legal_controls;
create trigger legal_controls_updated_at
  before update on public.legal_controls
  for each row execute function public.set_legal_controls_updated_at();

alter table public.legal_controls enable row level security;

drop policy if exists "Legal users manage legal controls" on public.legal_controls;
create policy "Legal users manage legal controls"
  on public.legal_controls for all
  using (public.is_active_sales_user() and public.user_has_portal('legal'))
  with check (public.is_active_sales_user() and public.user_has_portal('legal'));

-- Templates readable by legal users (for admin visibility)
alter table public.legal_control_templates enable row level security;

drop policy if exists "Legal users read legal templates" on public.legal_control_templates;
create policy "Legal users read legal templates"
  on public.legal_control_templates for select
  using (public.is_active_sales_user() and public.user_has_portal('legal'));

-- ---------------------------------------------------------------------------
-- Legal tasks linked to incomplete controls (optionally mirror to sales_tasks)
-- ---------------------------------------------------------------------------
create table if not exists public.legal_tasks (
  id            uuid primary key default gen_random_uuid(),
  control_id    uuid not null references public.legal_controls (id) on delete cascade,
  sales_task_id uuid references public.sales_tasks (id) on delete set null,
  title         text not null,
  status        text not null default 'open'
                  check (status in ('open', 'done', 'cancelled')),
  assigned_to   uuid references public.sales_users (id) on delete set null,
  due_at        date,
  notes         text not null default '',
  created_by    uuid references public.sales_users (id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create unique index if not exists legal_tasks_open_control_uidx
  on public.legal_tasks (control_id)
  where status = 'open';

create index if not exists legal_tasks_status_idx
  on public.legal_tasks (status, due_at);

create or replace function public.set_legal_tasks_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists legal_tasks_updated_at on public.legal_tasks;
create trigger legal_tasks_updated_at
  before update on public.legal_tasks
  for each row execute function public.set_legal_tasks_updated_at();

alter table public.legal_tasks enable row level security;

drop policy if exists "Legal users manage legal tasks" on public.legal_tasks;
create policy "Legal users manage legal tasks"
  on public.legal_tasks for all
  using (public.is_active_sales_user() and public.user_has_portal('legal'))
  with check (public.is_active_sales_user() and public.user_has_portal('legal'));

-- ---------------------------------------------------------------------------
-- Provision helpers
-- ---------------------------------------------------------------------------
create or replace function public.provision_legal_controls_for_entity(p_entity_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.legal_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    p_entity_id,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Auto-provisioned for new entity from legal control templates'
  from public.legal_control_templates t
  where t.applies_to_entities = true
    and not exists (
      select 1 from public.legal_controls c
      where c.control_key = t.control_key
        and c.entity_id = p_entity_id
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.provision_legal_controls_for_parent()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.legal_controls (
    entity_id, control_key, title, description, area, document_kind,
    evidence_expectation, source, cadence, owner_role,
    applies_to_parent, applies_to_entities, status, notes
  )
  select
    null,
    t.control_key,
    t.title,
    t.description,
    t.area,
    t.document_kind,
    t.evidence_expectation,
    t.source,
    t.cadence,
    t.owner_role,
    t.applies_to_parent,
    t.applies_to_entities,
    'open',
    'Seeded from Legal corporate audit checklist'
  from public.legal_control_templates t
  where t.applies_to_parent = true
    and not exists (
      select 1 from public.legal_controls c
      where c.control_key = t.control_key
        and c.entity_id is null
        and c.active = true
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

create or replace function public.trg_ops_entities_provision_legal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status in ('active', 'forming', 'acquired') then
    perform public.provision_legal_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_legal on public.ops_entities;
create trigger ops_entities_provision_legal
  after insert on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_legal();

-- Also provision when status flips into an active-like state
create or replace function public.trg_ops_entities_provision_legal_on_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and new.status in ('active', 'forming', 'acquired')
     and (old.status is null or old.status not in ('active', 'forming', 'acquired')) then
    perform public.provision_legal_controls_for_entity(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists ops_entities_provision_legal_on_status on public.ops_entities;
create trigger ops_entities_provision_legal_on_status
  after update of status on public.ops_entities
  for each row execute function public.trg_ops_entities_provision_legal_on_status();

-- Create open legal_tasks for incomplete controls (idempotent)
create or replace function public.create_legal_tasks_for_incomplete(p_created_by uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer := 0;
begin
  insert into public.legal_tasks (control_id, title, status, due_at, notes, created_by)
  select
    c.id,
    'Legal: ' || c.title,
    'open',
    c.next_due_at,
    coalesce(nullif(c.area, ''), 'Legal') || ' · ' || coalesce(nullif(c.control_key, ''), 'control'),
    p_created_by
  from public.legal_controls c
  where c.active = true
    and c.status in ('open', 'in_progress', 'gap')
    and not exists (
      select 1 from public.legal_tasks t
      where t.control_id = c.id and t.status = 'open'
    );
  get diagnostics inserted = row_count;
  return inserted;
end;
$$;

grant execute on function public.provision_legal_controls_for_entity(uuid) to authenticated;
grant execute on function public.provision_legal_controls_for_parent() to authenticated;
grant execute on function public.create_legal_tasks_for_incomplete(uuid) to authenticated;

-- Update legal portal copy
update public.sales_portals
set description = 'Corporate legal audit, operational compliance hygiene, and open legal tasks across parent + subsidiaries.'
where slug = 'legal';

insert into public.legal_control_templates (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('org-formation-documents','Formation documents (articles of incorporation / formation / organization)','Articles of incorporation, formation, or organization on file and current.','Organizational','RECORDS','Latest filed formation docs','audit','one_time','Legal',true,true),
('org-formation-amendments','Amendments to formation documents','Any amendments to formation documents are filed and retained.','Organizational','RECORDS','Latest amendments (or confirmation none)','audit','annual','Legal',true,true),
('org-operating-agreement','Operating agreement','Current operating agreement executed and retained.','Organizational','RECORDS','Executed operating agreement','audit','annual','Legal',true,true),
('org-shareholder-unitholder-agreement','Shareholder / unitholder agreement','Shareholder or unitholder agreement on file when applicable.','Organizational','RECORDS','Agreement or N/A rationale','audit','annual','Legal',true,true),
('org-voting-agreement','Voting agreement','Voting agreement on file when applicable.','Organizational','RECORDS','Agreement or N/A rationale','audit','annual','Legal',true,true),
('org-investors-rights-agreement','Investors'' rights agreement','Investors'' rights agreement on file when applicable.','Organizational','RECORDS','Agreement or N/A rationale','audit','annual','Legal',true,true),
('org-rofr-cosale-agreement','Right of first refusal / co-sale agreement','ROFR / co-sale agreement on file when applicable.','Organizational','RECORDS','Agreement or N/A rationale','audit','annual','Legal',true,true),
('org-structure-chart','Structure chart (parents and subsidiaries)','Maintain structure chart covering parents, subsidiaries, and expansion plans (asset protection, risk isolation, succession, gov-contract, tax).','Organizational','RECORDS','Current org / structure chart','audit','annual','Legal',true,false),
('org-list-of-officers','List of officers','Current list of officers named in authorizing resolutions.','Organizational','RECORDS','Officer roster + resolutions','audit','annual','Legal',true,true),
('org-list-of-managers','List of managers','Current list of managers named in authorizing resolutions.','Organizational','RECORDS','Manager roster + resolutions','audit','annual','Legal',true,true),
('org-corporate-minute-book','Corporate minute book','Corporate minute book maintained with resolutions and meeting minutes.','Organizational','RECORDS','Minute book (or equivalent digital vault)','audit','annual','Legal',true,true),
('org-capitalization-records','Capitalization records','Ownership / capitalization records current (members, units, %).','Organizational','RECORDS','Cap table / ownership schedule','audit','annual','Legal',true,true),
('contracts-partnership-jv','Partnership and joint venture agreements','Partnership / JV agreements (and inter-LLC agreements for spin-offs/subsidiaries) on file.','Material Contracts','RECORDS','Executed agreements or confirmation none','audit','annual','Legal',true,true),
('contracts-loans-liabilities','Loans and liabilities documentation','All loan, credit, mortgage, pledge, guarantee, and related default correspondence retained.','Material Contracts','RECORDS','Debt schedule + agreements','audit','annual','Legal / Finance',true,true),
('contracts-leases','Leases and occupancy agreements','Real property leases, occupancy agreements, options, subleases retained.','Material Contracts','RECORDS','Lease file or month-to-month confirmation','audit','annual','Legal / Ops',true,true),
('contracts-vendor-agreements','Vendor agreements (including form)','Vendor agreements and approved form vendor agreement reviewed and filed.','Material Contracts','RECORDS','Executed vendor agreements + form','audit','annual','Legal',true,true),
('contracts-customer-contracts','Customer contracts (including form MSA/SaaS)','Customer contracts and form MSA/SaaS/SOW templates reviewed and filed.','Material Contracts','RECORDS','Executed customer agreements + form','audit','annual','Legal',true,true),
('gov-regulatory-correspondence','Regulatory correspondence (5 years)','Significant correspondence/reports with local, state, and federal regulators for past 5 years.','Governmental & Regulatory','RECORDS','Regulatory correspondence file or confirmation none','audit','annual','Legal',true,true),
('gov-licenses-permits','Licenses and permits register','List and copies of licenses/permits; track renewals.','Governmental & Regulatory','RECORDS','License/permit register + copies','audit','annual','Legal / Ops',true,true),
('emp-headcount-ic-classification','Employee / independent contractor classification','Headcount and IC classification documented and reviewed.','Employee Matters','RECORDS','Headcount + IC classification summary','audit','annual','Legal / HR',true,true),
('emp-background-checks','Background checks and consents','Background check practices and consents obtained/retained where used.','Employee Matters','RECORDS','Policy + sample consents','audit','annual','Legal / HR',true,true),
('emp-employment-agreements','Employment agreements (including form)','Form employment agreement (or documented offer-letter policy) reviewed and available.','Employee Matters','RECORDS','Form agreement + executed samples','audit','annual','Legal / HR',true,true),
('emp-executive-agreements','Executive employment agreements','Executive agreements covering indemnification, confidentiality, and non-compete as applicable.','Employee Matters','RECORDS','Executed executive agreements or N/A','audit','annual','Legal / HR',true,true),
('emp-separation-agreements','Separation / termination agreements','Form separation/termination agreement reviewed and available.','Employee Matters','RECORDS','Form separation agreement','recommended','annual','Legal / HR',true,true),
('emp-employee-handbook','Employee handbook (legal review)','Employee handbook attorney-reviewed and current.','Employee Matters','POLICY','Current handbook + review note','audit','annual','Legal / HR',true,true),
('emp-collective-bargaining','Collective bargaining agreements','Collective bargaining agreements on file when applicable.','Employee Matters','RECORDS','CBA or N/A confirmation','audit','annual','Legal / HR',true,true),
('lit-claims-schedule','Litigation and claims schedule','Schedule of liability claims and material litigation/admin/arbitration/investigations pending or threatened.','Litigation','RECORDS','Litigation/claims schedule or confirmation none','audit','quarterly','Legal',true,true),
('lit-judgments-settlements','Consent decrees, judgments, and settlements','Consent decrees, judgments, orders, injunctions, and settlement agreements retained.','Litigation','RECORDS','Judgment/settlement file or confirmation none','audit','annual','Legal',true,true),
('env-matters-assessment','Environmental matters assessment','Confirm whether any environmental matters apply and document conclusion.','Environmental','RECORDS','Assessment note or confirmation none','audit','annual','Legal / Ops',true,true),
('assets-real-estate','Real estate assets register','Real estate assets owned or controlled documented.','Material Assets','RECORDS','Asset register or confirmation none','audit','annual','Legal / Finance',true,true),
('assets-portfolio-investments','Portfolio company investments','Portfolio / subsidiary investment records maintained.','Material Assets','RECORDS','Investment schedule','audit','annual','Legal / Finance',true,false),
('assets-equipment','Equipment assets register','Equipment assets documented (including BYOD / server intent and data-security notes).','Material Assets','RECORDS','Equipment inventory or confirmation limited','audit','annual','Legal / IT',true,true),
('ins-key-man','Key man insurance policy','Key man insurance policy on file when part of succession plan.','Insurance','RECORDS','Policy declarations or gap note','audit','annual','Legal / Finance',true,true),
('ins-buy-sell','Buy/sell insurance policies','Buy/sell policies on file when applicable.','Insurance','RECORDS','Policy or N/A rationale','audit','annual','Legal / Finance',true,true),
('ins-cgl','Commercial general liability insurance','CGL coverage current; attorney review recommended.','Insurance','RECORDS','Declarations page + review note','audit','annual','Legal',true,true),
('ins-umbrella','Umbrella insurance policy','Umbrella policy current; attorney review recommended.','Insurance','RECORDS','Declarations page + review note','audit','annual','Legal',true,true),
('ins-cyber','Cyber / data breach insurance','Cyber / data breach coverage confirmed (standalone or via CGL).','Insurance','RECORDS','Policy declarations or coverage confirmation','audit','annual','Legal / IT',true,true),
('ip-trademarks','Trademarks','Trademark search/registration status documented.','Intellectual Property','RECORDS','Trademark search / registration file','audit','annual','Legal',true,true),
('ip-copyrights','Copyrights','Copyright registrations or N/A documented.','Intellectual Property','RECORDS','Copyright file or N/A','audit','annual','Legal',true,true),
('ip-patents','Patents','Patent filings or N/A documented.','Intellectual Property','RECORDS','Patent file or N/A','audit','annual','Legal',true,true),
('ip-trade-secrets-policy','Trade secrets policy','Trade secrets policy created and implemented.','Intellectual Property','POLICY','Adopted trade secrets policy','audit','annual','Legal',true,true),
('privacy-global-policy','Global privacy policy','Global privacy policy created and published where applicable.','Privacy','POLICY','Published privacy policy','audit','annual','Legal',true,true),
('privacy-consumer-disclosures','Consumer privacy disclosures','Consumer privacy disclosures current.','Privacy','POLICY','Consumer disclosures','audit','annual','Legal',true,true),
('privacy-employee-disclosures','Employee privacy disclosures','Employee privacy disclosures created and acknowledged.','Privacy','POLICY','Employee privacy disclosure + ack samples','audit','annual','Legal / HR',true,true),
('privacy-hipaa','HIPAA applicability','HIPAA applicability assessed; compliance if applicable.','Privacy','RECORDS','HIPAA assessment or N/A','audit','annual','Legal / HR',true,true),
('privacy-customer-data-inventory','Customer data inventory','Inventory of data collected from customers.','Privacy','RECORDS','Customer data inventory','audit','annual','Legal / Ops',true,true),
('privacy-employee-data-inventory','Employee data inventory','Inventory of data collected from employees (incl. third-party processors).','Privacy','RECORDS','Employee data inventory + processor list','audit','annual','Legal / HR',true,true),
('ad-domain-names','Domain name register','List of domain names owned/controlled.','Advertising & Promotional','RECORDS','Domain register','audit','annual','Legal / Marketing',true,true),
('ad-website-tos','Website terms of service','Website terms of service attorney-reviewed.','Advertising & Promotional','POLICY','Current ToS + review note','audit','annual','Legal',true,true),
('ad-website-privacy','Website privacy policy','Website privacy policy attorney-reviewed.','Advertising & Promotional','POLICY','Current privacy policy + review note','audit','annual','Legal',true,true),
('ad-cookie-policy','Cookie policy','Cookie policy attorney-reviewed.','Advertising & Promotional','POLICY','Current cookie policy + review note','audit','annual','Legal',true,true),
('ad-website-data-inventory','Website data collection inventory','Document data collected from website (analytics, CRM, marketing tools).','Advertising & Promotional','RECORDS','Website data inventory','audit','annual','Legal / Marketing',true,true),
('ad-contests-sweepstakes','Contests or sweepstakes compliance','Contest/sweepstakes rules and filings when used.','Advertising & Promotional','RECORDS','Rules/filings or N/A','audit','annual','Legal / Marketing',true,true),
('ad-email-marketing-practices','Email marketing practices review','Email marketing practices and tool ToS reviewed (CRM, outreach tools).','Advertising & Promotional','RECORDS','Practice review note + vendor ToS','audit','annual','Legal / Marketing',true,true),
('ad-cold-call-practices','Cold call practices','Cold call practices documented or confirmed N/A.','Advertising & Promotional','RECORDS','Practice note or N/A','audit','annual','Legal / Sales',true,true),
('geo-principal-place','Principal place of business','Principal place of business documented.','Geography','RECORDS','Principal address confirmation','audit','annual','Legal',true,true),
('geo-other-offices','Other offices / branches','Addresses of other offices/branches documented.','Geography','RECORDS','Office list or confirmation none','audit','annual','Legal / Ops',true,true),
('geo-advertising-states','States where services are advertised','Track states where services/products are advertised (job boards, etc.).','Geography','RECORDS','Advertising-state register','audit','annual','Legal / Marketing',true,true),
('geo-customer-states','States where clients are located','Track states where clients/customers are located.','Geography','RECORDS','Customer-state register','audit','annual','Legal / Sales',true,true),
('geo-bank-state','State of bank account','State where bank account is located documented.','Geography','RECORDS','Banking domicile confirmation','audit','annual','Legal / Finance',true,true),
('tax-prior-year-liability','Prior-year tax liability review','Prior-year tax liability reviewed with counsel/CPA as needed.','Tax','RECORDS','Tax review note','audit','annual','Legal / Finance',true,true),
('tax-rate-documentation','Tax rate documentation','Applicable tax rate documentation retained.','Tax','RECORDS','Tax rate summary','audit','annual','Finance / Legal',true,true),
('tax-income-classification','Active vs passive income classification','Active/passive income classification documented.','Tax','RECORDS','Classification note','audit','annual','Finance / Legal',true,true),
('tax-fein','FEIN on file','FEIN on file and accessible to authorized personnel.','Tax','RECORDS','FEIN confirmation (no full number in notes)','audit','one_time','Finance / Legal',true,true),
('succ-formal-plan','Formal business succession plan','Formal business succession plan adopted.','Business Succession','POLICY','Adopted succession plan','audit','annual','Legal',true,false),
('succ-key-man','Succession key man insurance','Key man insurance aligned to succession plan.','Business Succession','RECORDS','Policy or gap note','audit','annual','Legal / Finance',true,false),
('succ-buy-sell','Succession buy/sell policy','Buy/sell policy for ownership transitions.','Business Succession','POLICY','Buy/sell policy or agreement','audit','annual','Legal',true,false),
('succ-estate-plan','Estate plan for owners','Owner estate plan considerations documented.','Business Succession','RECORDS','Estate plan status note (owner privilege)','audit','annual','Legal',true,false),
('succ-trusts','Trusts','Relevant trusts documented when used.','Business Succession','RECORDS','Trust schedule or N/A','audit','annual','Legal',true,false),
('succ-spousal-consents','Spousal consents','Spousal consents obtained when required.','Business Succession','RECORDS','Consents or N/A','audit','annual','Legal',true,false),
('succ-exit-plan','Exit plan','Entity/owner exit plan documented.','Business Succession','POLICY','Exit plan','audit','annual','Legal',true,false),
('rec-intercompany-agreements','Intercompany agreements for subsidiaries','Agreements between parent and subsidiaries/spin-offs when multi-entity structure exists.','Material Contracts','RECORDS','Intercompany agreement pack','recommended','annual','Legal',true,true),
('rec-privacy-data-security-consult','Privacy / data security consultation','Consult on privacy/data security (esp. BYOD / shared server intent).','Privacy','RECORDS','Consultation memo or engagement','recommended','annual','Legal / IT',true,true),
('rec-s-corp-tax-election','S-corp tax election (when LLC taxed as S-corp)','Confirm S-corp tax election filed when entity is LLC taxed as S-corp.','Tax','RECORDS','IRS election confirmation','recommended','one_time','Legal / Finance',true,true)
on conflict (control_key) do update set
  title = excluded.title,
  description = excluded.description,
  area = excluded.area,
  document_kind = excluded.document_kind,
  evidence_expectation = excluded.evidence_expectation,
  source = excluded.source,
  cadence = excluded.cadence,
  owner_role = excluded.owner_role,
  applies_to_parent = excluded.applies_to_parent,
  applies_to_entities = excluded.applies_to_entities,
  updated_at = now();

-- HR extras
insert into public.hr_compliance_controls (entity_id, control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities, status, notes)
select null, s.control_key, s.title, s.description, s.area, s.document_kind, s.evidence_expectation, s.source, s.cadence, s.owner_role, s.applies_to_parent, s.applies_to_entities, 'open', 'Seeded from Legal corporate audit Employee Matters overlap'
from (values
('legal-audit-separation-termination-agreement','Separation / Termination Agreement (form)','Recommended by legal corporate audit — form separation/termination agreement reviewed and available for HR use.','Offboarding','RECORDS','Form agreement on file','recommended','annual','HR / Legal',true,true),
('legal-audit-executive-confidentiality-noncompete','Executive Confidentiality & Non-Compete Agreements','Legal audit: executive agreements covering confidentiality and non-compete (with indemnification as applicable).','Employee Relations','RECORDS','Executed executive agreements or N/A','recommended','annual','HR / Legal',true,true),
('legal-audit-employee-ic-headcount-classification','Employee vs IC Headcount Classification','Legal audit: maintain classification of employees vs independent contractors for each entity.','Compliance','RECORDS','Headcount + classification summary','recommended','annual','HR',true,true),
('legal-audit-employee-privacy-disclosures','Employee Privacy Disclosures (company)','Legal audit: create and maintain employee privacy disclosures (complements per-person privacy consent).','Compliance','POLICY','Published disclosures + ack samples','recommended','annual','HR / Legal',true,true),
('legal-audit-background-check-practice-review','Background Check Practice Review','Legal audit: review background-check policies/practices and retained consents.','Onboarding','POLICY','Practice review note + sample consents','recommended','annual','HR / Legal',true,true)
) as s(control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities)
where not exists (select 1 from public.hr_compliance_controls c where c.control_key = s.control_key and c.entity_id is null and c.active = true);

-- Materialize parent + entity control rows from templates
select public.provision_legal_controls_for_parent();

do $$
declare
  r record;
begin
  for r in
    select id from public.ops_entities
    where status in ('active', 'forming', 'acquired')
  loop
    perform public.provision_legal_controls_for_entity(r.id);
  end loop;
end $$;

-- HR overlap: also seed entity rows for legal-audit HR extras
insert into public.hr_compliance_controls (
  entity_id, control_key, title, description, area, document_kind,
  evidence_expectation, source, cadence, owner_role,
  applies_to_parent, applies_to_entities, status, notes
)
select
  e.id,
  s.control_key,
  s.title,
  s.description,
  s.area,
  s.document_kind,
  s.evidence_expectation,
  s.source,
  s.cadence,
  s.owner_role,
  s.applies_to_parent,
  s.applies_to_entities,
  'open',
  'Seeded from Legal corporate audit Employee Matters overlap'
from (values
  ('legal-audit-separation-termination-agreement','Separation / Termination Agreement (form)','Recommended by legal corporate audit — form separation/termination agreement reviewed and available for HR use.','Offboarding','RECORDS','Form agreement on file','recommended','annual','HR / Legal',true,true),
  ('legal-audit-executive-confidentiality-noncompete','Executive Confidentiality & Non-Compete Agreements','Legal audit: executive agreements covering confidentiality and non-compete (with indemnification as applicable).','Employee Relations','RECORDS','Executed executive agreements or N/A','recommended','annual','HR / Legal',true,true),
  ('legal-audit-employee-ic-headcount-classification','Employee vs IC Headcount Classification','Legal audit: maintain classification of employees vs independent contractors for each entity.','Compliance','RECORDS','Headcount + classification summary','recommended','annual','HR',true,true),
  ('legal-audit-employee-privacy-disclosures','Employee Privacy Disclosures (company)','Legal audit: create and maintain employee privacy disclosures (complements per-person privacy consent).','Compliance','POLICY','Published disclosures + ack samples','recommended','annual','HR / Legal',true,true),
  ('legal-audit-background-check-practice-review','Background Check Practice Review','Legal audit: review background-check policies/practices and retained consents.','Onboarding','POLICY','Practice review note + sample consents','recommended','annual','HR / Legal',true,true)
) as s(control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities)
cross join public.ops_entities e
where s.applies_to_entities = true
  and e.status in ('active', 'forming', 'acquired')
  and not exists (
    select 1 from public.hr_compliance_controls c
    where c.control_key = s.control_key and c.entity_id = e.id and c.active = true
  );

-- Seed open legal tasks for incomplete controls (no MS To Do push — UI can sync)
select public.create_legal_tasks_for_incomplete(null);

