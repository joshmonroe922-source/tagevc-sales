/** Portal calendar / Today timezone preference (IANA). */

export const DEFAULT_TIMEZONE = 'America/Indiana/Indianapolis';

const OVERRIDE_KEY = 'tage.calendar.preferred_timezone';
const MAILBOX_KEY = 'tage.calendar.mailbox_timezone';

export type TimezoneSource = 'override' | 'mailbox' | 'browser' | 'default';

export type ResolvedTimezone = {
  timeZone: string;
  source: TimezoneSource;
  /** Raw Graph / Windows name when source is mailbox (before IANA map). */
  mailboxRaw?: string | null;
};

/** Common US / work zones for the Settings control. */
export const COMMON_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: 'America/Indiana/Indianapolis', label: 'Eastern — Indianapolis' },
  { value: 'America/New_York', label: 'Eastern — New York' },
  { value: 'America/Chicago', label: 'Central' },
  { value: 'America/Denver', label: 'Mountain' },
  { value: 'America/Phoenix', label: 'Arizona (no DST)' },
  { value: 'America/Los_Angeles', label: 'Pacific' },
  { value: 'UTC', label: 'UTC' },
];

/** Graph mailboxSettings often returns Windows timezone IDs. */
const WINDOWS_TO_IANA: Record<string, string> = {
  'Dateline Standard Time': 'Etc/GMT+12',
  'UTC-11': 'Etc/GMT+11',
  'Aleutian Standard Time': 'America/Adak',
  'Hawaiian Standard Time': 'Pacific/Honolulu',
  'Marquesas Standard Time': 'Pacific/Marquesas',
  'Alaskan Standard Time': 'America/Anchorage',
  'UTC-09': 'Etc/GMT+9',
  'Pacific Standard Time (Mexico)': 'America/Tijuana',
  'UTC-08': 'Etc/GMT+8',
  'Pacific Standard Time': 'America/Los_Angeles',
  'US Mountain Standard Time': 'America/Phoenix',
  'Mountain Standard Time (Mexico)': 'America/Mazatlan',
  'Mountain Standard Time': 'America/Denver',
  'Central America Standard Time': 'America/Guatemala',
  'Central Standard Time': 'America/Chicago',
  'Easter Island Standard Time': 'Pacific/Easter',
  'Central Standard Time (Mexico)': 'America/Mexico_City',
  'Canada Central Standard Time': 'America/Regina',
  'SA Pacific Standard Time': 'America/Bogota',
  'Eastern Standard Time (Mexico)': 'America/Cancun',
  'Eastern Standard Time': 'America/New_York',
  'Hawaii-Aleutian Standard Time': 'America/Adak',
  'US Eastern Standard Time': 'America/Indiana/Indianapolis',
  'Cuba Standard Time': 'America/Havana',
  'SA Western Standard Time': 'America/La_Paz',
  'Atlantic Standard Time': 'America/Halifax',
  'Venezuela Standard Time': 'America/Caracas',
  'Central Brazilian Standard Time': 'America/Cuiaba',
  'SA Eastern Standard Time': 'America/Cayenne',
  'Newfoundland Standard Time': 'America/St_Johns',
  'Tocantins Standard Time': 'America/Araguaina',
  'Paraguay Standard Time': 'America/Asuncion',
  'E. South America Standard Time': 'America/Sao_Paulo',
  'Argentina Standard Time': 'America/Argentina/Buenos_Aires',
  'Greenland Standard Time': 'America/Nuuk',
  'Montevideo Standard Time': 'America/Montevideo',
  'Magallanes Standard Time': 'America/Punta_Arenas',
  'Saint Pierre Standard Time': 'America/Miquelon',
  'Bahia Standard Time': 'America/Bahia',
  'UTC-02': 'Etc/GMT+2',
  'Azores Standard Time': 'Atlantic/Azores',
  'Cape Verde Standard Time': 'Atlantic/Cape_Verde',
  UTC: 'UTC',
  'GMT Standard Time': 'Europe/London',
  'Greenwich Standard Time': 'Atlantic/Reykjavik',
  'Sao Tome Standard Time': 'Africa/Sao_Tome',
  'Morocco Standard Time': 'Africa/Casablanca',
  'W. Europe Standard Time': 'Europe/Berlin',
  'Central Europe Standard Time': 'Europe/Budapest',
  'Romance Standard Time': 'Europe/Paris',
  'Central European Standard Time': 'Europe/Warsaw',
  'W. Central Africa Standard Time': 'Africa/Lagos',
  'Jordan Standard Time': 'Asia/Amman',
  'GTB Standard Time': 'Europe/Bucharest',
  'Middle East Standard Time': 'Asia/Beirut',
  'Egypt Standard Time': 'Africa/Cairo',
  'E. Europe Standard Time': 'Europe/Chisinau',
  'Syria Standard Time': 'Asia/Damascus',
  'West Bank Standard Time': 'Asia/Hebron',
  'South Africa Standard Time': 'Africa/Johannesburg',
  'FLE Standard Time': 'Europe/Kiev',
  'Israel Standard Time': 'Asia/Jerusalem',
  'Kaliningrad Standard Time': 'Europe/Kaliningrad',
  'Sudan Standard Time': 'Africa/Khartoum',
  'Libya Standard Time': 'Africa/Tripoli',
  'Namibia Standard Time': 'Africa/Windhoek',
  'Arabic Standard Time': 'Asia/Baghdad',
  'Turkey Standard Time': 'Europe/Istanbul',
  'Arab Standard Time': 'Asia/Riyadh',
  'Belarus Standard Time': 'Europe/Minsk',
  'Russian Standard Time': 'Europe/Moscow',
  'E. Africa Standard Time': 'Africa/Nairobi',
  'Iran Standard Time': 'Asia/Tehran',
  'Arabian Standard Time': 'Asia/Dubai',
  'Astrakhan Standard Time': 'Europe/Astrakhan',
  'Azerbaijan Standard Time': 'Asia/Baku',
  'Russia Time Zone 3': 'Europe/Samara',
  'Mauritius Standard Time': 'Indian/Mauritius',
  'Saratov Standard Time': 'Europe/Saratov',
  'Georgian Standard Time': 'Asia/Tbilisi',
  'Volgograd Standard Time': 'Europe/Volgograd',
  'Caucasus Standard Time': 'Asia/Yerevan',
  'Afghanistan Standard Time': 'Asia/Kabul',
  'West Asia Standard Time': 'Asia/Tashkent',
  'Ekaterinburg Standard Time': 'Asia/Yekaterinburg',
  'Pakistan Standard Time': 'Asia/Karachi',
  'Qyzylorda Standard Time': 'Asia/Qyzylorda',
  'India Standard Time': 'Asia/Kolkata',
  'Sri Lanka Standard Time': 'Asia/Colombo',
  'Nepal Standard Time': 'Asia/Kathmandu',
  'Central Asia Standard Time': 'Asia/Almaty',
  'Bangladesh Standard Time': 'Asia/Dhaka',
  'Omsk Standard Time': 'Asia/Omsk',
  'Myanmar Standard Time': 'Asia/Yangon',
  'SE Asia Standard Time': 'Asia/Bangkok',
  'Altai Standard Time': 'Asia/Barnaul',
  'W. Mongolia Standard Time': 'Asia/Hovd',
  'North Asia Standard Time': 'Asia/Krasnoyarsk',
  'N. Central Asia Standard Time': 'Asia/Novosibirsk',
  'Tomsk Standard Time': 'Asia/Tomsk',
  'China Standard Time': 'Asia/Shanghai',
  'North Asia East Standard Time': 'Asia/Irkutsk',
  'Singapore Standard Time': 'Asia/Singapore',
  'W. Australia Standard Time': 'Australia/Perth',
  'Taipei Standard Time': 'Asia/Taipei',
  'Ulaanbaatar Standard Time': 'Asia/Ulaanbaatar',
  'Aus Central W. Standard Time': 'Australia/Eucla',
  'Transbaikal Standard Time': 'Asia/Chita',
  'Tokyo Standard Time': 'Asia/Tokyo',
  'North Korea Standard Time': 'Asia/Pyongyang',
  'Korea Standard Time': 'Asia/Seoul',
  'Yakutsk Standard Time': 'Asia/Yakutsk',
  'Cen. Australia Standard Time': 'Australia/Adelaide',
  'AUS Central Standard Time': 'Australia/Darwin',
  'E. Australia Standard Time': 'Australia/Brisbane',
  'AUS Eastern Standard Time': 'Australia/Sydney',
  'West Pacific Standard Time': 'Pacific/Port_Moresby',
  'Tasmania Standard Time': 'Australia/Hobart',
  'Vladivostok Standard Time': 'Asia/Vladivostok',
  'Lord Howe Standard Time': 'Australia/Lord_Howe',
  'Bougainville Standard Time': 'Pacific/Bougainville',
  'Russia Time Zone 10': 'Asia/Srednekolymsk',
  'Magadan Standard Time': 'Asia/Magadan',
  'Norfolk Standard Time': 'Pacific/Norfolk',
  'Sakhalin Standard Time': 'Asia/Sakhalin',
  'Central Pacific Standard Time': 'Pacific/Guadalcanal',
  'Russia Time Zone 11': 'Asia/Kamchatka',
  'New Zealand Standard Time': 'Pacific/Auckland',
  'UTC+12': 'Etc/GMT-12',
  'Fiji Standard Time': 'Pacific/Fiji',
  'Chatham Islands Standard Time': 'Pacific/Chatham',
  'UTC+13': 'Etc/GMT-13',
  'Tonga Standard Time': 'Pacific/Tongatapu',
  'Samoa Standard Time': 'Pacific/Apia',
  'Line Islands Standard Time': 'Pacific/Kiritimati',
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

export function detectBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return tz && isValidTimeZone(tz) ? tz : null;
  } catch {
    return null;
  }
}

