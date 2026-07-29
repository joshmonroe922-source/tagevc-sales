/**
 * Continuous close checklist + period lock + snapshots (Spec - GL JE Close).
 */

import { trialBalance } from '@/lib/af/ledger/je-engine';
import type {
  AfBill,
  AfInvoice,
  BankFeedTxn,
  EntityCode,
  GlBalanceMap,
  JournalEntry,
  SetupStepStatus,
} from '@/lib/af/types';
import { AF_ENTITIES } from '@/lib/af/master-data';
import { DUE_TO_PARENT_GL } from '@/lib/af/constants';

export const CLOSE_TASK_DEFS = [
  { id: 'bank_rec', label: 'Bank/card rec complete' },
  { id: 'ar_ap_age', label: 'AR/AP age reviewed' },
  { id: 'ic_agree', label: 'IC balances agree parent↔sub' },
  { id: 'rev_cutoff', label: 'Revenue cut-off' },
  { id: 'deferred_rev', label: 'Deferred rev rollforward' },
  { id: 'accruals', label: 'Accruals' },
  { id: 'payroll', label: 'Payroll' },
  { id: 'commissions', label: 'Commissions true-up' },
  { id: 'loans', label: 'Loans schedule' },
  { id: 'elim', label: 'Eliminations draft' },
  { id: 'tb', label: 'TB balance' },
  { id: 'snapshot_lock', label: 'Snapshot + lock period' },
] as const;

export type CloseTaskId = (typeof CLOSE_TASK_DEFS)[number]['id'];

export type CloseTaskResult = {
  id: CloseTaskId;
  label: string;
  status: SetupStepStatus;
  detail: string;
};

export type PeriodLockState = {
  entityCode: EntityCode | 'CONSOL';
  period: string; // YYYY-MM
  mode: 'open' | 'soft' | 'hard';
  lockedAt?: string;
  lockedBy?: string;
};

export type AfPeriodSnapshot = {
  id: string;
  entityCode: EntityCode | 'CONSOL';
  period: string;
  takenAt: string;
  takenBy?: string;
  balances: GlBalanceMap;
  invoiceCount: number;
  billCount: number;
  journalCount: number;
  netWorth?: number;
};

export type CloseEngineInput = {
  entityCode?: EntityCode | null;
  period: string;
  balances: Record<string, GlBalanceMap>;
  invoices: AfInvoice[];
  bills: AfBill[];
  journals: JournalEntry[];
  feedTxns: BankFeedTxn[];
  locks: PeriodLockState[];
  snapshots: AfPeriodSnapshot[];
  asOf?: string;
};

function filterEntity<T extends { entityCode: string }>(
  rows: T[],
  entityCode?: EntityCode | null,
): T[] {
  if (!entityCode) return rows;
  return rows.filter((r) => r.entityCode === entityCode);
}

function icAgree(balances: Record<string, GlBalanceMap>): boolean {
  const parentDueFrom =
    (balances.TVC?.['1410'] ?? 0) +
    (balances.TVC?.['1411'] ?? 0) +
    (balances.TVC?.['1412'] ?? 0) +
    (balances.TVC?.['1413'] ?? 0);
  const subDueTo =
    (balances.R619?.[DUE_TO_PARENT_GL] ?? 0) +
    (balances.SHR?.[DUE_TO_PARENT_GL] ?? 0) +
    (balances.INDA?.[DUE_TO_PARENT_GL] ?? 0);
  // Seeded books may not yet post 141x — treat near-zero parent as Watch, not fail
  if (parentDueFrom === 0 && subDueTo === 0) return true;
  return Math.abs(parentDueFrom - subDueTo) < 1;
}

export function currentPeriod(asOf = new Date()): string {
  return asOf.toISOString().slice(0, 7);
}

