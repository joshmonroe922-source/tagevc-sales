'use server';

import { collectTageThinkTankContext } from '@/lib/think-tank/context';
import {
  createTageThinkTankThread,
  loadTageThinkTankDesk,
  removeTageThinkTankAttachment,
  renameTageThinkTankThread,
  sendTageThinkTankMessage,
  uploadTageThinkTankAttachment,
  type ThinkTankAttachmentDto,
  type ThinkTankDeskState,
  type ThinkTankSendResult,
  type ThinkTankThreadDto,
} from '@/lib/think-tank/service';
import { getSessionContext } from '@/lib/rbac/session';
import { APP_ROLE_LABELS } from '@/lib/types/roles';

function sessionScope() {
  return getSessionContext();
}

export async function loadThinkTankDeskAction(
  conversationId?: string | null,
): Promise<ThinkTankDeskState> {
  const session = await sessionScope();
  if (!session) throw new Error('Unauthorized');
  return loadTageThinkTankDesk({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    role: session.realRole,
    viewAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
    conversationId,
  });
}

/** @deprecated use loadThinkTankDeskAction — kept for older wrappers. */
export async function loadThinkTank() {
  return loadThinkTankDeskAction();
}

export async function sendThinkTankChat(
  conversationId: string | null,
  message: string,
): Promise<ThinkTankSendResult> {
  const session = await sessionScope();
  if (!session) return { error: 'Unauthorized' };

  const context = await collectTageThinkTankContext(session);
  return sendTageThinkTankMessage({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    name: session.profile.full_name,
    role: session.realRole,
    message,
    conversationId,
    context,
    impersonatingAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
  });
}

export async function createThinkTankThreadAction(
  title?: string,
): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const session = await sessionScope();
  if (!session) return { error: 'Unauthorized' };
  return createTageThinkTankThread({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    role: session.realRole,
    title,
  });
}

export async function renameThinkTankThreadAction(
  conversationId: string,
  title: string,
): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const session = await sessionScope();
  if (!session) return { error: 'Unauthorized' };
  return renameTageThinkTankThread({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    conversationId,
    title,
  });
}

export async function uploadThinkTankAttachmentAction(
  formData: FormData,
): Promise<
  | { conversationId: string; attachment: ThinkTankAttachmentDto }
  | { error: string }
> {
  const session = await sessionScope();
  if (!session) return { error: 'Unauthorized' };
  const file = formData.get('file');
  if (!(file instanceof File)) return { error: 'File is required.' };
  const conversationId = String(formData.get('conversationId') ?? '').trim() || null;
  return uploadTageThinkTankAttachment({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    role: session.realRole,
    conversationId,
    file,
  });
}

export async function removeThinkTankAttachmentAction(
  attachmentId: string,
): Promise<{ ok: true } | { error: string }> {
  const session = await sessionScope();
  if (!session) return { error: 'Unauthorized' };
  return removeTageThinkTankAttachment({
    profileId: session.profile.id,
    activeEntityOs: session.activeEntityOs,
    profileEntityId: session.profile.entity_id,
    attachmentId,
  });
}

/** @deprecated New thread no longer wipes history — use createThinkTankThreadAction. */
export async function resetThinkTankThread() {
  return createThinkTankThreadAction();
}
