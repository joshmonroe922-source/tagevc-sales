export const HR_EMPLOYMENT_STATUSES = [
  'prospect',
  'onboarding',
  'active',
  'offboarding',
  'terminated',
  'alumni',
] as const;
export type HrEmploymentStatus = (typeof HR_EMPLOYMENT_STATUSES)[number];

export const HR_EMPLOYMENT_STATUS_LABELS: Record<HrEmploymentStatus, string> = {
  prospect: 'Prospect',
  onboarding: 'Onboarding',
  active: 'Active',
  offboarding: 'Offboarding',
  terminated: 'Terminated',
  alumni: 'Alumni',
};

export const HR_CHECKLIST_KINDS = [
  'talent_acquisition',
  'onboarding',
  'offboarding',
] as const;
export type HrChecklistKind = (typeof HR_CHECKLIST_KINDS)[number];

export const HR_CHECKLIST_KIND_LABELS: Record<HrChecklistKind, string> = {
  talent_acquisition: 'Talent acquisition',
  onboarding: 'Onboarding',
  offboarding: 'Offboarding',
};

export const HR_ITEM_SCOPES = ['parent', 'signent', 'both'] as const;
export type HrItemScope = (typeof HR_ITEM_SCOPES)[number];

export const HR_ITEM_SCOPE_LABELS: Record<HrItemScope, string> = {
  parent: 'Parent / shared',
  signent: 'Signent-specific',
  both: 'Parent + Signent',
};

/** Canonical template slugs seeded in migration 0035. */
export const HR_TEMPLATE_SLUGS: Record<HrChecklistKind, string> = {
  talent_acquisition: 'talent-acquisition-v1',
  onboarding: 'signent-onboarding-v1',
  offboarding: 'audit-offboarding-v2',
};

export const HR_CHECKLIST_STATUSES = ['open', 'in_progress', 'complete', 'cancelled'] as const;
export type HrChecklistStatus = (typeof HR_CHECKLIST_STATUSES)[number];

export const HR_ITEM_STATUSES = ['todo', 'doing', 'done', 'na'] as const;
export type HrItemStatus = (typeof HR_ITEM_STATUSES)[number];

export const HR_ITEM_STATUS_LABELS: Record<HrItemStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  na: 'N/A',
};

export const HR_SYSTEM_HOOKS = [
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
  'compliance_ack',
] as const;
export type HrSystemHook = (typeof HR_SYSTEM_HOOKS)[number];

export const HR_SYSTEM_HOOK_LABELS: Record<HrSystemHook, string> = {
  payroll: 'Payroll',
  it_provision: 'IT provision',
  asset_audit: 'Asset audit',
  benefits: 'Benefits',
  swag: 'Swag / marketing',
  access_revoke: 'Access revoke',
  manual: 'Manual',
  i9: 'I-9 verification',
  handbook_ack: 'Handbook acknowledgment',
  employment_contract: 'Employment contract',
  privacy_consent: 'Privacy consent',
  job_description: 'Job description',
  compliance_ack: 'Compliance acknowledgment',
};

export const HR_COMPLIANCE_CADENCES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;
export type HrComplianceCadence = (typeof HR_COMPLIANCE_CADENCES)[number];

export const HR_COMPLIANCE_CADENCE_LABELS: Record<HrComplianceCadence, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

export const HR_CONTROL_STATUSES = [
  'open',
  'in_progress',
  'compliant',
  'gap',
  'na',
] as const;
export type HrControlStatus = (typeof HR_CONTROL_STATUSES)[number];

export const HR_CONTROL_STATUS_LABELS: Record<HrControlStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  compliant: 'Compliant',
  gap: 'Gap',
  na: 'N/A',
};

export const HR_CONTROL_SOURCES = ['audit', 'recommended', 'manual'] as const;
export type HrControlSource = (typeof HR_CONTROL_SOURCES)[number];

export const HR_CONTROL_SOURCE_LABELS: Record<HrControlSource, string> = {
  audit: 'From audit',
  recommended: 'Recommended',
  manual: 'Manual',
};

export const HR_DOCUMENT_KINDS_CONTROL = ['POLICY', 'RECORDS'] as const;
export type HrControlDocumentKind = (typeof HR_DOCUMENT_KINDS_CONTROL)[number];

export const HR_COMPLIANCE_AREAS = [
  'Administration',
  'Benefits',
  'Compliance',
  'Employee Engagement',
  'Employee Relations',
  'Offboarding',
  'Onboarding',
  'Recordkeeping',
  'Safety & Health',
  'General',
] as const;
export type HrComplianceArea = (typeof HR_COMPLIANCE_AREAS)[number];

