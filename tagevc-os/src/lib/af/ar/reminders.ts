/**
 * AR reminders + collections queue (Spec - AR & Invoicing §4).
 */

import type { AfInvoice, EntityCode, HealthStatus } from '@/lib/af/types';

/** Cadence offsets relative to due date (days). */
export const REMINDER_CADENCE_DAYS = [-3, 0, 7, 14, 30] as const;

export type ReminderStage =
  | 'pre_due'
  | 'due'
  | 'plus_7'
  | 'plus_14'
  | 'plus_30'
  | 'escalated';

export type ReminderPlanItem = {
  invoiceId: string;
  entityCode: EntityCode;
  customerName: string;
  number: string;
  dueDate: string;
  balance: number;
  daysPastDue: number;
  stage: ReminderStage;
  nextAction: string;
  channel: 'email' | 'sms' | 'both';
  health: HealthStatus;
};

function stageForDaysPastDue(days: number): ReminderStage {
  if (days < 0) return 'pre_due';
  if (days === 0) return 'due';
  if (days <= 7) return 'plus_7';
  if (days <= 14) return 'plus_14';
  if (days <= 30) return 'plus_30';
  return 'escalated';
}

function nextAction(stage: ReminderStage): string {
  switch (stage) {
    case 'pre_due':
      return 'Send friendly reminder (−3 days)';
    case 'due':
      return 'Send due-date notice';
    case 'plus_7':
      return 'Send +7 follow-up';
    case 'plus_14':
      return 'Escalate to collections email';
    case 'plus_30':
      return 'Collections call + SMS';
    case 'escalated':
      return 'Escalate to Controller · hold new work';
  }
}

function healthFor(days: number, balance: number): HealthStatus {
  if (days > 60 || balance > 50000) return 'Critical';
  if (days > 30) return 'At Risk';
  if (days > 7) return 'Watch';
  return 'On Track';
}

export function buildCollectionsQueue(input: {
  invoices: AfInvoice[];
  entityCode?: EntityCode | null;
  asOf?: string;
}): ReminderPlanItem[] {
  const asOf = input.asOf ?? new Date().toISOString().slice(0, 10);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const items: ReminderPlanItem[] = [];

  for (const inv of input.invoices) {
    if (input.entityCode && inv.entityCode !== input.entityCode) continue;
    if (inv.status === 'Paid' || inv.status === 'Void' || inv.status === 'Draft') {
      continue;
    }
    const balance = inv.amount - inv.amountPaid;
    if (balance <= 0) continue;
    const dueMs = Date.parse(`${inv.dueDate}T00:00:00Z`);
    const daysPastDue = Math.floor((asOfMs - dueMs) / 86400000);
    const stage = stageForDaysPastDue(daysPastDue);
    items.push({
      invoiceId: inv.id,
      entityCode: inv.entityCode,
      customerName: inv.customerName,
      number: inv.number,
      dueDate: inv.dueDate,
      balance,
      daysPastDue,
      stage,
      nextAction: nextAction(stage),
      channel: daysPastDue >= 14 ? 'both' : 'email',
      health: healthFor(daysPastDue, balance),
    });
  }

  return items.sort((a, b) => b.daysPastDue - a.daysPastDue);
}

export function reminderScheduleForInvoice(
  inv: AfInvoice,
): { offsetDays: number; label: string; sendOn: string }[] {
  const due = Date.parse(`${inv.dueDate}T00:00:00Z`);
  return REMINDER_CADENCE_DAYS.map((offset) => {
    const d = new Date(due);
    d.setUTCDate(d.getUTCDate() + offset);
    const label =
      offset < 0
        ? `${Math.abs(offset)} days before due`
        : offset === 0
          ? 'Due date'
          : `+${offset} days`;
    return {
      offsetDays: offset,
      label,
      sendOn: d.toISOString().slice(0, 10),
    };
  });
}

export type CollectionsSummary = {
  queueCount: number;
  overdueCount: number;
  overdueAmount: number;
  escalatedCount: number;
  health: HealthStatus;
};

export function summarizeCollections(
  queue: ReminderPlanItem[],
): CollectionsSummary {
  const overdue = queue.filter((q) => q.daysPastDue > 0);
  const escalated = queue.filter((q) => q.stage === 'escalated');
  const overdueAmount = overdue.reduce((s, q) => s + q.balance, 0);
  let health: HealthStatus = 'On Track';
  if (escalated.length > 0 || overdueAmount > 40000) health = 'Critical';
  else if (overdue.length > 2) health = 'At Risk';
  else if (overdue.length > 0) health = 'Watch';
  return {
    queueCount: queue.length,
    overdueCount: overdue.length,
    overdueAmount,
    escalatedCount: escalated.length,
    health,
  };
}
