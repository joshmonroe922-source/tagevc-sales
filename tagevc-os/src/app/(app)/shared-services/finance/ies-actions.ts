'use server';

import { revalidatePath } from 'next/cache';
import { resolveIesCompanyByEntity } from '@/lib/ies/company-map';
import { mapEntityToRealm } from '@/lib/ies/report';
import { runIesSync } from '@/lib/ies/sync';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';

export async function runIesSyncAction(input?: { entityId?: string | null }) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const result = await runIesSync({
    trigger: 'manual',
    entity_id: input?.entityId ?? null,
  });
  revalidatePath('/shared-services/finance');
  return result;
}

/** Map OS company → locked IES company by display name / entity; never takes raw realm IDs from the UI. */
export async function mapIesEntityAction(input: { entityId: string }) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const mapped = resolveIesCompanyByEntity(input.entityId.trim());
  if (!mapped) {
    return { ok: false as const, error: 'Unknown company' };
  }
  const session = await getSessionContext();
  const result = await mapEntityToRealm({
    entity_id: mapped.entity_id,
    realm_id: mapped.ies_company_id,
    ies_company_name: mapped.ies_company_name,
    actor_id: session?.profile.id ?? null,
  });
  revalidatePath('/shared-services/finance');
  return result.ok
    ? { ok: true as const, displayName: mapped.display_name }
    : result;
}
