'use server';

import { revalidatePath } from 'next/cache';
import {
  executeDemoCleanup,
  inventoryDemoData,
  type DemoDomain,
} from '@/lib/admin/demo-data-cleanup';
import { getSessionContext, guardPermission } from '@/lib/rbac/session';

export async function inventoryDemoDataAction() {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const inv = await inventoryDemoData();
  return { ok: true as const, inventory: inv };
}

export async function executeDemoCleanupAction(input: {
  domains: DemoDomain[];
  confirm_phrase: string;
  dry_run: boolean;
}) {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return { ok: false as const, error: gate.error };
  const session = await getSessionContext();
  const result = await executeDemoCleanup({
    ...input,
    actor_email: session?.profile.email ?? null,
  });
  revalidatePath('/settings/data-cleanup');
  return result;
}
