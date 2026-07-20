'use server';

import { revalidatePath } from 'next/cache';
import { getSessionContext } from '@/lib/rbac/session';
import { createClient } from '@/lib/supabase/server';
import {
  listDirectoryProfiles,
  listMessages,
  listMyConversations,
  totalUnreadCount,
} from '@/lib/messaging/repo';

async function requireUser() {
  const ctx = await getSessionContext();
  if (!ctx) return { ok: false as const, error: 'Not signed in' };
  return { ok: true as const, profile: ctx.profile };
}

export async function getMessagingBootstrapAction(selectedId?: string | null) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const [conversations, directory, unread] = await Promise.all([
    listMyConversations(auth.profile.id),
    listDirectoryProfiles(auth.profile.id),
    totalUnreadCount(auth.profile.id),
  ]);

  if (!conversations.ok) {
    return { ok: false as const, error: conversations.error };
  }
  if (!directory.ok) {
    return { ok: false as const, error: directory.error };
  }

  let messages = null as Awaited<ReturnType<typeof listMessages>> | null;
  const pick =
    selectedId &&
    conversations.conversations.some((c) => c.id === selectedId)
      ? selectedId
      : conversations.conversations[0]?.id ?? null;

  if (pick) {
    messages = await listMessages(pick);
  }

  return {
    ok: true as const,
    me: {
      id: auth.profile.id,
      email: auth.profile.email,
      full_name: auth.profile.full_name,
      avatar_url: auth.profile.avatar_url,
      role: auth.profile.role,
      active: auth.profile.active,
    },
    conversations: conversations.conversations,
    directory: directory.profiles,
    unreadTotal: unread.ok ? unread.count : 0,
    selectedId: pick,
    messages: messages?.ok ? messages.messages : [],
    messagesError: messages && !messages.ok ? messages.error : null,
  };
}

export async function loadMessagesAction(conversationId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const result = await listMessages(conversationId);
  if (!result.ok) return result;
  return { ok: true as const, messages: result.messages };
}

export async function startDirectMessageAction(otherUserId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_or_get_dm', {
    other_user_id: otherUserId,
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const, conversationId: data as string };
}

export async function startGroupChatAction(title: string, memberIds: string[]) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_group_chat', {
    p_title: title,
    p_member_ids: memberIds,
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const, conversationId: data as string };
}

export async function sendMessageAction(conversationId: string, body: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const text = body.trim();
  if (!text) return { ok: false as const, error: 'Message is empty' };
  if (text.length > 8000) {
    return { ok: false as const, error: 'Message is too long' };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: auth.profile.id,
      body: text,
    })
    .select(
      'id, conversation_id, sender_id, body, parent_id, metadata, created_at, edited_at, deleted_at',
    )
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const, message: data };
}

export async function markConversationReadAction(conversationId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { error } = await supabase.rpc('mark_conversation_read', {
    cid: conversationId,
  });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const };
}

export async function getUnreadTotalAction() {
  const auth = await requireUser();
  if (!auth.ok) return { ok: true as const, count: 0 };
  return totalUnreadCount(auth.profile.id);
}
