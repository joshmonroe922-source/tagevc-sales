export const MARKETING_COMPLIANCE_CADENCES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;
export type MarketingComplianceCadence = (typeof MARKETING_COMPLIANCE_CADENCES)[number];

export const MARKETING_COMPLIANCE_CADENCE_LABELS: Record<
  MarketingComplianceCadence,
  string
> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

export const MARKETING_CONTROL_STATUSES = [
  'open',
  'in_progress',
  'compliant',
  'gap',
  'na',
] as const;
export type MarketingControlStatus = (typeof MARKETING_CONTROL_STATUSES)[number];

export const MARKETING_CONTROL_STATUS_LABELS: Record<MarketingControlStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  compliant: 'Compliant',
  gap: 'Gap',
  na: 'N/A',
};

export const MARKETING_CONTROL_SOURCES = ['audit', 'recommended', 'manual'] as const;
export type MarketingControlSource = (typeof MARKETING_CONTROL_SOURCES)[number];

export const MARKETING_CONTROL_SOURCE_LABELS: Record<MarketingControlSource, string> = {
  audit: 'From audit',
  recommended: 'Recommended',
  manual: 'Manual',
};

export const MARKETING_DOCUMENT_KINDS = ['POLICY', 'RECORDS'] as const;
export type MarketingDocumentKind = (typeof MARKETING_DOCUMENT_KINDS)[number];

export const MARKETING_AREAS = [
  'Strategy & Objectives',
  'Branding & Positioning',
  'Channels & Campaigns',
  'Budgeting & ROI',
  'Analytics & Reporting',
  'MarTech Stack',
  'Team & Governance',
  'Compliance & Risk',
  'Review & Audit',
  'Platform Integration',
  'General',
] as const;
export type MarketingArea = (typeof MARKETING_AREAS)[number];

export const MARKETING_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type MarketingTaskStatus = (typeof MARKETING_TASK_STATUSES)[number];

export const MARKETING_TASK_STATUS_LABELS: Record<MarketingTaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
};

export type MarketingControl = {
  id: string;
  entity_id: string | null;
  control_key: string;
  title: string;
  description: string;
  area: string;
  document_kind: MarketingDocumentKind | string;
  evidence_expectation: string;
  source: MarketingControlSource | string;
  applies_to_parent: boolean;
  applies_to_entities: boolean;
  cadence: MarketingComplianceCadence;
  /** cadence is the review frequency (shared audit pattern). */
  owner_role: string;
  next_due_at: string | null;
  last_reviewed_at: string | null;
  status: MarketingControlStatus;
  evidence_url: string;
  evidence_notes: string;
  evidence_storage_path: string;
  evidence_file_name: string;
  evidence_mime_type?: string;
  notes: string;
  active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  ops_entities?: { id: string; name: string } | null;
};

export type MarketingTask = {
  id: string;
  control_id: string;
  sales_task_id: string | null;
  title: string;
  status: MarketingTaskStatus;
  assigned_to: string | null;
  due_at: string | null;
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  marketing_controls?: {
    id: string;
    title: string;
    area: string;
    status: MarketingControlStatus;
    control_key: string;
    entity_id: string | null;
    ops_entities?: { id: string; name: string } | null;
  } | null;
};