export function getPreferredTimezoneOverride(): string | null {
  try {
    const v = localStorage.getItem(OVERRIDE_KEY)?.trim() ?? '';
    return v && isValidTimeZone(v) ? v : null;
  } catch {
    return null;
  }
}

/** Pass null / empty to clear override and fall back to mailbox → browser → default. */
export function setPreferredTimezoneOverride(tz: string | null): void {
  try {
    const next = (tz ?? '').trim();
    if (!next) {
      localStorage.removeItem(OVERRIDE_KEY);
      return;
    }
    if (!isValidTimeZone(next)) return;
    localStorage.setItem(OVERRIDE_KEY, next);
  } catch {
    /* private mode */
  }
}

export function getCachedMailboxTimezone(): string | null {
  try {
    const v = localStorage.getItem(MAILBOX_KEY)?.trim() ?? '';
    return v && isValidTimeZone(v) ? v : null;
  } catch {
    return null;
  }
}

export function cacheMailboxTimezone(rawGraphTz: string | null | undefined): string | null {
  const iana = windowsToIana(rawGraphTz);
  try {
    if (iana) localStorage.setItem(MAILBOX_KEY, iana);
    else localStorage.removeItem(MAILBOX_KEY);
  } catch {
    /* private mode */
  }
  return iana;
}

