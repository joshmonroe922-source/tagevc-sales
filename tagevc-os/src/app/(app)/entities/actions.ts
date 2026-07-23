'use server';

import { revalidatePath } from 'next/cache';
import {
  PHASE53_RECRUIT_ENTITY_ID,
  refreshSubsidiaryRollupPhase53,
} from '@/lib/data/subsidiary-rollup-phase53';
import { canAccessEntityId } from '@/lib/rbac/entity-scope';
import { getSessionContext } from '@/lib/rbac/session';

export async function refreshSubsidiaryRollupPhase53Action(
  entityId: string = PHASE53_RECRUIT_ENTITY_ID,
) {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };

  if (
    !canAccessEntityId(
      ctx.profile.role,
      ctx.profile.entity_id,
      entityId,
    )
  ) {
    return {
      ok: false as const,
      error: `You do not have access to entity ${entityId}`,
    };
  }

  if (entityId !== PHASE53_RECRUIT_ENTITY_ID) {
    return {
      ok: false as const,
      error: 'Phase 53 subsidiary rollup currently supports ENT-R619 only',
    };
  }

  const result = await refreshSubsidiaryRollupPhase53({
    actorId: ctx.profile.id,
    entityId,
  });

  revalidatePath('/entities');
  revalidatePath(`/entities/${entityId}`);

  return result;
}
