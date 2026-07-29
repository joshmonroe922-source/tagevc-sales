'use server';

import { revalidatePath } from 'next/cache';
import { generateCsuiteBriefing } from '@/lib/ai-csuite/briefing';
import {
  proposeCsuiteAction,
  sendCsuiteMessage,
  transitionCsuiteAction,
} from '@/lib/ai-csuite/service';
import type { AiCsuiteNavRole } from '@/lib/ai-csuite/roles';
import type { CsuiteActionStatus, CsuiteActionType } from '@/lib/ai-csuite/actions';
import { getSessionContext } from '@/lib/rbac/session';
import { isVisionaryBreadthRole } from '@/lib/types/roles';

async function assertVisionaryBreadth() {
  const ctx = await getSessionContext();
  if (!ctx || !isVisionaryBreadthRole(ctx.profile.role)) {
    throw new Error('C-Suite is Visionary / Think Tank only');
  }
  if (ctx.liveLookActive) {
    throw new Error('C-Suite is hidden during Live Look');
  }
  return ctx;
}

export async function sendCsuiteMessageAction(formData: FormData) {
  await assertVisionaryBreadth();
  const role = String(formData.get('role') ?? 'hq') as AiCsuiteNavRole;
  const content = String(formData.get('content') ?? '').trim();
  if (!content) return { error: 'Message required' };
  try {
    const result = await sendCsuiteMessage({ role, content });
    revalidatePath('/c-suite');
    revalidatePath(`/c-suite/${role === 'hq' ? '' : role}`);
    return result;
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Send failed' };
  }
}

export async function proposeCsuiteActionAction(formData: FormData) {
  await assertVisionaryBreadth();
  const role = String(formData.get('role') ?? 'hq') as AiCsuiteNavRole;
  const actionType = String(
    formData.get('action_type') ?? 'ticket',
  ) as CsuiteActionType;
  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  if (!title) return { error: 'Title required' };
  try {
    const { id } = await proposeCsuiteAction({
      role,
      actionType,
      title,
      body,
    });
    revalidatePath('/c-suite');
    return { id };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Propose failed' };
  }
}

export async function transitionCsuiteActionAction(formData: FormData) {
  await assertVisionaryBreadth();
  const actionId = String(formData.get('action_id') ?? '');
  const to = String(formData.get('to') ?? '') as CsuiteActionStatus;
  try {
    await transitionCsuiteAction({ actionId, to });
    revalidatePath('/c-suite');
    return { ok: true };
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Transition failed' };
  }
}

export async function refreshCsuiteBriefingAction(role: AiCsuiteNavRole) {
  await assertVisionaryBreadth();
  try {
    const briefing = await generateCsuiteBriefing({
      role,
      forceRefresh: true,
    });
    revalidatePath('/c-suite');
    if (role !== 'hq') revalidatePath(`/c-suite/${role}`);
    return { ok: true as const, briefing };
  } catch (e) {
    return {
      ok: false as const,
      error: e instanceof Error ? e.message : 'Briefing refresh failed',
    };
  }
}
