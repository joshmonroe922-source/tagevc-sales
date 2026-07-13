import {
  DEAL_PATHS,
  type DealPath,
  dueAtFromDateInput,
  formatDate,
  formatDateTime,
} from './types';

export {
  DEAL_PATHS,
  type DealPath,
  dueAtFromDateInput,
  formatDate,
  formatDateTime,
};

export const OPS_ENTITY_TYPES = ['launch', 'acquire', 'operate', 'other'] as const;
export type OpsEntityType = (typeof OPS_ENTITY_TYPES)[number];

export const OPS_ENTITY_TYPE_LABELS: Record<OpsEntityType, string> = {
  launch: 'Launch',
  acquire: 'Acquire',
  operate: 'Operate',
  other: 'Other',
};

export const OPS_ENTITY_STATUSES = [
  'active',
  'forming',
  'acquired',
  'dormant',
  'closed',
] as const;
export type OpsEntityStatus = (typeof OPS_ENTITY_STATUSES)[number];

export const OPS_ENTITY_STATUS_LABELS: Record<OpsEntityStatus, string> = {
  active: 'Active',
  forming: 'Forming',
  acquired: 'Acquired',
  dormant: 'Dormant',
  closed: 'Closed',
};

export const CHECKLIST_STATUSES = ['todo', 'doing', 'done', 'na'] as const;
export type ChecklistStatus = (typeof CHECKLIST_STATUSES)[number];

export const CHECKLIST_STATUS_LABELS: Record<ChecklistStatus, string> = {
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  na: 'N/A',
};

export const COMPLIANCE_CADENCES = ['annual', 'monthly', 'one_time', 'custom'] as const;
export type ComplianceCadence = (typeof COMPLIANCE_CADENCES)[number];

export const COMPLIANCE_CADENCE_LABELS: Record<ComplianceCadence, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  one_time: 'One-time',
  custom: 'Custom',
};

export type OpsEntity = {
  id: string;
  name: string;
  /** Stable key for seeded portfolio companies; null for ad-hoc entities. */
  slug: string | null;
  entity_type: OpsEntityType;
  status: OpsEntityStatus;
  lead_id: string | null;
  jurisdiction: string;
  formed_at: string | null;
  website_url: string;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  sales_leads?: { id: string; name: string; company: string } | null;
};

export type OpsChecklistTemplate = {
  id: string;
  slug: string;
  name: string;
  description: string;
  entity_type: OpsEntityType;
  active: boolean;
};

export type OpsChecklistTemplateItem = {
  id: string;
  template_id: string;
  title: string;
  phase: string;
  sort_order: number;
};

export type OpsChecklistItem = {
  id: string;
  entity_id: string;
  title: string;
  phase: string;
  status: ChecklistStatus;
  due_at: string | null;
  completed_at: string | null;
  sort_order: number;
  created_at: string;
};

export type OpsFolder = {
  id: string;
  entity_id: string;
  name: string;
  sort_order: number;
  created_at: string;
};

export type OpsDocument = {
  id: string;
  entity_id: string;
  folder_id: string | null;
  title: string;
  file_name: string;
  mime_type: string;
  storage_path: string;
  external_url: string;
  notes: string;
  uploaded_by: string | null;
  created_at: string;
};

export type OpsComplianceItem = {
  id: string;
  entity_id: string;
  title: string;
  cadence: ComplianceCadence;
  next_due_at: string | null;
  last_completed_at: string | null;
  notes: string;
  active: boolean;
  created_at: string;
  updated_at: string;
  ops_entities?: { id: string; name: string } | null;
};

export type OpsDefaultFolder = {
  id: string;
  name: string;
  sort_order: number;
};

export function checklistProgress(items: OpsChecklistItem[]): {
  done: number;
  total: number;
  pct: number;
} {
  const actionable = items.filter((i) => i.status !== 'na');
  const done = actionable.filter((i) => i.status === 'done').length;
  const total = actionable.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, pct };
}

export function isComplianceOverdue(
  item: Pick<OpsComplianceItem, 'active' | 'next_due_at'>,
): boolean {
  if (!item.active || !item.next_due_at) return false;
  const due = new Date(`${item.next_due_at}T12:00:00`);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

export function isComplianceDueSoon(
  item: Pick<OpsComplianceItem, 'active' | 'next_due_at'>,
  withinDays = 30,
): boolean {
  if (!item.active || !item.next_due_at || isComplianceOverdue(item)) return false;
  const due = new Date(`${item.next_due_at}T12:00:00`);
  const limit = new Date();
  limit.setHours(0, 0, 0, 0);
  limit.setDate(limit.getDate() + withinDays);
  return due.getTime() <= limit.getTime();
}

/** Map template slug → default entity_type when creating. */
export function entityTypeForTemplateSlug(slug: string): OpsEntityType {
  if (slug === 'start-business') return 'launch';
  if (slug === 'acquire-business') return 'acquire';
  return 'other';
}
