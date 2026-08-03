'use server';

import { revalidatePath } from 'next/cache';
import { convertSalesPurchaseToClientOrg } from '@/lib/signent/client-orgs';
import { getSessionContext } from '@/lib/rbac/session';

export async function actionConvertSignentClient(input: {
  legalName: string;
  tradeName?: string;
  productKeys: string[];
  invoiceRef?: string | null;
  primaryContactEmail?: string | null;
  accountId?: string | null;
}) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await convertSalesPurchaseToClientOrg({
    ...input,
    salesOwnerProfileId: session.profile.id,
  });
  revalidatePath('/shared-services/signent/clients');
  if (result.ok) {
    revalidatePath(`/shared-services/signent/clients/${result.clientOrg.id}`);
  }
  return result;
}
