'use server';

import { revalidatePath } from 'next/cache';
import {
  updateAuditItem,
  updateChecklistTask,
} from '@/lib/shared-services/ssc-checklist/engine';
import type { SscTaskStatus } from '@/lib/shared-services/ssc-checklist/types';
import { guardPermission } from '@/lib/rbac/session';

function revalidateSsc() {
  revalidatePath('/shared-services/checklists');
  revalidatePath('/shared-services/audits');
  revalidatePath('/shared-services');
  revalidatePath('/shared-services/finance');
  revalidatePath('/shared-services/hr');
  revalidatePath('/shared-services/marketing');
  revalidatePath('/shared-services/it/assets');
  revalidatePath('/shared-services/legal/docusign');
}

export async function updateSscChecklistTaskAction(input: {
  task_id: string;
  status?: SscTaskStatus;
  evidence_note?: string | null;
  evidence_ticket_id?: string | null;
  evidence_url?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const result = await updateChecklistTask({
    ...input,
    actor_id: gate.profile.id,
  });
  revalidateSsc();
  return result;
}

export async function updateSscAuditItemAction(input: {
  item_id: string;
  status?: SscTaskStatus;
  evidence_note?: string | null;
  evidence_ticket_id?: string | null;
  evidence_url?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false, error: gate.error };
  const result = await updateAuditItem({
    ...input,
    actor_id: gate.profile.id,
  });
  revalidateSsc();
  return result;
}
