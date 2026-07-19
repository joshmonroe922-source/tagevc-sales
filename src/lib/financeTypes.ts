export const FINANCE_COMPLIANCE_CADENCES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;
export type FinanceComplianceCadence = (typeof FINANCE_COMPLIANCE_CADENCES)[number];

export const FINANCE_COMPLIANCE_CADENCE_LABELS: Record<FinanceComplianceCadence, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

export const FINANCE_CONTROL_STATUSES = [
  'open',
  'in_progress',
  'compliant',
  'gap',
  'na',
] as const;
export type FinanceControlStatus = (typeof FINANCE_CONTROL_STATUSES)[number];

export const FINANCE_CONTROL_STATUS_LABELS: Record<FinanceControlStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  compliant: 'Compliant',
  gap: 'Gap',
  na: 'N/A',
};

export const FINANCE_CONTROL_SOURCES = ['audit', 'recommended', 'manual'] as const;
export type FinanceControlSource = (typeof FINANCE_CONTROL_SOURCES)[number];

export const FINANCE_CONTROL_SOURCE_LABELS: Record<FinanceControlSource, string> = {
  audit: 'From audit',
  recommended: 'Recommended',
  manual: 'Manual',
};

export const FINANCE_DOCUMENT_KINDS = ['POLICY', 'RECORDS'] as const;
export type FinanceDocumentKind = (typeof FINANCE_DOCUMENT_KINDS)[number];

export const FINANCE_AREAS = [
  'Platform Setup',
  'Policies',
  'Accounts Receivable',
  'Accounts Payable',
  'Banking',
  'Payroll',
  'Inventory',
  'Fixed Assets',
  'General Ledger',
  'Bookkeeping',
  'Period Close',
  'Financial Reporting',
  'Intercompany',
  'Consolidation',
  'Budgeting & Forecasting',
  'KPIs & Dashboards',
  'Working Capital',
  'Treasury',
  'Risk Management',
  'Controls',
  'Audit Prep',
  'Tax Support',
  'Master Data',
  'General',
] as const;
export type FinanceArea = (typeof FINANCE_AREAS)[number];

export const FINANCE_TASK_STATUSES = ['open', 'done', 'cancelled'] as const;
export type FinanceTaskStatus = (typeof FINANCE_TASK_STATUSES)[number];

export const FINANCE_TASK_STATUS_LABELS: Record<FinanceTaskStatus, string> = {
  open: 'Open',
  done: 'Done',
  cancelled: 'Cancelled',
};

export type FinanceControl = {
  id: string;
  entity_id: string | null;
  control_key: string;
  title: string;
  description: string;
  area: string;
  document_kind: FinanceDocumentKind | string;
  evidence_expectation: string;
  source: FinanceControlSource | string;
  applies_to_parent: boolean;
  applies_to_entities: boolean;
  cadence: FinanceComplianceCadence;
  owner_role: string;
  next_due_at: string | null;
  last_reviewed_at: string | null;
  status: FinanceControlStatus;
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

export type FinanceTask = {
  id: string;
  control_id: string;
  sales_task_id: string | null;
  title: string;
  status: FinanceTaskStatus;
  assigned_to: string | null;
  due_at: string | null;
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  finance_controls?: {
    id: string;
    title: string;
    area: string;
    status: FinanceControlStatus;
    control_key: string;
    entity_id: string | null;
    ops_entities?: { id: string; name: string } | null;
  } | null;
};

/** Month-end (YYYY-MM) or year-end (YYYY) close workspace. */
export const FINANCE_CLOSE_PERIOD_TYPES = ['month', 'year'] as const;
export type FinanceClosePeriodType = (typeof FINANCE_CLOSE_PERIOD_TYPES)[number];

export const FINANCE_CLOSE_PERIOD_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type FinanceClosePeriodStatus = (typeof FINANCE_CLOSE_PERIOD_STATUSES)[number];

export const FINANCE_CLOSE_PERIOD_STATUS_LABELS: Record<FinanceClosePeriodStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  closed: 'Closed',
};

export const FINANCE_CLOSE_ITEM_STATUSES = [
  'open',
  'in_progress',
  'done',
  'na',
  'blocked',
] as const;
export type FinanceCloseItemStatus = (typeof FINANCE_CLOSE_ITEM_STATUSES)[number];

export const FINANCE_CLOSE_ITEM_STATUS_LABELS: Record<FinanceCloseItemStatus, string> = {
  open: 'Open',
  in_progress: 'In progress',
  done: 'Done',
  na: 'N/A',
  blocked: 'Blocked',
};

export type FinanceClosePeriod = {
  id: string;
  entity_id: string | null;
  period_type: FinanceClosePeriodType;
  period_key: string;
  status: FinanceClosePeriodStatus;
  due_at: string | null;
  opened_at: string;
  closed_at: string | null;
  closed_by: string | null;
  notes: string;
  created_at: string;
  updated_at: string;
  ops_entities?: { id: string; name: string } | null;
  /** Present when loaded with item counts (optional API enrich). */
  item_total?: number;
  item_done?: number;
  item_open?: number;
};

export type FinanceCloseItem = {
  id: string;
  period_id: string;
  item_key: string;
  title: string;
  description: string;
  area: string;
  sort_order: number;
  evidence_expectation: string;
  source_control_key: string;
  owner_role: string;
  status: FinanceCloseItemStatus;
  due_at: string | null;
  completed_at: string | null;
  evidence_url: string;
  evidence_notes: string;
  evidence_storage_path: string;
  evidence_file_name: string;
  evidence_mime_type: string;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type FinanceCloseTask = {
  id: string;
  item_id: string;
  sales_task_id: string | null;
  title: string;
  status: FinanceTaskStatus;
  assigned_to: string | null;
  due_at: string | null;
  notes: string;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
  finance_close_items?: {
    id: string;
    title: string;
    area: string;
    status: FinanceCloseItemStatus;
    item_key: string;
    period_id: string;
    finance_close_periods?: {
      id: string;
      period_type: FinanceClosePeriodType;
      period_key: string;
      entity_id: string | null;
      ops_entities?: { id: string; name: string } | null;
    } | null;
  } | null;
};
