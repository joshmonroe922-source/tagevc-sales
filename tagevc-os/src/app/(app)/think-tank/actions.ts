'use server';

import { collectTageThinkTankContext } from '@/lib/think-tank/context';
import {
  getOrCreateThinkTankConversation,
  listThinkTankMessages,
  sendThinkTankMessage,
  startNewThinkTankThread,
  type ThinkTankMessageDto,
} from '@/lib/think-tank/service';
import { thinkTankRoleBand } from '@/lib/think-tank/prompts';
import { getSessionContext } from '@/lib/rbac/session';
import { APP_ROLE_LABELS } from '@/lib/types/roles';

export async function loadThinkTank(): Promise<{
  conversationId: string;
  roleBand: string;
  messages: ThinkTankMessageDto[];
  viewAsLabel: string | null;
}> {
  const session = await getSessionContext();
  if (!session) throw new Error('Unauthorized');

  const entityId = session.profile.entity_id ?? 'ENT-FIRM';
  const conv = await getOrCreateThinkTankConversation({
    profileId: session.profile.id,
    entityId,
    role: session.realRole,
  });
  const messages = await listThinkTankMessages(conv.id);
  return {
    conversationId: conv.id,
    roleBand: thinkTankRoleBand(session.realRole),
    messages: messages.filter((m) => m.role !== 'system'),
    viewAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
  };
}

export async function sendThinkTankChat(message: string): Promise<
  | {
      userMessage: ThinkTankMessageDto;
      assistantMessage: ThinkTankMessageDto;
      model: string | null;
    }
  | { error: string }
> {
  const session = await getSessionContext();
  if (!session) return { error: 'Unauthorized' };

  const context = await collectTageThinkTankContext(session);
  const entityId = session.profile.entity_id ?? 'ENT-FIRM';

  return sendThinkTankMessage({
    profileId: session.profile.id,
    entityId,
    email: session.profile.email,
    name: session.profile.full_name,
    role: session.realRole,
    message,
    context,
    impersonatingAsLabel: session.impersonatingAs
      ? APP_ROLE_LABELS[session.impersonatingAs]
      : null,
  });
}

export async function resetThinkTankThread(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const session = await getSessionContext();
  if (!session) return { ok: false, error: 'Unauthorized' };
  return startNewThinkTankThread({
    profileId: session.profile.id,
    entityId: session.profile.entity_id ?? 'ENT-FIRM',
    role: session.realRole,
  });
}
