/**
 * GL / JE templates — Spec - GL JE Close.
 */

import type { JeLine, JournalEntry, BooksId } from '@/lib/af/types';
import {
  AP_GL,
  AR_GL,
  DUE_TO_PARENT_GL,
  MGMT_FEE_EXPENSE_GL,
  MGMT_FEE_INCOME_GL,
  OPERATING_GL,
} from '@/lib/af/constants';

function assertBalanced(lines: JeLine[]): void {
  const d = lines.reduce((s, l) => s + l.debit, 0);
  const c = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(d - c) > 0.02) {
    throw new Error(`Unbalanced JE: ${d} vs ${c}`);
  }
}

export function makeJe(input: {
  id: string;
  entityCode: BooksId;
  date: string;
  sourceModule: string;
  sourceId: string;
  memo: string;
  lines: JeLine[];
}): JournalEntry {
  assertBalanced(input.lines);
  return {
    ...input,
    period: input.date.slice(0, 7),
    status: 'posted',
  };
}

/** INV-ISSUE: Dr AR / Cr Revenue */
export function templateInvIssue(
  amount: number,
  revenueAccount: string,
): JeLine[] {
  return [
    { account: AR_GL, debit: amount, credit: 0 },
    { account: revenueAccount, debit: 0, credit: amount },
  ];
}

/** BILL: Dr Expense / Cr AP */
export function templateBill(amount: number, expenseAccount: string): JeLine[] {
  return [
    { account: expenseAccount, debit: amount, credit: 0 },
    { account: AP_GL, debit: 0, credit: amount },
  ];
}

/** BILL-PAY: Dr AP / Cr Cash */
export function templateBillPay(amount: number): JeLine[] {
  return [
    { account: AP_GL, debit: amount, credit: 0 },
    { account: OPERATING_GL, debit: 0, credit: amount },
  ];
}

/**
 * BANK-SPEND (unmatched outflow): Dr Expense / Cr Cash.
 * amount is absolute spend magnitude.
 */
export function templateBankSpend(
  amount: number,
  expenseAccount: string,
  cashGl = OPERATING_GL,
): JeLine[] {
  return [
    { account: expenseAccount, debit: amount, credit: 0 },
    { account: cashGl, debit: 0, credit: amount },
  ];
}

/**
 * BANK-DEPOSIT (unmatched inflow, non-AR): Dr Cash / Cr Revenue (or other income).
 * amount is absolute deposit magnitude.
 */
export function templateBankDeposit(
  amount: number,
  revenueAccount: string,
  cashGl = OPERATING_GL,
): JeLine[] {
  return [
    { account: cashGl, debit: amount, credit: 0 },
    { account: revenueAccount, debit: 0, credit: amount },
  ];
}

/** Manual JE — lines must already balance; status may be draft or posted. */
export function makeJeDraft(input: {
  id: string;
  entityCode: BooksId;
  date: string;
  sourceModule: string;
  sourceId: string;
  memo: string;
  lines: JeLine[];
  status?: 'draft' | 'posted';
}): JournalEntry {
  assertBalanced(input.lines);
  return {
    id: input.id,
    entityCode: input.entityCode,
    date: input.date,
    period: input.date.slice(0, 7),
    sourceModule: input.sourceModule,
    sourceId: input.sourceId,
    memo: input.memo,
    lines: input.lines,
    status: input.status ?? 'draft',
  };
}

/** MGMT-FEE sub: Dr 6950 / Cr 2450 */
export function templateMgmtFeeSub(amount: number): JeLine[] {
  return [
    { account: MGMT_FEE_EXPENSE_GL, debit: amount, credit: 0 },
    { account: DUE_TO_PARENT_GL, debit: 0, credit: amount },
  ];
}

/** MGMT-FEE parent: Dr 141x / Cr 4000 */
export function templateMgmtFeeParent(
  amount: number,
  dueFromAccount: string,
): JeLine[] {
  return [
    { account: dueFromAccount, debit: amount, credit: 0 },
    { account: MGMT_FEE_INCOME_GL, debit: 0, credit: amount },
  ];
}

export function parentDueFromAccount(sub: string): string {
  switch (sub) {
    case 'R619':
      return '1410';
    case 'SHR':
      return '1420';
    case 'INDA':
      return '1430';
    default:
      return '1400';
  }
}

export function trialBalance(
  journals: JournalEntry[],
  entityCode: BooksId,
): Record<string, { debit: number; credit: number; net: number }> {
  const map: Record<string, { debit: number; credit: number; net: number }> =
    {};
  for (const je of journals) {
    if (je.entityCode !== entityCode || je.status !== 'posted') continue;
    for (const line of je.lines) {
      const row = map[line.account] ?? { debit: 0, credit: 0, net: 0 };
      row.debit += line.debit;
      row.credit += line.credit;
      row.net = row.debit - row.credit;
      map[line.account] = row;
    }
  }
  return map;
}
