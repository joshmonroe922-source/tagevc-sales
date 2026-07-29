/** Phase 66 — SSC checklist + audit types. */

export const SSC_PHASE66_CONTRACT = 'ssc-checklist-audit-phase66-v1' as const;

export const SSC_FUNCTIONS = [
  'finance',
  'hr',
  'it',
  'marketing',
  'legal',
] as const;
export type SscFunction = (typeof SSC_FUNCTIONS)[number];

export const SSC_PERIOD_TYPES = [
  'weekly',
  'as_needed',
  'monthly',
  'quarterly',
  'annual',
] as const;
export type SscPeriodType = (typeof SSC_PERIOD_TYPES)[number];

export const SSC_SCOPE_MODES = [
  'parent',
  'parent_subs',
  'subs',
  'single',
] as const;
export type SscScopeMode = (typeof SSC_SCOPE_MODES)[number];

export const SSC_TASK_STATUSES = [
  'not_started',
  'in_progress',
  'done',
  'blocked',
  'waived',
] as const;
export type SscTaskStatus = (typeof SSC_TASK_STATUSES)[number];

export const SSC_AUTOMATION_SOURCES = [
  'manual',
  'ai_assisted',
  'auto',
] as const;
export type SscAutomationSource = (typeof SSC_AUTOMATION_SOURCES)[number];

export type SscRiskLevel = 'low' | 'normal' | 'high' | 'critical';

export type SscTaskTemplate = {
  key: string;
  title: string;
  description: string;
  function: SscFunction;
  period_type: SscPeriodType;
  owner_role: string;
  risk_level: SscRiskLevel;
  /** Prefer generating one row per company in scope when true. */
  per_company: boolean;
};

export type SscChecklistTaskRow = {
  id: string;
  instance_id: string;
  template_key: string;
  title: string;
  description: string | null;
  function_key: SscFunction;
  period_type: SscPeriodType;
  owner_role: string;
  entity_id: string | null;
  company_name: string;
  status: SscTaskStatus;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  evidence_ticket_id: string | null;
  evidence_url: string | null;
  evidence_note: string | null;
  automation_source: SscAutomationSource;
  risk_level: SscRiskLevel;
  sort_order: number;
  ai_suggestion: string | null;
  is_overdue: boolean;
};

export type SscChecklistInstanceRow = {
  id: string;
  function_key: SscFunction;
  period_type: SscPeriodType;
  period_key: string;
  scope_mode: SscScopeMode;
  entity_id: string | null;
  company_name: string | null;
  period_start: string;
  period_end: string;
  due_at: string;
  status: string;
  completion_pct: number;
  overdue_count: number;
  blocked_count: number;
  generated_by: string;
};

export type SscAuditType = 'startup' | 'annual';

export type SscAuditItemTemplate = {
  key: string;
  title: string;
  description: string;
  function_key: SscFunction | 'cross';
  owner_role: string;
  risk_level: SscRiskLevel;
};

export type SscAuditItemRow = {
  id: string;
  audit_id: string;
  template_key: string;
  function_key: SscFunction | 'cross';
  title: string;
  description: string | null;
  status: SscTaskStatus;
  owner_role: string;
  risk_level: SscRiskLevel;
  evidence_ticket_id: string | null;
  evidence_url: string | null;
  evidence_note: string | null;
  ai_finding_draft: string | null;
  completed_at: string | null;
  completed_by: string | null;
  sort_order: number;
};

export type SscAuditRow = {
  id: string;
  audit_type: SscAuditType;
  entity_id: string;
  company_name: string;
  period_key: string;
  title: string;
  status: string;
  completion_pct: number;
  open_item_count: number;
  due_date: string | null;
  generated_by: string;
  items: SscAuditItemRow[];
};

export type SscMonitoringSummary = {
  function_key: SscFunction | 'all';
  completion_pct: number;
  total_tasks: number;
  done_tasks: number;
  overdue_tasks: number;
  blocked_tasks: number;
  waived_tasks: number;
  audit_open_items: number;
  risk_badge: 'green' | 'amber' | 'red';
  trend_label: string;
};

export type SscAiBriefing = {
  summary: string;
  recommended_order: string[];
  next_actions: string[];
  impact: string;
  guardrails: string[];
  /** rules = deterministic; openai = optional LLM polish */
  provider?: 'rules' | 'openai';
};

export type SscSyncSnapshot = {
  entity_id: string;
  company_name: string;
  source_key: string;
  status: 'ok' | 'partial' | 'missing' | 'error';
  captured_at: string;
  highlights: string[];
};

export function functionLabel(fn: SscFunction | 'all' | 'cross'): string {
  switch (fn) {
    case 'finance':
      return 'Accounting & Finance';
    case 'hr':
      return 'Human Resources';
    case 'it':
      return 'Technology';
    case 'marketing':
      return 'Marketing';
    case 'legal':
      return 'Legal / Counsel';
    case 'cross':
      return 'Cross-function';
    default:
      return 'All functions';
  }
}

export function periodLabel(p: SscPeriodType): string {
  switch (p) {
    case 'weekly':
      return 'Weekly';
    case 'as_needed':
      return 'As needed';
    case 'monthly':
      return 'Monthly';
    case 'quarterly':
      return 'Quarterly';
    case 'annual':
      return 'Annual';
  }
}

export function scopeLabel(s: SscScopeMode): string {
  switch (s) {
    case 'parent':
      return 'Parent only';
    case 'parent_subs':
      return 'Parent + subsidiaries';
    case 'subs':
      return 'Subsidiaries only';
    case 'single':
      return 'Single company';
  }
}

export function statusLabel(s: SscTaskStatus): string {
  switch (s) {
    case 'not_started':
      return 'Not started';
    case 'in_progress':
      return 'In progress';
    case 'done':
      return 'Done';
    case 'blocked':
      return 'Blocked';
    case 'waived':
      return 'Waived';
  }
}

export function functionHomeHref(fn: SscFunction): string {
  switch (fn) {
    case 'finance':
      return '/shared-services/af/finance';
    case 'hr':
      return '/shared-services/hr';
    case 'it':
      return '/shared-services/it/assets';
    case 'marketing':
      return '/shared-services/marketing';
    case 'legal':
      return '/shared-services/legal';
  }
}

/** Tiny sparkline for UI (client-safe). */
export function sparklineBars(values: number[], width = 6): string {
  if (!values.length) return '—';
  const slice = values.slice(-width);
  const blocks = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];
  return slice
    .map((v) => {
      const idx = Math.max(
        0,
        Math.min(blocks.length - 1, Math.round((v / 100) * (blocks.length - 1))),
      );
      return blocks[idx];
    })
    .join('');
}
