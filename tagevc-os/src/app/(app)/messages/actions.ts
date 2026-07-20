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
import { resolveMentions } from '@/lib/messaging/mentions';
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

export async function startChannelAction(input: {
  title: string;
  memberIds?: string[];
  entityId?: string | null;
  topic?: string | null;
  isPrivate?: boolean;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('create_channel', {
    p_title: input.title,
    p_member_ids: input.memberIds ?? [],
    p_entity_id: input.entityId ?? null,
    p_topic: input.topic ?? null,
    p_is_private: input.isPrivate ?? false,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('create_channel')
        ? 'Channels require Phase 12/13 SQL. Apply phase12 then phase13 SQL.'
        : error.message,
    };
  }
  revalidatePath('/messages');
  return { ok: true as const, conversationId: data as string };
}

export async function joinChannelAction(conversationId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('join_channel', { cid: conversationId });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const, conversationId };
}

export async function sendMessageAction(
  conversationId: string,
  body: string,
  parentId?: string | null,
  attachments?: Array<{ doc_id: string; title: string }>,
  uploadedFiles?: Array<{
    storage_path: string;
    file_name: string;
    mime_type: string;
    size_bytes: number;
  }>,
) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const text = body.trim();
  const hasFiles = Boolean(uploadedFiles?.length);
  if (!text && !(attachments && attachments.length > 0) && !hasFiles) {
    return { ok: false as const, error: 'Message is empty' };
  }
  if (text.length > 8000) {
    return { ok: false as const, error: 'Message is too long' };
  }

  const directory = await listDirectoryProfiles();
  const profiles = directory.ok ? directory.profiles : [];
  const { mentionedIds, normalizedBody } = resolveMentions(
    text ||
      (hasFiles
        ? `Shared ${uploadedFiles!.length} file(s)`
        : attachments?.length
          ? `Shared ${attachments.length} document(s)`
          : ''),
    profiles,
  );

  const metadata: Record<string, unknown> = {};
  if (mentionedIds.length) metadata.mentions = mentionedIds;
  if (attachments?.length) metadata.attachments = attachments;
  if (hasFiles) {
    metadata.files = uploadedFiles!.map((f) => ({
      storage_path: f.storage_path,
      file_name: f.file_name,
      mime_type: f.mime_type,
      size_bytes: f.size_bytes,
    }));
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('os_messages')
    .insert({
      conversation_id: conversationId,
      sender_id: auth.profile.id,
      body: normalizedBody || text || 'Attachment',
      parent_id: parentId || null,
      metadata,
    })
    .select(
      'id, conversation_id, sender_id, body, parent_id, metadata, created_at, edited_at, deleted_at',
    )
    .maybeSingle();

  if (error) return { ok: false as const, error: error.message };

  if (data && uploadedFiles?.length) {
    const { error: fileErr } = await supabase.from('os_message_files').insert(
      uploadedFiles.map((f) => ({
        message_id: data.id,
        conversation_id: conversationId,
        uploader_id: auth.profile.id,
        storage_path: f.storage_path,
        file_name: f.file_name,
        mime_type: f.mime_type,
        size_bytes: f.size_bytes,
      })),
    );
    if (fileErr) {
      console.error('os_message_files insert', fileErr.message);
    }
  }

  if (data && mentionedIds.length > 0) {
    await supabase.rpc('notify_message_mentions', {
      p_message_id: data.id,
      p_mentioned_user_ids: mentionedIds,
    });
  }

  revalidatePath('/messages');
  revalidatePath('/activity');
  return { ok: true as const, message: data };
}

