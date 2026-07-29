'use server';

import { revalidatePath } from 'next/cache';
import { listOrgProfiles, updateProfileOrgFields } from '@/lib/org/repo';
import { wouldCreateCycle } from '@/lib/org/tree';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';

export async function updateOrgProfileAction(input: {
  profileId: string;
  managerProfileId?: string | null;
  jobTitle?: string | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const gate = await guardPermission('admin:users');
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Sign in required' };

  // Allow SSC HR via shared_services write if admin:users fails
  if (!gate.ok) {
    const hr = await guardPermission('write:shared_services');
    if (!hr.ok) return { ok: false, error: gate.error };
  }

  if (input.managerProfileId) {
    const listed = await listOrgProfiles();
    if (
      wouldCreateCycle(
        listed.profiles,
        input.profileId,
        input.managerProfileId,
      )
    ) {
      return { ok: false, error: 'That reports-to link would create a cycle.' };
    }
  }

  const res = await updateProfileOrgFields({
    profileId: input.profileId,
    managerProfileId: input.managerProfileId,
    jobTitle: input.jobTitle,
    actorRole: session.profile.role,
  });
  if (!res.ok) return { ok: false, error: res.error ?? 'Update failed' };
  revalidatePath('/admin/org-chart');
  revalidatePath('/eos');
  revalidatePath('/messages');
  return { ok: true };
}
