/** Shared audit-control due dates, roll-forward, and evidence path helpers. */

/** Format a completion stamp for UI: "Completed Jul 14, 2026". */
export function formatCompletedAt(
  iso: string | null | undefined,
  prefix = 'Completed',
): string | null {
  if (!iso) return null;
  // Date-only (YYYY-MM-DD) — noon local-ish to avoid UTC day shift
  const d =
    /^\d{4}-\d{2}-\d{2}$/.test(iso)
      ? new Date(`${iso}T12:00:00`)
      : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const formatted = d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return `${prefix} ${formatted}`;
}

export const AUDIT_REVIEW_FREQUENCIES = [
  'annual',
  'monthly',
  'quarterly',
  'one_time',
  'custom',
] as const;

export type AuditReviewFrequency = (typeof AUDIT_REVIEW_FREQUENCIES)[number];

export const AUDIT_REVIEW_FREQUENCY_LABELS: Record<AuditReviewFrequency, string> = {
  annual: 'Annual',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  one_time: 'One-time',
  custom: 'Custom',
};

/** Prefer review_frequency when present; otherwise cadence (same meaning). */
export type AuditControlDueFields = {
  cadence?: string;
  review_frequency?: string | null;
  next_due_at: string | null;
  last_reviewed_at?: string | null;
  status: string;
};

export const AUDIT_EVIDENCE_BUCKET = 'audit-evidence';

export function auditEvidenceBucket(): string {
  return AUDIT_EVIDENCE_BUCKET;
}

/** Path: `{portal}/{controlId}/{timestamp}_{safeName}` */
export function buildAuditEvidencePath(
  portal: string,
  controlId: string,
  fileName: string,
): string {
  const safe = fileName.replace(/[^\w.\-]+/g, '_');
  return `${portal}/${controlId}/${Date.now()}_${safe}`;
}

export function todayDateString(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function resolveReviewFrequency(c: AuditControlDueFields): string {
  return (
    (c.review_frequency || c.cadence || 'annual').toLowerCase() || 'annual'
  );
}

export function isAuditControlOverdue(c: AuditControlDueFields): boolean {
  if (!c.next_due_at || c.status === 'compliant' || c.status === 'na') return false;
  return c.next_due_at < todayDateString();
}

/** Due within the next N days (not already overdue). */
export function isAuditControlDueSoon(
  c: AuditControlDueFields,
  withinDays = 30,
): boolean {
  if (!c.next_due_at || c.status === 'compliant' || c.status === 'na') return false;
  const today = todayDateString();
  if (c.next_due_at < today) return false;
  const limit = new Date();
  limit.setUTCDate(limit.getUTCDate() + withinDays);
  return c.next_due_at <= limit.toISOString().slice(0, 10);
}

export function addCadenceToDate(isoDate: string, cadence: string): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const base = new Date(Date.UTC(y, (m ?? 1) - 1, d ?? 1));
  const freq = (cadence || 'annual').toLowerCase();
  if (freq === 'monthly') {
    base.setUTCMonth(base.getUTCMonth() + 1);
  } else if (freq === 'quarterly') {
    base.setUTCMonth(base.getUTCMonth() + 3);
  } else if (freq === 'one_time') {
    return isoDate;
  } else {
    base.setUTCFullYear(base.getUTCFullYear() + 1);
  }
  return base.toISOString().slice(0, 10);
}

/**
 * Roll forward from the later of prior due / reviewed-on so overdue items
 * do not keep the same past due date forever.
 */
export function rollForwardDueDate(
  priorDue: string | null,
  frequency: string,
  reviewedOn: string = todayDateString(),
): string | null {
  const freq = (frequency || 'annual').toLowerCase();
  if (freq === 'one_time') return null;
  const base =
    priorDue && priorDue > reviewedOn ? priorDue : reviewedOn;
  return addCadenceToDate(base, freq);
}

/** Default first due date from today for a new/seeded control. */
export function initialDueDateFromFrequency(
  frequency: string,
  from: string = todayDateString(),
): string | null {
  const freq = (frequency || 'annual').toLowerCase();
  if (freq === 'custom') return null;
  if (freq === 'one_time') return from;
  return addCadenceToDate(from, freq);
}

/**
 * When marking reviewed/compliant, stamp last_reviewed_at and roll next_due_at
 * forward by review frequency. one_time clears next due.
 */
export function buildMarkReviewedPatch(
  c: AuditControlDueFields,
  opts?: { status?: string; reviewedOn?: string },
): {
  status: string;
  last_reviewed_at: string;
  next_due_at: string | null;
} {
  const reviewedOn = opts?.reviewedOn ?? todayDateString();
  const freq = resolveReviewFrequency(c);
  return {
    status: opts?.status ?? 'compliant',
    last_reviewed_at: reviewedOn,
    next_due_at: rollForwardDueDate(c.next_due_at, freq, reviewedOn),
  };
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
