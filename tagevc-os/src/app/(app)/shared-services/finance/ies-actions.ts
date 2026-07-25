'use server';

import { revalidatePath } from 'next/cache';
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

export async function mapIesEntityAction(input: {
  entityId: string;
  realmId: string;
  companyName?: string | null;
}) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const session = await getSessionContext();
  const result = await mapEntityToRealm({
    entity_id: input.entityId,
    realm_id: input.realmId,
    ies_company_name: input.companyName ?? null,
    actor_id: session?.profile.id ?? null,
  });
  revalidatePath('/shared-services/finance');
  return result;
}
