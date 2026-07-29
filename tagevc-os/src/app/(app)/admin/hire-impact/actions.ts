'use server';

import { revalidatePath } from 'next/cache';
import {
  createHireScenario,
  upsertHireCostTemplate,
} from '@/lib/hire/repo';
import { canViewHireImpact } from '@/lib/org/tree';
import { getSessionContext } from '@/lib/rbac/session';

export async function updateHireTemplateAction(
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Sign in required' };
  if (!canViewHireImpact(session.profile.role)) {
    return { ok: false, error: 'Leadership only' };
  }
  const res = await upsertHireCostTemplate({
    entity_id: String(formData.get('entity_id') ?? ''),
    role_key: String(formData.get('role_key') ?? ''),
    title: String(formData.get('title') ?? ''),
    base_salary_annual: Number(formData.get('base_salary_annual') ?? 0),
    burden_pct: Number(formData.get('burden_pct') ?? 0.3),
    tools_annual: Number(formData.get('tools_annual') ?? 0),
    recruiting_one_time: Number(formData.get('recruiting_one_time') ?? 0),
    created_by: session.profile.id,
  });
  if (!res.ok) return { ok: false, error: res.error ?? 'Save failed' };
  revalidatePath('/admin/hire-impact');
  return { ok: true };
}

export async function createHireScenarioAction(input: {
  entityId: string;
  templateId: string;
  roleTitle: string;
  baseSalary: number;
  burdenPct: number;
  toolsAnnual: number;
  recruiting: number;
}): Promise<{ ok: true; id?: string } | { ok: false; error: string }> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Sign in required' };
  if (!canViewHireImpact(session.profile.role)) {
    return { ok: false, error: 'Leadership only' };
  }
  const start = new Date();
  const startMonth = `${start.getUTCFullYear()}-${String(start.getUTCMonth() + 1).padStart(2, '0')}-01`;
  const res = await createHireScenario({
    entity_id: input.entityId,
    title: `Hire · ${input.roleTitle}`,
    template_id: input.templateId,
    role_title: input.roleTitle,
    manager_profile_id: session.profile.id,
    start_month: startMonth,
    base_salary_annual: input.baseSalary,
    burden_pct: input.burdenPct,
    tools_annual: input.toolsAnnual,
    recruiting_one_time: input.recruiting,
    created_by: session.profile.id,
  });
  if (!res.ok) return { ok: false, error: res.error ?? 'Create failed' };
  revalidatePath('/admin/hire-impact');
  return { ok: true, id: res.id };
}
