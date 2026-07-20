import { createClient } from '@/lib/supabase/server';
import { displayName } from '@/lib/messaging/repo-client';
import { reactionSummary } from '@/lib/messaging/mentions';
import type {
  ConversationListItem,
  ConversationMember,
  ConversationRow,
  DirectoryProfile,
  MessageRow,
} from '@/lib/messaging/types';

function conversationTitle(
  row: ConversationRow,
  members: ConversationMember[],
  myId: string,
): string {
  if (row.kind === 'group' || row.kind === 'channel') {
    return row.title?.trim() || 'Group chat';
  }
  const peers = members.filter((m) => m.user_id !== myId && !m.left_at);
  if (peers.length === 0) return 'Direct message';
  return peers.map((m) => displayName(m.profile)).join(', ');
}

function unreadCount(
  lastMessageAt: string | null,
  lastReadAt: string | null,
  lastPreview: string | null,
  myId: string,
  // Approximate: if last message exists and is newer than last_read, count at least 1.
  // Precise count fetched separately when needed; list uses boolean-ish count.
  messagesNewerThan?: number,
): number {
  if (messagesNewerThan != null) return messagesNewerThan;
  if (!lastMessageAt || !lastPreview) return 0;
  if (!lastReadAt) return 1;
  return new Date(lastMessageAt) > new Date(lastReadAt) ? 1 : 0;
}

export async function listDirectoryProfiles(
  excludeUserId?: string,
): Promise<{ ok: true; profiles: DirectoryProfile[] } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    let q = supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role, active')
      .eq('active', true)
      .order('full_name', { ascending: true });
    if (excludeUserId) q = q.neq('id', excludeUserId);
    const { data, error } = await q;
    if (error) {
      return { ok: false, error: error.message };
    }
    return { ok: true, profiles: (data ?? []) as DirectoryProfile[] };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to load directory',
    };
  }
}

export async function listMyConversations(
  myId: string,
): Promise<
  | { ok: true; conversations: ConversationListItem[] }
  | { ok: false; error: string }
> {
  try {
    const supabase = await createClient();

    const { data: memberRows, error: memErr } = await supabase
      .from('os_conversation_members')
      .select('conversation_id, last_read_at')
      .eq('user_id', myId)
      .is('left_at', null);

    if (memErr) {
      if (
        memErr.message.includes('os_conversation_members') ||
        memErr.message.includes('does not exist')
      ) {
        return { ok: true, conversations: [] };
      }
      return { ok: false, error: memErr.message };
    }

    const ids = (memberRows ?? []).map((r) => r.conversation_id as string);
    if (ids.length === 0) {
      return { ok: true, conversations: [] };
    }

    const lastReadByConv = new Map(
      (memberRows ?? []).map((r) => [
        r.conversation_id as string,
        r.last_read_at as string | null,
      ]),
    );

    const { data: convs, error: convErr } = await supabase
      .from('os_conversations')
      .select('*')
      .in('id', ids)
      .is('archived_at', null)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    if (convErr) return { ok: false, error: convErr.message };

    const { data: allMembers, error: allMemErr } = await supabase
      .from('os_conversation_members')
      .select('conversation_id, user_id, member_role, last_read_at, joined_at, left_at')
      .in('conversation_id', ids)
      .is('left_at', null);

    if (allMemErr) return { ok: false, error: allMemErr.message };

    const userIds = [
      ...new Set((allMembers ?? []).map((m) => m.user_id as string)),
    ];
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role, active')
      .in('id', userIds);

    const profileMap = new Map(
      ((profiles ?? []) as DirectoryProfile[]).map((p) => [p.id, p]),
    );

    // Unread: count messages from others after last_read_at
    const unreadMap = new Map<string, number>();
    await Promise.all(
      ids.map(async (cid) => {
        const lastRead = lastReadByConv.get(cid);
        let q = supabase
          .from('os_messages')
          .select('id', { count: 'exact', head: true })
          .eq('conversation_id', cid)
          .neq('sender_id', myId)
          .is('deleted_at', null);
        if (lastRead) {
          q = q.gt('created_at', lastRead);
        }
        const { count } = await q;
        unreadMap.set(cid, count ?? 0);
      }),
    );

    const membersByConv = new Map<string, ConversationMember[]>();
    for (const m of allMembers ?? []) {
      const cid = m.conversation_id as string;
      const list = membersByConv.get(cid) ?? [];
      list.push({
        user_id: m.user_id as string,
        member_role: m.member_role as 'owner' | 'member',
        last_read_at: m.last_read_at as string | null,
        joined_at: m.joined_at as string,
        left_at: m.left_at as string | null,
        profile: profileMap.get(m.user_id as string) ?? null,
      });
      membersByConv.set(cid, list);
    }

    const conversations: ConversationListItem[] = ((convs ?? []) as ConversationRow[])
      .map((row) => {
        const members = membersByConv.get(row.id) ?? [];
        return {
          ...row,
          members,
          unread_count: unreadMap.get(row.id) ?? unreadCount(
            row.last_message_at,
            lastReadByConv.get(row.id) ?? null,
            row.last_message_preview,
            myId,
          ),
          display_title: conversationTitle(row, members, myId),
          peer_ids: members
            .filter((m) => m.user_id !== myId)
            .map((m) => m.user_id),
        };
      })
      .sort((a, b) => {
        const at = a.last_message_at ?? a.created_at;
        const bt = b.last_message_at ?? b.created_at;
        return new Date(bt).getTime() - new Date(at).getTime();
      });

    return { ok: true, conversations };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to load conversations',
    };
  }
}

export async function listMessages(
  conversationId: string,
  limit = 80,
): Promise<{ ok: true; messages: MessageRow[] } | { ok: false; error: string }> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from('os_messages')
      .select('id, conversation_id, sender_id, body, parent_id, metadata, created_at, edited_at, deleted_at')
      .eq('conversation_id', conversationId)
      .is('deleted_at', null)
      .order('created_at', { ascending: true })
      .limit(limit);

    if (error) return { ok: false, error: error.message };

    const rows = (data ?? []) as MessageRow[];
    const senderIds = [...new Set(rows.map((r) => r.sender_id))];
    if (senderIds.length === 0) return { ok: true, messages: [] };

    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name, avatar_url, role, active')
      .in('id', senderIds);

    const map = new Map(
      ((profiles ?? []) as DirectoryProfile[]).map((p) => [p.id, p]),
    );

    const messageIds = rows.map((r) => r.id);
    const reactionsByMessage = new Map<
      string,
      Array<{ emoji: string; user_id: string }>
    >();
    if (messageIds.length > 0) {
      const { data: reactions } = await supabase
        .from('os_message_reactions')
        .select('message_id, emoji, user_id')
        .in('message_id', messageIds);
      for (const r of reactions ?? []) {
        const mid = r.message_id as string;
        const list = reactionsByMessage.get(mid) ?? [];
        list.push({ emoji: r.emoji as string, user_id: r.user_id as string });
        reactionsByMessage.set(mid, list);
      }
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    const myId = user?.id ?? '';

    return {
      ok: true,
      messages: rows.map((r) => ({
        ...r,
        sender: map.get(r.sender_id) ?? null,
        reactions: reactionSummary(reactionsByMessage.get(r.id) ?? [], myId),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'Failed to load messages',
    };
  }
}

export async function totalUnreadCount(
  myId: string,
): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const list = await listMyConversations(myId);
  if (!list.ok) return list;
  return {
    ok: true,
    count: list.conversations.reduce((sum, c) => sum + c.unread_count, 0),
  };
}

export { conversationTitle };
