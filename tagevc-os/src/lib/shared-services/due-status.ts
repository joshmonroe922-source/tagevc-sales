/**
 * Plain-language ticket due status (replaces operator-facing "SLA").
 * Internal field names may still say sla_*; UI must use these labels.
 */

export type DueStatus = 'ok' | 'due_soon' | 'breached' | 'none' | 'escalated';

export const DUE_STATUS_LABELS: Record<DueStatus, string> = {
  ok: 'On time',
  due_soon: 'Due soon',
  breached: 'Overdue',
  none: 'No due date',
  escalated: 'Escalated',
};

export function dueStatusLabel(status: DueStatus | string): string {
  if (status in DUE_STATUS_LABELS) {
    return DUE_STATUS_LABELS[status as DueStatus];
  }
  return 'On time';
}

export const DUE_STATUS_FILTER_ALL = 'All due status';

/** Column / section header for ticket boards. */
export const DUE_STATUS_HEADER = 'Due status';

export const RESPOND_BY_LABEL = 'Respond by';
export const RESOLVE_BY_LABEL = 'Resolve by';
