/**
 * In-memory demo store seeded from Spec - Seed Fixtures patterns.
 * Replace with Supabase persistence in hardening phase.
 */

import { AF_BANKS, AF_ENTITIES, getOperatingBank } from '@/lib/af/master-data';
import { processInvoicePaid } from '@/lib/af/ar/paid-chain';
import {
  applyFeedPaymentMatch,
  executePortalPay,
  matchFeedToPayment,
} from '@/lib/af/ap/pay-match';
import { makeJe, templateBill, templateInvIssue, trialBalance } from '@/lib/af/ledger/je-engine';
import {
  buildInitialChecklist,
  computeGoLiveProgress,
  markStepDone,
} from '@/lib/af/setup/go-live';
import {
  computeConsolidatedNetWorth,
  computeEntityNetWorth,
  computePersonalNetWorth,
} from '@/lib/af/net-worth/compute';
import type {
  AfBill,
  AfInvoice,
  AllocationLedgerRow,
  BankFeedTxn,
  EntityCode,
  GlBalanceMap,
  JournalEntry,
  PaymentRecord,
  SetupChecklistItem,
} from '@/lib/af/types';

export type AfStore = {
  invoices: AfInvoice[];
  bills: AfBill[];
  journals: JournalEntry[];
  payments: PaymentRecord[];
  feedTxns: BankFeedTxn[];
  allocationLedger: AllocationLedgerRow[];
  checklist: SetupChecklistItem[];
  openingBalances: Record<string, GlBalanceMap>;
  personalBalances: GlBalanceMap;
};

function seedInvoices(): AfInvoice[] {
  return [
    {
      id: 'INV-R619-1001',
      entityCode: 'R619',
      customerId: 'CUST-001',
      customerName: 'Acme Staffing Client',
      number: 'R619-1001',
      status: 'Sent',
      issueDate: '2026-07-01',
      dueDate: '2026-07-31',
      amount: 25000,
      amountPaid: 0,
      sku: 'R619-DH',
      revenueAccount: '4210',
      commissionAmount: 3750,
      extraAttachmentIds: [],
    },
    {
      id: 'INV-INDA-2001',
      entityCode: 'INDA',
      customerId: 'CUST-010',
      customerName: 'SaaS Pilot Co',
      number: 'INDA-2001',
      status: 'Sent',
      issueDate: '2026-07-05',
      dueDate: '2026-08-05',
      amount: 4800,
      amountPaid: 0,
      sku: 'INDA-SAAS',
      revenueAccount: '4410',
      commissionAmount: 0,
      extraAttachmentIds: [],
    },
    {
      id: 'INV-SHR-3001',
      entityCode: 'SHR',
      customerId: 'CUST-020',
      customerName: 'Harbor HR Client',
      number: 'SHR-3001',
      status: 'Draft',
      issueDate: '2026-07-10',
      dueDate: '2026-08-10',
      amount: 8500,
      amountPaid: 0,
      sku: 'SHR-HR',
      revenueAccount: '4310',
      commissionAmount: 850,
      extraAttachmentIds: [],
    },
  ];
}

function seedBills(): AfBill[] {
  return [
    {
      id: 'BILL-R619-501',
      entityCode: 'R619',
      vendorId: 'VEND-01',
      vendorName: 'Cloud Phone Co',
      number: 'CP-8891',
      status: 'Approved',
      amount: 420,
      amountPaid: 0,
      dueDate: '2026-07-28',
      expenseAccount: '6500',
    },
    {
      id: 'BILL-TVC-101',
      entityCode: 'TVC',
      vendorId: 'VEND-02',
      vendorName: 'Office Lease LLC',
      number: 'OL-220',
      status: 'Approved',
      amount: 3500,
      amountPaid: 0,
      dueDate: '2026-08-01',
      expenseAccount: '6600',
    },
  ];
}

function seedOpening(): Record<string, GlBalanceMap> {
  return {
    TVC: {
      '1000': 185000,
      '1010': 420000,
      '1100': 12000,
      '2000': 8500,
      '2250': 0,
      '2500': 50000,
      '1500': 200000,
    },
    R619: {
      '1000': 92000,
      '1040': 35000,
      '1100': 48000,
      '2000': 6200,
      '2250': 12000,
      '2450': 8000,
    },
    SHR: {
      '1000': 41000,
      '1040': 15000,
      '1100': 18000,
      '2000': 3100,
      '2250': 2400,
      '2450': 4500,
    },
    INDA: {
      '1000': 67000,
      '1040': 22000,
      '1100': 9600,
      '1700': 85000,
      '2000': 2800,
      '2300': 14000,
      '2450': 3000,
    },
  };
}

function createStore(): AfStore {
  const invoices = seedInvoices();
  const journals: JournalEntry[] = [];

  for (const inv of invoices) {
    if (inv.status === 'Draft') continue;
    journals.push(
      makeJe({
        id: `JE-ISSUE-${inv.id}`,
        entityCode: inv.entityCode,
        date: inv.issueDate,
        sourceModule: 'AR',
        sourceId: inv.id,
        memo: `Issue ${inv.number}`,
        lines: templateInvIssue(inv.amount, inv.revenueAccount),
      }),
    );
  }

  for (const bill of seedBills()) {
    journals.push(
      makeJe({
        id: `JE-BILL-${bill.id}`,
        entityCode: bill.entityCode,
        date: bill.dueDate,
        sourceModule: 'AP',
        sourceId: bill.id,
        memo: `Bill ${bill.number}`,
        lines: templateBill(bill.amount, bill.expenseAccount),
      }),
    );
  }

  return {
    invoices,
    bills: seedBills(),
    journals,
    payments: [],
    feedTxns: [],
    allocationLedger: [],
    checklist: buildInitialChecklist(),
    openingBalances: seedOpening(),
    personalBalances: {
      '1000': 42000,
      '1010': 28000,
      '1020': 15000,
      '1500': 185000,
      '1510': 310000,
      '1520': 22000,
      '1600': 450000,
      '2000': 8500,
      '2500': 320000,
    },
  };
}

