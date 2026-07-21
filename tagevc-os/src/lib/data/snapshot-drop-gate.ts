/**
 * Stage 4e DROP approval gate (Phase 25).
 * Never executes DROP — only records ops approval eligibility.
 */

export type SnapshotDropGate = {
  approved: boolean;
  approved_at: string | null;
  approved_by: string | null;
  detail: string;
  /** True only when env ALLOW_SNAPSHOT_DROP=1 — still never auto-drops from app. */
  allow_manual_drop_script: boolean;
};

/**
 * Ops must set both SNAPSHOT_DROP_APPROVED_AT (ISO) and SNAPSHOT_DROP_APPROVED_BY
 * after retention window and checklist review. Optional ALLOW_SNAPSHOT_DROP=1
 * unlocks running the offline manual SQL script — the app never DROP's.
 */
export function getSnapshotDropGate(): SnapshotDropGate {
  const approvedAt = process.env.SNAPSHOT_DROP_APPROVED_AT?.trim() || null;
  const approvedBy = process.env.SNAPSHOT_DROP_APPROVED_BY?.trim() || null;
  const allow =
    process.env.ALLOW_SNAPSHOT_DROP === '1' ||
    process.env.ALLOW_SNAPSHOT_DROP === 'true';

  if (approvedAt && approvedBy) {
    const d = new Date(approvedAt);
    if (!Number.isNaN(d.getTime())) {
      return {
        approved: true,
        approved_at: approvedAt,
        approved_by: approvedBy,
        detail: `Approved by ${approvedBy} at ${approvedAt}${
          allow
            ? ' · ALLOW_SNAPSHOT_DROP set — use offline phase30_stage4e_drop.sql (soft rename first)'
            : ' · set ALLOW_SNAPSHOT_DROP=1 only when running the offline DROP script'
        }`,
        allow_manual_drop_script: allow,
      };
    }
  }

  return {
    approved: false,
    approved_at: approvedAt,
    approved_by: approvedBy,
    detail:
      'Set SNAPSHOT_DROP_APPROVED_AT + SNAPSHOT_DROP_APPROVED_BY after checklist green. App never drops the table.',
    allow_manual_drop_script: false,
  };
}