export const HR_DOC_CATEGORIES = [
  'onboarding',
  'tenure',
  'offboarding',
  'compliance',
  'other',
] as const;
export type HrDocCategory = (typeof HR_DOC_CATEGORIES)[number];

export const HR_DOC_CATEGORY_LABELS: Record<HrDocCategory, string> = {
  onboarding: 'Onboarding',
  tenure: 'Tenure',
  offboarding: 'Offboarding',
  compliance: 'Compliance',
  other: 'Other',
};

export const HR_DOC_KINDS = ['file', 'link', 'note', 'ack'] as const;
export type HrDocKind = (typeof HR_DOC_KINDS)[number];

export const HR_DOC_KIND_LABELS: Record<HrDocKind, string> = {
  file: 'File',
  link: 'Link',
  note: 'Note',
  ack: 'Acknowledgment',
};

export const HR_ACTIVITY_TYPES = [
  'note',
  'status_change',
  'checklist',
  'document',
  'compliance_ack',
  'system_hook',
  'review',
  'other',
] as const;
export type HrActivityType = (typeof HR_ACTIVITY_TYPES)[number];

export const HR_ACTIVITY_TYPE_LABELS: Record<HrActivityType, string> = {
  note: 'Note',
  status_change: 'Status change',
  checklist: 'Checklist',
  document: 'Document',
  compliance_ack: 'Compliance ack',
  system_hook: 'System hook',
  review: 'Review',
  other: 'Other',
};

export type HrEmployee = {
  id: string;
  entity_id: string | null;
  full_name: string;
  work_email: string;
  personal_email: string;
  role_title: string;
  department: string;
  employment_status: HrEmploymentStatus;
  start_date: string | null;
  end_date: string | null;
  manager_name: string;
  location: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ops_entities?: { id: string; name: string } | null;
};

export type HrOnboardingChecklist = {
  id: string;
  employee_id: string;
  kind: HrChecklistKind;
  status: HrChecklistStatus;
  template_slug: string;
  started_at: string | null;
  completed_at: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  hr_employees?: {
    id: string;
    full_name: string;
    role_title: string;
    employment_status: HrEmploymentStatus;
  } | null;
};

export type HrChecklistItem = {
  id: string;
  checklist_id: string;
  title: string;
  category: string;
  sort_order: number;
  status: HrItemStatus;
  system_hook: HrSystemHook | null;
  assignee_hint: string;
  scope: HrItemScope | string;
  due_at: string | null;
  completed_at: string | null;
  notes: string;
  created_at: string;
};

