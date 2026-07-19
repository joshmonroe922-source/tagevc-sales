import type { AllowAction } from '@/lib/types';

/**
 * COO-signed AUTO allow-list (§7C / §7E v1 Assist).
 * Only these may execute without human approval when confidence ≥90%
 * and forbid-list is empty.
 */
export type AllowRule = {
  code: AllowAction;
  label: string;
  service_hint: string[];
  signals: string[];
};

export const ALLOW_LIST: AllowRule[] = [
  {
    code: 'spawn_missing_stage_tasks',
    label: 'Spawn missing stage tasks from process library',
    service_hint: ['Legal', 'IT', 'Marketing'],
    signals: ['spawn tasks', 'missing tasks', 'process library', 'stage tasks'],
  },
  {
    code: 'tag_ticket_service',
    label: 'Tag / reclassify ticket service',
    service_hint: ['IT', 'HR', 'Finance', 'Legal', 'Marketing'],
    signals: ['retag', 'wrong service', 'reclassify', 'tag service'],
  },
  {
    code: 'sla_nudge',
    label: 'SLA nudge / reminder to assignee',
    service_hint: ['IT', 'HR', 'Finance', 'Legal', 'Marketing'],
    signals: ['sla nudge', 'reminder', 'follow up sla', 'overdue nudge'],
  },
  {
    code: 'route_inbound_form',
    label: 'Route inbound form to correct pipeline track',
    service_hint: ['Marketing'],
    signals: ['route inbound', 'form routing', 'wrong pipeline', 'route to vc'],
  },
  {
    code: 'draft_status_summary',
    label: 'Draft internal status summary (no send)',
    service_hint: ['Finance', 'Legal', 'HR', 'IT', 'Marketing'],
    signals: ['status summary', 'draft summary', 'weekly digest draft'],
  },
];

export function matchAllowAction(text: string): AllowAction | null {
  const hay = text.toLowerCase();
  for (const rule of ALLOW_LIST) {
    if (rule.signals.some((s) => hay.includes(s.toLowerCase()))) {
      return rule.code;
    }
  }
  return null;
}

export function isAllowListed(action: string | null): boolean {
  if (!action) return false;
  return ALLOW_LIST.some((r) => r.code === action);
}