/**
 * Resolve display / range timezone for Calendar & Today.
 * Order: explicit override → stored profile → mailbox (arg or cache) → browser → Indianapolis.
 */
export function resolveUserTimezone(opts?: {
  mailboxTimeZone?: string | null;
  /** IANA from sales_users.timezone (server-backed for digest cron). */
  profileTimezone?: string | null;
}): ResolvedTimezone {
  const override = getPreferredTimezoneOverride();
  if (override) {
    return { timeZone: override, source: 'override' };
  }

  const profile = (opts?.profileTimezone ?? '').trim();
  if (profile && isValidTimeZone(profile)) {
    return { timeZone: profile, source: 'override' };
  }

  const fromArg = windowsToIana(opts?.mailboxTimeZone);
  if (fromArg) {
    return {
      timeZone: fromArg,
      source: 'mailbox',
      mailboxRaw: opts?.mailboxTimeZone ?? null,
    };
  }

  const cached = getCachedMailboxTimezone();
  if (cached) {
    return { timeZone: cached, source: 'mailbox' };
  }

  const browser = detectBrowserTimezone();
  if (browser) {
    return { timeZone: browser, source: 'browser' };
  }

  return { timeZone: DEFAULT_TIMEZONE, source: 'default' };
}

export function timezoneSourceLabel(source: TimezoneSource): string {
  switch (source) {
    case 'override':
      return 'Your setting';
    case 'mailbox':
      return 'Outlook mailbox';
    case 'browser':
      return 'Browser';
    default:
      return 'Default (Indianapolis)';
  }
}

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0=Sun … 6=Sat
};

const weekdayMap: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

export function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
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
    weekday: weekdayMap[bag.weekday ?? 'Sun'] ?? 0,
  };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date. */
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