export type HrChecklistTemplate = {
  id: string;
  slug: string;
  kind: HrChecklistKind;
  title: string;
  description: string;
  source_doc: string;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type HrChecklistTemplateItem = {
  id: string;
  template_id: string;
  title: string;
  category: string;
  sort_order: number;
  system_hook: HrSystemHook | null;
  assignee_hint: string;
  scope: HrItemScope | string;
  notes: string;
  created_at: string;
};

export type HrComplianceControl = {
  id: string;
  entity_id: string | null;
  control_key: string;
  title: string;
  description: string;
  area: string;
  document_kind: HrControlDocumentKind | string;
  evidence_expectation: string;
  source: HrControlSource | string;
  applies_to_parent: boolean;
  applies_to_entities: boolean;
  cadence: HrComplianceCadence;
  owner_role: string;
  next_due_at: string | null;
  last_reviewed_at: string | null;
  status: HrControlStatus;
  evidence_url: string;
  evidence_notes: string;
  evidence_storage_path: string;
  evidence_file_name: string;
  evidence_mime_type: string;
  notes: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ops_entities?: { id: string; name: string } | null;
};

export type HrEmployeeDocument = {
  id: string;
  employee_id: string;
  title: string;
  category: HrDocCategory;
  doc_kind: HrDocKind;
  file_url: string;
  related_control_key: string;
  related_checklist_id: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type HrEmployeeActivity = {
  id: string;
  employee_id: string;
  activity_type: HrActivityType;
  title: string;
  body: string;
  related_checklist_id: string | null;
  related_document_id: string | null;
  system_hook: string | null;
  status: string;
  occurred_at: string;
  created_by: string | null;
  created_at: string;
};

/** Client fallback seeds when DB templates are unavailable. Prefer DB via startChecklist. */
export type HrTemplateItemSeed = {
  title: string;
  category: string;
  sort_order: number;
  system_hook: HrSystemHook | null;
  assignee_hint: string;
  scope?: HrItemScope;
};

export const DEFAULT_TALENT_ACQUISITION_ITEMS: HrTemplateItemSeed[] = [
  {
    title: 'Screen resume / application',
    category: 'Sourcing',
    sort_order: 10,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager / Recruiter',
    scope: 'parent',
  },
  {
    title: 'Complete phone screen',
    category: 'Interview',
    sort_order: 20,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager / Recruiter',
    scope: 'parent',
  },
  {
    title: 'Hiring manager interview(s)',
    category: 'Interview',
    sort_order: 30,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Additional / panel interviews',
    category: 'Interview',
    sort_order: 40,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Complete reference checks',
    category: 'Diligence',
    sort_order: 50,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager / HR',
    scope: 'parent',
  },
  {
    title: 'Background check authorization & run',
    category: 'Diligence',
    sort_order: 60,
    system_hook: 'compliance_ack',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Prepare and send offer letter (and NDA if needed)',
    category: 'Offer',
    sort_order: 70,
    system_hook: 'employment_contract',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Offer accepted — ready to advance to onboarding',
    category: 'Offer',
    sort_order: 80,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
];

/** Signent/TAGE onboarding — mirror of migration 0035 (docs/hr Signent checklist). */
export const DEFAULT_ONBOARDING_ITEMS: HrTemplateItemSeed[] = [
  {
    title: 'Verify application or resume',
    category: 'Pre-Employment',
    sort_order: 10,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title:
      'Provide HR offer details upon selection (name, personal email, phone, resume, position, start date, salary, comp plan)',
    category: 'Pre-Employment',
    sort_order: 20,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Create and send offer letter & NDA if needed (copy manager)',
    category: 'Pre-Employment',
    sort_order: 30,
    system_hook: 'employment_contract',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Confirm documents & create personnel file',
    category: 'Pre-Employment',
    sort_order: 40,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'File resume in personnel file',
    category: 'Pre-Employment',
    sort_order: 50,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'File signed offer letter / NDA',
    category: 'Pre-Employment',
    sort_order: 60,
    system_hook: 'employment_contract',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Begin employment verification with authorization',
    category: 'Pre-Employment',
    sort_order: 70,
    system_hook: 'compliance_ack',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Begin background check with authorization',
    category: 'Pre-Employment',
    sort_order: 80,
    system_hook: 'compliance_ack',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Add start date to calendar (copy manager & CEO)',
    category: 'Pre-Employment',
    sort_order: 90,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'both',
  },
  {
    title: 'Send internal team announcement',
    category: 'Before Start Date',
    sort_order: 100,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Confirm computer availability',
    category: 'Before Start Date',
    sort_order: 110,
    system_hook: 'asset_audit',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Order computer if necessary',
    category: 'Before Start Date',
    sort_order: 120,
    system_hook: 'asset_audit',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Assign and tag equipment',
    category: 'Before Start Date',
    sort_order: 130,
    system_hook: 'asset_audit',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Computer cleaned / set up / updated',
    category: 'Before Start Date',
    sort_order: 140,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Notify IT for laptop provisioning & user setup',
    category: 'Before Start Date',
    sort_order: 150,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'both',
  },
  {
    title: 'Create Microsoft email',
    category: 'Before Start Date',
    sort_order: 160,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'both',
  },
  {
    title: 'Download Chrome, RingCentral, Teams, Outlook, Word',
    category: 'Before Start Date',
    sort_order: 170,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Create RingCentral account and add extension (Chrome)',
    category: 'Before Start Date',
    sort_order: 180,
    system_hook: 'it_provision',
    assignee_hint: 'Director of Operations Support',
    scope: 'signent',
  },
  {
    title: 'Create Salesforce account and connect to RingCentral',
    category: 'Before Start Date',
    sort_order: 190,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Create training schedule',
    category: 'Before Start Date',
    sort_order: 200,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Schedule all live training sessions',
    category: 'Before Start Date',
    sort_order: 210,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Schedule welcome lunch (start date or after)',
    category: 'Before Start Date',
    sort_order: 220,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Send welcome email with first day/week details (copy CEO & HR)',
    category: 'Before Start Date',
    sort_order: 230,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'both',
  },
  {
    title: 'Enter employee into HRIS',
    category: 'Before Start Date',
    sort_order: 240,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Email HRIS invite to new hire',
    category: 'Before Start Date',
    sort_order: 250,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Assign HRIS training',
    category: 'Before Start Date',
    sort_order: 260,
    system_hook: 'manual',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Complete Form I-9 via HRIS',
    category: 'Start Date',
    sort_order: 270,
    system_hook: 'i9',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Collect copy of ID documents for I-9',
    category: 'Start Date',
    sort_order: 280,
    system_hook: 'i9',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Ensure employee completed direct deposit & tax setup',
    category: 'Start Date',
    sort_order: 290,
    system_hook: 'payroll',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Send benefit guide & enrollment application',
    category: 'Start Date',
    sort_order: 300,
    system_hook: 'benefits',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Send employee handbook',
    category: 'Start Date',
    sort_order: 310,
    system_hook: 'handbook_ack',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
  {
    title: 'Review computer setup',
    category: 'Start Date',
    sort_order: 320,
    system_hook: 'it_provision',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Review Zoom',
    category: 'Start Date',
    sort_order: 330,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Company overview briefing',
    category: 'Start Date',
    sort_order: 340,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'both',
  },
  {
    title: 'Review org chart',
    category: 'Start Date',
    sort_order: 350,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'parent',
  },
  {
    title: 'Walk through new hire training schedule',
    category: 'Start Date',
    sort_order: 360,
    system_hook: 'manual',
    assignee_hint: 'CEO / Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Set up calendars',
    category: 'Start Date',
    sort_order: 370,
    system_hook: 'manual',
    assignee_hint: 'CEO / Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Configure email signature & Teams background',
    category: 'Start Date',
    sort_order: 380,
    system_hook: 'manual',
    assignee_hint: 'CEO / Hiring Manager',
    scope: 'both',
  },
  {
    title: 'Add to location calendar / distribution email',
    category: 'Start Date',
    sort_order: 390,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'both',
  },
  {
    title: 'Send all company meeting invites',
    category: 'Start Date',
    sort_order: 400,
    system_hook: 'manual',
    assignee_hint: 'CEO',
    scope: 'both',
  },
  {
    title: 'Add to quarterly bonus calc spreadsheet',
    category: 'Start Date',
    sort_order: 410,
    system_hook: 'payroll',
    assignee_hint: 'CEO',
    scope: 'signent',
  },
  {
    title: 'Schedule 30 / 60 / 90-day check-ins',
    category: 'Start Date',
    sort_order: 420,
    system_hook: 'manual',
    assignee_hint: 'Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Notify HR of any monthly payroll reimbursements',
    category: 'Start Date',
    sort_order: 430,
    system_hook: 'payroll',
    assignee_hint: 'CEO / Hiring Manager',
    scope: 'parent',
  },
  {
    title: 'Confirm all benefit / 401k deductions & earnings',
    category: 'Before First Payroll',
    sort_order: 440,
    system_hook: 'benefits',
    assignee_hint: 'Human Resources',
    scope: 'parent',
  },
];

export const DEFAULT_OFFBOARDING_ITEMS: HrTemplateItemSeed[] = [
  {
    title: 'Confirm last day and transition owner',
    category: 'Exit',
    sort_order: 10,
    system_hook: 'manual',
    assignee_hint: 'HR / Manager',
    scope: 'parent',
  },
  {
    title: 'Apply rules for dismissal / exit documentation',
    category: 'Compliance',
    sort_order: 15,
    system_hook: 'compliance_ack',
    assignee_hint: 'HR / Legal',
    scope: 'parent',
  },
  {
    title: 'Prepare separation / termination agreement (when used)',
    category: 'Compliance',
    sort_order: 16,
    system_hook: 'compliance_ack',
    assignee_hint: 'HR / Legal',
    scope: 'parent',
  },
  {
    title: 'Disable payroll / final pay (timing checklist)',
    category: 'Payroll',
    sort_order: 20,
    system_hook: 'payroll',
    assignee_hint: 'HR / Finance',
    scope: 'parent',
  },
  {
    title: 'End benefits COBRA / portability notice',
    category: 'Benefits',
    sort_order: 30,
    system_hook: 'benefits',
    assignee_hint: 'HR',
    scope: 'parent',
  },
  {
    title: 'Revoke SSO, email, and app access',
    category: 'Technology',
    sort_order: 40,
    system_hook: 'access_revoke',
    assignee_hint: 'IT',
    scope: 'parent',
  },
  {
    title: 'Recover and audit technology assets',
    category: 'Technology',
    sort_order: 50,
    system_hook: 'asset_audit',
    assignee_hint: 'IT',
    scope: 'parent',
  },
  {
    title: 'Collect badges / keys / facilities access',
    category: 'Facilities',
    sort_order: 60,
    system_hook: 'manual',
    assignee_hint: 'Ops',
    scope: 'parent',
  },
  {
    title: 'File offboarding process record + exit interview',
    category: 'Exit',
    sort_order: 70,
    system_hook: 'manual',
    assignee_hint: 'HR / Manager',
    scope: 'parent',
  },
];
