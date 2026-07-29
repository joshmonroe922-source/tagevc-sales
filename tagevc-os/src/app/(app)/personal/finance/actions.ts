'use server';

import { revalidatePath } from 'next/cache';
import {
  applyPlaidAccountMaps,
  completePlaidLink,
  startPersonalBankConnect,
  syncPlaidBankFeed,
} from '@/lib/af';
import { requirePersonalVisionary } from '@/lib/personal/access';

export async function actionConnectPersonalBank(bankAccountId: string) {
  await requirePersonalVisionary();
  const result = await startPersonalBankConnect({
    bankAccountId,
    actorLabel: 'josh',
  });
  revalidatePath('/personal/finance/accounts/connect');
  revalidatePath('/personal/finance/accounts');
  return result;
}

export async function actionCompletePersonalPlaidLink(input: {
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
  await requirePersonalVisionary();
  const result = await completePlaidLink(input);
  revalidatePath('/personal/finance/accounts/connect');
  revalidatePath('/personal/finance/accounts');
  return result;
}

export async function actionApplyPersonalPlaidMaps(input: {
  sourceBankAccountId: string;
  institutionName?: string | null;
  mappings: Array<{ plaidAccountId: string; bankAccountId: string }>;
}) {
  await requirePersonalVisionary();
  const result = await applyPlaidAccountMaps(input);
  revalidatePath('/personal/finance/accounts/connect');
  revalidatePath('/personal/finance/accounts');
  revalidatePath('/personal/finance');
  return result;
}

export async function actionSyncPersonalBank(bankAccountId: string) {
  await requirePersonalVisionary();
  const result = await syncPlaidBankFeed(bankAccountId);
  revalidatePath('/personal/finance/accounts');
  revalidatePath('/personal/finance');
  return result;
}
