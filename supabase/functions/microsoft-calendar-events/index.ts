import { corsHeaders, jsonResponse } from '../_shared/cors.ts';
import {
  decryptSecret,
  fetchCalendarView,
  fetchCalendars,
  getMsConfig,
  getValidAccessToken,
  mapWithConcurrency,
  outlookColorToHex,
  requireActiveSalesUser,
  type GraphCalendar,
} from '../_shared/microsoftGraph.ts';
import { fetchIcsFeed } from '../_shared/icsCalendar.ts';
import { auditMsAction } from '../_shared/msAudit.ts';
import { createServiceClient, createUserClient } from '../_shared/supabase.ts';

/** Stay under Graph MailboxConcurrency (~4 concurrent requests per mailbox). */
const GRAPH_CALENDAR_VIEW_CONCURRENCY = 2;

type Body = {
  start?: string;
  end?: string;
  /** When set, only fetch these calendar IDs (still overlaid). Omit = all non-hidden. */
  calendar_ids?: string[];
  /** When false, skip audit (background alert poll). Default true. */
  audit?: boolean;
};

type PortalCalendar = {
  id: string;
  name: string;
  color: string | null;
  is_default: boolean;
  can_edit: boolean;
  owner_name: string | null;
  owner_email: string | null;
  source: 'graph' | 'ics';
};

function resolveCalendarColor(cal: GraphCalendar): string | null {
  const hex = (cal.hexColor ?? '').trim();
  if (hex && hex !== '000000' && hex !== '#000000') {
    return hex.startsWith('#') ? hex : `#${hex}`;
  }
  return outlookColorToHex(cal.color);
}

