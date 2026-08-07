'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import {
  revokePersonasForUser,
  upsertTemplate,
} from '@/lib/digital-cards/repo';
import { defaultThemeForEntity } from '@/lib/digital-cards/theme';

function canAdmin(role: string | undefined): boolean {
  return [
    'visionary',
    'admin',
    'coo',
    'service_lead',
    'partner',
    'counsel_ops',
  ].includes(role || '');
}

export async function saveTemplateAction(input: {
  entity_id: string;
  cta_label: string;
  cta_url: string;
  company_main_line?: string;
  company_website?: string;
}) {
  const ctx = await getSessionContext();
  if (!canAdmin(ctx?.profile?.role)) {
    return { ok: false as const, error: 'Not allowed' };
  }
  const result = await upsertTemplate({
    entity_id: input.entity_id,
    default_cta: {
      label: input.cta_label.trim(),
      url: input.cta_url.trim(),
    },
    locked_theme: defaultThemeForEntity(input.entity_id),
    company_main_line: input.company_main_line?.trim() || null,
    company_website: input.company_website?.trim() || null,
  });
  revalidatePath('/admin/digital-cards');
  return result.ok
    ? { ok: true as const }
    : { ok: false as const, error: result.error };
}

export async function forceRevokeUserCardsAction(userProfileId: string) {
  const ctx = await getSessionContext();
  if (!canAdmin(ctx?.profile?.role)) {
    return { ok: false as const, error: 'Not allowed' };
  }
  const result = await revokePersonasForUser(userProfileId);
  revalidatePath('/admin/digital-cards');
  return result.ok
    ? { ok: true as const, count: result.count }
    : { ok: false as const, error: result.error };
}