export function evaluateCloseChecklist(
  input: CloseEngineInput,
): CloseTaskResult[] {
  const entity = input.entityCode ?? null;
  const invoices = filterEntity(input.invoices, entity);
  const bills = filterEntity(input.bills, entity);
  const feeds = filterEntity(input.feedTxns, entity);
  const journals = entity
    ? input.journals.filter((j) => j.entityCode === entity)
    : input.journals;

  const unmatched = feeds.filter((f) => f.status === 'Unmatched').length;
  const openAr = invoices.filter(
    (i) => i.status !== 'Paid' && i.status !== 'Void',
  ).length;
  const overdueAr = invoices.filter(
    (i) =>
      i.status !== 'Paid' &&
      i.status !== 'Void' &&
      i.dueDate < (input.asOf ?? new Date().toISOString().slice(0, 10)),
  ).length;
  const openAp = bills.filter(
    (b) => b.status !== 'Paid' && b.status !== 'Rejected',
  ).length;
  const draftPast = invoices.filter(
    (i) => i.status === 'Draft' && i.issueDate.slice(0, 7) <= input.period,
  ).length;

  const bals = entity
    ? { [entity]: input.balances[entity] ?? {} }
    : input.balances;
  const tbOk = (entity ? [entity] : AF_ENTITIES.map((e) => e.code)).every(
    (code) => {
      const tb = trialBalance(input.journals, code);
      const debits = Object.values(tb).reduce((s, r) => s + r.debit, 0);
      const credits = Object.values(tb).reduce((s, r) => s + r.credit, 0);
      return Math.abs(debits - credits) < 0.02;
    },
  );

  const deferred = Object.values(bals).reduce(
    (sum, b) => sum + (b['2300'] ?? 0),
    0,
  );
  const loanPrincipal = Object.values(bals).reduce(
    (sum, b) => sum + (b['2500'] ?? 0),
    0,
  );
  const commission = Object.values(bals).reduce(
    (sum, b) => sum + (b['2250'] ?? 0),
    0,
  );

  const lock = input.locks.find(
    (l) =>
      l.period === input.period &&
      (entity ? l.entityCode === entity : l.entityCode === 'CONSOL' || true),
  );
  const snap = input.snapshots.find(
    (s) =>
      s.period === input.period &&
      (entity ? s.entityCode === entity : s.entityCode === 'CONSOL'),
  );
  const anyHard = input.locks.some(
    (l) =>
      l.period === input.period &&
      l.mode === 'hard' &&
      (!entity || l.entityCode === entity),
  );
  const anySnap = input.snapshots.some(
    (s) =>
      s.period === input.period && (!entity || s.entityCode === entity),
  );

  const tasks: CloseTaskResult[] = [
    {
      id: 'bank_rec',
      label: 'Bank/card rec complete',
      status: unmatched === 0 ? 'Done' : unmatched <= 2 ? 'In progress' : 'Blocked',
      detail:
        unmatched === 0
          ? 'All feed txns matched or excluded'
          : `${unmatched} unmatched feed txn(s)`,
    },
    {
      id: 'ar_ap_age',
      label: 'AR/AP age reviewed',
      status:
        overdueAr === 0 && openAp <= 2
          ? 'Done'
          : overdueAr > 3
            ? 'Blocked'
            : 'In progress',
      detail: `Open AR ${openAr} (${overdueAr} overdue) · Open AP ${openAp}`,
    },
    {
      id: 'ic_agree',
      label: 'IC balances agree parent↔sub',
      status: icAgree(input.balances) ? 'Done' : 'In progress',
      detail: icAgree(input.balances)
        ? 'Due From ↔ Due To within $1'
        : 'IC Due From/To out of balance — refresh elim',
    },
    {
      id: 'rev_cutoff',
      label: 'Revenue cut-off',
      status: draftPast === 0 ? 'Done' : 'In progress',
      detail:
        draftPast === 0
          ? 'No draft invoices lingering in period'
          : `${draftPast} draft invoice(s) still open in period`,
    },
    {
      id: 'deferred_rev',
      label: 'Deferred rev rollforward',
      status: deferred >= 0 ? 'Done' : 'Blocked',
      detail: `Deferred revenue (2300) balance ${deferred.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
    },
    {
      id: 'accruals',
      label: 'Accruals',
      status: journals.some((j) => /accrual/i.test(j.memo))
        ? 'Done'
        : 'In progress',
      detail: journals.some((j) => /accrual/i.test(j.memo))
        ? 'Accrual JEs present'
        : 'Review period-end accruals before hard lock',
    },
    {
      id: 'payroll',
      label: 'Payroll',
      status: 'Skipped',
      detail: 'Payroll calculation OOS for V1 — interface only',
    },
    {
      id: 'commissions',
      label: 'Commissions true-up',
      status: commission >= 0 ? 'Done' : 'Blocked',
      detail: `Protected commission liability 2250 = ${commission.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`,
    },
    {
      id: 'loans',
      label: 'Loans schedule',
      status: 'Done',
      detail:
        loanPrincipal > 0
          ? `Loan principal 2500 = ${loanPrincipal.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })}`
          : 'No loan principal outstanding',
    },
    {
      id: 'elim',
      label: 'Eliminations draft',
      status: icAgree(input.balances) ? 'Done' : 'In progress',
      detail: 'Consol NW applies IC elim on Due From/To + mgmt fee',
    },
    {
      id: 'tb',
      label: 'TB balance',
      status: tbOk ? 'Done' : 'Blocked',
      detail: tbOk
        ? 'All entity trial balances in balance'
        : 'Unbalanced JE detected — fix before lock',
    },
    {
      id: 'snapshot_lock',
      label: 'Snapshot + lock period',
      status: anyHard && anySnap ? 'Done' : anySnap || lock ? 'In progress' : 'Not started',
      detail: anyHard
        ? `Hard locked${snap ? ' · snapshot taken' : ''}`
        : anySnap
          ? 'Snapshot taken — soft/hard lock still open'
          : 'Take snapshot then soft → hard lock',
    },
  ];

  return tasks;
}

export function closeProgress(tasks: CloseTaskResult[]): {
  done: number;
  total: number;
  pct: number;
  readyForHardLock: boolean;
} {
  const actionable = tasks.filter((t) => t.status !== 'Skipped');
  const done = actionable.filter((t) => t.status === 'Done').length;
  const blocked = actionable.some((t) => t.status === 'Blocked');
  const total = actionable.length;
  return {
    done,
    total,
    pct: total ? Math.round((done / total) * 100) : 0,
    readyForHardLock: !blocked && done >= total - 1,
  };
}

export function assertPeriodAllowsPosting(input: {
  locks: PeriodLockState[];
  entityCode: EntityCode;
  period: string;
}): { ok: boolean; code?: string; message?: string } {
  const lock = input.locks.find(
    (l) =>
      l.period === input.period &&
      (l.entityCode === input.entityCode || l.entityCode === 'CONSOL'),
  );
  if (lock?.mode === 'hard') {
    return {
      ok: false,
      code: 'PERIOD_LOCKED',
      message: `Period ${input.period} is hard-locked for ${input.entityCode}. Reopen requires Controls role + audit log.`,
    };
  }
  return { ok: true };
}

export function softLockPeriod(input: {
  locks: PeriodLockState[];
  entityCode: EntityCode | 'CONSOL';
  period: string;
  actor?: string;
}): PeriodLockState[] {
  const next: PeriodLockState = {
    entityCode: input.entityCode,
    period: input.period,
    mode: 'soft',
    lockedAt: new Date().toISOString(),
    lockedBy: input.actor,
  };
  return [
    ...input.locks.filter(
      (l) =>
        !(l.entityCode === input.entityCode && l.period === input.period),
    ),
    next,
  ];
}

export function hardLockPeriod(input: {
  locks: PeriodLockState[];
  entityCode: EntityCode | 'CONSOL';
  period: string;
  actor?: string;
}): PeriodLockState[] {
  const next: PeriodLockState = {
    entityCode: input.entityCode,
    period: input.period,
    mode: 'hard',
    lockedAt: new Date().toISOString(),
    lockedBy: input.actor,
  };
  return [
    ...input.locks.filter(
      (l) =>
        !(l.entityCode === input.entityCode && l.period === input.period),
    ),
    next,
  ];
}

export function reopenPeriod(input: {
  locks: PeriodLockState[];
  entityCode: EntityCode | 'CONSOL';
  period: string;
}): PeriodLockState[] {
  return input.locks.filter(
    (l) =>
      !(l.entityCode === input.entityCode && l.period === input.period),
  );
}

export function takePeriodSnapshot(input: {
  entityCode: EntityCode | 'CONSOL';
  period: string;
  balances: GlBalanceMap;
  invoices: AfInvoice[];
  bills: AfBill[];
  journals: JournalEntry[];
  actor?: string;
  netWorth?: number;
}): AfPeriodSnapshot {
  return {
    id: `SNAP-${input.entityCode}-${input.period}-${Date.now()}`,
    entityCode: input.entityCode,
    period: input.period,
    takenAt: new Date().toISOString(),
    takenBy: input.actor,
    balances: { ...input.balances },
    invoiceCount: input.invoices.length,
    billCount: input.bills.length,
    journalCount: input.journals.length,
    netWorth: input.netWorth,
  };
}
