import { preferredChatCompletion } from '@/lib/ai/chat';
import { getAiOrgSettings, getAiUserPrefs } from '@/lib/ai/settings';
import { XAI_SETUP_NOTE } from '@/lib/think-tank/llm';
import {
  buildTageThinkTankSystemPrompt,
  thinkTankRoleBand,
  type ThinkTankRoleBand,
} from '@/lib/think-tank/prompts';
import { createClient } from '@/lib/supabase/server';

export const TAGE_PORTAL_KEY = 'tage' as const;

export type ThinkTankMessageDto = {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  model: string | null;
  createdAt: string;
};

function toDto(m: {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
}): ThinkTankMessageDto {
  return {
    id: m.id,
    conversationId: m.conversation_id,
    role: m.role as ThinkTankMessageDto['role'],
    content: m.content,
    model: m.model,
    createdAt: m.created_at,
  };
}

export async function getOrCreateThinkTankConversation(opts: {
  profileId: string;
  entityId: string;
  role: string;
}): Promise<{ id: string; roleHint: ThinkTankRoleBand }> {
  const supabase = await createClient();
  const roleHint = thinkTankRoleBand(opts.role);

  const { data: existing } = await supabase
    .from('os_think_tank_conversations')
    .select('id, role_hint')
    .eq('portal_key', TAGE_PORTAL_KEY)
    .eq('profile_id', opts.profileId)
    .maybeSingle();

  if (existing?.id) {
    return {
      id: existing.id,
      roleHint: thinkTankRoleBand(existing.role_hint ?? opts.role),
    };
  }

  const { data, error } = await supabase
    .from('os_think_tank_conversations')
    .insert({
      portal_key: TAGE_PORTAL_KEY,
      entity_id: opts.entityId,
      profile_id: opts.profileId,
      title: 'Think Tank',
      role_hint: roleHint,
    })
    .select('id, role_hint')
    .maybeSingle();

  if (error || !data) {
    throw new Error(error?.message ?? 'Could not create Think Tank thread');
  }
  return { id: data.id, roleHint: thinkTankRoleBand(data.role_hint) };
}

export async function listThinkTankMessages(
  conversationId: string,
): Promise<ThinkTankMessageDto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_messages')
    .select('id, conversation_id, role, content, model, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(200);
  return (data ?? []).map((m) => toDto(m as Parameters<typeof toDto>[0]));
}

async function assertRateLimit(conversationId: string): Promise<string | null> {
  const supabase = await createClient();
  const since = new Date(Date.now() - 60_000).toISOString();
  const { count } = await supabase
    .from('os_think_tank_messages')
    .select('id', { count: 'exact', head: true })
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .gte('created_at', since);
  if ((count ?? 0) >= 12) {
    return 'Rate limit: max 12 messages per minute. Pause briefly and try again.';
  }
  return null;
}

export type SendThinkTankResult =
  | {
      userMessage: ThinkTankMessageDto;
      assistantMessage: ThinkTankMessageDto;
      model: string | null;
    }
  | { error: string };

export async function sendThinkTankMessage(opts: {
  profileId: string;
  entityId: string;
  email: string;
  name?: string | null;
  role: string;
  message: string;
  context: Record<string, unknown>;
  impersonatingAsLabel?: string | null;
}): Promise<SendThinkTankResult> {
  const message = opts.message.trim();
  if (!message) return { error: 'Message is required.' };
  if (message.length > 8000) return { error: 'Message too long (8k max).' };

  const supabase = await createClient();
  const conv = await getOrCreateThinkTankConversation({
    profileId: opts.profileId,
    entityId: opts.entityId,
    role: opts.role,
  });

  const limited = await assertRateLimit(conv.id);
  if (limited) return { error: limited };

  const { data: history } = await supabase
    .from('os_think_tank_messages')
    .select('role, content')
    .eq('conversation_id', conv.id)
    .order('created_at', { ascending: true })
    .limit(40);

  const { data: userRow, error: userErr } = await supabase
    .from('os_think_tank_messages')
    .insert({
      conversation_id: conv.id,
      role: 'user',
      content: message,
      context_meta: { at: new Date().toISOString() },
    })
    .select('id, conversation_id, role, content, model, created_at')
    .maybeSingle();

  if (userErr || !userRow) {
    return { error: userErr?.message ?? 'Failed to save message.' };
  }

  const system = buildTageThinkTankSystemPrompt({
    roleBand: conv.roleHint,
    userName: opts.name,
    entityId: opts.entityId,
    contextJson: JSON.stringify(opts.context).slice(0, 6000),
    impersonatingAsLabel: opts.impersonatingAsLabel,
  });

  const llmMessages = [
    { role: 'system' as const, content: system },
    ...(history ?? [])
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
      })),
    { role: 'user' as const, content: message },
  ];

  const [orgAi, userAi] = await Promise.all([
    getAiOrgSettings(opts.entityId),
    getAiUserPrefs(opts.profileId),
  ]);

  const result = await preferredChatCompletion({
    messages: llmMessages,
    temperature: 0.5,
    preference: {
      userPreferred: userAi.preferredProvider,
      orgDefault: orgAi.defaultProvider,
    },
  });

  if (!result.content) {
    await supabase.from('os_think_tank_messages').delete().eq('id', userRow.id);
    return { error: result.error ?? XAI_SETUP_NOTE };
  }

  const { data: assistantRow, error: aErr } = await supabase
    .from('os_think_tank_messages')
    .insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: result.content,
      model: result.model,
      context_meta: {
        roleBand: conv.roleHint,
        provider: result.provider ?? null,
      },
    })
    .select('id, conversation_id, role, content, model, created_at')
    .maybeSingle();

  if (aErr || !assistantRow) {
    return { error: aErr?.message ?? 'Failed to save assistant reply.' };
  }

  await supabase
    .from('os_think_tank_conversations')
    .update({ updated_at: new Date().toISOString(), role_hint: conv.roleHint })
    .eq('id', conv.id);

  console.info('[think-tank:tage]', {
    profileId: opts.profileId,
    conversationId: conv.id,
    model: result.model,
    provider: result.provider,
  });

  return {
    userMessage: toDto(userRow as Parameters<typeof toDto>[0]),
    assistantMessage: toDto(assistantRow as Parameters<typeof toDto>[0]),
    model: result.model,
  };
}

export async function startNewThinkTankThread(opts: {
  profileId: string;
  entityId: string;
  role: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('os_think_tank_conversations')
    .select('id')
    .eq('portal_key', TAGE_PORTAL_KEY)
    .eq('profile_id', opts.profileId)
    .maybeSingle();

  if (existing?.id) {
    await supabase
      .from('os_think_tank_messages')
      .delete()
      .eq('conversation_id', existing.id);
    await supabase
      .from('os_think_tank_conversations')
      .update({
        updated_at: new Date().toISOString(),
        title: 'Think Tank',
        role_hint: thinkTankRoleBand(opts.role),
      })
      .eq('id', existing.id);
    return { ok: true };
  }

  await getOrCreateThinkTankConversation(opts);
  return { ok: true };
}
