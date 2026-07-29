/**
 * A&F working store — seeded from Spec - Seed Fixtures, persisted to os_af_workspace.
 */

import { AF_BANKS, AF_ENTITIES, getOperatingBank } from '@/lib/af/master-data';
import { processInvoicePaid } from '@/lib/af/ar/paid-chain';
import {
  applyFeedPaymentMatch,
  executePortalPay,
  matchFeedToPayment,
} from '@/lib/af/ap/pay-match';
import { makeJe, trialBalance } from '@/lib/af/ledger/je-engine';
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
import {
  hydrateAfWorkspaceOnce,
  isAfStoreHydrated,
  queueAfPersist,
  saveAfWorkspace,
} from '@/lib/af/persist/repo';
import { buildEnvelope, publishAfEvent } from '@/lib/af/bus/events';
import { writeAfAudit } from '@/lib/af/audit/controls';
import {
  applyIcFeeToBalances,
  runMonthlyMgmtFees,
} from '@/lib/af/ic/engine';
import {
  assertPeriodAllowsPosting,
  currentPeriod,
  hardLockPeriod,
  reopenPeriod,
  softLockPeriod,
  takePeriodSnapshot,
  type AfPeriodSnapshot,
  type PeriodLockState,
} from '@/lib/af/ledger/close';
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
  periodLocks: PeriodLockState[];
  snapshots: AfPeriodSnapshot[];
  /** Set when demo fixtures were cleared for live Plaid go-live. */
  liveGoLive?: boolean;
};

const DEMO_INVOICE_IDS = new Set([
  'INV-R619-1001',
  'INV-INDA-2001',
  'INV-SHR-3001',
]);
const DEMO_BILL_IDS = new Set(['BILL-R619-501', 'BILL-TVC-101']);

function emptyOpening(): Record<string, GlBalanceMap> {
  return {
    TVC: { '1000': 0, '1010': 0, '1100': 0, '2000': 0, '2250': 0 },
    R619: { '1000': 0, '1040': 0, '1100': 0, '2000': 0, '2250': 0 },
    SHR: { '1000': 0, '1040': 0, '1100': 0, '2000': 0, '2250': 0 },
    INDA: { '1000': 0, '1040': 0, '1100': 0, '2000': 0 },
  };
}

function createStore(): AfStore {
  // Live go-live baseline — no demo invoices/bills/fixture cash.
  return {
    invoices: [],
    bills: [],
    journals: [],
    payments: [],
    feedTxns: [],
    allocationLedger: [],
    checklist: buildInitialChecklist(),
    openingBalances: emptyOpening(),
    personalBalances: {
      '1000': 0,
      '1010': 0,
      '1020': 0,
    },
    periodLocks: [],
    snapshots: [],
    liveGoLive: true,
  };
}

/** Strip Spec seed fixtures from a hydrated workspace; keep checklist + live feeds. */
export function purgeDemoAfStore(store: AfStore): AfStore {
  if (store.liveGoLive) return store;
  const hadDemo =
    store.invoices.some((i) => DEMO_INVOICE_IDS.has(i.id)) ||
    store.bills.some((b) => DEMO_BILL_IDS.has(b.id)) ||
    Object.values(store.openingBalances).some((b) =>
      Object.values(b).some((v) => Math.abs(v) >= 10000),
    ) ||
    Object.values(store.personalBalances ?? {}).some((v) => Math.abs(v) >= 10000);

  if (!hadDemo && store.invoices.length === 0 && store.bills.length === 0) {
    return { ...store, liveGoLive: true };
  }

  const liveFeeds = store.feedTxns.filter(
    (t) => t.id.startsWith('PLAID-') || !t.id.includes('TEST'),
  );

  return {
    ...store,
    invoices: store.invoices.filter((i) => !DEMO_INVOICE_IDS.has(i.id)),
    bills: store.bills.filter((b) => !DEMO_BILL_IDS.has(b.id)),
    journals: store.journals.filter(
      (j) =>
        !j.id.startsWith('JE-ISSUE-INV-') &&
        !j.id.startsWith('JE-BILL-BILL-'),
    ),
    payments: store.payments.filter((p) => !String(p.id).includes('TEST')),
    feedTxns: liveFeeds,
    allocationLedger: [],
    openingBalances: emptyOpening(),
    personalBalances: { '1000': 0, '1010': 0, '1020': 0 },
    snapshots: [],
    liveGoLive: true,
  };
}

