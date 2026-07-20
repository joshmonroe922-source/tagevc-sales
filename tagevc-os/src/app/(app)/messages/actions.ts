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
import { logActivity } from '@/lib/data/activity';

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
  const inList =
    selectedId &&
    conversations.conversations.some((c) => c.id === selectedId);
  const pick = inList
    ? selectedId!
    : selectedId
      ? selectedId
      : (conversations.conversations[0]?.id ?? null);

  if (pick) {
    messages = await listMessages(pick);
    // If selectedId was forced but not in list, refresh conversations after RPC create
    if (selectedId && !inList && messages.ok) {
      const refreshed = await listMyConversations(auth.profile.id);
      if (refreshed.ok) {
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
          conversations: refreshed.conversations,
          directory: directory.profiles,
          unreadTotal: unread.ok ? unread.count : 0,
          selectedId: pick,
          messages: messages.messages,
          messagesError: null as string | null,
        };
      }
    }
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

export async function sendMessageAction(
  conversationId: string,
  body: string,
  parentId?: string | null,
) {
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
      parent_id: parentId || null,
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
  revalidatePath('/activity');
  return { ok: true as const };
}

export async function getUnreadTotalAction() {
  const auth = await requireUser();
  if (!auth.ok) return { ok: true as const, count: 0 };
  return totalUnreadCount(auth.profile.id);
}

export async function linkConversationAction(input: {
  conversationId: string;
  refType: string;
  refId: string;
  entityId?: string | null;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { error } = await supabase.rpc('link_conversation', {
    cid: input.conversationId,
    p_ref_type: input.refType,
    p_ref_id: input.refId,
    p_entity_id: input.entityId ?? null,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('link_conversation')
        ? 'Linking requires Phase 11 SQL. Apply phase11_chat_and_normalize.sql.'
        : error.message,
    };
  }

  await logActivity({
    module: 'messages',
    action: 'link_conversation',
    title: `Linked chat to ${input.refType} ${input.refId}`,
    ref_type: input.refType,
    ref_id: input.refId,
    entity_id: input.entityId ?? undefined,
  });

  revalidatePath('/messages');
  return { ok: true as const };
}

export async function openLinkedChatAction(input: {
  refType: string;
  refId: string;
  title: string;
  entityId?: string | null;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('find_or_create_linked_chat', {
    p_ref_type: input.refType,
    p_ref_id: input.refId,
    p_title: input.title,
    p_entity_id: input.entityId ?? null,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('find_or_create_linked_chat')
        ? 'Contextual chat requires Phase 11 SQL. Apply phase11_chat_and_normalize.sql.'
        : error.message,
    };
  }

  await logActivity({
    module: 'messages',
    action: 'open_linked_chat',
    title: `Opened chat for ${input.refType} ${input.refId}`,
    ref_type: input.refType,
    ref_id: input.refId,
    entity_id: input.entityId ?? undefined,
  });

  revalidatePath('/messages');
  return { ok: true as const, conversationId: data as string };
}

export async function searchConversationMessagesAction(
  conversationId: string,
  query: string,
) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const q = query.trim();
  if (q.length < 2) {
    return { ok: true as const, results: [] as Array<{ id: string; body: string; created_at: string; sender_id: string }> };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_conversation_messages', {
    cid: conversationId,
    p_query: q,
    p_limit: 40,
  });

  if (error) {
    // Fallback: client-side already filters; soft-fail
    if (
      error.message.includes('search_conversation_messages') ||
      error.code === 'PGRST202'
    ) {
      const loaded = await listMessages(conversationId, 200);
      if (!loaded.ok) return { ok: false as const, error: loaded.error };
      const lower = q.toLowerCase();
      return {
        ok: true as const,
        results: loaded.messages
          .filter((m) => m.body.toLowerCase().includes(lower))
          .slice(-40)
          .reverse()
          .map((m) => ({
            id: m.id,
            body: m.body,
            created_at: m.created_at,
            sender_id: m.sender_id,
          })),
      };
    }
    return { ok: false as const, error: error.message };
  }

  return {
    ok: true as const,
    results: (data ?? []) as Array<{
      id: string;
      body: string;
      created_at: string;
      sender_id: string;
    }>,
  };
}