/** Module-level singleton for demo session (server). */
let store: AfStore | null = null;

export function getAfStore(): AfStore {
  if (!store) store = createStore();
  return store;
}

export function resetAfStore(): AfStore {
  store = createStore();
  return store;
}

export function payInvoice(
  invoiceId: string,
  amount?: number,
): ReturnType<typeof processInvoicePaid> {
  const s = getAfStore();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  const payAmt = amount ?? inv.amount - inv.amountPaid;
  const result = processInvoicePaid({
    invoice: inv,
    amountPaid: payAmt,
    paidAt: new Date().toISOString(),
  });
  s.invoices = s.invoices.map((i) =>
    i.id === invoiceId ? result.invoice : i,
  );
  s.journals.push(result.journal);
  s.allocationLedger.push(...result.allocationLedger);
  const bal = s.openingBalances[inv.entityCode] ?? {};
  bal['1000'] = (bal['1000'] ?? 0) + payAmt;
  bal['1100'] = (bal['1100'] ?? 0) - payAmt;
  if (inv.commissionAmount > 0) {
    bal['2250'] = (bal['2250'] ?? 0) + inv.commissionAmount;
  }
  s.openingBalances[inv.entityCode] = bal;
  return result;
}

export function payBill(billId: string): ReturnType<typeof executePortalPay> {
  const s = getAfStore();
  const bill = s.bills.find((b) => b.id === billId);
  if (!bill) throw new Error(`Bill ${billId} not found`);
  const bank = getOperatingBank(bill.entityCode);
  const result = executePortalPay({
    bill,
    amount: bill.amount - bill.amountPaid,
    bankAccountId: bank?.id ?? `BA-${bill.entityCode}-OP`,
    paymentRef: `ACH-${bill.number}`,
    paidAt: new Date().toISOString().slice(0, 10),
  });
  s.bills = s.bills.map((b) => (b.id === billId ? result.bill : b));
  s.payments.push(result.payment);
  s.journals.push(
    makeJe({
      id: `JE-${result.payment.id}`,
      entityCode: bill.entityCode,
      date: result.payment.paidAt,
      sourceModule: 'AP',
      sourceId: result.payment.id,
      memo: `Pay ${bill.number}`,
      lines: result.jeLines,
    }),
  );
  const bal = s.openingBalances[bill.entityCode] ?? {};
  bal['1000'] = (bal['1000'] ?? 0) - result.payment.amount;
  bal['2000'] = (bal['2000'] ?? 0) - result.payment.amount;
  s.openingBalances[bill.entityCode] = bal;

  // Simulate feed arrival for match demo
  s.feedTxns.push({
    id: `FTX-${result.payment.id}`,
    bankAccountId: result.payment.bankAccountId,
    entityCode: bill.entityCode,
    amount: -result.payment.amount,
    date: result.payment.paidAt,
    description: `${bill.vendorName} ${result.payment.paymentRef}`,
    ref: result.payment.paymentRef,
    status: 'Unmatched',
  });

  return result;
}

export function autoMatchFeeds(): number {
  const s = getAfStore();
  let matched = 0;
  s.feedTxns = s.feedTxns.map((txn) => {
    if (txn.status !== 'Unmatched') return txn;
    const { matched: payment, auto } = matchFeedToPayment(txn, s.payments);
    if (auto && payment) {
      const applied = applyFeedPaymentMatch(txn, payment);
      s.payments = s.payments.map((p) =>
        p.id === payment.id ? applied.payment : p,
      );
      matched += 1;
      return applied.txn;
    }
    return txn;
  });
  return matched;
}

export function completeSetupStep(
  entityCode: EntityCode | 'ORG',
  stepId: string,
): SetupChecklistItem[] {
  const s = getAfStore();
  s.checklist = markStepDone(s.checklist, entityCode, stepId, 'josh');
  return s.checklist;
}

export function getSetupProgress() {
  return computeGoLiveProgress(getAfStore().checklist);
}

export function getEntityTb(entityCode: EntityCode) {
  return trialBalance(getAfStore().journals, entityCode);
}

export function getNetWorthSnapshot() {
  const s = getAfStore();
  const byEntity = {} as Record<EntityCode, ReturnType<typeof computeEntityNetWorth>>;
  const balances = {} as Record<EntityCode, GlBalanceMap>;
  for (const e of AF_ENTITIES) {
    balances[e.code] = s.openingBalances[e.code] ?? {};
    byEntity[e.code] = computeEntityNetWorth(e.code, balances[e.code]);
  }
  const consolidated = computeConsolidatedNetWorth(balances);
  const entityBookNw = Object.fromEntries(
    AF_ENTITIES.map((e) => [e.code, byEntity[e.code].netWorth]),
  ) as Record<EntityCode, number>;
  const personal = computePersonalNetWorth({
    balances: s.personalBalances,
    entityBookNw,
  });
  return { byEntity, consolidated, personal, banks: AF_BANKS };
}
