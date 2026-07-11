export const STAGES = [
  'new',
  'qualified',
  'call_booked',
  'diligence',
  'term_sheet',
  'closed_won',
  'closed_lost',
  'passed',
] as const;

export type LeadStage = (typeof STAGES)[number];

export const PIPELINE_STAGES = [
  'new',
  'qualified',
  'call_booked',
  'diligence',
  'term_sheet',
  'closed_won',
] as const;

export const KANBAN_COLUMNS = [
  ...PIPELINE_STAGES,
  'closed_lost',
  'passed',
] as const;

export const STAGE_LABELS: Record<LeadStage, string> = {
  new: 'New',
  qualified: 'Qualified',
  call_booked: 'Call Booked',
  diligence: 'Diligence',
  term_sheet: 'Term Sheet',
  closed_won: 'Closed Won',
  closed_lost: 'Closed Lost',
  passed: 'Passed',
};

export const DEAL_PATHS = ['launch', 'partner', 'exit'] as const;
export type DealPath = (typeof DEAL_PATHS)[number];

export const DEAL_PATH_LABELS: Record<DealPath, string> = {
  launch: 'Launch',
  partner: 'Partner',
  exit: 'Exit',
};

/** Thesis / path framing for forms and empty states */
export const DEAL_PATH_THESES: Record<DealPath, string> = {
  launch: 'Build with us — early-stage founders & venture studio',
  partner: 'Grow with us — strategic distribution, tech & capital',
  exit: 'Transition with us — confidential exit & liquidity',
};

export const LEAD_SOURCES = ['website_form', 'manual', 'referral'] as const;
export type LeadSource = (typeof LEAD_SOURCES)[number];

export const SOURCE_LABELS: Record<LeadSource, string> = {
  website_form: 'Website form',
  manual: 'Manual',
  referral: 'Referral',
};

export const TERMINAL_STAGES = new Set<LeadStage>([
  'closed_won',
  'closed_lost',
  'passed',
]);

export type SalesRole = 'rep' | 'manager' | 'admin';

export type SalesUser = {
  id: string;
  email: string;
  full_name: string | null;
  role: SalesRole;
  active: boolean;
  manager_id: string | null;
  is_house_account: boolean;
};

export type SalesLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  deal_path: DealPath;
  source: LeadSource;
  stage: LeadStage;
  notes: string;
  assigned_rep_id: string | null;
  next_action_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskStatus = 'open' | 'done';

export type SalesTask = {
  id: string;
  sales_user_id: string;
  lead_id: string | null;
  title: string;
  notes: string;
  due_at: string | null;
  status: TaskStatus;
  created_at: string;
  completed_at: string | null;
  sales_leads?: Pick<SalesLead, 'id' | 'name' | 'company'> | null;
};

export type LeadActivity = {
  id: string;
  lead_id: string;
  activity_type: string;
  summary: string;
  metadata: Record<string, unknown>;
  created_by: string | null;
  created_at: string;
};

export type DripSequence = {
  id: string;
  slug: string;
  name: string;
  description: string;
  active: boolean;
};

export type DripStep = {
  id: string;
  sequence_id: string;
  step_order: number;
  delay_days: number;
  action_type: 'internal_reminder' | 'create_task' | 'email_lead';
  subject: string;
  body_html: string;
};

export type DripEnrollment = {
  id: string;
  sequence_id: string;
  lead_id: string;
  owner_id: string | null;
  status: 'active' | 'completed' | 'cancelled' | 'paused';
  current_step: number;
  enrolled_at: string;
  next_send_at: string | null;
  last_sent_at: string | null;
  completed_at: string | null;
};

export function dueAtFromDateInput(dateValue: string): string {
  return new Date(`${dateValue}T12:00:00`).toISOString();
}

export function isTaskOverdue(task: Pick<SalesTask, 'status' | 'due_at'>): boolean {
  if (task.status !== 'open' || !task.due_at) return false;
  const due = new Date(task.due_at);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  return due.getTime() < startOfToday.getTime();
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
