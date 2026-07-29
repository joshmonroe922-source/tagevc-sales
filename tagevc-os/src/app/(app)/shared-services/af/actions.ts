'use server';

import { revalidatePath } from 'next/cache';
import {
  autoMatchFeeds,
  completeSetupStep,
  payBill,
  payInvoice,
  runIcMgmtFeePeriod,
  startBankConnect,
  runTestImport,
  completePlaidLink,
  applyPlaidAccountMaps,
  uploadAfAttachment,
} from '@/lib/af';
import type { EntityCode } from '@/lib/af';
import { AF_BANKS } from '@/lib/af';

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

export async function actionRunIcFees(period?: string) {
  const result = runIcMgmtFeePeriod(period);
  revalidatePath('/shared-services/af/accounting/ic');
  return result;
}

export async function actionConnectBank(bankAccountId: string) {
  const result = await startBankConnect({ bankAccountId, actorLabel: 'josh' });
  revalidatePath('/shared-services/af/setup/banks/connect');
  return result;
}

export async function actionCompletePlaidLink(input: {
  bankAccountId: string;
  publicToken: string;
  institutionName?: string | null;
  accounts?: Array<{
    id?: string;
    name?: string;
    mask?: string;
    type?: string;
    subtype?: string;
  }>;
}) {
  const result = await completePlaidLink(input);
  revalidatePath('/shared-services/af/setup/banks/connect');
  revalidatePath('/shared-services/af/setup');
  return result;
}

export async function actionApplyPlaidAccountMaps(input: {
  sourceBankAccountId: string;
  institutionName?: string | null;
  mappings: Array<{ plaidAccountId: string; bankAccountId: string }>;
}) {
  const result = await applyPlaidAccountMaps(input);
  if (result.ok) {
    for (const conn of result.connected) {
      completeSetupStep(conn.entityCode as EntityCode, 'ENT-03');
    }
  }
  revalidatePath('/shared-services/af/setup/banks/connect');
  revalidatePath('/shared-services/af/setup');
  return result;
}

export async function actionTestBankImport(bankAccountId: string) {
  const bank = AF_BANKS.find((b) => b.id === bankAccountId);
  const result = await runTestImport(bankAccountId);
  if (bank && result.ok) {
    completeSetupStep(bank.entityCode, 'ENT-03');
  }
  revalidatePath('/shared-services/af');
  revalidatePath('/shared-services/af/accounting/banks');
  revalidatePath('/shared-services/af/setup/banks/connect');
  return result;
}

export async function actionSyncAllLiveFeeds() {
  const { syncAllConnectedCompanyFeeds } = await import('@/lib/af');
  const result = await syncAllConnectedCompanyFeeds();
  revalidatePath('/shared-services/af');
  revalidatePath('/shared-services/af/accounting/banks');
  revalidatePath('/shared-services/af/finance');
  return result;
}

export async function actionUploadAttachment(formData: FormData) {
  const file = formData.get('file');
  const entityCode = String(formData.get('entityCode') ?? '') as EntityCode;
  const documentType = String(formData.get('documentType') ?? 'Other');
  const displayName = String(formData.get('displayName') ?? 'Upload');
  const attachmentDefaultId = formData.get('attachmentDefaultId');

  if (!(file instanceof File)) {
    return { ok: false as const, error: 'No file' };
  }
  if (!entityCode) {
    return { ok: false as const, error: 'entityCode required' };
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const result = await uploadAfAttachment({
    entityCode,
    documentType,
    displayName: displayName || file.name,
    fileName: file.name,
    mimeType: file.type || 'application/pdf',
    bytes,
    attachmentDefaultId:
      typeof attachmentDefaultId === 'string' ? attachmentDefaultId : null,
  });

  if (result.file && (documentType === 'Wiring' || documentType === 'I-9')) {
    completeSetupStep(entityCode, 'ENT-06');
  }

  revalidatePath('/shared-services/af/accounting/settings/invoice-attachments');
  revalidatePath('/shared-services/af/setup');
  return result.file
    ? { ok: true as const, file: result.file }
    : { ok: false as const, error: result.error ?? 'Upload failed' };
}
