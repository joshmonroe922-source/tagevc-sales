import { formatCompletedAt } from '../lib/auditControlUtils';

type AuditStatus = 'open' | 'in_progress' | 'compliant' | 'gap' | 'na' | string;

type Props = {
  status: AuditStatus;
  busy?: boolean;
  /** Shown when status is compliant (e.g. last_reviewed_at / completed_at). */
  completedAt?: string | null;
  /** Defaults to "Mark reviewed"; shows "Completed" when status is compliant. */
  reviewLabel?: string;
  onMarkReviewed: () => void | Promise<void>;
  onGap: () => void | Promise<void>;
  onInProgress: () => void | Promise<void>;
};

function btnClass(active: boolean): string {
  return active ? 'btn primary' : 'btn ghost';
}

/**
 * Shared Gap / In progress / Mark reviewed controls for audit matrices.
 * Selected status is filled Instant NDA blue (`btn primary` / `--brand`).
 * After a successful review, status `compliant` selects the Completed state.
 */
export function AuditControlStatusActions({
  status,
  busy,
  completedAt,
  reviewLabel = 'Mark reviewed',
  onMarkReviewed,
  onGap,
  onInProgress,
}: Props) {
  const isCompliant = status === 'compliant';
  const isGap = status === 'gap';
  const isInProgress = status === 'in_progress';
  const completedLabel =
    isCompliant && completedAt ? formatCompletedAt(completedAt) : null;

  return (
    <div className="ops-compliance-actions audit-status-actions" role="group" aria-label="Control status">
      <div className="audit-status-complete-wrap">
        <button
          type="button"
          className={btnClass(isCompliant)}
          aria-pressed={isCompliant}
          disabled={busy}
          onClick={() => void onMarkReviewed()}
        >
          {isCompliant ? 'Completed' : reviewLabel}
        </button>
        {completedLabel ? (
          <span className="muted small audit-completed-at">{completedLabel}</span>
        ) : null}
      </div>
      <button
        type="button"
        className={btnClass(isGap)}
        aria-pressed={isGap}
        disabled={busy}
        onClick={() => void onGap()}
      >
        Gap
      </button>
      <button
        type="button"
        className={btnClass(isInProgress)}
        aria-pressed={isInProgress}
        disabled={busy}
        onClick={() => void onInProgress()}
      >
        In progress
      </button>
    </div>
  );
}
