import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  createOnlineMeeting,
  listUpcomingOnlineMeetings,
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
  sendChatMessage,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  action?: 'create' | 'list';
  subject?: string;
  start?: string;
  end?: string;
  attendees?: string[] | string;
  /** When set, post the join URL into this chat after create */
  chat_id?: string;
  top?: number;
  audit?: boolean;
};

function parseAttendees(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.flatMap((a) => a.split(/[,;\s]+/)).map((s) => s.trim()).filter(Boolean);
  }
  return raw.split(/[,;\s]+/).map((s) => s.trim()).filter(Boolean);
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
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    if (action === 'list') {
      const meetings = await listUpcomingOnlineMeetings(accessToken, {
        start: body.start,
        end: body.end,
        top: body.top ?? 20,
      });
      if (body.audit !== false) {
        await auditMsAction(service, {
          userId: salesUser.id,
          email: salesUser.email,
          eventType: 'online_meeting_list',
          path: '/sales/calendar',
          metadata: { count: meetings.length },
        });
      }
      return jsonResponse({ meetings }, 200, origin);
    }

    if (action === 'create') {
      const subject = (body.subject ?? '').trim() || 'Teams meeting';
      const now = Date.now();
      const start = (body.start ?? '').trim() || new Date(now).toISOString();
      const end =
        (body.end ?? '').trim() ||
        new Date(now + 60 * 60 * 1000).toISOString();
      const startMs = Date.parse(start);
      const endMs = Date.parse(end);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
        return jsonResponse({ error: 'Invalid start/end' }, 400, origin);
      }

      const attendees = parseAttendees(body.attendees);
      const created = await createOnlineMeeting(accessToken, {
        subject,
        start,
        end,
        attendees,
      });

      const meeting = {
        id: created.id,
        subject: created.subject ?? subject,
        start: created.startDateTime ?? start,
        end: created.endDateTime ?? end,
        join_url: created.joinWebUrl ?? null,
      };

      const chatId = (body.chat_id ?? '').trim();
      if (chatId && meeting.join_url) {
        try {
          await sendChatMessage(
            accessToken,
            chatId,
            `Teams meeting: ${meeting.subject}\n${meeting.join_url}`,
          );
        } catch (err) {
          console.warn('Post meeting link to chat failed', err);
        }
      }

      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'online_meeting_create',
        path: chatId ? '/sales/chat' : '/sales/calendar',
        metadata: {
          meeting_id: meeting.id,
          subject: meeting.subject,
          attendee_count: attendees.length,
          chat_id: chatId || null,
        },
      });

      return jsonResponse({ meeting }, 200, origin);
    }

    return jsonResponse({ error: 'Unknown action' }, 400, origin);
  } catch (err) {
    console.error('microsoft-online-meetings', err);
    return jsonResponse(
      {
        error:
          err instanceof Error ? err.message : 'Online meeting request failed',
      },
      500,
      origin,
    );
  }
});
