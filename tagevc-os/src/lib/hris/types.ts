/** Phase 68 — HRIS types (employee system of record + process runs). */

export const HRIS_CONTRACT_VERSION = 'phase68-v1' as const;

export type HrisEmployeeStatus =
  | 'pre_start'
  | 'onboarding'
  | 'active'
  | 'leave'
  | 'offboarding'
  | 'terminated';

export type HrisProcessKind = 'onboarding' | 'offboarding';

export type HrisProcessStatus =
  | 'none'
  | 'not_started'
  | 'in_progress'
  | 'blocked'
  | 'complete'
  | 'cancelled';

export type HrisRunStatus =
  | 'open'
  | 'in_progress'
  | 'blocked'
  | 'complete'
  | 'cancelled';

export type HrisStepStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'waived'
  | 'blocked'
  | 'na';

export type HrisTimingAnchor = 'offer_accepted' | 'start_date' | 'end_date';

export type HrisAutomation = 'manual' | 'assist' | 'auto';

export type HrisAudience = 'all' | 'recruit619' | 'signent' | 'parent';

export type HrisEventKind =
  | 'created'
  | 'status_change'
  | 'step_done'
  | 'step_waived'
  | 'step_blocked'
  | 'escalated'
  | 'note'
  | 'run_started'
  | 'run_completed'
  | 'link_added';

export type HrisLinkKind =
  | 'document'
  | 'equipment'
  | 'access'
  | 'it_onboarding'
  | 'it_offboarding'
  | 'ticket'
  | 'checklist'
  | 'other';

export type RecruitAssignment = {
  portal_hint?: string;
  status?: 'pending_link' | 'linked' | 'skipped';
  linked_at?: string | null;
  entity_id?: string;
  note?: string;
  recruit_user_id?: string | null;
};

export type HrisCompBasis =
  | 'salary'
  | 'hourly'
  | 'commission'
  | 'draw'
  | 'other';

export type HrisPayFrequency =
  | 'annual'
  | 'monthly'
  | 'biweekly'
  | 'weekly'
  | 'hourly';

export type HrisBonusFrequency =
  | 'none'
  | 'monthly'
  | 'quarterly'
  | 'semiannual'
  | 'annual'
  | 'one_time';

/** `mbo` = tied to written MBOs, usually defined in the offer letter. */
export type HrisBonusType =
  | 'none'
  | 'mbo'
  | 'commission'
  | 'discretionary'
  | 'signing'
  | 'retention'
  | 'performance'
  | 'other';

export const HRIS_BONUS_FREQUENCY_LABELS: Record<HrisBonusFrequency, string> = {
  none: 'None',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Semi-annual',
  annual: 'Annual',
  one_time: 'One-time',
};

export const HRIS_BONUS_TYPE_LABELS: Record<HrisBonusType, string> = {
  none: 'None',
  mbo: 'MBO',
  commission: 'Commission',
  discretionary: 'Discretionary',
  signing: 'Signing',
  retention: 'Retention',
  performance: 'Performance',
  other: 'Other',
};

/** "$2,500 quarterly · MBO" — one-line summary for cards and tables. */
export function bonusSummary(
  emp: Pick<
    HrisEmployee,
    'bonus_amount' | 'bonus_currency' | 'bonus_frequency' | 'bonus_type'
  >,
): string | null {
  if (emp.bonus_amount === null || emp.bonus_amount === undefined) return null;
  const amount = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: emp.bonus_currency || 'USD',
    maximumFractionDigits: 0,
  }).format(emp.bonus_amount);
  const freq =
    emp.bonus_frequency && emp.bonus_frequency !== 'none'
      ? ` ${HRIS_BONUS_FREQUENCY_LABELS[emp.bonus_frequency].toLowerCase()}`
      : '';
  const type =
    emp.bonus_type && emp.bonus_type !== 'none'
      ? ` · ${HRIS_BONUS_TYPE_LABELS[emp.bonus_type]}`
      : '';
  return `${amount}${freq}${type}`;
}

export type HrisEmployee = {
  id: string;
  employee_key: string;
  full_name: string;
  work_email: string;
  personal_email: string;
  phone: string;
  entity_id: string;
  role_title: string;
  department: string;
  location: string;
  manager_employee_id: string | null;
  manager_name: string;
  manager_profile_id: string | null;
  status: HrisEmployeeStatus;
  start_date: string | null;
  end_date: string | null;
  offer_accepted_at: string | null;
  onboarding_status: HrisProcessStatus;
  offboarding_status: HrisProcessStatus;
  onboarding_pct: number;
  offboarding_pct: number;
  /** Protected — HR/Visionary only at app layer. */
  comp_amount: number | null;
  comp_currency: string;
  comp_basis: HrisCompBasis;
  pay_frequency: HrisPayFrequency;
  /** Variable comp — protected alongside base compensation. */
  bonus_amount: number | null;
  bonus_currency: string;
  bonus_frequency: HrisBonusFrequency;
  bonus_type: HrisBonusType;
  bonus_notes: string;
  profile_id: string | null;
  /** Entra/M365 identity, written by the joiner + identity lifecycle. */
  entra_object_id: string | null;
  upn: string | null;
  identity_status: string;
  recruit_assignment: RecruitAssignment;
  notes: string;
  created_at: string;
  updated_at: string;
};

export type HrisTemplateStepDef = {
  step_key: string;
  title: string;
  category: string;
  sort_order: number;
  owner_role: string;
  timing_anchor: HrisTimingAnchor;
  offset_days: number;
  evidence_required: boolean;
  automation: HrisAutomation;
  destructive: boolean;
  optional_for_audience: boolean;
  system_hook: string | null;
};

export type HrisProcessStep = {
  id: string;
  run_id: string;
  step_key: string;
  title: string;
  category: string;
  sort_order: number;
  owner_role: string;
  timing_anchor: HrisTimingAnchor;
  offset_days: number;
  due_at: string | null;
  status: HrisStepStatus;
  evidence_required: boolean;
  evidence_note: string;
  evidence_url: string | null;
  automation: HrisAutomation;
  destructive: boolean;
  optional_for_audience: boolean;
  system_hook: string | null;
  blocker: boolean;
  escalated_ticket_id: string | null;
  completed_at: string | null;
  notes: string;
};

export type HrisProcessRun = {
  id: string;
  run_key: string;
  employee_id: string;
  template_id: string;
  kind: HrisProcessKind;
  status: HrisRunStatus;
  completion_pct: number;
  escalated_ticket_id: string | null;
  offer_accepted_at: string | null;
  start_date: string | null;
  end_date: string | null;
  started_at: string;
  completed_at: string | null;
  notes: string;
  steps?: HrisProcessStep[];
};

export type HrisEmployeeEvent = {
  id: string;
  employee_id: string;
  event_kind: HrisEventKind;
  summary: string;
  detail: Record<string, unknown>;
  created_at: string;
};

export type HrisEmployeeLink = {
  id: string;
  employee_id: string;
  kind: HrisLinkKind;
  ref_id: string;
  label: string;
  href: string | null;
  created_at: string;
};

export function statusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function completionLabel(pct: number): string {
  return `${Math.round(pct)}%`;
}
