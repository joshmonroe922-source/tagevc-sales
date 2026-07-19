-- HR Phase 2: compliance audit seed + employee file (documents/activities)
-- Source: docs/hr/HR Compliance Audit.pdf (gitignored — sensitive)
-- Run after 0024_hr_foundation.sql on project hqmobgtnedmhzipusert

-- ---------------------------------------------------------------------------
-- Schema: compliance control enrichment
-- ---------------------------------------------------------------------------
alter table public.hr_compliance_controls
  add column if not exists area text not null default 'General',
  add column if not exists document_kind text not null default 'RECORDS',
  add column if not exists evidence_expectation text not null default '',
  add column if not exists source text not null default 'manual',
  add column if not exists applies_to_parent boolean not null default true,
  add column if not exists applies_to_entities boolean not null default true,
  add column if not exists evidence_notes text not null default '';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'hr_compliance_controls_document_kind_check'
  ) then
    alter table public.hr_compliance_controls
      add constraint hr_compliance_controls_document_kind_check
      check (document_kind in ('POLICY', 'RECORDS'));
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'hr_compliance_controls_source_check'
  ) then
    alter table public.hr_compliance_controls
      add constraint hr_compliance_controls_source_check
      check (source in ('audit', 'recommended', 'manual'));
  end if;
end $$;

