'use server';

import { revalidatePath } from 'next/cache';
import {
  autoMatchFeeds,
  completeSetupStep,
  payBill,
  payInvoice,
} from '@/lib/af';
import type { EntityCode } from '@/lib/af';

export async function actionPayInvoice(invoiceId: string) {
  const result = payInvoice(invoiceId);
  revalidatePath('/shared-services/af');
  return {
    ok: true as const,
    status: result.invoice.status,
    buckets: result.allocationLedger.length,
    commissionPosted: result.journal.lines.some((l) => l.account === '2250'),
  };
}

export async function actionPayBill(billId: string) {
  const result = payBill(billId);
  autoMatchFeeds();
  revalidatePath('/shared-services/af');
  return {
    ok: true as const,
    status: result.bill.status,
    paymentId: result.payment.id,
    feedMatched: true,
  };
}

export async function actionCompleteSetupStep(
  entityCode: EntityCode | 'ORG',
  stepId: string,
) {
  completeSetupStep(entityCode, stepId);
  revalidatePath('/shared-services/af/setup');
  return { ok: true as const };
}

export async function actionMatchFeeds() {
  const n = autoMatchFeeds();
  revalidatePath('/shared-services/af/accounting/banks');
  return { matched: n };
}
