'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { isAiProviderId } from '@/lib/ai/resolve';
import { upsertAiUserPreferredProvider } from '@/lib/ai/settings';
import { getSessionContext } from '@/lib/rbac/session';

export type AiSettingsActionResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function saveUserAiPreferenceAction(
  formData: FormData,
): Promise<AiSettingsActionResult> {
  const ctx = await getSessionContext();
  if (!ctx?.profile?.id) return { ok: false, error: 'Not authenticated.' };
  if (ctx.liveLookActive) {
    return { ok: false, error: 'Live Look is read-only.' };
  }

  const raw = String(formData.get('preferredProvider') ?? 'inherit');
  let preferred: 'grok' | 'claude' | null = null;
  if (raw === 'inherit' || raw === '') {
    preferred = null;
  } else if (isAiProviderId(raw)) {
    preferred = raw;
  } else {
    return { ok: false, error: 'Invalid provider.' };
  }

  const parsed = z
    .object({
      preferredProvider: z.enum(['grok', 'claude']).nullable(),
    })
    .safeParse({ preferredProvider: preferred });
  if (!parsed.success) {
    return { ok: false, error: 'Invalid provider.' };
  }

  const result = await upsertAiUserPreferredProvider({
    userId: ctx.profile.id,
    preferredProvider: parsed.data.preferredProvider,
  });
  if (!result.ok) return result;

  revalidatePath('/settings/ai');
  revalidatePath('/think-tank');
  revalidatePath('/home');
  return { ok: true, message: 'AI preference saved.' };
}

export async function saveUserAiPreferenceFormAction(
  formData: FormData,
): Promise<void> {
  await saveUserAiPreferenceAction(formData);
}
