/** Period key helpers for SSC checklists. */

import type { SscPeriodType } from './types';

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** ISO week number (Mon-start). */
export function isoWeekParts(d: Date): { year: number; week: number } {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return { year: date.getUTCFullYear(), week };
}

export function periodBounds(
  periodType: SscPeriodType,
  ref: Date = new Date(),
): {
  period_key: string;
  period_start: string;
  period_end: string;
  due_at: string;
} {
  const y = ref.getFullYear();
  const m = ref.getMonth();
  const d = ref.getDate();

  if (periodType === 'weekly' || periodType === 'as_needed') {
    const { year, week } = isoWeekParts(ref);
    const day = ref.getDay() || 7;
    const monday = new Date(ref);
    monday.setDate(d - (day - 1));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    const key =
      periodType === 'weekly'
        ? `${year}-W${pad2(week)}`
        : `as-needed:${year}-W${pad2(week)}`;
    return {
      period_key: key,
      period_start: toDateStr(monday),
      period_end: toDateStr(sunday),
      due_at: toDateStr(sunday),
    };
  }

  if (periodType === 'monthly') {
    const start = new Date(y, m, 1);
    const end = new Date(y, m + 1, 0);
    return {
      period_key: `${y}-${pad2(m + 1)}`,
      period_start: toDateStr(start),
      period_end: toDateStr(end),
      due_at: toDateStr(end),
    };
  }

  if (periodType === 'quarterly') {
    const q = Math.floor(m / 3) + 1;
    const start = new Date(y, (q - 1) * 3, 1);
    const end = new Date(y, q * 3, 0);
    return {
      period_key: `${y}-Q${q}`,
      period_start: toDateStr(start),
      period_end: toDateStr(end),
      due_at: toDateStr(end),
    };
  }

  // annual
  return {
    period_key: String(y),
    period_start: `${y}-01-01`,
    period_end: `${y}-12-31`,
    due_at: `${y}-12-31`,
  };
}

export function shiftPeriod(
  periodType: SscPeriodType,
  ref: Date,
  delta: number,
): Date {
  const d = new Date(ref);
  if (periodType === 'weekly' || periodType === 'as_needed') {
    d.setDate(d.getDate() + delta * 7);
    return d;
  }
  if (periodType === 'monthly') {
    d.setMonth(d.getMonth() + delta);
    return d;
  }
  if (periodType === 'quarterly') {
    d.setMonth(d.getMonth() + delta * 3);
    return d;
  }
  d.setFullYear(d.getFullYear() + delta);
  return d;
}

export function classifyTimeNav(
  periodStart: string,
  periodEnd: string,
  now: Date = new Date(),
): 'past' | 'current' | 'future' {
  const today = toDateStr(now);
  if (today < periodStart) return 'future';
  if (today > periodEnd) return 'past';
  return 'current';
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function parsePeriodOffset(
  timeNav: 'past' | 'current' | 'future',
  offset = 0,
): number {
  if (timeNav === 'current') return offset;
  if (timeNav === 'past') return -1 - Math.abs(offset);
  return 1 + Math.abs(offset);
}
