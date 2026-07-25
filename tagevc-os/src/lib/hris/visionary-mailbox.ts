/**
 * HRIS assist: Visionary mailbox FullAccess for onboarding step
 * bs.visionary_mailbox_access
 */

import { grantVisionaryMailboxFullAccess } from '@/lib/shared-services/it-mdm';
import { writeAuditEvent } from '@/lib/audit/write';

export const VISIONARY_MAILBOX_STEP_KEY = 'bs.visionary_mailbox_access';

export async function runVisionaryMailboxAssist(input: {
  employeeEmail?: string | null;
  employeeUserId?: string | null;
  entityId?: string | null;
}): Promise<{
  ok: boolean;
  skipped?: boolean;
  pending?: boolean;
  detail: string;
}> {
  const result = await grantVisionaryMailboxFullAccess({
    user_id: input.employeeUserId || undefined,
    email: input.employeeEmail,
  });

  await writeAuditEvent({
    action: 'hris_action',
    title: 'Visionary mailbox FullAccess assist',
    object_type: 'mailbox',
    object_id: input.employeeEmail || input.employeeUserId || null,
    entity_id: input.entityId ?? null,
    metadata: {
      step_key: VISIONARY_MAILBOX_STEP_KEY,
      ok: result.ok,
      skipped: result.skipped ?? false,
      pending: result.pending ?? false,
      detail: result.detail,
    },
  });

  return {
    ok: result.ok,
    skipped: result.skipped,
    pending: result.pending,
    detail: result.detail,
  };
}
