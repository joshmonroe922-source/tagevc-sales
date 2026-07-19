import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  createGroupChat,
  createOneOnOneChat,
  fetchChatMessages,
  fetchMe,
  fetchMyChats,
  getMsConfig,
  getValidAccessToken,
  hideChatForUser,
  requireActiveSalesUser,
  searchPeopleSuggestions,
  sendChatMessage,
  type GraphChat,
  type GraphChatMessage,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?:
    | 'list'
    | 'messages'
    | 'send'
    | 'create'
    | 'hide'
    | 'search_people';
  chat_id?: string;
  content?: string;
  /** Email or AAD user id for 1:1; or list for group */
  member?: string;
  members?: string[];
  topic?: string;
  chat_type?: 'oneOnOne' | 'group';
  q?: string;
  top?: number;
  audit?: boolean;
};

function stripHtml(html: string | null | undefined): string {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .trim();
}

function chatTitle(chat: GraphChat, myUserId: string | null): string {
  if (chat.topic?.trim()) return chat.topic.trim();
  const members = chat.members ?? [];
  const others = members.filter((m) => {
    const uid = (m.userId ?? m.id ?? '').toLowerCase();
    if (myUserId && uid === myUserId.toLowerCase()) return false;
    return true;
  });
  const names = others
    .map((m) => m.displayName?.trim() || m.email?.trim() || null)
    .filter(Boolean) as string[];
  if (names.length) return names.join(', ');
  if (chat.chatType === 'meeting') return 'Meeting chat';
  if (chat.chatType === 'group') return 'Group chat';
  return 'Chat';
}

function mapChat(chat: GraphChat, myUserId: string | null) {
  const preview = chat.lastMessagePreview;
  return {
    id: chat.id,
    topic: chat.topic ?? null,
    chat_type: chat.chatType ?? null,
    title: chatTitle(chat, myUserId),
    web_url: chat.webUrl ?? null,
    created_at: chat.createdDateTime ?? null,
    updated_at: chat.lastUpdatedDateTime ?? null,
    members: (chat.members ?? []).map((m) => ({
      id: m.id ?? m.userId ?? null,
      display_name: m.displayName ?? null,
      email: m.email ?? null,
      user_id: m.userId ?? null,
    })),
    last_message: preview
      ? {
          id: preview.id ?? null,
          created_at: preview.createdDateTime ?? null,
          from_id: preview.from?.user?.id ?? null,
          from_name: preview.from?.user?.displayName ?? null,
          preview: stripHtml(preview.body?.content).slice(0, 160),
        }
      : null,
  };
}