export function sameZonedDay(a: Date, b: Date, timeZone: string): boolean {
  return zonedDayKey(a, timeZone) === zonedDayKey(b, timeZone);
}

export function startOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return wallTimeInZoneToUtc(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

export function endOfZonedDay(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return wallTimeInZoneToUtc(p.year, p.month, p.day, 23, 59, 59, timeZone);
}

export function addZonedDays(date: Date, days: number, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  // Noon avoids DST edge cases when shifting calendar days
  const noon = wallTimeInZoneToUtc(p.year, p.month, p.day, 12, 0, 0, timeZone);
  const shifted = new Date(noon.getTime() + days * 24 * 60 * 60 * 1000);
  return startOfZonedDay(shifted, timeZone);
}

export function startOfZonedWeek(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return addZonedDays(startOfZonedDay(date, timeZone), -p.weekday, timeZone);
}

export function startOfZonedMonth(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  return wallTimeInZoneToUtc(p.year, p.month, 1, 0, 0, 0, timeZone);
}

export function endOfZonedMonth(date: Date, timeZone: string): Date {
  const p = getZonedParts(date, timeZone);
  const firstNext = wallTimeInZoneToUtc(
    p.month === 12 ? p.year + 1 : p.year,
    p.month === 12 ? 1 : p.month + 1,
    1,
    0,
    0,
    0,
    timeZone,
  );
  return new Date(firstNext.getTime() - 1);
}

/**
 * Parse Graph calendarView dateTime (+ timezone).
 * Events API uses Prefer UTC, so values are usually UTC wall-clock without Z.
 */
export function parseGraphDateTime(
  iso: string | null | undefined,
  graphTimeZone?: string | null,
): Date | null {
  if (!iso) return null;
  const cleaned = iso.trim().replace(' ', 'T');
  if (/Z$|[+-]\d{2}:\d{2}$/.test(cleaned)) {
    const d = new Date(cleaned);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = cleaned.match(
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?$/,
  );
  if (!m) {
    const d = new Date(cleaned);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const hour = Number(m[4]);
  const minute = Number(m[5]);
  const second = Number(m[6] ?? '0');

  const tzRaw = (graphTimeZone ?? 'UTC').trim() || 'UTC';
  const iana =
    windowsToIana(tzRaw) ??
    (isValidTimeZone(tzRaw) ? tzRaw : null) ??
    'UTC';

  if (iana === 'UTC' || iana === 'Etc/UTC') {
    return new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  }

  return wallTimeInZoneToUtc(year, month, day, hour, minute, second, iana);
}

export function formatInTimeZone(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): string {
  return date.toLocaleString(undefined, { ...options, timeZone });
}

export function formatTimeInZone(date: Date, timeZone: string, allDay: boolean): string {
  if (allDay) return 'All day';
  return formatInTimeZone(date, timeZone, { hour: 'numeric', minute: '2-digit' });
}

/** `datetime-local` value for wall clock in `timeZone`. */
export function toZonedInputValue(date: Date, timeZone: string): string {
  const p = getZonedParts(date, timeZone);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour)}:${pad(p.minute)}`;
}

/** Parse `datetime-local` as wall time in `timeZone` → ISO UTC. */
export function zonedInputToUtcIso(localInput: string, timeZone: string): string {
  const m = localInput.trim().match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return new Date(localInput).toISOString();
  return wallTimeInZoneToUtc(
    Number(m[1]),
    Number(m[2]),
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    0,
    timeZone,
  ).toISOString();
}

export function defaultMeetingTimesInZone(timeZone: string): {
  start: string;
  end: string;
} {
  const now = new Date();
  const p = getZonedParts(now, timeZone);
  let hour = p.hour + 1;
  let day = p.day;
  let month = p.month;
  let year = p.year;
  if (hour >= 24) {
    hour -= 24;
    const next = addZonedDays(startOfZonedDay(now, timeZone), 1, timeZone);
    const np = getZonedParts(next, timeZone);
    year = np.year;
    month = np.month;
    day = np.day;
  }
  const start = wallTimeInZoneToUtc(year, month, day, hour, 0, 0, timeZone);
  const end = wallTimeInZoneToUtc(year, month, day, hour + 1, 0, 0, timeZone);
  return {
    start: toZonedInputValue(start, timeZone),
    end: toZonedInputValue(end, timeZone),
  };
}
