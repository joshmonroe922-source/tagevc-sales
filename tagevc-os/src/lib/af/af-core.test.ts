import { describe, expect, it } from 'vitest';
import {
  assembleInvoiceSendPacket,
  executePortalPay,
  matchFeedToPayment,
  applyFeedPaymentMatch,
  processInvoicePaid,
  runWaterfall,
  bucketBalances,
  computeEntityNetWorth,
  computeConsolidatedNetWorth,
  computePersonalNetWorth,
  computeGoLiveProgress,
  buildInitialChecklist,
  markStepDone,
  AF_BANKS,
  AF_ENTITIES,
  getEntityAttachmentDefaults,
  resolveDepositRoute,
} from '@/lib/af';

describe('AF SSOT masters', () => {
  it('has four canonical entities with simplified banks', () => {
    expect(AF_ENTITIES.map((e) => e.code)).toEqual([
      'TVC',
      'R619',
      'SHR',
      'INDA',
    ]);
    expect(AF_ENTITIES.find((e) => e.code === 'R619')?.legalName).toBe(
      'Recruit 619',
    );
    expect(AF_BANKS.every((b) => ['1000', '1010', '1040'].includes(b.glAccount))).toBe(
      true,
    );
    expect(AF_BANKS.filter((b) => b.glAccount === '1000')).toHaveLength(4);
  });

  it('routes all deposits to Operating 1000', () => {
    const r = resolveDepositRoute('R619', 'R619-DH');
    expect(r.depositGl).toBe('1000');
    expect(r.revenueAccount).toBe('4210');
  });
});

describe('paid waterfall + commission 2250', () => {
  it('runs cash → 2250 → allocation_ledger on invoice.paid', () => {
    const result = processInvoicePaid({
      invoice: {
        id: 'INV-1',
        entityCode: 'R619',
        customerId: 'C1',
        customerName: 'Client',
        number: '1',
        status: 'Sent',
        issueDate: '2026-07-01',
        dueDate: '2026-07-31',
        amount: 10000,
        amountPaid: 0,
        sku: 'R619-DH',
        revenueAccount: '4210',
        commissionAmount: 1500,
        extraAttachmentIds: [],
      },
      amountPaid: 10000,
      paidAt: '2026-07-15T12:00:00Z',
    });
    expect(result.invoice.status).toBe('Paid');
    expect(result.deposit.depositGl).toBe('1000');
    expect(
      result.journal.lines.some(
        (l) => l.account === '2250' && l.credit === 1500,
      ),
    ).toBe(true);
    expect(result.allocationLedger.length).toBeGreaterThan(3);
    const buckets = bucketBalances(result.allocationLedger);
    expect(buckets.COMM).toBe(1500);
    expect(result.osCallback.event).toBe('invoice.paid');
  });

  it('plugs PROFIT so allocations sum to paid', () => {
    const w = runWaterfall({
      entityCode: 'INDA',
      invoiceId: 'X',
      amountPaid: 1000,
      commissionAmount: 0,
      paidAt: '2026-07-01',
    });
    const sum = w.allocationLedger.reduce((s, r) => s + r.amount, 0);
    expect(Math.abs(sum - 1000)).toBeLessThan(0.05);
  });
});

describe('AP pay match', () => {
  it('posts AP clear on portal pay and matches feed without double AP', () => {
    const pay = executePortalPay({
      bill: {
        id: 'B1',
        entityCode: 'R619',
        vendorId: 'V1',
        vendorName: 'Vendor',
        number: 'V-1',
        status: 'Approved',
        amount: 100,
        amountPaid: 0,
        dueDate: '2026-07-20',
        expenseAccount: '6500',
      },
      amount: 100,
      bankAccountId: 'BA-R619-OP',
      paymentRef: 'ACH-1',
      paidAt: '2026-07-20',
    });
    expect(pay.bill.status).toBe('Paid');
    expect(pay.jeLines.find((l) => l.account === '2000')?.debit).toBe(100);

    const txn = {
      id: 'T1',
      bankAccountId: 'BA-R619-OP',
      entityCode: 'R619' as const,
      amount: -100,
      date: '2026-07-20',
      description: 'Vendor ACH-1',
      ref: 'ACH-1',
      status: 'Unmatched' as const,
    };
    const match = matchFeedToPayment(txn, [pay.payment]);
    expect(match.auto).toBe(true);
    const applied = applyFeedPaymentMatch(txn, match.matched!);
    expect(applied.txn.status).toBe('Matched');
    expect(applied.payment.feedMatched).toBe(true);
  });
});

describe('invoice attachments', () => {
  it('assembles PDF + entity Wire/I-9 defaults', () => {
    const defaults = getEntityAttachmentDefaults('TVC');
    expect(defaults.some((d) => d.documentType === 'Wiring Instructions')).toBe(
      true,
    );
    expect(defaults.some((d) => d.documentType === 'I-9 Packet')).toBe(true);
    const packet = assembleInvoiceSendPacket({
      entityCode: 'TVC',
      invoiceNumber: 'TVC-1',
    });
    expect(packet.attachments[0].source).toBe('invoice-pdf');
    expect(packet.attachments.filter((a) => a.source === 'entity').length).toBe(
      2,
    );
  });
});

describe('net worth', () => {
  it('computes entity + consolidated excluding IC double-count', () => {
    const tvc = computeEntityNetWorth('TVC', {
      '1000': 100,
      '1010': 200,
      '2000': 50,
    });
    expect(tvc.cash).toBe(300);
    expect(tvc.netWorth).toBe(250);

    const consol = computeConsolidatedNetWorth({
      TVC: { '1000': 100, '1410': 40, '2000': 10 },
      R619: { '1000': 50, '2450': 40, '2000': 5 },
      SHR: { '1000': 20 },
      INDA: { '1000': 10 },
    });
    expect(consol.eliminationsApplied).toBe(true);
    expect(consol.cash).toBe(180);
  });

  it('personal NW uses ownership% × book and liability total only', () => {
    const p = computePersonalNetWorth({
      balances: {
        '1000': 10,
        '1500': 20,
        '1510': 30,
        '1520': 5,
        '2000': 8,
      },
      entityBookNw: { TVC: 1000, R619: 500, SHR: 200, INDA: 300 },
      ownershipPct: { TVC: 1, R619: 1, SHR: 1, INDA: 1 },
    });
    expect(p.totalLiabilities).toBe(8);
    expect(p.businessOwnership.length).toBe(4);
    expect(p.categories.some((c) => c.id === 'cash')).toBe(true);
  });
});

describe('go-live setup', () => {
  it('gates production until required steps done', () => {
    let checklist = buildInitialChecklist();
    let progress = computeGoLiveProgress(checklist);
    expect(progress.productionUnlocked).toBe(false);
    expect(progress.orgPct).toBe(0);

    for (const step of ['ORG-01', 'ORG-02', 'ORG-03', 'ORG-04', 'ORG-05', 'ORG-06']) {
      checklist = markStepDone(checklist, 'ORG', step);
    }
    progress = computeGoLiveProgress(checklist);
    expect(progress.orgPct).toBe(100);
  });
});
