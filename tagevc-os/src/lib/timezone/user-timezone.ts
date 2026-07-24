/**
 * Viewer timezone helpers.
 * Prefer Microsoft mailboxSettings.timeZone when available; else browser/cookie;
 * else America/New_York.
 */

export const DEFAULT_TIMEZONE = 'America/New_York';
export const TZ_COOKIE = 'tagevc_tz';

export function normalizeIanaTimezone(raw: string | null | undefined): string {
  const tz = (raw ?? '').trim();
  if (!tz) return DEFAULT_TIMEZONE;
  try {
    // Throws RangeError for invalid IANA zones
    Intl.DateTimeFormat(undefined, { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

export function formatInTimezone(
  value: string | Date | null | undefined,
  timeZone: string,
  variant: 'datetime' | 'date' | 'time' = 'datetime',
): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const tz = normalizeIanaTimezone(timeZone);
  const options: Intl.DateTimeFormatOptions =
    variant === 'date'
      ? { dateStyle: 'medium', timeZone: tz }
      : variant === 'time'
        ? { timeStyle: 'short', timeZone: tz }
        : { dateStyle: 'medium', timeStyle: 'short', timeZone: tz };
  try {
    return new Intl.DateTimeFormat('en-US', options).format(d);
  } catch {
    return d.toLocaleString('en-US');
  }
}

/** Map common Windows Graph timeZone names → IANA. */
const WINDOWS_TO_IANA: Record<string, string> = {
  'Eastern Standard Time': 'America/New_York',
  'Central Standard Time': 'America/Chicago',
  'Mountain Standard Time': 'America/Denver',
  'Pacific Standard Time': 'America/Los_Angeles',
  'UTC': 'UTC',
  'GMT Standard Time': 'Europe/London',
};

export function windowsTimezoneToIana(windowsName: string | null | undefined): string {
  const raw = (windowsName ?? '').trim();
  if (!raw) return DEFAULT_TIMEZONE;
  if (WINDOWS_TO_IANA[raw]) return WINDOWS_TO_IANA[raw];
  return normalizeIanaTimezone(raw);
}
