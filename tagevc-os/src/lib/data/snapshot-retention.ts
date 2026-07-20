/**
 * Snapshot retirement retention helpers (Phase 23).
 */

import { getArchiveExportOpsConfirmation } from '@/lib/data/archive-export-state';

const RETENTION_DAYS = 90;

export function getSnapshotRetentionStatus(): {
  retention_days_target: number;
  confirmed: boolean;
  days_since_confirm: number | null;
  days_remaining_before_drop_eligible: number | null;
  detail: string;
} {
  const ops = getArchiveExportOpsConfirmation();
  const envAt = process.env.ARCHIVE_EXPORT_CONFIRMED_AT?.trim();
  let confirmedAt: Date | null = null;
  if (envAt) {
    const d = new Date(envAt);
    if (!Number.isNaN(d.getTime())) confirmedAt = d;
  }

  if (!ops.confirmed || !confirmedAt) {
    return {
      retention_days_target: RETENTION_DAYS,
      confirmed: ops.confirmed,
      days_since_confirm: null,
      days_remaining_before_drop_eligible: null,
      detail: ops.detail,
    };
  }

  const daysSince = Math.floor(
    (Date.now() - confirmedAt.getTime()) / (24 * 60 * 60 * 1000),
  );
  const remaining = Math.max(0, RETENTION_DAYS - daysSince);
  return {
    retention_days_target: RETENTION_DAYS,
    confirmed: true,
    days_since_confirm: daysSince,
    days_remaining_before_drop_eligible: remaining,
    detail:
      remaining > 0
        ? `${daysSince}d since confirm · ${remaining}d until DROP eligibility (≥${RETENTION_DAYS}d)`
        : `${daysSince}d since confirm · retention window met — DROP still requires explicit ops (never automatic)`,
  };
}