/** Module-level singleton (hydrated from Supabase when available). */
let store: AfStore | null = null;

function touchPersist() {
  if (!store) return;
  queueAfPersist(() => store!);
}

export function getAfStore(): AfStore {
  if (!store) store = createStore();
  // Backfill fields for older persisted payloads
  store.periodLocks ??= [];
  store.snapshots ??= [];
  return store;
}

export async function hydrateAfStore(): Promise<AfStore> {
  if (isAfStoreHydrated() && store) return store;
  return hydrateAfWorkspaceOnce(createStore, (s) => {
    const purged = purgeDemoAfStore(s);
    store = purged;
    if (!s.liveGoLive) {
      void saveAfWorkspace(purged);
    }
  });
}

export function resetAfStore(): AfStore {
  store = createStore();
  void saveAfWorkspace(store);
  return store;
}

export function payInvoice(
  invoiceId: string,
  amount?: number,
): ReturnType<typeof processInvoicePaid> {
  const s = getAfStore();
  const inv = s.invoices.find((i) => i.id === invoiceId);
  if (!inv) throw new Error(`Invoice ${invoiceId} not found`);
  const periodGate = assertPeriodAllowsPosting({
    locks: s.periodLocks,
    entityCode: inv.entityCode,
    period: currentPeriod(),
  });
  if (!periodGate.ok) {
    throw new Error(periodGate.message ?? 'Period locked');
  }
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
  touchPersist();
  void publishAfEvent({
    envelope: buildEnvelope({
      eventType: 'invoice.paid',
      entityCode: inv.entityCode,
      payload: {
        invoice_id: inv.id,
        amount_paid: payAmt,
        ...result.osCallback,
      },
    }),
    direction: 'outbound',
  });
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode: inv.entityCode,
    action: 'invoice.paid',
    refType: 'invoice',
    refId: inv.id,
    detail: { amount: payAmt, buckets: result.allocationLedger.length },
  });
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

  touchPersist();
  void publishAfEvent({
    envelope: buildEnvelope({
      eventType: 'bill.paid',
      entityCode: bill.entityCode,
      payload: { bill_id: bill.id, payment_id: result.payment.id },
    }),
  });
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode: bill.entityCode,
    action: 'bill.paid',
    refType: 'bill',
    refId: bill.id,
    detail: { paymentId: result.payment.id, amount: result.payment.amount },
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
  if (matched) touchPersist();
  return matched;
}

export function completeSetupStep(
  entityCode: EntityCode | 'ORG',
  stepId: string,
): SetupChecklistItem[] {
  const s = getAfStore();
  s.checklist = markStepDone(s.checklist, entityCode, stepId, 'josh');
  touchPersist();
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode,
    action: 'setup.step_done',
    refType: 'setup_step',
    refId: stepId,
  });
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

/** Build order step 7 — IC mgmt fee auto-run for a period. */
export function runIcMgmtFeePeriod(period?: string) {
  const s = getAfStore();
  const p =
    period ??
    new Date().toISOString().slice(0, 7);
  const existing = s.journals.some(
    (j) => j.sourceModule === 'IC' && j.sourceId.includes(p),
  );
  if (existing) {
    return { skipped: true as const, period: p, totalFee: 0 };
  }
  const run = runMonthlyMgmtFees({ period: p });
  s.journals.push(...run.journals);
  s.openingBalances = applyIcFeeToBalances(s.openingBalances, run);
  touchPersist();
  void publishAfEvent({
    envelope: buildEnvelope({
      eventType: 'ic.mgmt_fee_posted',
      entityCode: 'TVC',
      payload: { period: p, total: run.totalFee, byEntity: run.byEntity },
    }),
  });
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode: 'TVC',
    action: 'ic.mgmt_fee_run',
    refType: 'period',
    refId: p,
    detail: { totalFee: run.totalFee },
  });
  return { skipped: false as const, period: p, totalFee: run.totalFee, journals: run.journals.length };
}

export function ingestTestFeedTxns(
  bankAccountId: string,
  entityCode: EntityCode,
  count = 3,
): number {
  // Live mode: do not invent fixture feed rows.
  void bankAccountId;
  void entityCode;
  void count;
  return 0;
}

