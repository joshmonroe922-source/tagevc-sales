import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  createCalendarEvent,
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  subject?: string;
  body?: string;
  location?: string;
  start?: string;
  end?: string;
  time_zone?: string;
  attendees?: string[] | string;
  is_online_meeting?: boolean;
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
    const subject = (body.subject ?? '').trim();
    const start = (body.start ?? '').trim();
    const end = (body.end ?? '').trim();
    if (!subject || !start || !end) {
      return jsonResponse(
        { error: 'subject, start, and end are required' },
        400,
        origin,
      );
    }

    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return jsonResponse({ error: 'Invalid start/end' }, 400, origin);
    }

    let accessToken: string;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      return jsonResponse({ error: message, needs_reconnect: true }, 401, origin);
    }

    const timeZone = (body.time_zone ?? '').trim() || 'UTC';
    const attendees = parseAttendees(body.attendees);

    const created = await createCalendarEvent(accessToken, {
      subject,
      body: body.body ?? null,
      location: body.location ?? null,
      start,
      end,
      timeZone,
      attendees,
      isOnlineMeeting: Boolean(body.is_online_meeting),
    });

    await service
      .from('microsoft_calendar_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('sales_user_id', salesUser.id);

    const event = {
      id: created.id,
      subject: created.subject || subject,
      body_preview: created.bodyPreview ?? null,
      is_all_day: Boolean(created.isAllDay),
      show_as: created.showAs ?? null,
      web_link: created.webLink ?? null,
      location: created.location?.displayName ?? null,
      start: created.start?.dateTime ?? null,
      start_timezone: created.start?.timeZone ?? timeZone,
      end: created.end?.dateTime ?? null,
      end_timezone: created.end?.timeZone ?? timeZone,
      organizer_name: created.organizer?.emailAddress?.name ?? null,
      organizer_email: created.organizer?.emailAddress?.address ?? null,
      online_meeting_url: created.onlineMeeting?.joinUrl ?? null,
    };

    await auditMsAction(service, {
      userId: salesUser.id,
      email: salesUser.email,
      eventType: 'meeting_create',
      path: '/sales/calendar',
      metadata: {
        event_id: event.id,
        subject: event.subject,
        start,
        end,
        attendee_count: attendees.length,
        is_online_meeting: Boolean(body.is_online_meeting),
      },
    });

    return jsonResponse({ event }, 200, origin);
  } catch (err) {
    console.error('microsoft-calendar-create-event', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to create event' },
      500,
      origin,
    );
  }
});
