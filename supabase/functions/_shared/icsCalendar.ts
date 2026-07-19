/** Minimal ICS fetch + VEVENT parse for personal calendar overlays (Google, etc.). */

export type IcsEvent = {
  uid: string;
  summary: string;
  description: string | null;
  location: string | null;
  isAllDay: boolean;
  startIso: string;
  endIso: string;
};

function unfoldIcs(raw: string): string {
  // RFC 5545 line folding: CRLF + WSP
  return raw.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
}

function unescapeText(value: string): string {
  return value
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

function parseIcsDate(
  prop: string,
  value: string,
): { iso: string; isAllDay: boolean } | null {
  const upper = prop.toUpperCase();
  const isAllDay = /VALUE=DATE/i.test(upper) || (/^\d{8}$/.test(value) && !value.includes('T'));
  if (isAllDay) {
    const y = value.slice(0, 4);
    const m = value.slice(4, 6);
    const d = value.slice(6, 8);
    if (!y || !m || !d) return null;
    // Midnight UTC for all-day start; callers treat isAllDay separately.
    return { iso: `${y}-${m}-${d}T00:00:00.000Z`, isAllDay: true };
  }

  // DATE-TIME: 20260715T140000Z or 20260715T140000 (floating) or with TZID in prop
  const m = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (!m) return null;
  const [, yy, mo, dd, hh, mi, ss, z] = m;
  if (z === 'Z') {
    return {
      iso: `${yy}-${mo}-${dd}T${hh}:${mi}:${ss}.000Z`,
      isAllDay: false,
    };
  }
  // Floating / TZID local — treat as UTC wall (best-effort; Google private feeds usually use Z).
  return {
    iso: `${yy}-${mo}-${dd}T${hh}:${mi}:${ss}.000Z`,
    isAllDay: false,
  };
}

function propParts(line: string): { name: string; params: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon < 0) return null;
  const left = line.slice(0, colon);
  const value = line.slice(colon + 1);
  const semi = left.indexOf(';');
  if (semi < 0) return { name: left.toUpperCase(), params: '', value };
  return {
    name: left.slice(0, semi).toUpperCase(),
    params: left.slice(semi + 1),
    value,
  };
}

/** Parse VEVENT blocks; keep those overlapping [startMs, endMs). */
export function parseIcsEvents(
  icsText: string,
  startMs: number,
  endMs: number,
): IcsEvent[] {
  const text = unfoldIcs(icsText);
  const lines = text.split(/\r?\n/);
  const events: IcsEvent[] = [];
  let inEvent = false;
  let cur: Record<string, { params: string; value: string }> = {};

  const flush = () => {
    const uid = cur.UID?.value?.trim() || crypto.randomUUID();
    const summary = unescapeText(cur.SUMMARY?.value ?? '(No title)').trim() || '(No title)';
    const description = cur.DESCRIPTION
      ? unescapeText(cur.DESCRIPTION.value).trim() || null
      : null;
    const location = cur.LOCATION
      ? unescapeText(cur.LOCATION.value).trim() || null
      : null;

    const startRaw = cur.DTSTART;
    if (!startRaw) return;
    const start = parseIcsDate(`DTSTART;${startRaw.params}`, startRaw.value.trim());
    if (!start) return;

    let end: { iso: string; isAllDay: boolean } | null = null;
    if (cur.DTEND) {
      end = parseIcsDate(`DTEND;${cur.DTEND.params}`, cur.DTEND.value.trim());
    } else if (cur.DURATION?.value) {
      // Skip complex durations; treat as 1 hour timed / 1 day all-day.
      const startDate = new Date(start.iso);
      const durMs = start.isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      end = {
        iso: new Date(startDate.getTime() + durMs).toISOString(),
        isAllDay: start.isAllDay,
      };
    } else {
      const startDate = new Date(start.iso);
      const durMs = start.isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000;
      end = {
        iso: new Date(startDate.getTime() + durMs).toISOString(),
        isAllDay: start.isAllDay,
      };
    }
    if (!end) return;

    const evStart = Date.parse(start.iso);
    const evEnd = Date.parse(end.iso);
    if (Number.isNaN(evStart) || Number.isNaN(evEnd)) return;
    // Overlap with requested window
    if (evEnd <= startMs || evStart >= endMs) return;

    events.push({
      uid,
      summary,
      description,
      location,
      isAllDay: start.isAllDay,
      startIso: start.iso,
      endIso: end.iso,
    });
  };

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      cur = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (inEvent) flush();
      inEvent = false;
      cur = {};
      continue;
    }
    if (!inEvent) continue;
    const p = propParts(line);
    if (!p) continue;
    // First occurrence wins for standard fields (ignore overrides in this minimal parser).
    if (!cur[p.name]) cur[p.name] = { params: p.params, value: p.value };
  }

  return events;
}

export async function fetchIcsFeed(
  feedUrl: string,
  startMs: number,
  endMs: number,
): Promise<IcsEvent[]> {
  const url = feedUrl.trim();
  if (!/^https:\/\//i.test(url)) {
    throw new Error('ICS URL must be https');
  }
  // Block obvious non-calendar hosts misuse; still allow Google/Outlook/Apple/etc.
  if (url.length > 2048) {
    throw new Error('ICS URL too long');
  }

  const res = await fetch(url, {
    headers: {
      Accept: 'text/calendar, text/plain, */*',
      'User-Agent': 'TagePortalCalendar/1.0',
    },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new Error(`ICS fetch failed: ${res.status}`);
  }
  const text = await res.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error('Response is not a valid ICS calendar');
  }
  return parseIcsEvents(text, startMs, endMs);
}

export function isLikelyIcsUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u.startsWith('https://')) return false;
  return (
    u.includes('.ics') ||
    u.includes('calendar.google.com/calendar/ical') ||
    u.includes('/ical/') ||
    u.includes('outlook.office') ||
    u.includes('outlook.live')
  );
}