function mapMessage(msg: GraphChatMessage) {
  const raw = msg.body?.content ?? '';
  const contentType = msg.body?.contentType ?? 'text';
  const text =
    contentType.toLowerCase() === 'html' ? stripHtml(raw) : raw.trim();
  return {
    id: msg.id,
    created_at: msg.createdDateTime ?? null,
    message_type: msg.messageType ?? null,
    from_id: msg.from?.user?.id ?? null,
    from_name: msg.from?.user?.displayName ?? null,
    body: text,
    body_html: contentType.toLowerCase() === 'html' ? raw : null,
  };
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin');

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, origin);
  }

  try {
    const config = getMsConfig();
    if (!config.configured) {
      return jsonResponse(
        { error: 'Microsoft Graph is not configured', configured: false },
        503,
        origin,
      );
    }

    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const userClient = createUserClient(authHeader);
    const {
      data: { user },
    } = await userClient.auth.getUser();
    if (!user?.email) {
      return jsonResponse({ error: 'Unauthorized' }, 401, origin);
    }

    const service = createServiceClient();
    const salesUser = await requireActiveSalesUser(service, user.email);
    if (!salesUser) {
      return jsonResponse({ error: 'Forbidden' }, 403, origin);
    }

    const body = (await req.json()) as Body;
    const action = body.action ?? 'list';

    let accessToken: string;
    let connectionMicrosoftUserId: string | null = null;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
      connectionMicrosoftUserId = result.connection.microsoft_user_id;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    if (action === 'search_people') {
      const q = (body.q ?? '').trim();
      if (q.length < 2) {
        return jsonResponse({ people: [], query: q }, 200, origin);
      }
      const people = await searchPeopleSuggestions(accessToken, q, {
        top: body.top ?? 8,
      });
      return jsonResponse({ people, query: q }, 200, origin);
    }

    let myUserId = connectionMicrosoftUserId;
    if (!myUserId || action === 'create') {
      const me = await fetchMe(accessToken);
      myUserId = me.id;
    }

    if (action === 'list') {
      const chats = await fetchMyChats(accessToken);
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'chat_list',
          path: '/sales/chat',
          metadata: { count: chats.length },
        });
      }
      return jsonResponse(
        {
          me_id: myUserId,
          chats: chats.map((c) => mapChat(c, myUserId)),
        },
        200,
        origin,
      );
    }

    if (action === 'messages') {
      const chatId = (body.chat_id ?? '').trim();
      if (!chatId) {
        return jsonResponse({ error: 'chat_id is required' }, 400, origin);
      }
      const messages = await fetchChatMessages(accessToken, chatId, body.top ?? 50);
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'chat_open',
          path: '/sales/chat',
          metadata: { chat_id: chatId, message_count: messages.length },
        });
      }
      return jsonResponse(
        {
          chat_id: chatId,
          me_id: myUserId,
          messages: messages.map(mapMessage),
        },
        200,
        origin,
      );
    }

    if (action === 'send') {
      const chatId = (body.chat_id ?? '').trim();
      const content = (body.content ?? '').trim();
      if (!chatId) {
        return jsonResponse({ error: 'chat_id is required' }, 400, origin);
      }
      if (!content) {
        return jsonResponse({ error: 'content is required' }, 400, origin);
      }
      const sent = await sendChatMessage(accessToken, chatId, content);
      const message = mapMessage(sent);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'chat_send',
        path: '/sales/chat',
        metadata: {
          chat_id: chatId,
          message_id: message.id,
          preview: message.body.slice(0, 80),
        },
      });
      return jsonResponse({ chat_id: chatId, message }, 200, origin);
    }

    if (action === 'create') {
      const chatType = body.chat_type === 'group' ? 'group' : 'oneOnOne';
      if (!myUserId) {
        return jsonResponse({ error: 'Could not resolve Microsoft user id' }, 400, origin);
      }

      let created: GraphChat;
      if (chatType === 'group') {
        const members = [
          ...(body.members ?? []),
          ...(body.member ? [body.member] : []),
        ]
          .map((m) => m.trim())
          .filter(Boolean);
        if (members.length < 1) {
          return jsonResponse(
            { error: 'members (emails or user ids) required for group chat' },
            400,
            origin,
          );
        }
        created = await createGroupChat(
          accessToken,
          myUserId,
          members,
          body.topic ?? null,
        );
      } else {
        const member = (body.member ?? body.members?.[0] ?? '').trim();
        if (!member) {
          return jsonResponse(
            { error: 'member (email or user id) required for 1:1 chat' },
            400,
            origin,
          );
        }
        created = await createOneOnOneChat(accessToken, myUserId, member);
      }

      // Expand members for title when create response is thin
      let chat = created;
      try {
        const all = await fetchMyChats(accessToken);
        const found = all.find((c) => c.id === created.id);
        if (found) chat = found;
      } catch {
        // keep create response
      }

      const mapped = mapChat(chat, myUserId);
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'chat_create',
        path: '/sales/chat',
        metadata: {
          chat_id: mapped.id,
          chat_type: mapped.chat_type,
          title: mapped.title,
        },
      });
      return jsonResponse({ chat: mapped, me_id: myUserId }, 200, origin);
    }

    if (action === 'hide') {
      const chatId = (body.chat_id ?? '').trim();
      if (!chatId) {
        return jsonResponse({ error: 'chat_id is required' }, 400, origin);
      }
      if (!myUserId) {
        return jsonResponse({ error: 'Could not resolve Microsoft user id' }, 400, origin);
      }
      // Matches Teams “Remove from list”: hideForUser (soft-hide for this user only).
      // Soft-delete DELETE /chats requires Chat.ManageDeletion.All (tenant admin) — not used.
      // Meeting chats may fall back to ui_dismiss when Graph returns 404.
      const hideResult = await hideChatForUser(
        accessToken,
        chatId,
        myUserId,
        config.tenantId,
      );
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'chat_hide',
        path: '/sales/chat',
        metadata: {
          chat_id: chatId,
          mode: hideResult.mode,
          reason: hideResult.reason ?? null,
        },
      });
      return jsonResponse(
        {
          ok: true,
          chat_id: chatId,
          mode: hideResult.mode,
          reason: hideResult.reason ?? null,
        },
        200,
        origin,
      );
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-chat', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Chat request failed' },
      500,
      origin,
    );
  }
});
