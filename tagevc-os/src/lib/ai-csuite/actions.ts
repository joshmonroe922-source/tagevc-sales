/**
 * Draft-only C-Suite action status machine.
 * proposed → approved | rejected; approved → executed (human confirm).
 * Never auto-executes money / legal send / secrets.
 */

export const CSUITE_ACTION_STATUSES = [
  'proposed',
  'approved',
  'rejected',
  'executed',
] as const;

export type CsuiteActionStatus = (typeof CSUITE_ACTION_STATUSES)[number];

export const CSUITE_ACTION_TYPES = [
  'ticket',
  'checklist_note',
  'task',
] as const;

export type CsuiteActionType = (typeof CSUITE_ACTION_TYPES)[number];

const TRANSITIONS: Record<CsuiteActionStatus, CsuiteActionStatus[]> = {
  proposed: ['approved', 'rejected'],
  approved: ['executed', 'rejected'],
  rejected: [],
  executed: [],
};

export function canTransitionCsuiteAction(
  from: CsuiteActionStatus,
  to: CsuiteActionStatus,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function assertCsuiteActionTransition(
  from: CsuiteActionStatus,
  to: CsuiteActionStatus,
): void {
  if (!canTransitionCsuiteAction(from, to)) {
    throw new Error(`Invalid C-Suite action transition ${from} → ${to}`);
  }
}

/** Forbidden autonomous outcomes — always require human gate outside this machine. */
export const CSUITE_FORBIDDEN_AUTONOMY = [
  'money_movement',
  'legal_send',
  'legal_void',
  'production_secret_change',
  'fabricated_kpi',
] as const;
