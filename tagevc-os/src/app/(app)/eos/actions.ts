'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import {
  completeEosTodo,
  createEosIssue,
  createEosRock,
  createEosTodo,
  updateEosIssueStatus,
  updateEosRockStatus,
  upsertEosScorecardActual,
  upsertEosVto,
} from '@/lib/eos/dashboard';
import { getSessionContext } from '@/lib/rbac/session';

function revalidateEos() {
  revalidatePath('/eos');
  revalidatePath('/shared-services/hr');
}

export async function createRockAction(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const parsed = z
    .object({
      entity_id: z.string().trim().min(1),
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().max(2000).optional(),
    })
    .safeParse({
      entity_id: formData.get('entity_id'),
      title: formData.get('title'),
      detail: formData.get('detail') || undefined,
    });
  if (!parsed.success) return;
  await createEosRock({
    entityId: parsed.data.entity_id,
    profileId: session.profile.id,
    title: parsed.data.title,
    detail: parsed.data.detail,
    sourcePortal: 'tage',
  });
  revalidateEos();
}

export async function createIssueAction(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const parsed = z
    .object({
      entity_id: z.string().trim().min(1),
      title: z.string().trim().min(1).max(200),
      detail: z.string().trim().max(2000).optional(),
      priority: z.enum(['low', 'medium', 'high']).optional(),
    })
    .safeParse({
      entity_id: formData.get('entity_id'),
      title: formData.get('title'),
      detail: formData.get('detail') || undefined,
      priority: formData.get('priority') || undefined,
    });
  if (!parsed.success) return;
  await createEosIssue({
    entityId: parsed.data.entity_id,
    profileId: session.profile.id,
    title: parsed.data.title,
    detail: parsed.data.detail,
    priority: parsed.data.priority,
    sourcePortal: 'tage',
  });
  revalidateEos();
}

export async function createTodoAction(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  if (!entityId || !title) return;
  await createEosTodo({
    entityId,
    profileId: session.profile.id,
    title,
    sourcePortal: 'tage',
  });
  revalidateEos();
}

export async function completeTodoAction(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const id = String(formData.get('todo_id') ?? '');
  if (!id) return;
  await completeEosTodo(id);
  revalidateEos();
}

export async function updateRockStatusAction(
  formData: FormData,
): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !status) return;
  await updateEosRockStatus(id, status);
  revalidateEos();
}

export async function updateIssueStatusAction(
  formData: FormData,
): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const id = String(formData.get('id') ?? '');
  const status = String(formData.get('status') ?? '');
  if (!id || !status) return;
  await updateEosIssueStatus(id, status);
  revalidateEos();
}

export async function saveVtoAction(formData: FormData): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const entityId = String(formData.get('entity_id') ?? '').trim();
  if (!entityId) return;
  await upsertEosVto({
    entityId,
    profileId: session.profile.id,
    core_values: String(formData.get('core_values') ?? ''),
    core_focus: String(formData.get('core_focus') ?? ''),
    ten_year_target: String(formData.get('ten_year_target') ?? ''),
    three_year_picture: String(formData.get('three_year_picture') ?? ''),
    one_year_plan: String(formData.get('one_year_plan') ?? ''),
    marketing_strategy: String(formData.get('marketing_strategy') ?? ''),
    issues_list_notes: String(formData.get('issues_list_notes') ?? ''),
    sourcePortal: 'tage',
  });
  revalidateEos();
}

export async function saveScorecardActualAction(
  formData: FormData,
): Promise<void> {
  const session = await getSessionContext();
  if (!session) return;
  const entityId = String(formData.get('entity_id') ?? '').trim();
  const metricKey = String(formData.get('metric_key') ?? '').trim();
  const actualRaw = String(formData.get('actual') ?? '').trim();
  const goalRaw = String(formData.get('goal') ?? '').trim();
  if (!entityId || !metricKey || actualRaw === '') return;
  const actual = Number(actualRaw);
  if (Number.isNaN(actual)) return;
  await upsertEosScorecardActual({
    entityId,
    metricKey,
    actual,
    goal: goalRaw === '' ? null : Number(goalRaw),
    profileId: session.profile.id,
    sourcePortal: 'tage',
  });
  revalidateEos();
}
