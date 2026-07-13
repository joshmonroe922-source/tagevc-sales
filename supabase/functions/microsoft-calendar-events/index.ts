import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  fetchCalendarView,
  getMsConfig,
  getValidAccessToken,
  requireActiveSalesUser,
} from '../_shared/microsoftGraph.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

type Body = {
  start?: string;
  end?: string;
};

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
        {
          error: 'Microsoft Graph is not configured',
          configured: false,
        },
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
    const start = (body.start ?? '').trim();
    const end = (body.end ?? '').trim();
    if (!start || !end) {
      return jsonResponse(
        { error: 'start and end ISO datetimes are required' },
        400,
        origin,
      );
    }

    // Guard absurd ranges (max ~62 days)
    const startMs = Date.parse(start);
    const endMs = Date.parse(end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      return jsonResponse({ error: 'Invalid start/end range' }, 400, origin);
    }
    if (endMs - startMs > 62 * 24 * 60 * 60 * 1000) {
      return jsonResponse(
        { error: 'Date range too large (max 62 days)' },
        400,
        origin,
      );
    }

    let accessToken: string;
    try {
      const result = await getValidAccessToken(service, config, salesUser.id);
      accessToken = result.accessToken;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Not connected';
      await service
        .from('microsoft_calendar_connections')
        .update({
          last_error: message,
          updated_at: new Date().toISOString(),
        })
        .eq('sales_user_id', salesUser.id);
      return jsonResponse(
        { error: message, needs_reconnect: true },
        401,
        origin,
      );
    }

    const graphEvents = await fetchCalendarView(accessToken, start, end);

    await service
      .from('microsoft_calendar_connections')
      .update({
        last_synced_at: new Date().toISOString(),
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('sales_user_id', salesUser.id);

    const events = graphEvents.map((ev) => ({
      id: ev.id,
      subject: ev.subject || '(No title)',
      body_preview: ev.bodyPreview ?? null,
      is_all_day: Boolean(ev.isAllDay),
      show_as: ev.showAs ?? null,
      web_link: ev.webLink ?? null,
      location: ev.location?.displayName ?? null,
      start: ev.start?.dateTime ?? null,
      start_timezone: ev.start?.timeZone ?? 'UTC',
      end: ev.end?.dateTime ?? null,
      end_timezone: ev.end?.timeZone ?? 'UTC',
      organizer_name: ev.organizer?.emailAddress?.name ?? null,
      organizer_email: ev.organizer?.emailAddress?.address ?? null,
    }));

    return jsonResponse({ events, start, end }, 200, origin);
  } catch (err) {
    console.error('microsoft-calendar-events', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to load events' },
      500,
      origin,
    );
  }
});
