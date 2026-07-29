'use server';

import { revalidatePath } from 'next/cache';
import { resolveIesCompanyByEntity } from '@/lib/ies/company-map';
import { mapEntityToRealm } from '@/lib/ies/report';
import { runIesSync } from '@/lib/ies/sync';
import {
  canManageIesConnections,
  canRefreshIesSnapshots,
} from '@/lib/ies/ux';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';

function revalidateIesSurfaces() {
  revalidatePath('/shared-services/finance');
  revalidatePath('/shared-services');
  revalidatePath('/dashboard');
  revalidatePath('/command-center');
  revalidatePath('/entities');
  revalidatePath('/firm');
}

/**
 * Global IES refresh — syncs ALL connected/mapped companies.
 * Prefer this from UI Refresh buttons to avoid per-table sync spam.
 */
export async function runIesGlobalSyncAction() {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  if (!canRefreshIesSnapshots(session.profile.role)) {
    return { ok: false as const, error: 'Forbidden' };
  }
  const result = await runIesSync({
    trigger: 'manual',
    entity_id: null,
  });
  revalidateIesSurfaces();
  return result;
}

/** @deprecated Prefer runIesGlobalSyncAction — entity filter reserved for ops. */
export async function runIesSyncAction(input?: { entityId?: string | null }) {
  const session = await getSessionContext();
  if (!session) return { ok: false as const, error: 'Not signed in' };
  // Legacy callers used write:shared_services; allow refresh-capable roles too.
  if (
    !canRefreshIesSnapshots(session.profile.role) &&
    !canManageIesConnections(session.profile.role)
  ) {
    return { ok: false as const, error: 'Forbidden' };
  }
  // Always pull the full connected set (product decision: one global sync).
  void input?.entityId;
  const result = await runIesSync({
    trigger: 'manual',
    entity_id: null,
  });
  revalidateIesSurfaces();
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
  revalidateIesSurfaces();
  return result.ok
    ? { ok: true as const, displayName: mapped.display_name }
    : result;
}
