/** Timing engine — due dates relative to offer / start / end anchors. */

import type { HrisTimingAnchor } from './types';

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const d = new Date(`${value.slice(0, 10)}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(isoDate: string, days: number): string {
  const d = parseDate(isoDate);
  if (!d) return isoDate;
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Next Monday from a reference date (or today if Monday). */
export function nextMonday(from: Date = new Date()): string {
  const d = new Date(
    Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate(), 12),
  );
  const dow = d.getUTCDay(); // 0 Sun .. 1 Mon
  const add = dow === 1 ? 0 : (8 - dow) % 7;
  d.setUTCDate(d.getUTCDate() + add);
  return formatDate(d);
}

export function computeDueDate(input: {
  timing_anchor: HrisTimingAnchor;
  offset_days: number;
  offer_accepted_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
}): string | null {
  const anchor =
    input.timing_anchor === 'offer_accepted'
      ? input.offer_accepted_at
      : input.timing_anchor === 'end_date'
        ? input.end_date
        : input.start_date;
  if (!anchor) return null;
  return addDays(anchor.slice(0, 10), input.offset_days);
}

export function isStepOverdue(step: {
  due_at: string | null;
  status: string;
}, today: string = new Date().toISOString().slice(0, 10)): boolean {
  if (!step.due_at) return false;
  if (['done', 'waived', 'na'].includes(step.status)) return false;
  return step.due_at.slice(0, 10) < today;
}

export function completionPct(
  steps: Array<{ status: string }>,
): number {
  if (steps.length === 0) return 0;
  const done = steps.filter((s) =>
    ['done', 'waived', 'na'].includes(s.status),
  ).length;
  return Math.round((1000 * done) / steps.length) / 10;
}

/** Offboarding revoke-first: access revoke categories must sort before equipment. */
export function assertRevokeFirstOrder(
  steps: Array<{ category: string; sort_order: number; destructive: boolean }>,
): boolean {
  const access = steps.filter((s) =>
    s.category.toLowerCase().includes('access'),
  );
  const equipment = steps.filter((s) =>
    s.category.toLowerCase().includes('equipment'),
  );
  if (access.length === 0 || equipment.length === 0) return true;
  const maxAccess = Math.max(...access.map((s) => s.sort_order));
  const minEquip = Math.min(...equipment.map((s) => s.sort_order));
  return maxAccess < minEquip;
}
