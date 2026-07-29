/**
 * invoice.paid chain (handoff rule 5):
 * deposit Operating 1000 → Commission Engine credits 2250 →
 * Revenue Split Waterfall writes allocation_ledger → forecast touch → OS callback.
 */

import { buildInvoicePaidCashLines, resolveDepositRoute } from '@/lib/af/cash/routing';
import { runWaterfall } from '@/lib/af/waterfall/engine';
import type {
  AfInvoice,
  AllocationLedgerRow,
  EntityCode,
  JournalEntry,
  JeLine,
} from '@/lib/af/types';

export type PaidChainResult = {
  invoice: AfInvoice;
  deposit: ReturnType<typeof resolveDepositRoute>;
  journal: JournalEntry;
  allocationLedger: AllocationLedgerRow[];
  residualProfit: number;
  osCallback: {
    event: 'invoice.paid';
    invoiceId: string;
    entityCode: EntityCode;
    amountPaid: number;
  };
  forecastTouch: {
    entityCode: EntityCode;
    amount: number;
    bucketsUpdated: number;
  };
};

export function processInvoicePaid(input: {
  invoice: AfInvoice;
  amountPaid: number;
  paidAt: string;
  useUndeposited?: boolean;
}): PaidChainResult {
  const { invoice } = input;
  const deposit = resolveDepositRoute(invoice.entityCode, invoice.sku);
  const cashLines = buildInvoicePaidCashLines(input.amountPaid, {
    useUndeposited: input.useUndeposited,
  });

  const waterfall = runWaterfall({
    entityCode: invoice.entityCode,
    invoiceId: invoice.id,
    amountPaid: input.amountPaid,
    commissionAmount: invoice.commissionAmount,
    paidAt: input.paidAt,
  });

  const lines: JeLine[] = [...cashLines, ...waterfall.commissionJeLines];
  assertBalanced(lines);

  const newPaid = invoice.amountPaid + input.amountPaid;
  const status =
    newPaid >= invoice.amount - 0.001
      ? 'Paid'
      : newPaid > 0
        ? 'Partially Paid'
        : invoice.status;

  const journal: JournalEntry = {
    id: `JE-PAID-${invoice.id}`,
    entityCode: invoice.entityCode,
    date: input.paidAt.slice(0, 10),
    period: input.paidAt.slice(0, 7),
    sourceModule: 'AR',
    sourceId: invoice.id,
    memo: `Invoice ${invoice.number} paid`,
    lines,
    status: 'posted',
  };

  return {
    invoice: { ...invoice, amountPaid: newPaid, status },
    deposit,
    journal,
    allocationLedger: waterfall.allocationLedger,
    residualProfit: waterfall.residualProfit,
    osCallback: {
      event: 'invoice.paid',
      invoiceId: invoice.id,
      entityCode: invoice.entityCode,
      amountPaid: input.amountPaid,
    },
    forecastTouch: {
      entityCode: invoice.entityCode,
      amount: input.amountPaid,
      bucketsUpdated: waterfall.allocationLedger.length,
    },
  };
}

function assertBalanced(lines: JeLine[]): void {
  const debits = lines.reduce((s, l) => s + l.debit, 0);
  const credits = lines.reduce((s, l) => s + l.credit, 0);
  if (Math.abs(debits - credits) > 0.02) {
    throw new Error(`Unbalanced JE: Dr ${debits} ≠ Cr ${credits}`);
  }
}
