'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { upsertAiOrgSettings } from '@/lib/ai/settings';
import { guardPermission } from '@/lib/rbac/session';

export type AdminAiActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function saveOrgAiSettingsAction(
  formData: FormData,
): Promise<AdminAiActionResult> {
  const gated = await guardPermission('admin:users');
  if (!gated.ok) return { ok: false, error: gated.error };

  const entityId =
    String(formData.get('entityId') ?? '').trim() ||
    gated.profile.entity_id ||
    'ENT-FIRM';

  const parsed = z
    .object({
      defaultProvider: z.enum(['grok', 'claude']),
      claudeFeatureEnabled: z.string().optional(),
    })
    .safeParse({
      defaultProvider: formData.get('defaultProvider'),
      claudeFeatureEnabled: formData.get('claudeFeatureEnabled') ?? undefined,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid.' };
  }

  const result = await upsertAiOrgSettings({
    entityId,
    defaultProvider: parsed.data.defaultProvider,
    claudeFeatureEnabled: parsed.data.claudeFeatureEnabled === '1',
    updatedBy: gated.profile.id,
  });
  if (!result.ok) return result;

  revalidatePath('/admin/ai');
  revalidatePath('/settings/ai');
  return { ok: true, message: 'Org AI defaults saved.' };
}

export async function saveOrgAiSettingsFormAction(
  formData: FormData,
): Promise<void> {
  await saveOrgAiSettingsAction(formData);
}
