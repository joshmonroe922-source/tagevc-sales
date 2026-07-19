export const TECHNOLOGY_COMPLIANCE_CADENCES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;
export type TechnologyComplianceCadence = (typeof TECHNOLOGY_COMPLIANCE_CADENCES)[number];

export const TECHNOLOGY_COMPLIANCE_CADENCE_LABELS: Record<TechnologyComplianceCadence, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

export const TECHNOLOGY_CONTROL_STATUSES = [
  'open',
  'in_progress',
  'compliant',
  'gap',
  'na',
] as const;
export type TechnologyControlStatus = (typeof TECHNOLOGY_CONTROL_STATUSES)[number];

export const TECHNOLOGY_CONTROL_STATUS_LABELS: Record<TechnologyControlStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  compliant: 'Compliant',
  gap: 'Gap',
  na: 'N/A',
};

export const TECHNOLOGY_CONTROL_SOURCES = ['audit', 'recommended', 'manual'] as const;
export type TechnologyControlSource = (typeof TECHNOLOGY_CONTROL_SOURCES)[number];

export const TECHNOLOGY_CONTROL_SOURCE_LABELS: Record<TechnologyControlSource, string> = {
  audit: 'From audit',
  recommended: 'Recommended',
  manual: 'Manual',
};

export const TECHNOLOGY_DOCUMENT_KINDS = ['POLICY', 'RECORDS'] as const;
export type TechnologyDocumentKind = (typeof TECHNOLOGY_DOCUMENT_KINDS)[number];

export const TECHNOLOGY_AREAS = [
  'Strategy & Governance',
  'Infrastructure & Cloud',
  'Applications & Systems',
  'Data & Analytics',
  'Cybersecurity',
  'Network & End-User Computing',
  'Support & Operations',
  'Software Development & Innovation',
  'Integrations & APIs',
  'Budgeting & ROI',
  'Team & Resources',
  'Disaster Recovery & BCDR',
  'Review & Audit',
  'Platform Integration',
  'General',
] as const;
export type TechnologyArea = (typeof TECHNOLOGY_AREAS)[number];

export const TECHNOLOGY_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type TechnologyTaskStatus = (typeof TECHNOLOGY_TASK_STATUSES)[number];

export const TECHNOLOGY_TASK_STATUS_LABELS: Record<TechnologyTaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
};

export type TechnologyControl = {
  id: string;
  entity_id: string | null;
  control_key: string;
  title: string;
  description: string;
  area: string;
  document_kind: TechnologyDocumentKind | string;
  evidence_expectation: string;
  source: TechnologyControlSource | string;
  applies_to_parent: boolean;
  applies_to_entities: boolean;
  cadence: TechnologyComplianceCadence;
  owner_role: string;
  next_due_at: string | null;
  last_reviewed_at: string | null;
  status: TechnologyControlStatus;
  evidence_url: string;
  evidence_notes: string;
  /** Storage path in bucket audit-evidence (shared column across audit portals). */
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

export type TechnologyTask = {
  id: string;
  control_id: string;
  sales_task_id: string | null;
  title: string;
  status: TechnologyTaskStatus;
  assigned_to: string | null;
  due_at: string | null;
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  technology_controls?: {
    id: string;
    title: string;
    area: string;
    status: TechnologyControlStatus;
    control_key: string;
    entity_id: string | null;
    ops_entities?: { id: string; name: string } | null;
  } | null;
};
