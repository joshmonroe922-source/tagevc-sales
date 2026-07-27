/**
 * Shared reporting timeframes for Tage OS + every subsidiary OS scaffold.
 *
 * Ported from My Recruiting Desk (`Recruiting Tools` → `src/lib/performance/periods.ts`)
 * and generalized: day / week / month / quarter / ytd / custom, timezone-aware.
 *
 * Copy this file into new subsidiary portals under `src/lib/platform/` (or import
 * from a future shared package). Do not invent per-app date math.
 */

export type ReportingPeriod =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'ytd'
  | 'custom';

/** Presets shown in UI chips by default (matches desk day/week/month habit). */
export const DEFAULT_REPORTING_PERIODS: ReportingPeriod[] = [
  'day',
  'week',
  'month',
];

/** Extended presets for leadership / finance boards. */
export const EXTENDED_REPORTING_PERIODS: ReportingPeriod[] = [
  'day',
  'week',
  'month',
  'quarter',
  'ytd',
];

export const DEFAULT_REPORTING_TIMEZONE = 'America/New_York';

type Ymd = { y: number; m: number; d: number };

function localYmd(date: Date, timeZone: string): Ymd {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? NaN);
  return { y: get('year'), m: get('month'), d: get('day') };
}

function timeZoneOffsetMs(utcInstant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(utcInstant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  return asUtc - utcInstant.getTime();
}

/** UTC instant for a civil local datetime in `timeZone`. */
export function zonedLocalToUtc(
  y: number,
  m: number,
  d: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, hour, minute, second));
  const offset = timeZoneOffsetMs(guess, timeZone);
  const refined = new Date(guess.getTime() - offset);
  const offset2 = timeZoneOffsetMs(refined, timeZone);
  return new Date(guess.getTime() - offset2);
}

function startOfLocalDay(ymd: Ymd, timeZone: string): Date {
  return zonedLocalToUtc(ymd.y, ymd.m, ymd.d, 0, 0, 0, timeZone);
}

/** Monday = start of week (ISO-style), in the viewer's local timezone. */
function startOfLocalWeek(now: Date, timeZone: string): Date {
  const { y, m, d } = localYmd(now, timeZone);
  const noon = zonedLocalToUtc(y, m, d, 12, 0, 0, timeZone);
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
  }).format(noon);
  const monOffset: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const daysBack = monOffset[weekday] ?? 0;
  const monday = new Date(noon.getTime() - daysBack * 86_400_000);
  return startOfLocalDay(localYmd(monday, timeZone), timeZone);
}

function startOfLocalMonth(now: Date, timeZone: string): Date {
  const { y, m } = localYmd(now, timeZone);
  return zonedLocalToUtc(y, m, 1, 0, 0, 0, timeZone);
}

function startOfLocalQuarter(now: Date, timeZone: string): Date {
  const { y, m } = localYmd(now, timeZone);
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  return zonedLocalToUtc(y, qStartMonth, 1, 0, 0, 0, timeZone);
}

function startOfLocalYear(now: Date, timeZone: string): Date {
  const { y } = localYmd(now, timeZone);
  return zonedLocalToUtc(y, 1, 1, 0, 0, 0, timeZone);
}

export function isValidIanaTimeZone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveReportingTimeZone(tz?: string | null): string {
  if (tz && isValidIanaTimeZone(tz)) return tz;
  return DEFAULT_REPORTING_TIMEZONE;
}

export type ReportingWindow = {
  period: ReportingPeriod;
  start: Date;
  end: Date;
  /** Short chip label */
  label: string;
  /** Shown under metrics — clarifies the window */
  rangeLabel: string;
  timeZone: string;
};

function formatRange(start: Date, end: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  });
  const startStr = fmt.format(start);
  const endStr = fmt.format(end);
  const tzLabel = timeZone.replace(/_/g, ' ');
  if (startStr === endStr) return `${startStr} · ${tzLabel}`;
  return `${startStr} – ${endStr} · ${tzLabel}`;
}

export type CustomReportingRange = {
  start: Date;
  end: Date;
};

export function reportingWindow(
  period: ReportingPeriod,
  timeZone: string,
  now = new Date(),
  custom?: CustomReportingRange,
): ReportingWindow {
  const tz = resolveReportingTimeZone(timeZone);
  const end = now;
  let start: Date;
  let label: string;

  if (period === 'custom') {
    if (!custom?.start || !custom?.end) {
      throw new Error('custom reporting period requires start and end');
    }
    start = custom.start;
    const customEnd = custom.end;
    return {
      period,
      start,
      end: customEnd,
      label: 'Custom',
      rangeLabel: formatRange(start, customEnd, tz),
      timeZone: tz,
    };
  }

  if (period === 'day') {
    start = startOfLocalDay(localYmd(now, tz), tz);
    label = 'Today';
  } else if (period === 'week') {
    start = startOfLocalWeek(now, tz);
    label = 'This week';
  } else if (period === 'month') {
    start = startOfLocalMonth(now, tz);
    label = 'This month';
  } else if (period === 'quarter') {
    start = startOfLocalQuarter(now, tz);
    label = 'This quarter';
  } else {
    start = startOfLocalYear(now, tz);
    label = 'YTD';
  }

  return {
    period,
    start,
    end,
    label,
    rangeLabel: formatRange(start, end, tz),
    timeZone: tz,
  };
}

export function allReportingWindows(
  timeZone: string,
  now = new Date(),
  periods: ReportingPeriod[] = DEFAULT_REPORTING_PERIODS,
): Partial<Record<ReportingPeriod, ReportingWindow>> {
  const out: Partial<Record<ReportingPeriod, ReportingWindow>> = {};
  for (const p of periods) {
    if (p === 'custom') continue;
    out[p] = reportingWindow(p, timeZone, now);
  }
  return out;
}

/** True when `iso` falls inside [start, end] (inclusive end). */
export function isIsoInReportingWindow(
  iso: string | null | undefined,
  window: Pick<ReportingWindow, 'start' | 'end'>,
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  return t >= window.start.getTime() && t <= window.end.getTime();
}

/** Parse `?period=` query values safely. */
export function parseReportingPeriodParam(
  raw: string | null | undefined,
  fallback: ReportingPeriod = 'week',
): ReportingPeriod {
  const v = (raw ?? '').trim().toLowerCase();
  if (
    v === 'day' ||
    v === 'week' ||
    v === 'month' ||
    v === 'quarter' ||
    v === 'ytd' ||
    v === 'custom'
  ) {
    return v;
  }
  return fallback;
}
