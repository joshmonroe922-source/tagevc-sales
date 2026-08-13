/**
 * Think Tank thread CRUD — shared UDL tables, user + portal + entity_os scoped.
 * Copy with `src/lib/platform/think-tank/`. Hosts wire portal_key + LLM.
 */
import { createClient } from '@/lib/supabase/server';
import {
  formatThreadAttachmentContext,
  listThinkTankAttachments,
} from '@/lib/platform/think-tank/attachments';
import {
  isUntitledThinkTank,
  suggestThinkTankTitle,
} from '@/lib/platform/think-tank/scope';
import {
  THINK_TANK_DEFAULT_TITLE,
  THINK_TANK_MAX_MESSAGE,
  THINK_TANK_RATE_PER_MINUTE,
  type ThinkTankDeskState,
  type ThinkTankLlmMessage,
  type ThinkTankLlmResult,
  type ThinkTankMessageDto,
  type ThinkTankSendResult,
  type ThinkTankThreadDto,
} from '@/lib/platform/think-tank/types';

type ConvRow = {
  id: string;
  title: string;
  role_hint: string | null;
  entity_os: string | null;
  entity_id: string | null;
  updated_at: string;
  created_at: string;
};

type MsgRow = {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  model: string | null;
  created_at: string;
};

export function toThinkTankThreadDto(row: ConvRow): ThinkTankThreadDto {
  return {
    id: row.id,
    title: row.title || THINK_TANK_DEFAULT_TITLE,
    roleHint: row.role_hint,
    entityOs: row.entity_os || row.entity_id || '',
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

export function toThinkTankMessageDto(row: MsgRow): ThinkTankMessageDto {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role as ThinkTankMessageDto['role'],
    content: row.content,
    model: row.model,
    createdAt: row.created_at,
  };
}

async function ownedConversation(opts: {
  portalKey: string;
  profileId: string;
  entityOs: string;
  conversationId: string;
}): Promise<ConvRow | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_conversations')
    .select('id, title, role_hint, entity_os, entity_id, updated_at, created_at')
    .eq('id', opts.conversationId)
    .eq('portal_key', opts.portalKey)
    .eq('profile_id', opts.profileId)
    .eq('entity_os', opts.entityOs)
    .maybeSingle();
  return (data as ConvRow | null) ?? null;
}

export async function listThinkTankThreads(opts: {
  portalKey: string;
  profileId: string;
  entityOs: string;
}): Promise<ThinkTankThreadDto[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from('os_think_tank_conversations')
    .select('id, title, role_hint, entity_os, entity_id, updated_at, created_at')
    .eq('portal_key', opts.portalKey)
    .eq('profile_id', opts.profileId)
    .eq('entity_os', opts.entityOs)
    .order('updated_at', { ascending: false })
    .limit(80);
  return ((data ?? []) as ConvRow[]).map(toThinkTankThreadDto);
}

export async function createThinkTankThread(opts: {
  portalKey: string;
  profileId: string;
  entityId: string;
  entityOs: string;
  roleHint: string;
  title?: string;
}): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const supabase = await createClient();
  const title = suggestThinkTankTitle(opts.title ?? '', THINK_TANK_DEFAULT_TITLE);
  const { data, error } = await supabase
    .from('os_think_tank_conversations')
    .insert({
      portal_key: opts.portalKey,
      entity_id: opts.entityId,
      entity_os: opts.entityOs,
      profile_id: opts.profileId,
      title,
      role_hint: opts.roleHint,
    })
    .select('id, title, role_hint, entity_os, entity_id, updated_at, created_at')
    .maybeSingle();

  if (error || !data) {
    return { error: error?.message ?? 'Could not create Think Tank thread.' };
  }
  return { thread: toThinkTankThreadDto(data as ConvRow) };
}

export async function renameThinkTankThread(opts: {
  portalKey: string;
  profileId: string;
  entityOs: string;
  conversationId: string;
  title: string;
}): Promise<{ thread: ThinkTankThreadDto } | { error: string }> {
  const title = suggestThinkTankTitle(opts.title, THINK_TANK_DEFAULT_TITLE);
  const existing = await ownedConversation(opts);
  if (!existing) return { error: 'Thread not found.' };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_think_tank_conversations')
    .update({ title, updated_at: new Date().toISOString() })
    .eq('id', existing.id)
    .select('id, title, role_hint, entity_os, entity_id, updated_at, created_at')
    .maybeSingle();

  if (error || !data) {
    return { error: error?.message ?? 'Could not rename thread.' };
  }
  return { thread: toThinkTankThreadDto(data as ConvRow) };
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
  return ((data ?? []) as MsgRow[])
    .map(toThinkTankMessageDto)
    .filter((m) => m.role !== 'system');
}

