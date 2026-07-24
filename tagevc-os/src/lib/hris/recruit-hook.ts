/** Recruit 619 additive assignment stub (no Recruit portal UI). */

import type { RecruitAssignment } from './types';

export const RECRUIT_PORTAL_HINT = 'https://portal.recruit619.com';

export function buildRecruitAssignment(
  entityId: string,
  existing?: RecruitAssignment | null,
): RecruitAssignment | null {
  if (entityId !== 'ENT-R619') return existing ?? null;
  return {
    portal_hint: RECRUIT_PORTAL_HINT,
    status: existing?.status ?? 'pending_link',
    linked_at: existing?.linked_at ?? null,
    entity_id: 'ENT-R619',
    note:
      existing?.note ??
      'Additive Recruit 619 assignment stub — link portal user when provisioned',
    recruit_user_id: existing?.recruit_user_id ?? null,
  };
}

export function recruitPeopleHref(
  assignment: RecruitAssignment | null | undefined,
): string | null {
  if (!assignment?.portal_hint) return null;
  if (assignment.recruit_user_id) {
    return `${assignment.portal_hint.replace(/\/$/, '')}/people/${assignment.recruit_user_id}`;
  }
  return assignment.portal_hint;
}