function icsCalendarId(feedId: string): string {
  return `ics:${feedId}`;
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

    const requestedIds = Array.isArray(body.calendar_ids)
      ? body.calendar_ids.map((id) => String(id).trim()).filter(Boolean)
      : null;
    const wantsId = (id: string) =>
      !requestedIds || requestedIds.length === 0 || requestedIds.includes(id);

    // --- Personal ICS feeds (Google etc.) — independent of Graph mailbox calendars ---
    const { data: feedRows } = await service
      .from('personal_calendar_feeds')
      .select('id, name, color, url_enc')
      .eq('sales_user_id', salesUser.id)
      .order('created_at', { ascending: true });

    const icsCalendars: PortalCalendar[] = [];
    const icsEvents: Array<Record<string, unknown>> = [];
    const calendarErrors: Array<{
      calendar_id: string | null;
      calendar_name: string | null;
      error: string;
    }> = [];

    for (const feed of feedRows ?? []) {
      const calId = icsCalendarId(feed.id);
      const cal: PortalCalendar = {
        id: calId,
        name: feed.name || 'Personal',
        color: feed.color || '#5B8DEF',
        is_default: false,
        can_edit: false,
        owner_name: null,
        owner_email: null,
        source: 'ics',
      };
      icsCalendars.push(cal);
      if (!wantsId(calId)) continue;

      try {
        const url = await decryptSecret(feed.url_enc, config.encryptionKey);
        const events = await fetchIcsFeed(url, startMs, endMs);
        for (const ev of events) {
          icsEvents.push({
            id: ev.uid,
            subject: ev.summary,
            body_preview: ev.description,
            is_all_day: ev.isAllDay,
            show_as: null,
            web_link: null,
            location: ev.location,
            start: ev.startIso,
            start_timezone: 'UTC',
            end: ev.endIso,
            end_timezone: 'UTC',
            organizer_name: null,
            organizer_email: null,
            is_online_meeting: false,
            online_meeting_url: null,
            calendar_id: calId,
            calendar_name: cal.name,
            calendar_color: cal.color,
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load ICS feed';
        calendarErrors.push({
          calendar_id: calId,
          calendar_name: cal.name,
          error: msg,
        });
      }
    }

    // --- Microsoft Graph calendars ---
    let accessToken: string | null = null;
    let graphNeedsReconnect = false;
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
      // If we have ICS feeds, still return those; otherwise require reconnect.
      if (icsCalendars.length === 0) {
        return jsonResponse(
          { error: message, needs_reconnect: true },
          401,
          origin,
        );
      }
      graphNeedsReconnect = true;
    }

    let graphCalendars: PortalCalendar[] = [];
    let graphEvents: Array<Record<string, unknown>> = [];

    if (accessToken) {
      let rawGraph: GraphCalendar[] = [];
      try {
        rawGraph = await fetchCalendars(accessToken);
      } catch (err) {
        const status = (err as Error & { status?: number }).status;
        const message = err instanceof Error ? err.message : 'Failed to list calendars';
        if (status === 401 || status === 403) {
          if (icsCalendars.length === 0) {
            return jsonResponse(
              {
                error:
                  'Microsoft connection needs Calendars.Read (or Calendars.ReadWrite). Reconnect after admin consent.',
                needs_reconnect: true,
                needs_scope_upgrade: true,
                detail: message,
              },
              403,
              origin,
            );
          }
          graphNeedsReconnect = true;
        } else {
          // Soft-fail list (429 MailboxConcurrency, transient Graph errors): keep ICS.
          calendarErrors.push({
            calendar_id: null,
            calendar_name: 'Outlook calendars',
            error: message,
          });
        }
      }

      graphCalendars = rawGraph
        .filter((c) => Boolean(c.id))
        .map((c) => ({
          id: c.id,
          name: c.name || 'Calendar',
          color: resolveCalendarColor(c),
          is_default: Boolean(c.isDefaultCalendar),
          can_edit: Boolean(c.canEdit),
          owner_name: c.owner?.name ?? null,
          owner_email: c.owner?.address ?? null,
          source: 'graph' as const,
        }));

      const targetGraph = graphCalendars.filter((c) => wantsId(c.id));

      // Cap parallel calendarView calls — unbounded Promise.all hits MailboxConcurrency.
      const settled = await mapWithConcurrency(
        targetGraph,
        GRAPH_CALENDAR_VIEW_CONCURRENCY,
        async (cal) => {
          const events = await fetchCalendarView(accessToken!, start, end, cal.id);
          return events.map((ev) => ({
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
            is_online_meeting: Boolean(ev.isOnlineMeeting || ev.onlineMeeting?.joinUrl),
            online_meeting_url: ev.onlineMeeting?.joinUrl ?? null,
            calendar_id: cal.id,
            calendar_name: cal.name,
            calendar_color: cal.color,
          }));
        },
      );

      graphEvents = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
      settled.forEach((r, i) => {
        if (r.status !== 'rejected') return;
        const cal = targetGraph[i];
        const msg = r.reason instanceof Error ? r.reason.message : 'Failed';
        calendarErrors.push({
          calendar_id: cal?.id ?? null,
          calendar_name: cal?.name ?? null,
          error: msg,
        });
      });

      const graphHadFailures = calendarErrors.some(
        (e) => e.calendar_id == null || !String(e.calendar_id).startsWith('ics:'),
      );
      await service
        .from('microsoft_calendar_connections')
        .update({
          last_synced_at: new Date().toISOString(),
          last_error: graphHadFailures
            ? calendarErrors.find(
                (e) => e.calendar_id == null || !String(e.calendar_id).startsWith('ics:'),
              )?.error ?? 'Some Outlook calendars failed to load'
            : null,
          updated_at: new Date().toISOString(),
        })
        .eq('sales_user_id', salesUser.id);
    }

    const calendars = [...graphCalendars, ...icsCalendars];
    const events = [...graphEvents, ...icsEvents].sort((a, b) => {
      const as = String(a.start ?? '');
      const bs = String(b.start ?? '');
      return as.localeCompare(bs);
    });

    if (body.audit !== false) {
      await auditMsAction(service, {
        userId: salesUser.id,
        email: salesUser.email,
        eventType: 'calendar_view',
        path: '/sales/calendar',
        metadata: {
          start,
          end,
          event_count: events.length,
          calendar_count: calendars.length,
          graph_calendar_count: graphCalendars.length,
          ics_calendar_count: icsCalendars.length,
          calendar_error_count: calendarErrors.length,
        },
      });
    }

    const triedGraph = Boolean(accessToken) && graphCalendars.length > 0;
    const icsRequested = icsCalendars.filter((c) => wantsId(c.id));
    const icsFailedIds = new Set(
      calendarErrors
        .map((e) => e.calendar_id)
        .filter((id): id is string => Boolean(id?.startsWith('ics:'))),
    );
    const anyIcsOk = icsRequested.some((c) => !icsFailedIds.has(c.id));
    const allErrorsThrottle = calendarErrors.every((e) =>
      /429|503|throttl|MailboxConcurrency|ApplicationThrottled/i.test(e.error),
    );
    if (
      triedGraph &&
      graphEvents.length === 0 &&
      !anyIcsOk &&
      calendarErrors.length > 0 &&
      calendarErrors.length >=
        graphCalendars.filter((c) => wantsId(c.id)).length + icsRequested.length &&
      !allErrorsThrottle
    ) {
      const first = calendarErrors[0];
      const needsReconnect = /401|403|Unauthorized|Forbidden|scope/i.test(first.error);
      return jsonResponse(
        {
          error: needsReconnect
            ? 'Could not read calendars. Reconnect Microsoft if Calendars.Read was recently granted.'
            : first.error,
          needs_reconnect: needsReconnect,
          calendars,
          events: [],
          calendar_errors: calendarErrors,
          personal_calendar_hint:
            'Outlook “Add personal calendars” (Google) is not available via Microsoft Graph. Add a Google secret ICS URL under Calendar settings, or Subscribe from web in Outlook on the web.',
          start,
          end,
        },
        needsReconnect ? 403 : 500,
        origin,
      );
    }

    return jsonResponse(
      {
        events,
        calendars,
        calendar_errors: calendarErrors,
        needs_reconnect: graphNeedsReconnect || undefined,
        personal_calendar_hint:
          icsCalendars.length === 0
            ? 'Missing a Google/personal calendar? Outlook “Add personal calendars” does not sync to Graph. Paste a Google secret ICS URL in Calendar settings, or use Outlook → Add calendar → Subscribe from web.'
            : null,
        start,
        end,
      },
      200,
      origin,
    );
  } catch (err) {
    console.error('microsoft-calendar-events', err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : 'Failed to load events' },
      500,
      origin,
    );
  }
});
