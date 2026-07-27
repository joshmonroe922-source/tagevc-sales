/**
 * Shared reporting timeframes for Tage OS.
 * Portable twin: `src/lib/platform/reporting-timeframes.ts` (scaffold copy target).
 * R619 portal also has `src/lib/reporting/timeframes.ts` (America/Los_Angeles default).
 */

export type ReportingPeriod =
  | 'day'
  | 'week'
  | 'month'
  | 'quarter'
  | 'ytd'
  | 'custom';

export type ReportingPeriodChip = 'day' | 'week' | 'month';

export const DEFAULT_REPORTING_TIMEZONE = 'America/New_York';

export const REPORTING_PERIOD_CHIPS: {
  id: ReportingPeriodChip;
  label: string;
}[] = [
  { id: 'day', label: 'Today' },
  { id: 'week', label: 'This week' },
  { id: 'month', label: 'This month' },
];

const LABELS: Record<Exclude<ReportingPeriod, 'custom'>, string> = {
  day: 'Today',
  week: 'This week',
  month: 'This month',
  quarter: 'This quarter',
  ytd: 'YTD',
};

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

export function parseReportingPeriod(
  raw: string | null | undefined,
  fallback: ReportingPeriod = 'week',
): ReportingPeriod {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'day' || v === 'today') return 'day';
  if (v === 'week' || v === 'this_week' || v === 'this-week') return 'week';
  if (v === 'month' || v === 'this_month' || v === 'this-month') return 'month';
  if (v === 'quarter' || v === 'this_quarter') return 'quarter';
  if (v === 'ytd' || v === 'year') return 'ytd';
  if (v === 'custom') return 'custom';
  return fallback;
}

export type PeriodWindow = {
  period: ReportingPeriod;
  start: Date;
  end: Date;
  label: string;
  rangeLabel: string;
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

export function periodWindow(
  period: ReportingPeriod,
  timeZone: string,
  now = new Date(),
  custom?: { start: Date; end: Date },
): PeriodWindow {
  const tz = resolveReportingTimeZone(timeZone);
  const end = now;
  let start: Date;
  let label: string;

  if (period === 'custom' && custom?.start && custom?.end) {
    return {
      period,
      start: custom.start,
      end: custom.end,
      label: 'Custom',
      rangeLabel: formatRange(custom.start, custom.end, tz),
    };
  }

  if (period === 'day') {
    start = startOfLocalDay(localYmd(now, tz), tz);
    label = LABELS.day;
  } else if (period === 'week') {
    start = startOfLocalWeek(now, tz);
    label = LABELS.week;
  } else if (period === 'month') {
    start = startOfLocalMonth(now, tz);
    label = LABELS.month;
  } else if (period === 'quarter') {
    start = startOfLocalQuarter(now, tz);
    label = LABELS.quarter;
  } else if (period === 'custom') {
    start = startOfLocalWeek(now, tz);
    label = LABELS.week;
    return {
      period: 'week',
      start,
      end,
      label,
      rangeLabel: formatRange(start, end, tz),
    };
  } else {
    start = startOfLocalYear(now, tz);
    label = LABELS.ytd;
  }

  return {
    period,
    start,
    end,
    label,
    rangeLabel: formatRange(start, end, tz),
  };
}

export function allPeriodWindows(
  timeZone: string,
  now = new Date(),
): Record<Exclude<ReportingPeriod, 'custom'>, PeriodWindow> {
  return {
    day: periodWindow('day', timeZone, now),
    week: periodWindow('week', timeZone, now),
    month: periodWindow('month', timeZone, now),
    quarter: periodWindow('quarter', timeZone, now),
    ytd: periodWindow('ytd', timeZone, now),
  };
}

export function windowDaysApprox(
  period: ReportingPeriod,
  timeZone: string = DEFAULT_REPORTING_TIMEZONE,
  now = new Date(),
): number {
  if (period === 'day') return 1;
  if (period === 'week') return 7;
  if (period === 'month') return 30;
  if (period === 'quarter') return 91;
  if (period === 'custom') return 7;
  const win = periodWindow(period, timeZone, now);
  const ms = Math.max(0, win.end.getTime() - win.start.getTime());
  return Math.max(1, Math.ceil(ms / 86_400_000));
}

export function isoInWindow(
  iso: string | null | undefined,
  window: Pick<PeriodWindow, 'start' | 'end'>,
): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return false;
  return t >= window.start.getTime() && t <= window.end.getTime();
}
