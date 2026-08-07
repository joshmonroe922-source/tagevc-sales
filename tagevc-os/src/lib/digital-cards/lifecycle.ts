/**
 * HRIS lifecycle: activate on hire, revoke on term.
 */

import type { HrisEmployee } from '@/lib/hris/types';
import { activatePersona, revokePersonasForUser } from './repo';
import { entityDisplayName } from '@/lib/entities/display-name';

export async function activateDigitalCardForEmployee(
  emp: HrisEmployee,
): Promise<{ ok: boolean; detail: string; public_id?: string }> {
  const profileId = emp.profile_id;
  if (!profileId) {
    return {
      ok: false,
      detail:
        'No linked portal profile yet — link profile_id on the HRIS employee, then re-run Activate digital card.',
    };
  }

  const result = await activatePersona({
    userProfileId: profileId,
    entityId: emp.entity_id,
    displayName: emp.full_name,
    title: emp.role_title || undefined,
    department: emp.department || undefined,
    workEmail: emp.work_email || emp.personal_email || undefined,
    setDefault: true,
  });

  if (!result.ok) {
    return { ok: false, detail: result.error };
  }

  return {
    ok: true,
    detail: result.created
      ? `Activated digital card · ${result.persona.public_id}`
      : `Refreshed digital card · ${result.persona.public_id}`,
    public_id: result.persona.public_id,
  };
}

export async function revokeDigitalCardsForEmployee(
  emp: HrisEmployee,
): Promise<{ ok: boolean; detail: string }> {
  const profileId = emp.profile_id;
  if (!profileId) {
    return {
      ok: true,
      detail: 'No portal profile — nothing to revoke',
    };
  }

  const company = entityDisplayName(emp.entity_id);
  const result = await revokePersonasForUser(
    profileId,
    `No longer with ${company}`,
  );
  if (!result.ok) return { ok: false, detail: result.error };
  return {
    ok: true,
    detail:
      result.count === 0
        ? 'No active personas to revoke'
        : `Revoked ${result.count} digital card persona(s)`,
  };
}
