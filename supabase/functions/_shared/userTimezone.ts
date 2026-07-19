/** Deno-compatible timezone helpers (mirrors src/lib/userTimezone.ts). */

export const DEFAULT_TIMEZONE = 'America/Indiana/Indianapolis';

const WINDOWS_TO_IANA: Record<string, string> = {
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time': 'America/Denver',
  'Central Standard Time': 'America/Chicago',
  'Eastern Standard Time': 'America/New_York',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Hawaii-Aleutian Standard Time': 'America/Adak',
  'Alaskan Standard Time': 'America/Anchorage',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Romance Standard Time': 'Europe/Paris',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'China Standard Time': 'Asia/Shanghai',
  'India Standard Time': 'Asia/Kolkata',
  'AUS Eastern Standard Time': 'Australia/Sydney',
};

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function windowsToIana(tz: string | null | undefined): string | null {
  const raw = (tz ?? '').trim();
  if (!raw) return null;
  if (raw.includes('/') || raw === 'UTC' || raw === 'Etc/UTC') {
    return isValidTimeZone(raw) ? raw : null;
  }
  const mapped = WINDOWS_TO_IANA[raw];
  if (mapped && isValidTimeZone(mapped)) return mapped;
  return null;
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  let hour = Number(bag.hour);
  if (hour === 24) hour = 0;
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour,
    minute: Number(bag.minute),
    second: Number(bag.second),
  };
}

export function wallTimeInZoneToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  let utc = Date.UTC(year, month - 1, day, hour, minute, second);
  for (let i = 0; i < 3; i++) {
    const parts = getZonedParts(new Date(utc), timeZone);
    const asUtc = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second,
    );
    const wanted = Date.UTC(year, month - 1, day, hour, minute, second);
    utc += wanted - asUtc;
  }
  return new Date(utc);
}

export function zonedDayKey(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return wallTimeInZoneToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function endOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return wallTimeInZoneToUtc(p.year, p.month, p.day, 23, 59, 59, timeZone);
}

/** True when local wall time is in [targetHour:00, targetHour:windowMinutes). */
export function isInLocalHourWindow(
  now: Date,
  timeZone: string,
  targetHour = 6,
  windowMinutes = 15,
): boolean {
  const p = getZonedParts(now, timeZone);
  if (p.hour !== targetHour) return false;
  return p.minute < windowMinutes;
}

export function formatTimeInZone(
  date: Date,
  timeZone: string,
  opts?: { allDay?: boolean },
): string {
  if (opts?.allDay) return 'All day';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour: 'numeric',
      minute: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString();
  }
}

export function parseGraphDateTime(
  iso: string | null | undefined,
  graphTimeZone?: string | null,
): Date | null {
  if (!iso?.trim()) return null;
  const raw = iso.trim();
  // Graph calendarView with Prefer outlook.timezone="UTC" returns naive UTC-ish strings
  if (/Z$/i.test(raw) || /[+-]\d{2}:\d{2}$/.test(raw)) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const asUtc = new Date(raw.endsWith('Z') ? raw : `${raw}Z`);
  if (!Number.isNaN(asUtc.getTime())) return asUtc;
  const tz = windowsToIana(graphTimeZone) ?? 'UTC';
  const m = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/,
  );
  if (!m) return null;
  return wallTimeInZoneToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
    tz,
  );
}
