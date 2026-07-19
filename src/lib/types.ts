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

export const PORTAL_SLUGS = [
  'deal-sourcing',
  'due-diligence',
  'new-start-up',
  'new-acquisition',
  'manage-portfolio',
  'executive-leadership',
  'reporting',
  'accounting-finance',
  'legal',
  'marketing',
  'technology',
  'human-resources',
  'administrative',
] as const;

export type PortalSlug = (typeof PORTAL_SLUGS)[number];

export type SalesPortal = {
  id: string;
  slug: PortalSlug;
  name: string;
  description: string;
  icon: string;
  sort_order: number;
  active: boolean;
};

export type SalesUser = {
  id: string;
  email: string;
  /** Microsoft 365 mailbox for calendar OAuth (may differ from portal login). */
  work_email: string | null;
  /** Preferred calendar UI: month | week | agenda (default agenda). */
  calendar_default_view?: 'month' | 'week' | 'agenda' | null;
  /** Portal Mail signature (HTML or plain text); not synced to Outlook desktop. */
  mail_signature_html?: string | null;
  /** When true, portal Mail appends mail_signature_html on send. */
  mail_signature_enabled?: boolean | null;
  /**
   * IANA timezone for morning digest scheduling (and preferred display when set).
   * Null = derive from Outlook mailbox / browser.
   */
  timezone?: string | null;
  /** When true (default), 6:00 AM local Today digest email is sent. */
  morning_digest_enabled?: boolean | null;
  full_name: string | null;
  role: SalesRole;
  active: boolean;
  manager_id: string | null;
  is_house_account: boolean;
  /** Portals this user may open (from sales_user_portals). */
  portals: SalesPortal[];
};

export const ACCOUNT_TYPES = [
  'prospect',
  'partner',
  'portfolio',
  'acquisition',
  'other',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  prospect: 'Prospect',
  partner: 'Partner',
  portfolio: 'Portfolio',
  acquisition: 'Acquisition',
  other: 'Other',
};

export type SalesAccount = {
  id: string;
  name: string;
  website: string;
  account_type: AccountType | string;
  notes: string;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesContact = {
  id: string;
  account_id: string | null;
  full_name: string;
  title: string;
  company: string;
  primary_email: string;
  primary_phone: string;
  emails: string[];
  phones: string[];
  notes: string;
  created_by: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  sales_accounts?: Pick<SalesAccount, 'id' | 'name' | 'account_type' | 'website'> | null;
};

export type SalesLead = {
  id: string;
  name: string;
  email: string;
  phone: string;
  company: string;
  account_id: string | null;
  contact_id: string | null;
  deal_path: DealPath;
  source: LeadSource;
  stage: LeadStage;
  notes: string;
  assigned_rep_id: string | null;
  next_action_at: string | null;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
  sales_contacts?: Pick<
    SalesContact,
    'id' | 'full_name' | 'primary_email' | 'primary_phone' | 'company' | 'title' | 'account_id'
  > | null;
  sales_accounts?: Pick<SalesAccount, 'id' | 'name' | 'account_type' | 'website'> | null;
};

/** Activity types including Phase 2 SMS/call logging hooks. */
export const ACTIVITY_TYPES = [
  'email_sent',
  'email_queued',
  'email_received',
  'task_created',
  'task_cleared',
  'drip_enrolled',
  'drip_step_sent',
  'drip_completed',
  'drip_cancelled',
  'note',
  'stage_change',
  'system',
  'intake',
  'sms_sent',
  'sms_received',
  'call_logged',
  'call_missed',
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** Phase 2 stub — call list to dial/SMS down. */
export type SalesCallList = {
  id: string;
  name: string;
  description: string;
  status: 'draft' | 'active' | 'archived';
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type SalesCallListMember = {
  id: string;
  list_id: string;
  contact_id: string;
  sort_order: number;
  status: 'pending' | 'called' | 'skipped' | 'sms_sent' | 'no_answer';
  notes: string;
  last_attempt_at: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type TaskStatus = 'open' | 'done';

export type TaskImportance = 'low' | 'normal' | 'high';

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
  importance?: TaskImportance | string | null;
  portal_slug?: PortalSlug | string | null;
  ms_todo_list_id?: string | null;
  ms_todo_task_id?: string | null;
  sales_leads?: Pick<SalesLead, 'id' | 'name' | 'company'> | null;
};

export type CreateTaskResult = {
  task: SalesTask;
  synced: boolean;
  syncError?: string;
};

export type LeadActivity = {
  id: string;
  lead_id: string | null;
  contact_id: string | null;
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