export async function toggleReactionAction(messageId: string, emoji: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from('os_message_reactions')
    .select('message_id')
    .eq('message_id', messageId)
    .eq('user_id', auth.profile.id)
    .eq('emoji', emoji)
    .maybeSingle();

  if (existing) {
    const { error } = await supabase
      .from('os_message_reactions')
      .delete()
      .eq('message_id', messageId)
      .eq('user_id', auth.profile.id)
      .eq('emoji', emoji);
    if (error) return { ok: false as const, error: error.message };
  } else {
    const { error } = await supabase.from('os_message_reactions').insert({
      message_id: messageId,
      user_id: auth.profile.id,
      emoji,
    });
    if (error) {
      return {
        ok: false as const,
        error: error.message.includes('os_message_reactions')
          ? 'Reactions require Phase 12 SQL.'
          : error.message,
      };
    }
  }
  return { ok: true as const };
}

export async function listAttachableDocumentsAction() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const { listDocuments } = await import('@/lib/data/document-store');
  const docs = listDocuments().map((d) => ({
    doc_id: d.doc_id,
    title: d.title,
    entity_id: d.entity_id,
    status: d.status,
  }));
  return { ok: true as const, documents: docs };
}

export async function searchMessagesGlobalAction(query: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const q = query.trim();
  if (q.length < 2) {
    return { ok: true as const, results: [] as Array<{
      id: string;
      conversation_id: string;
      body: string;
      created_at: string;
      conversation_title: string;
    }> };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc('search_messages_global', {
    p_query: q,
    p_limit: 30,
  });

  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('search_messages_global')
        ? 'Global search requires Phase 12 SQL.'
        : error.message,
    };
  }

  return {
    ok: true as const,
    results: (data ?? []) as Array<{
      id: string;
      conversation_id: string;
      body: string;
      created_at: string;
      conversation_title: string;
    }>,
  };
}

export async function listDiscoverableChannelsAction() {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { data, error } = await supabase.rpc('list_discoverable_channels');
  if (error) {
    return { ok: true as const, channels: [] as Array<{ id: string; title: string | null }> };
  }
  return {
    ok: true as const,
    channels: (data ?? []).map((c: { id: string; title: string | null }) => ({
      id: c.id,
      title: c.title,
    })),
  };
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

export async function softDeleteMessageAction(messageId: string) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('soft_delete_message', {
    p_message_id: messageId,
  });
  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('soft_delete_message')
        ? 'Moderation requires Phase 13 SQL.'
        : error.message,
    };
  }
  revalidatePath('/messages');
  return { ok: true as const };
}

export async function updateChannelSettingsAction(input: {
  conversationId: string;
  title?: string;
  description?: string | null;
  isPrivate?: boolean;
}) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('update_channel_settings', {
    cid: input.conversationId,
    p_title: input.title ?? null,
    p_description: input.description ?? null,
    p_is_private: input.isPrivate ?? null,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const };
}

export async function addChannelMembersAction(
  conversationId: string,
  memberIds: string[],
) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('add_channel_members', {
    cid: conversationId,
    p_member_ids: memberIds,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const };
}

export async function removeChannelMemberAction(
  conversationId: string,
  userId: string,
) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { error } = await supabase.rpc('remove_channel_member', {
    cid: conversationId,
    p_user_id: userId,
  });
  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/messages');
  return { ok: true as const };
}

export async function muteConversationAction(
  conversationId: string,
  mute: boolean,
) {
  const auth = await requireUser();
  if (!auth.ok) return auth;
  const supabase = await createClient();
  const { data: prefs } = await supabase
    .from('os_notification_prefs')
    .select('muted_conversation_ids')
    .eq('user_id', auth.profile.id)
    .maybeSingle();

  const current = new Set<string>(
    ((prefs?.muted_conversation_ids as string[]) ?? []).map(String),
  );
  if (mute) current.add(conversationId);
  else current.delete(conversationId);

  const { error } = await supabase.rpc('upsert_notification_prefs', {
    p_muted_conversation_ids: [...current],
  });
  if (error) {
    return {
      ok: false as const,
      error: error.message.includes('upsert_notification_prefs')
        ? 'Notification prefs require Phase 13 SQL.'
        : error.message,
    };
  }
  revalidatePath('/messages');
  revalidatePath('/settings/notifications');
  return { ok: true as const };
}
