export const LEGAL_COMPLIANCE_CADENCES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;
export type LegalComplianceCadence = (typeof LEGAL_COMPLIANCE_CADENCES)[number];

export const LEGAL_COMPLIANCE_CADENCE_LABELS: Record<LegalComplianceCadence, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

export const LEGAL_CONTROL_STATUSES = [
  'open',
  'in_progress',
  'compliant',
  'gap',
  'na',
] as const;
export type LegalControlStatus = (typeof LEGAL_CONTROL_STATUSES)[number];

export const LEGAL_CONTROL_STATUS_LABELS: Record<LegalControlStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  compliant: 'Compliant',
  gap: 'Gap',
  na: 'N/A',
};

export const LEGAL_CONTROL_SOURCES = ['audit', 'recommended', 'manual'] as const;
export type LegalControlSource = (typeof LEGAL_CONTROL_SOURCES)[number];

export const LEGAL_CONTROL_SOURCE_LABELS: Record<LegalControlSource, string> = {
  audit: 'From audit',
  recommended: 'Recommended',
  manual: 'Manual',
};

export const LEGAL_DOCUMENT_KINDS = ['POLICY', 'RECORDS'] as const;
export type LegalDocumentKind = (typeof LEGAL_DOCUMENT_KINDS)[number];

export const LEGAL_AREAS = [
  'Organizational',
  'Material Contracts',
  'Governmental & Regulatory',
  'Employee Matters',
  'Litigation',
  'Environmental',
  'Material Assets',
  'Insurance',
  'Intellectual Property',
  'Privacy',
  'Advertising & Promotional',
  'Geography',
  'Tax',
  'Business Succession',
  'General',
] as const;
export type LegalArea = (typeof LEGAL_AREAS)[number];

export const LEGAL_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type LegalTaskStatus = (typeof LEGAL_TASK_STATUSES)[number];

export const LEGAL_TASK_STATUS_LABELS: Record<LegalTaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
};

export type LegalControl = {
  id: string;
  entity_id: string | null;
  control_key: string;
  title: string;
  description: string;
  area: string;
  document_kind: LegalDocumentKind | string;
  evidence_expectation: string;
  source: LegalControlSource | string;
  applies_to_parent: boolean;
  applies_to_entities: boolean;
  cadence: LegalComplianceCadence;
  owner_role: string;
  next_due_at: string | null;
  last_reviewed_at: string | null;
  status: LegalControlStatus;
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

export type LegalTask = {
  id: string;
  control_id: string;
  sales_task_id: string | null;
  title: string;
  status: LegalTaskStatus;
  assigned_to: string | null;
  due_at: string | null;
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  legal_controls?: {
    id: string;
    title: string;
    area: string;
    status: LegalControlStatus;
    control_key: string;
    entity_id: string | null;
    ops_entities?: { id: string; name: string } | null;
  } | null;
};