/** Upsert live Plaid transactions into the A&F feed (idempotent by id). */
export function ingestLiveFeedTxns(
  bankAccountId: string,
  entityCode: EntityCode,
  txns: Array<{
    id: string;
    amount: number;
    date: string;
    description: string;
    ref?: string;
  }>,
): number {
  const s = getAfStore();
  const existing = new Set(s.feedTxns.map((t) => t.id));
  let added = 0;
  for (const t of txns) {
    if (existing.has(t.id)) {
      const idx = s.feedTxns.findIndex((x) => x.id === t.id);
      if (idx >= 0) {
        s.feedTxns[idx] = {
          ...s.feedTxns[idx],
          amount: t.amount,
          date: t.date,
          description: t.description,
          ref: t.ref,
        };
      }
      continue;
    }
    s.feedTxns.push({
      id: t.id,
      bankAccountId,
      entityCode,
      amount: t.amount,
      date: t.date,
      description: t.description,
      ref: t.ref,
      status: 'Unmatched',
    });
    added += 1;
  }
  // Keep newest first-ish for UI
  s.feedTxns.sort((a, b) => b.date.localeCompare(a.date));
  touchPersist();
  return added;
}

/** Set cash GL balance from live Plaid (company entity or PERS personal books). */
export function applyLiveBankBalance(
  entityCode: EntityCode | 'PERS',
  glAccount: string,
  balance: number,
): void {
  const s = getAfStore();
  if (entityCode === 'PERS') {
    s.personalBalances = {
      ...s.personalBalances,
      [glAccount]: balance,
    };
  } else {
    const bals = { ...(s.openingBalances[entityCode] ?? {}) };
    bals[glAccount] = balance;
    s.openingBalances = {
      ...s.openingBalances,
      [entityCode]: bals,
    };
  }
  touchPersist();
}

export function snapshotClosePeriod(input: {
  entityCode: EntityCode | 'CONSOL';
  period?: string;
  actor?: string;
}): AfPeriodSnapshot {
  const s = getAfStore();
  const period = input.period ?? currentPeriod();
  const bals =
    input.entityCode === 'CONSOL'
      ? Object.values(s.openingBalances).reduce<GlBalanceMap>((acc, b) => {
          for (const [k, v] of Object.entries(b)) {
            acc[k] = (acc[k] ?? 0) + v;
          }
          return acc;
        }, {})
      : (s.openingBalances[input.entityCode] ?? {});
  const snap = takePeriodSnapshot({
    entityCode: input.entityCode,
    period,
    balances: bals,
    invoices: s.invoices,
    bills: s.bills,
    journals: s.journals,
    actor: input.actor,
    netWorth:
      input.entityCode === 'CONSOL'
        ? getNetWorthSnapshot().consolidated.netWorth
        : getNetWorthSnapshot().byEntity[input.entityCode as EntityCode]
            ?.netWorth,
  });
  s.snapshots = [
    ...s.snapshots.filter(
      (x) =>
        !(x.entityCode === input.entityCode && x.period === period),
    ),
    snap,
  ];
  touchPersist();
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode: input.entityCode === 'CONSOL' ? 'TVC' : input.entityCode,
    action: 'period.snapshot',
    refType: 'period',
    refId: period,
    detail: { snapshotId: snap.id },
  });
  return snap;
}

export function setPeriodLockMode(input: {
  entityCode: EntityCode | 'CONSOL';
  mode: 'soft' | 'hard' | 'reopen';
  period?: string;
  actor?: string;
}): PeriodLockState[] {
  const s = getAfStore();
  const period = input.period ?? currentPeriod();
  if (input.mode === 'soft') {
    s.periodLocks = softLockPeriod({
      locks: s.periodLocks,
      entityCode: input.entityCode,
      period,
      actor: input.actor,
    });
  } else if (input.mode === 'hard') {
    s.periodLocks = hardLockPeriod({
      locks: s.periodLocks,
      entityCode: input.entityCode,
      period,
      actor: input.actor,
    });
  } else {
    s.periodLocks = reopenPeriod({
      locks: s.periodLocks,
      entityCode: input.entityCode,
      period,
    });
  }
  touchPersist();
  void writeAfAudit({
    occurredAt: new Date().toISOString(),
    entityCode: input.entityCode === 'CONSOL' ? 'TVC' : input.entityCode,
    action: `period.${input.mode}`,
    refType: 'period',
    refId: period,
    actorLabel: input.actor,
  });
  return s.periodLocks;
}

