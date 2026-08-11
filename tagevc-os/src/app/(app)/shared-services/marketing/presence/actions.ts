'use server';

import { revalidatePath } from 'next/cache';
import { runAllPresenceImportsForEntity } from '@/lib/partners/presence-import';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext, requirePermission } from '@/lib/rbac/session';

export type PresenceActionResult =
  | { ok: true; message: string }
  | { ok: false; error: string };

export async function dryRunPresenceImportAction(
  formData: FormData,
): Promise<PresenceActionResult> {
  await requirePermission('write:marketing');
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false, error: 'Not signed in' };
  const firmWide = isFirmWideAccess(
    ctx.profile.role,
    ctx.profile.entity_id,
    ctx.activeEntityOs,
  );
  const entityId =
    String(formData.get('entity_id') || '').trim() ||
    (firmWide ? 'ENT-FIRM' : ctx.profile.entity_id);
  if (!entityId) return { ok: false, error: 'entity_id required' };

  const results = await runAllPresenceImportsForEntity(entityId);
  revalidatePath('/shared-services/marketing/presence');
  revalidatePath('/shared-services/bi');
  const okCount = results.filter((r) => r.ok).length;
  return {
    ok: true,
    message: `Presence import dry-run for ${entityId}: ${okCount}/${results.length} adapters ok`,
  };
}
