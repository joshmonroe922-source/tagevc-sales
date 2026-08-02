'use server';

import { revalidatePath } from 'next/cache';
import {
  createAccount,
  createContact,
  patchContactAsUser,
  setOrgEdgeStatus,
  suggestHierarchyForAccount,
} from '@/lib/spine/db/crud';
import { getSessionContext } from '@/lib/rbac/session';

export async function actionCreateAccount(formData: FormData) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await createAccount({
    name: String(formData.get('name') || ''),
    domain: String(formData.get('domain') || '') || null,
    website: String(formData.get('website') || '') || null,
    orgSlug: String(formData.get('org_slug') || 'tage'),
  });
  revalidatePath('/shared-services/crm');
  return result;
}

export async function actionCreateContact(formData: FormData) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await createContact({
    fullName: String(formData.get('full_name') || ''),
    email: String(formData.get('email') || '') || null,
    title: String(formData.get('title') || '') || null,
    accountId: String(formData.get('account_id') || '') || null,
  });
  revalidatePath('/shared-services/crm');
  if (result.ok) {
    revalidatePath(`/shared-services/crm/contacts/${result.contactId}`);
  }
  return result;
}

export async function actionPatchContact(
  contactId: string,
  fields: Record<string, string | null>,
) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await patchContactAsUser({
    contactId,
    fields,
    userProfileId: null,
  });
  revalidatePath(`/shared-services/crm/contacts/${contactId}`);
  return result;
}

export async function actionOrgEdgeDecision(
  edgeId: string,
  status: 'confirmed' | 'rejected',
  accountId: string,
) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await setOrgEdgeStatus({ edgeId, status });
  revalidatePath(`/shared-services/crm/accounts/${accountId}`);
  return result;
}

export async function actionSuggestHierarchy(accountId: string) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Unauthorized' };
  const result = await suggestHierarchyForAccount(accountId);
  revalidatePath(`/shared-services/crm/accounts/${accountId}`);
  return result;
}
