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

export type SscTimeNav = 'active' | 'future';
/** URL / legacy inputs — past + current both mean the combined Active view. */
export type SscTimeNavInput = SscTimeNav | 'past' | 'current';

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

/** Operator chrome: Past+Current → Active; Future stays separate. */
export function normalizeTimeNav(raw?: string | null): SscTimeNav {
  if (raw === 'future') return 'future';
  return 'active';
}

export function timeNavLabel(nav: SscTimeNav): string {
  return nav === 'active' ? 'Active' : 'Future';
}

/**
 * Urgency sort: most overdue first (oldest due), then due soon,
 * then undated / furthest out.
 */
export function compareSscTaskUrgency(
  a: { is_overdue?: boolean; due_date?: string | null },
  b: { is_overdue?: boolean; due_date?: string | null },
): number {
  const aOver = Boolean(a.is_overdue);
  const bOver = Boolean(b.is_overdue);
  if (aOver !== bOver) return aOver ? -1 : 1;
  const ad = a.due_date?.slice(0, 10) || '9999-12-31';
  const bd = b.due_date?.slice(0, 10) || '9999-12-31';
  return ad.localeCompare(bd);
}

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Calendar-day arithmetic on YYYY-MM-DD (local, not UTC). */
export function addDaysToDateStr(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return toDateStr(dt);
}

/** Why a task belongs in Needs attention on function homes. */
export type SscAttentionKind =
  | 'overdue'
  | 'due_today'
  | 'due_soon'
  | 'due_this_period'
  | 'open';

export const SSC_DUE_SOON_DAYS = 7;

/**
 * Classify open checklist work for the Needs attention panel.
 * Broader than overdue/due-today: due soon (7d), due by period end, and any
 * remaining open/at-risk work on the active period — so the panel is useful
 * whenever open period tasks exist.
 */
export function classifySscAttention(opts: {
  status: string;
  due_date: string | null | undefined;
  today: string;
  period_end: string;
  due_soon_days?: number;
}): {
  closed: boolean;
  is_overdue: boolean;
  due_today: boolean;
  due_soon: boolean;
  due_this_period: boolean;
  needs_attention: boolean;
  attention_kind: SscAttentionKind | null;
} {
  const status = opts.status;
  const closed = status === 'done' || status === 'waived';
  const due = opts.due_date ? String(opts.due_date).slice(0, 10) : null;
  const today = opts.today.slice(0, 10);
  const periodEnd = opts.period_end.slice(0, 10);
  const soonDays = opts.due_soon_days ?? SSC_DUE_SOON_DAYS;
  const soonEnd = addDaysToDateStr(today, soonDays);

  if (closed) {
    return {
      closed: true,
      is_overdue: false,
      due_today: false,
      due_soon: false,
      due_this_period: false,
      needs_attention: false,
      attention_kind: null,
    };
  }

  const is_overdue = Boolean(due && due < today);
  const due_today = Boolean(due && due === today);
  const due_soon = Boolean(due && due > today && due <= soonEnd);
  const due_this_period = Boolean(
    due && due > soonEnd && due <= periodEnd,
  );

  let attention_kind: SscAttentionKind;
  if (is_overdue) attention_kind = 'overdue';
  else if (due_today) attention_kind = 'due_today';
  else if (due_soon) attention_kind = 'due_soon';
  else if (due_this_period) attention_kind = 'due_this_period';
  else attention_kind = 'open'; // undated or dated beyond period — still at-risk open work

  return {
    closed: false,
    is_overdue,
    due_today,
    due_soon,
    due_this_period,
    needs_attention: true,
    attention_kind,
  };
}

export function parsePeriodOffset(
  timeNav: SscTimeNavInput,
  offset = 0,
): number {
  const nav = normalizeTimeNav(timeNav);
  if (nav === 'active') return offset;
  return 1 + Math.abs(offset);
}