export async function loadThinkTankDesk(opts: {
  portalKey: string;
  profileId: string;
  entityId: string;
  entityOs: string;
  roleHint: string;
  viewAsLabel?: string | null;
  conversationId?: string | null;
}): Promise<ThinkTankDeskState> {
  const threads = await listThinkTankThreads(opts);
  const requested = opts.conversationId?.trim() || null;
  const active =
    (requested && threads.find((t) => t.id === requested)) || threads[0] || null;

  if (!active) {
    return {
      threads,
      conversationId: null,
      messages: [],
      attachments: [],
      entityOs: opts.entityOs,
      roleBand: opts.roleHint,
      viewAsLabel: opts.viewAsLabel ?? null,
    };
  }

  const [messages, attachments] = await Promise.all([
    listThinkTankMessages(active.id),
    listThinkTankAttachments(active.id),
  ]);

  return {
    threads,
    conversationId: active.id,
    messages,
    attachments,
    entityOs: opts.entityOs,
    roleBand: active.roleHint || opts.roleHint,
    viewAsLabel: opts.viewAsLabel ?? null,
  };
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
  if ((count ?? 0) >= THINK_TANK_RATE_PER_MINUTE) {
    return `Rate limit: max ${THINK_TANK_RATE_PER_MINUTE} messages per minute. Pause briefly and try again.`;
  }
  return null;
}

export async function sendThinkTankTurn(opts: {
  portalKey: string;
  profileId: string;
  entityId: string;
  entityOs: string;
  roleHint: string;
  conversationId?: string | null;
  message: string;
  context: Record<string, unknown>;
  buildSystemPrompt: (args: { roleHint: string; conversationId: string }) => string;
  completeChat: (messages: ThinkTankLlmMessage[]) => Promise<ThinkTankLlmResult>;
}): Promise<ThinkTankSendResult> {
  const message = opts.message.trim();
  if (!message) return { error: 'Message is required.' };
  if (message.length > THINK_TANK_MAX_MESSAGE) {
    return { error: `Message too long (${THINK_TANK_MAX_MESSAGE / 1000}k max).` };
  }

  let conv = opts.conversationId
    ? await ownedConversation({
        portalKey: opts.portalKey,
        profileId: opts.profileId,
        entityOs: opts.entityOs,
        conversationId: opts.conversationId,
      })
    : null;

  if (!conv) {
    const created = await createThinkTankThread({
      portalKey: opts.portalKey,
      profileId: opts.profileId,
      entityId: opts.entityId,
      entityOs: opts.entityOs,
      roleHint: opts.roleHint,
      title: suggestThinkTankTitle(message),
    });
    if ('error' in created) return created;
    conv = {
      id: created.thread.id,
      title: created.thread.title,
      role_hint: created.thread.roleHint,
      entity_os: created.thread.entityOs,
      entity_id: opts.entityId,
      updated_at: created.thread.updatedAt,
      created_at: created.thread.createdAt,
    };
  }

  const limited = await assertRateLimit(conv.id);
  if (limited) return { error: limited };

  const supabase = await createClient();
  const roleHint = conv.role_hint || opts.roleHint;

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

  const attachmentBlock = await formatThreadAttachmentContext(conv.id);
  const systemBase = opts.buildSystemPrompt({
    roleHint,
    conversationId: conv.id,
  });
  const system = attachmentBlock
    ? `${systemBase}\n\nThread-only documents (use only for this conversation; do not assume they apply to other threads):\n${attachmentBlock}`
    : systemBase;

  const llmMessages: ThinkTankLlmMessage[] = [
    { role: 'system', content: system },
    ...((history ?? []) as Array<{ role: string; content: string }>)
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    { role: 'user', content: message },
  ];

  const result = await opts.completeChat(llmMessages);
  if (!result.content) {
    await supabase.from('os_think_tank_messages').delete().eq('id', userRow.id);
    return { error: result.error ?? 'Think Tank could not reply.' };
  }

  const { data: assistantRow, error: aErr } = await supabase
    .from('os_think_tank_messages')
    .insert({
      conversation_id: conv.id,
      role: 'assistant',
      content: result.content,
      model: result.model,
      context_meta: {
        roleBand: roleHint,
        provider: result.provider ?? null,
      },
    })
    .select('id, conversation_id, role, content, model, created_at')
    .maybeSingle();

  if (aErr || !assistantRow) {
    return { error: aErr?.message ?? 'Failed to save assistant reply.' };
  }

  const nextTitle = isUntitledThinkTank(conv.title)
    ? suggestThinkTankTitle(message)
    : conv.title;

  await supabase
    .from('os_think_tank_conversations')
    .update({
      updated_at: new Date().toISOString(),
      role_hint: roleHint,
      title: nextTitle,
    })
    .eq('id', conv.id);

  const thread: ThinkTankThreadDto = {
    id: conv.id,
    title: nextTitle,
    roleHint,
    entityOs: conv.entity_os || opts.entityOs,
    updatedAt: new Date().toISOString(),
    createdAt: conv.created_at,
  };

  return {
    conversationId: conv.id,
    thread,
    userMessage: toThinkTankMessageDto(userRow as MsgRow),
    assistantMessage: toThinkTankMessageDto(assistantRow as MsgRow),
    model: result.model,
  };
}
