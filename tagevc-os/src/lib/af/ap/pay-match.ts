/**
 * AP pay match — Spec - AP Vendor Portal & Cards §3.
 * Portal pay posts Dr AP / Cr Cash and closes bill; feed matches Payment only.
 */

import { AP_GL, OPERATING_GL } from '@/lib/af/constants';
import type {
  AfBill,
  BankFeedTxn,
  JeLine,
  PaymentRecord,
} from '@/lib/af/types';

export type PortalPayInput = {
  bill: AfBill;
  amount: number;
  bankAccountId: string;
  paymentRef: string;
  paidAt: string;
  creditCard?: boolean;
  cardLiabilityGl?: string;
};

export type PortalPayResult = {
  payment: PaymentRecord;
  bill: AfBill;
  jeLines: JeLine[];
};

/** PATH A — pay inside portal: post JE + close AP immediately. */
export function executePortalPay(input: PortalPayInput): PortalPayResult {
  const payAmount = Math.min(input.amount, input.bill.amount - input.bill.amountPaid);
  const amountPaid = input.bill.amountPaid + payAmount;
  const status =
    amountPaid >= input.bill.amount - 0.001
      ? 'Paid'
      : amountPaid > 0
        ? 'Partial'
        : input.bill.status;

  const creditGl = input.creditCard
    ? (input.cardLiabilityGl ?? '2100')
    : OPERATING_GL;

  const payment: PaymentRecord = {
    id: `PAY-${input.bill.id}-${Date.now()}`,
    entityCode: input.bill.entityCode,
    billIds: [input.bill.id],
    amount: payAmount,
    bankAccountId: input.bankAccountId,
    paymentRef: input.paymentRef,
    paidAt: input.paidAt,
    glPosted: true,
    feedMatched: false,
  };

  return {
    payment,
    bill: { ...input.bill, amountPaid, status },
    jeLines: [
      { account: AP_GL, debit: payAmount, credit: 0, memo: `Pay ${input.bill.number}` },
      {
        account: creditGl,
        debit: 0,
        credit: payAmount,
        memo: input.creditCard ? 'Card liability' : 'Cash out Operating',
      },
    ],
  };
}

export type MatchCandidate = {
  payment: PaymentRecord;
  confidence: number;
  reasons: string[];
};

/**
 * Match bank/card feed txn to existing Payment (no second AP entry).
 * Rules: amount, ±1–3 days, same bank, payment_ref / description.
 */
export function matchFeedToPayment(
  txn: BankFeedTxn,
  payments: PaymentRecord[],
  opts?: { dayWindow?: number; autoThreshold?: number },
): { matched: PaymentRecord | null; candidates: MatchCandidate[]; auto: boolean } {
  const window = opts?.dayWindow ?? 3;
  const threshold = opts?.autoThreshold ?? 0.85;
  const candidates: MatchCandidate[] = [];

  for (const payment of payments) {
    if (payment.feedMatched) continue;
    if (payment.bankAccountId !== txn.bankAccountId) continue;
    if (payment.entityCode !== txn.entityCode) continue;

    const reasons: string[] = [];
    let score = 0;

    if (Math.abs(payment.amount - Math.abs(txn.amount)) < 0.01) {
      score += 0.45;
      reasons.push('exact amount');
    } else if (Math.abs(payment.amount - Math.abs(txn.amount)) < 1) {
      score += 0.2;
      reasons.push('near amount');
    }

    const dayDiff = Math.abs(daysBetween(payment.paidAt, txn.date));
    if (dayDiff <= 1) {
      score += 0.3;
      reasons.push('±1 day');
    } else if (dayDiff <= window) {
      score += 0.15;
      reasons.push(`±${window} days`);
    }

    score += 0.1; // same bank already filtered
    reasons.push('same bank');

    const ref = (txn.ref ?? '') + ' ' + txn.description;
    if (
      payment.paymentRef &&
      ref.toLowerCase().includes(payment.paymentRef.toLowerCase())
    ) {
      score += 0.2;
      reasons.push('payment ref');
    }

    if (score > 0.3) {
      candidates.push({ payment, confidence: Math.min(score, 1), reasons });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0];
  if (best && best.confidence >= threshold) {
    return { matched: best.payment, candidates, auto: true };
  }
  return { matched: null, candidates, auto: false };
}

/** Apply match: mark feed Matched + payment feedMatched — never re-post AP. */
export function applyFeedPaymentMatch(
  txn: BankFeedTxn,
  payment: PaymentRecord,
): { txn: BankFeedTxn; payment: PaymentRecord } {
  return {
    txn: {
      ...txn,
      status: 'Matched',
      matchedPaymentId: payment.id,
    },
    payment: { ...payment, feedMatched: true },
  };
}

/**
 * PATH B — paid outside portal: suggest open bills; on confirm post same JE.
 */
export function suggestBillsForFeed(
  txn: BankFeedTxn,
  openBills: AfBill[],
): Array<{ bill: AfBill; confidence: number }> {
  const amount = Math.abs(txn.amount);
  return openBills
    .filter((b) => b.entityCode === txn.entityCode && b.status !== 'Paid')
    .map((bill) => {
      const remaining = bill.amount - bill.amountPaid;
      let confidence = 0;
      if (Math.abs(remaining - amount) < 0.01) confidence += 0.5;
      if (
        txn.description.toLowerCase().includes(bill.vendorName.toLowerCase())
      ) {
        confidence += 0.35;
      }
      if (txn.description.toLowerCase().includes(bill.number.toLowerCase())) {
        confidence += 0.2;
      }
      return { bill, confidence };
    })
    .filter((x) => x.confidence >= 0.35)
    .sort((a, b) => b.confidence - a.confidence);
}

function daysBetween(a: string, b: string): number {
  const ms = Date.parse(a) - Date.parse(b);
  return ms / (1000 * 60 * 60 * 24);
}
