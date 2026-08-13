import { preferredChatCompletion } from '@/lib/ai/chat';
import { getAiOrgSettings, getAiUserPrefs } from '@/lib/ai/settings';
import { XAI_SETUP_NOTE } from '@/lib/think-tank/llm';
import {
  buildTageThinkTankSystemPrompt,
  thinkTankRoleBand,
} from '@/lib/think-tank/prompts';
import {
  removeThinkTankAttachment,
  uploadThinkTankAttachment,
} from '@/lib/platform/think-tank/attachments';
import { thinkTankEntityOs } from '@/lib/platform/think-tank/scope';
import {
  createThinkTankThread,
  loadThinkTankDesk,
  renameThinkTankThread,
  sendThinkTankTurn,
} from '@/lib/platform/think-tank/threads';
import type {
  ThinkTankAttachmentDto,
  ThinkTankDeskState,
  ThinkTankSendResult,
  ThinkTankThreadDto,
} from '@/lib/platform/think-tank/types';

export const TAGE_PORTAL_KEY = 'tage' as const;

export type {
  ThinkTankAttachmentDto,
  ThinkTankDeskState,
  ThinkTankMessageDto,
  ThinkTankSendResult,
  ThinkTankThreadDto,
} from '@/lib/platform/think-tank/types';

export function tageThinkTankScope(opts: {
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
}): { portalKey: typeof TAGE_PORTAL_KEY; entityOs: string; entityId: string } {
  const entityOs = thinkTankEntityOs({
    portalKey: TAGE_PORTAL_KEY,
    activeEntityOs: opts.activeEntityOs,
    profileEntityId: opts.profileEntityId,
  });
  return {
    portalKey: TAGE_PORTAL_KEY,
    entityOs,
    entityId: entityOs,
  };
}

export async function loadTageThinkTankDesk(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  role: string;
  viewAsLabel?: string | null;
  conversationId?: string | null;
}): Promise<ThinkTankDeskState> {
  const scope = tageThinkTankScope(opts);
  return loadThinkTankDesk({
    ...scope,
    profileId: opts.profileId,
    roleHint: thinkTankRoleBand(opts.role),
    viewAsLabel: opts.viewAsLabel ?? null,
    conversationId: opts.conversationId,
  });
}

export async function createTageThinkTankThread(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  role: string;
  title?: string;
}): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const scope = tageThinkTankScope(opts);
  return createThinkTankThread({
    ...scope,
    profileId: opts.profileId,
    roleHint: thinkTankRoleBand(opts.role),
    title: opts.title,
  });
}

export async function renameTageThinkTankThread(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  conversationId: string;
  title: string;
}): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const scope = tageThinkTankScope(opts);
  return renameThinkTankThread({
    ...scope,
    profileId: opts.profileId,
    conversationId: opts.conversationId,
    title: opts.title,
  });
}

export async function sendTageThinkTankMessage(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  name?: string | null;
  role: string;
  message: string;
  conversationId?: string | null;
  context: Record<string, unknown>;
  impersonatingAsLabel?: string | null;
}): Promise<ThinkTankSendResult> {
  const scope = tageThinkTankScope(opts);
  const roleHint = thinkTankRoleBand(opts.role);
  const [orgAi, userAi] = await Promise.all([
    getAiOrgSettings(scope.entityId),
    getAiUserPrefs(opts.profileId),
  ]);

  const result = await sendThinkTankTurn({
    ...scope,
    profileId: opts.profileId,
    roleHint,
    conversationId: opts.conversationId,
    message: opts.message,
    context: opts.context,
    buildSystemPrompt: () =>
      buildTageThinkTankSystemPrompt({
        roleBand: thinkTankRoleBand(opts.role),
        userName: opts.name,
        entityId: scope.entityId,
        contextJson: JSON.stringify(opts.context).slice(0, 6000),
        impersonatingAsLabel: opts.impersonatingAsLabel,
      }),
    completeChat: async (messages) => {
      const llm = await preferredChatCompletion({
        messages,
        temperature: 0.5,
        preference: {
          userPreferred: userAi.preferredProvider,
          orgDefault: orgAi.defaultProvider,
        },
      });
      if (!llm.content && !llm.error) {
        return { ...llm, error: XAI_SETUP_NOTE };
      }
      return llm;
    },
  });

  if (!('error' in result)) {
    console.info('[think-tank:tage]', {
      profileId: opts.profileId,
      conversationId: result.conversationId,
      entityOs: scope.entityOs,
      model: result.model,
    });
  }
  return result;
}

export async function uploadTageThinkTankAttachment(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  role: string;
  conversationId?: string | null;
  file: File;
}): Promise<
  | { conversationId: string; attachment: ThinkTankAttachmentDto }
  | { error: string }
> {
  const scope = tageThinkTankScope(opts);
  return uploadThinkTankAttachment({
    ...scope,
    profileId: opts.profileId,
    roleHint: thinkTankRoleBand(opts.role),
    conversationId: opts.conversationId,
    file: opts.file,
  });
}

export async function removeTageThinkTankAttachment(opts: {
  profileId: string;
  activeEntityOs?: string | null;
  profileEntityId?: string | null;
  attachmentId: string;
}): Promise<{ ok: true } | { error: string }> {
  const scope = tageThinkTankScope(opts);
  return removeThinkTankAttachment({
    ...scope,
    profileId: opts.profileId,
    attachmentId: opts.attachmentId,
  });
}
