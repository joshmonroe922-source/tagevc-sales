/**
 * Microsoft Graph calendar → soft DND signals.
 *
 * Signals used (when MS_GRAPH_* configured + user UPN known):
 * - GET /users/{upn}/mailboxSettings → timeZone
 * - GET /users/{upn}/calendar/getSchedule or calendarView for "busy"/"oof"
 * - showAs in { busy, oof, workingElsewhere } within the next window → calendar DND
 *
 * Fail soft when tenant credentials or user lookup are missing.
 */

import { windowsTimezoneToIana } from '@/lib/timezone/user-timezone';

function graphConfigured(): boolean {
  return Boolean(
    process.env.MS_GRAPH_TENANT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_ID?.trim() &&
      process.env.MS_GRAPH_CLIENT_SECRET?.trim(),
  );
}

async function getAppToken(): Promise<string | null> {
  if (!graphConfigured()) return null;
  const tenant = process.env.MS_GRAPH_TENANT_ID!.trim();
  const clientId = process.env.MS_GRAPH_CLIENT_ID!.trim();
  const clientSecret = process.env.MS_GRAPH_CLIENT_SECRET!.trim();
  try {
    const res = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'https://graph.microsoft.com/.default',
          grant_type: 'client_credentials',
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { access_token?: string };
    return json.access_token ?? null;
  } catch {
    return null;
  }
}

export type CalendarPresenceHint = {
  configured: boolean;
  microsoftTimezone: string | null;
  busyUntil: string | null;
  showAs: string | null;
  note: string;
};

/**
 * Best-effort calendar busy check for the next few hours.
 * Requires Application permission Calendars.Read (or equivalent) on the tenant.
 */
export async function fetchCalendarPresenceHint(
  userPrincipalName: string,
): Promise<CalendarPresenceHint> {
  const empty = (note: string): CalendarPresenceHint => ({
    configured: graphConfigured(),
    microsoftTimezone: null,
    busyUntil: null,
    showAs: null,
    note,
  });

  if (!graphConfigured()) {
    return empty('MS Graph not configured — calendar presence skipped');
  }
  const upn = userPrincipalName.trim();
  if (!upn) return empty('No user principal for calendar lookup');

  const token = await getAppToken();
  if (!token) return empty('Could not obtain Graph app token');

  let microsoftTimezone: string | null = null;
  try {
    const mb = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/mailboxSettings`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (mb.ok) {
      const body = (await mb.json()) as { timeZone?: string };
      microsoftTimezone = windowsTimezoneToIana(body.timeZone ?? null);
    }
  } catch {
    /* fail soft */
  }

  const start = new Date();
  const end = new Date(start.getTime() + 4 * 60 * 60 * 1000);
  try {
    const view = await fetch(
      `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(upn)}/calendarView?startDateTime=${encodeURIComponent(start.toISOString())}&endDateTime=${encodeURIComponent(end.toISOString())}&$select=showAs,end,subject&$top=10`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
        },
      },
    );
    if (!view.ok) {
      return {
        configured: true,
        microsoftTimezone,
        busyUntil: null,
        showAs: null,
        note: `Calendar view unavailable (${view.status}) — check Calendars.Read app permission`,
      };
    }
    const payload = (await view.json()) as {
      value?: Array<{ showAs?: string; end?: { dateTime?: string } }>;
    };
    const busyShows = new Set(['busy', 'oof', 'workingElsewhere']);
    let busyUntil: string | null = null;
    let showAs: string | null = null;
    for (const ev of payload.value ?? []) {
      const sa = (ev.showAs ?? '').toLowerCase();
      if (!busyShows.has(sa)) continue;
      showAs = sa;
      const endAt = ev.end?.dateTime ? new Date(`${ev.end.dateTime}Z`).toISOString() : null;
      if (endAt && (!busyUntil || endAt > busyUntil)) busyUntil = endAt;
    }
    return {
      configured: true,
      microsoftTimezone,
      busyUntil,
      showAs,
      note: busyUntil
        ? `Calendar ${showAs} until ${busyUntil}`
        : 'No busy/focus blocks in next 4h',
    };
  } catch (e) {
    return {
      configured: true,
      microsoftTimezone,
      busyUntil: null,
      showAs: null,
      note: e instanceof Error ? e.message : 'Calendar lookup failed',
    };
  }
}