create unique index if not exists hr_compliance_controls_key_scope_uidx
  on public.hr_compliance_controls (control_key, coalesce(entity_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where control_key <> '' and active = true;

create index if not exists hr_compliance_controls_area_idx
  on public.hr_compliance_controls (area)
  where active = true;

create index if not exists hr_compliance_controls_source_idx
  on public.hr_compliance_controls (source)
  where active = true;

-- ---------------------------------------------------------------------------
-- Expand checklist system_hook options for audit-driven tasks
-- ---------------------------------------------------------------------------
alter table public.hr_checklist_items drop constraint if exists hr_checklist_items_system_hook_check;
alter table public.hr_checklist_items
  add constraint hr_checklist_items_system_hook_check
  check (
    system_hook is null
    or system_hook in (
      'payroll',
      'it_provision',
      'asset_audit',
      'benefits',
      'swag',
      'access_revoke',
      'manual',
      'i9',
      'handbook_ack',
      'employment_contract',
      'privacy_consent',
      'job_description',
      'compliance_ack'
    )
  );

-- ---------------------------------------------------------------------------
-- Employee file: documents + activity log
-- ---------------------------------------------------------------------------
create table if not exists public.hr_employee_documents (
  id                  uuid primary key default gen_random_uuid(),
  employee_id         uuid not null references public.hr_employees (id) on delete cascade,
  title               text not null,
  category            text not null default 'tenure'
                        check (category in (
                          'onboarding', 'tenure', 'offboarding', 'compliance', 'other'
                        )),
  doc_kind            text not null default 'file'
                        check (doc_kind in ('file', 'link', 'note', 'ack')),
  file_url            text not null default '',
  related_control_key text not null default '',
  related_checklist_id uuid references public.hr_onboarding_checklists (id) on delete set null,
  notes               text not null default '',
  created_by          uuid references public.sales_users (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists hr_employee_documents_employee_idx
  on public.hr_employee_documents (employee_id, created_at desc);

alter table public.hr_employee_documents enable row level security;

create or replace function public.set_hr_employee_documents_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists hr_employee_documents_updated_at on public.hr_employee_documents;
create trigger hr_employee_documents_updated_at
  before update on public.hr_employee_documents
  for each row execute function public.set_hr_employee_documents_updated_at();

drop policy if exists "HR users manage employee documents" on public.hr_employee_documents;
create policy "HR users manage employee documents"
  on public.hr_employee_documents for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));

create table if not exists public.hr_employee_activities (
  id                   uuid primary key default gen_random_uuid(),
  employee_id          uuid not null references public.hr_employees (id) on delete cascade,
  activity_type        text not null default 'note'
                         check (activity_type in (
                           'note', 'status_change', 'checklist', 'document',
                           'compliance_ack', 'system_hook', 'review', 'other'
                         )),
  title                text not null,
  body                 text not null default '',
  related_checklist_id uuid references public.hr_onboarding_checklists (id) on delete set null,
  related_document_id  uuid references public.hr_employee_documents (id) on delete set null,
  system_hook          text,
  status               text not null default '',
  occurred_at          timestamptz not null default now(),
  created_by           uuid references public.sales_users (id) on delete set null,
  created_at           timestamptz not null default now()
);

create index if not exists hr_employee_activities_employee_idx
  on public.hr_employee_activities (employee_id, occurred_at desc);

alter table public.hr_employee_activities enable row level security;

drop policy if exists "HR users manage employee activities" on public.hr_employee_activities;
create policy "HR users manage employee activities"
  on public.hr_employee_activities for all
  using (public.is_active_sales_user() and public.user_has_portal('human-resources'))
  with check (public.is_active_sales_user() and public.user_has_portal('human-resources'));


-- ---------------------------------------------------------------------------
-- Seed control catalog (idempotent by control_key + scope)
-- ---------------------------------------------------------------------------
create temporary table if not exists _hr_control_seed (
  control_key text primary key,
  title text not null,
  description text not null default '',
  area text not null,
  document_kind text not null,
  evidence_expectation text not null,
  source text not null,
  cadence text not null,
  owner_role text not null,
  applies_to_parent boolean not null,
  applies_to_entities boolean not null
) on commit drop;

truncate _hr_control_seed;

insert into _hr_control_seed (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('audit-administrati-certificate-of-insurance','Certificate of Insurance','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','annual','HR / Legal',true,true),
('audit-administrati-litigation-response-procedure','Litigation Response Procedure','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Legal',true,true),
('audit-administrati-scandal-response-procedure','Scandal Response Procedure','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Legal / HR',true,true),
('audit-administrati-environmental-policy','Environmental Policy','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Ops / Legal',true,true),
('audit-administrati-waste-disposal-procedure','Waste Disposal Procedure','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Ops',false,true),
('audit-administrati-crisis-management-training-and-implementation-records','Crisis Management Training and Implementation Records','Audit control — evidence: Actual Samples','Administration','RECORDS','Actual Samples','audit','annual','HR / Ops',true,true),
('audit-administrati-business-continuity-plan-bcp','Business Continuity Plan (BCP)','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Ops',true,true),
('audit-administrati-agreement-with-legal-counsel','Agreement with Legal Counsel','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','annual','Legal',true,false),
('audit-administrati-litigation-response-trail','Litigation Response Trail','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','custom','Legal',true,true),
('audit-administrati-evidence-of-past-scandal-response','Evidence of Past Scandal Response','Audit control — evidence: Actual Sample','Administration','RECORDS','Actual Sample','audit','custom','Legal / HR',true,true),
('audit-administrati-rules-for-personnel-evaluation','Rules for Personnel Evaluation','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','HR',true,true),
('audit-administrati-dissemination-record-regarding-policies-and-procedures','Dissemination Record regarding Policies and Procedures','Audit control — evidence: Actual Sample','Administration','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-administrati-insurance-coverage-regulations','Insurance Coverage Regulations','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Legal / Finance',true,true),
('audit-administrati-employee-register','Employee Register','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','monthly','HR',true,true),
('audit-administrati-salary-and-bonus-statement','Salary and Bonus Statement','Audit control — evidence: Actual Sample','Administration','RECORDS','Actual Sample','audit','annual','HR / Finance',true,true),
('audit-administrati-records-of-communication-for-the-prevention-of-overtime','Records of Communication for the Prevention of Overtime','Audit control — evidence: 3 Actual Samples','Administration','RECORDS','3 Actual Samples','audit','quarterly','HR',true,true),
('audit-administrati-employee-time-card','Employee Time Card','Audit control — evidence: 3 Actual Samples','Administration','RECORDS','3 Actual Samples','audit','quarterly','HR',true,true),
('audit-administrati-articles-of-incorporation','Articles of Incorporation','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','one_time','Legal',true,false),
('audit-administrati-board-of-director-regulations','Board of Director Regulations','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Legal',true,false),
('audit-administrati-corporate-rules-and-regulations','Corporate Rules and Regulations','Audit control — evidence: Latest File','Administration','POLICY','Latest File','audit','annual','Legal',true,false);
insert into _hr_control_seed (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('audit-administrati-organizational-chart','Organizational Chart','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','annual','HR',true,true),
('audit-administrati-reports-of-loss-theft-or-damage','Reports of Loss, Theft, or Damage','Audit control — evidence: Latest File','Administration','RECORDS','Latest File','audit','annual','Ops / Finance',true,true),
('audit-benefits-cobra-administration','COBRA Administration','Audit control — evidence: 3 Actual Samples','Benefits','RECORDS','3 Actual Samples','audit','annual','HR',true,true),
('audit-benefits-benefit-dependent-compliance','Benefit Dependent Compliance','Audit control — evidence: 3 Actual Samples','Benefits','RECORDS','3 Actual Samples','audit','annual','HR',true,true),
('audit-benefits-fmla-case-tracking','FMLA Case Tracking','Audit control — evidence: Latest File','Benefits','RECORDS','Latest File','audit','annual','HR',true,true),
('audit-benefits-fmla-application-and-approval-trail','FMLA Application and Approval Trail','Audit control — evidence: Latest File','Benefits','RECORDS','Latest File','audit','annual','HR',true,true),
('audit-compliance-osha-300a-summary','OSHA 300A Summary','Audit control — evidence: Actual Sample','Compliance','RECORDS','Actual Sample','audit','annual','HR / Safety',false,true),
('audit-compliance-personal-information-protection-regulations','Personal Information Protection Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-risk-management-rules','Risk Management Rules','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','Legal / Ops',true,true),
('audit-compliance-labor-union-policy','Labor Union Policy','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-compliance-regulations','Compliance Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-anti-bribery-regulations','Anti-Bribery Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','Legal',true,true),
('audit-compliance-competition-law-compliance-regulations','Competition Law Compliance Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','Legal',true,true),
('audit-compliance-eeo-1-reporting-compliance','EEO-1 Reporting Compliance','Audit control — evidence: Latest File','Compliance','RECORDS','Latest File','audit','annual','HR',true,true),
('audit-compliance-use-of-personal-information-consent-form','Use of Personal Information Consent Form','Audit control — evidence: 3 Actual Samples','Compliance','RECORDS','3 Actual Samples','audit','annual','HR',true,true),
('audit-compliance-disclosure-of-personal-information-acknowledgement-form','Disclosure of Personal Information Acknowledgement Form','Audit control — evidence: 3 Actual Samples','Compliance','RECORDS','3 Actual Samples','audit','annual','HR',true,true),
('audit-compliance-employment-posters-displayed','Employment Posters Displayed','Audit control — evidence: On-Site Inspection','Compliance','RECORDS','On-Site Inspection','audit','annual','HR',true,true),
('audit-compliance-compliance-training-materials-and-distribution-records','Compliance Training Materials and Distribution Records','Audit control — evidence: Actual Sample','Compliance','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-compliance-compliance-education-program','Compliance Education Program','Audit control — evidence: Latest Sample','Compliance','POLICY','Latest Sample','audit','annual','HR',true,true),
('audit-compliance-dissemination-records-of-anti-bribery','Dissemination Records of Anti-Bribery','Audit control — evidence: Actual Sample','Compliance','RECORDS','Actual Sample','audit','annual','Legal / HR',true,true);
insert into _hr_control_seed (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('audit-compliance-dissemination-records-of-competition-law-compliance','Dissemination Records of Competition Law Compliance','Audit control — evidence: Actual Sample','Compliance','RECORDS','Actual Sample','audit','annual','Legal',true,true),
('audit-compliance-labor-law-revision-documents','Labor Law Revision Documents','Audit control — evidence: Latest File','Compliance','RECORDS','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-employment-regulations','Employment Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR',true,true),
('audit-compliance-labor-law','Labor Law','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-wage-regulations','Wage Regulations','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Finance',true,true),
('audit-compliance-anti-discrimination-policy-title-vii','Anti Discrimination Policy (Title VII)','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-employee-handbook-change-record','Employee Handbook Change Record','Audit control — evidence: Latest File','Compliance','RECORDS','Latest File','audit','annual','HR',true,true),
('audit-compliance-confirmation-of-law-and-ordinance-change-record','Confirmation of Law and Ordinance Change Record','Audit control — evidence: Latest File','Compliance','RECORDS','Latest File','audit','annual','HR / Legal',true,true),
('audit-compliance-employee-handbook','Employee Handbook','Audit control — evidence: Latest File','Compliance','POLICY','Latest File','audit','annual','HR',true,true),
('audit-compliance-policy-and-procedure-change-record','Policy and Procedure Change Record','Audit control — evidence: Actual Sample','Compliance','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-employee-eng-employee-satisfaction-survey','Employee Satisfaction Survey','Audit control — evidence: Actual Sample','Employee Engagement','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-employee-eng-company-action-plan-to-survey-results','Company Action Plan to Survey Results','Audit control — evidence: Latest File','Employee Engagement','POLICY','Latest File','audit','annual','HR',true,true),
('audit-employee-eng-employee-recognition-program','Employee Recognition Program','Audit control — evidence: Latest File','Employee Engagement','POLICY','Latest File','audit','annual','HR',true,true),
('audit-employee-rel-internal-whistleblower-procedure','Internal Whistleblower Procedure','Audit control — evidence: Latest File','Employee Relations','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-employee-rel-employee-misconduct-investigation-procedure','Employee Misconduct Investigation Procedure','Audit control — evidence: Latest File','Employee Relations','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-employee-rel-employee-misconduct-investigation-trail-initial-complaint-emp','Employee Misconduct Investigation Trail (Initial Complaint, Employee Statements, Result and Summary)','Audit control — evidence: Actual Sample','Employee Relations','RECORDS','Actual Sample','audit','annual','HR / Legal',true,true),
('audit-employee-rel-retaliation-prevention','Retaliation Prevention','Audit control — evidence: Latest File','Employee Relations','POLICY','Latest File','audit','annual','HR / Legal',true,true),
('audit-employee-rel-internal-whistleblower-hotline-explanatory-materials','Internal Whistleblower Hotline Explanatory Materials','Audit control — evidence: Latest File','Employee Relations','POLICY','Latest File','audit','annual','HR',true,true),
('audit-employee-rel-trail-of-internal-whistleblower-hotline-cases','Trail of Internal Whistleblower Hotline Cases','Audit control — evidence: Latest File','Employee Relations','RECORDS','Latest File','audit','annual','HR / Legal',true,true),
('audit-offboarding-rules-for-dismissal','Rules for Dismissal','Audit control — evidence: Latest File','Offboarding','POLICY','Latest File','audit','annual','HR',true,true);
insert into _hr_control_seed (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('audit-offboarding-records-of-dismissal','Records of Dismissal','Audit control — evidence: 3 Actual Samples','Offboarding','RECORDS','3 Actual Samples','audit','annual','HR',true,true),
('audit-offboarding-offboarding-process','Offboarding Process','Audit control — evidence: Actual Sample','Offboarding','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-onboarding-onboarding-process','Onboarding Process','Audit control — evidence: Actual Sample','Onboarding','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-onboarding-employment-contract','Employment Contract','Audit control — evidence: Actual Sample','Onboarding','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-onboarding-record-of-i-9-verifications','Record of I-9 Verifications','Audit control — evidence: Latest Sample','Onboarding','RECORDS','Latest Sample','audit','annual','HR',true,true),
('audit-onboarding-job-description','Job Description','Audit control — evidence: 3 Actual Samples','Onboarding','POLICY','3 Actual Samples','audit','annual','HR',true,true),
('audit-onboarding-recruitment-plan','Recruitment Plan','Audit control — evidence: Latest File','Onboarding','POLICY','Latest File','audit','annual','HR',true,true),
('audit-onboarding-recruitment-record','Recruitment Record','Audit control — evidence: Actual Sample','Onboarding','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-onboarding-employee-handbook-acknowledgement-record','Employee Handbook Acknowledgement Record','Audit control — evidence: Actual Sample','Onboarding','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-recordkeepin-medical-information-record','Medical Information Record','Audit control — evidence: On-Site Inspection','Recordkeeping','RECORDS','On-Site Inspection','audit','annual','HR',true,true),
('audit-recordkeepin-personal-information-record','Personal Information Record','Audit control — evidence: On-Site Inspection','Recordkeeping','RECORDS','On-Site Inspection','audit','annual','HR',true,true),
('audit-recordkeepin-disposal-of-personal-information-record','Disposal of Personal Information Record','Audit control — evidence: On-Site Inspection','Recordkeeping','RECORDS','On-Site Inspection','audit','annual','HR',true,true),
('audit-recordkeepin-disciplinary-action-record','Disciplinary Action Record','Audit control — evidence: Actual Sample','Recordkeeping','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-recordkeepin-attendance-management-record','Attendance Management Record','Audit control — evidence: Actual Sample','Recordkeeping','RECORDS','Actual Sample','audit','annual','HR',true,true),
('audit-safety-healt-safety-policy-safety-and-health-management-regulations-osha','Safety Policy, Safety and Health Management Regulations (OSHA)','Audit control — evidence: Latest File','Safety & Health','POLICY','Latest File','audit','annual','HR / Safety',true,true),
('audit-safety-healt-health-and-safety-management-rules','Health and Safety Management Rules','Audit control — evidence: Latest File','Safety & Health','POLICY','Latest File','audit','annual','HR / Safety',true,true),
('audit-safety-healt-accident-response-procedure','Accident Response Procedure','Audit control — evidence: Latest File','Safety & Health','POLICY','Latest File','audit','annual','HR / Safety',true,true),
('audit-safety-healt-workplace-accident-injury-report','Workplace Accident/Injury Report','Audit control — evidence: Actual Sample','Safety & Health','RECORDS','Actual Sample','audit','annual','HR / Safety',false,true),
('audit-safety-healt-accident-investigation-and-review','Accident Investigation and Review','Audit control — evidence: Actual Sample','Safety & Health','RECORDS','Actual Sample','audit','annual','HR / Safety',false,true),
('audit-safety-healt-safety-communication-records-recurring-safety-meeting','Safety Communication Records (Recurring Safety Meeting)','Audit control — evidence: 3 Actual Samples','Safety & Health','RECORDS','3 Actual Samples','audit','annual','HR / Safety',false,true);
insert into _hr_control_seed (control_key, title, description, area, document_kind, evidence_expectation, source, cadence, owner_role, applies_to_parent, applies_to_entities) values
('audit-safety-healt-improvement-strategy-for-accidents','Improvement Strategy for Accidents','Audit control — evidence: Actual Sample','Safety & Health','RECORDS','Actual Sample','audit','annual','HR / Safety',false,true),
('rec-i-9-employment-eligibility-verification-procedure','I-9 / Employment Eligibility Verification Procedure','Written process for Form I-9 completion within 3 business days, retention, and reverification.','Compliance','POLICY','Latest File','recommended','annual','HR',true,true),
('rec-form-w-4-and-state-withholding-forms','Form W-4 and State Withholding Forms','Collect federal/state tax withholding on or before first payday.','Onboarding','RECORDS','3 Actual Samples','recommended','annual','HR / Finance',true,true),
('rec-state-new-hire-reporting-confirmation','State New-Hire Reporting Confirmation','Document timely new-hire reports to applicable state directories.','Onboarding','RECORDS','Actual Sample','recommended','annual','HR',true,true),
('rec-harassment-prevention-training-records','Harassment Prevention Training Records','State-required sexual harassment / respectful workplace training completion logs.','Compliance','RECORDS','Actual Sample','recommended','annual','HR',true,true),
('rec-ada-reasonable-accommodation-procedure','ADA Reasonable Accommodation Procedure','Interactive process for disability accommodations; separate from medical files.','Compliance','POLICY','Latest File','recommended','annual','HR / Legal',true,true),
('rec-workers-compensation-policy-and-claims-log','Workers Compensation Policy and Claims Log','Current WC certificate plus claim tracking where applicable.','Benefits','RECORDS','Latest File','recommended','annual','HR / Finance',true,true),
('rec-confidentiality-ip-assignment-acknowledgement','Confidentiality / IP Assignment Acknowledgement','Signed proprietary information and invention assignment (or equivalent).','Onboarding','RECORDS','Actual Sample','recommended','annual','HR / Legal',true,true),
('rec-background-check-authorization-where-used','Background Check Authorization (where used)','FCRA-compliant disclosure and authorization retained when screening is performed.','Onboarding','RECORDS','Actual Sample','recommended','annual','HR',true,true),
('rec-emergency-contact-and-beneficiary-designation','Emergency Contact and Beneficiary Designation','Collected during onboarding; refresh periodically.','Onboarding','RECORDS','Actual Sample','recommended','annual','HR',true,true),
('rec-paid-sick-leave-state-leave-notices','Paid Sick Leave / State Leave Notices','Jurisdiction-specific leave notices and acknowledgements.','Compliance','POLICY','Latest File','recommended','annual','HR',true,true),
('rec-compensation-equity-review-calendar','Compensation Equity Review Calendar','Periodic pay equity review cadence and documentation.','Administration','POLICY','Latest File','recommended','annual','HR / Finance',true,true),
('rec-direct-deposit-authorization','Direct Deposit Authorization','Banking authorization secured before first electronic pay.','Onboarding','RECORDS','Actual Sample','recommended','annual','HR / Finance',true,true),
('rec-lactation-accommodation-policy','Lactation Accommodation Policy','FLSA/state lactation break and space requirements.','Compliance','POLICY','Latest File','recommended','annual','HR',true,true),
('rec-performance-improvement-pip-procedure','Performance Improvement / PIP Procedure','Documented progressive discipline / PIP aligned with dismissal rules.','Employee Relations','POLICY','Latest File','recommended','annual','HR',true,true),
('rec-final-pay-timing-compliance-checklist','Final Pay Timing Compliance Checklist','State final-pay timing verification at termination.','Offboarding','RECORDS','Actual Sample','recommended','annual','HR / Finance',true,true);

-- Parent / shared-services rows (entity_id null)
insert into public.hr_compliance_controls (
  entity_id, control_key, title, description, area, document_kind,
  evidence_expectation, source, cadence, owner_role,
  applies_to_parent, applies_to_entities, status, notes
)
select
  null,
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
  case when s.source = 'recommended' then 'Recommended control (not in original audit PDF)' else 'Seeded from HR Compliance Audit PDF' end
from _hr_control_seed s
where s.applies_to_parent = true
  and not exists (
    select 1 from public.hr_compliance_controls c
    where c.control_key = s.control_key and c.entity_id is null and c.active = true
  );

-- Portfolio entity rows
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
  case when s.source = 'recommended' then 'Recommended control (not in original audit PDF)' else 'Seeded from HR Compliance Audit PDF' end
from _hr_control_seed s
cross join public.ops_entities e
where s.applies_to_entities = true
  and e.status in ('active', 'forming', 'acquired')
  and not exists (
    select 1 from public.hr_compliance_controls c
    where c.control_key = s.control_key and c.entity_id = e.id and c.active = true
  );
