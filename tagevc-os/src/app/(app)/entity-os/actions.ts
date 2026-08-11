'use server';

import { revalidatePath } from 'next/cache';
import { logActivity } from '@/lib/data/activity';
import { LIVE_LOOK_BLOCK_MESSAGE, readLiveLookCookie } from '@/lib/live-look/cookie';
import {
  canSwitchEntityOs,
  entityOsLabel,
  FIRM_OS_ENTITY_ID,
  parseEntityOsId,
} from '@/lib/rbac/entity-os';
import {
  applyEntityOsSelection,
  clearEntityOsCookie,
} from '@/lib/rbac/entity-os-cookie';
import { readImpersonationCookie } from '@/lib/rbac/impersonation';
import { getRealProfile } from '@/lib/rbac/session';

export type EntityOsResult =
  | { ok: true; entityId: string | null; label: string; message: string }
  | { ok: false; error: string };

const NOT_ALLOWED =
  'Only a firm-wide Visionary can switch entity operating systems';

async function requireEntityOsSwitcher() {
  const real = await getRealProfile();
  if (!real) return { ok: false as const, error: 'Not signed in' };
  const [impersonatingAs, liveLookId] = await Promise.all([
    readImpersonationCookie(),
    readLiveLookCookie(),
  ]);
  if (liveLookId) {
    return { ok: false as const, error: LIVE_LOOK_BLOCK_MESSAGE };
  }
  if (
    !canSwitchEntityOs({
      realRole: real.role,
      impersonatingAs,
      liveLookActive: false,
    })
  ) {
    return { ok: false as const, error: NOT_ALLOWED };
  }
  return { ok: true as const, profile: real };
}

/** Enter a subsidiary OS, or pass ENT-FIRM to return to the parent OS. */
export async function switchEntityOsAction(
  entityId: string,
): Promise<EntityOsResult> {
  const gate = await requireEntityOsSwitcher();
  if (!gate.ok) return gate;

  const target = parseEntityOsId(entityId);
  if (!target && entityId !== FIRM_OS_ENTITY_ID) {
    return { ok: false, error: 'Unknown entity operating system' };
  }

  const applied = await applyEntityOsSelection(entityId);
  const label = entityOsLabel(applied ?? FIRM_OS_ENTITY_ID);

  void logActivity({
    module: 'auth',
    action: applied ? 'entity_os_enter' : 'entity_os_exit',
    title: applied ? `Working in ${label} OS` : `Returned to ${label} OS`,
    detail: `Visionary ${gate.profile.email} switched entity operating system`,
    ref_type: 'entity',
    ref_id: applied ?? FIRM_OS_ENTITY_ID,
  });

  revalidatePath('/', 'layout');
  return {
    ok: true,
    entityId: applied,
    label,
    message: applied ? `Now working in ${label}` : `Back to ${label}`,
  };
}

/** Leave the subsidiary OS and return to the firm-wide parent OS. */
export async function exitEntityOsAction(): Promise<EntityOsResult> {
  const gate = await requireEntityOsSwitcher();
  if (!gate.ok) {
    // Always release the lock even if the role changed — safe cleanup.
    await clearEntityOsCookie();
    revalidatePath('/', 'layout');
    return gate;
  }
  return switchEntityOsAction(FIRM_OS_ENTITY_ID);
}
