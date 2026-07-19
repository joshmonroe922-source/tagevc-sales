import { formatCompletedAt } from '../lib/auditControlUtils';

type TaskStatus = 'open' | 'done' | 'cancelled' | string;

type Props = {
  status: TaskStatus;
  busy?: boolean;
  /** Shown when status is done (completed_at). */
  completedAt?: string | null;
  onMarkDone: () => void | Promise<void>;
  onCancel?: () => void | Promise<void>;
  showCancel?: boolean;
};

function btnClass(active: boolean): string {
  return active ? 'btn primary' : 'btn ghost';
}

/**
 * Shared Mark done / Cancel for portal open-task checklists.
 * After Mark done succeeds (or optimistic update), shows Completed as the selected blue state.
 */
export function AuditTaskStatusActions({
  status,
  busy,
  completedAt,
  onMarkDone,
  onCancel,
  showCancel = true,
}: Props) {
  const isDone = status === 'done';
  const isCancelled = status === 'cancelled';
  const completedLabel = isDone && completedAt ? formatCompletedAt(completedAt) : null;

  return (
    <div className="ops-compliance-actions audit-status-actions" role="group" aria-label="Task status">
      {isDone ? (
        <div className="audit-status-complete-wrap">
          <button type="button" className={btnClass(true)} aria-pressed disabled>
            Completed
          </button>
          {completedLabel ? (
            <span className="muted small audit-completed-at">{completedLabel}</span>
          ) : null}
        </div>
      ) : !isCancelled ? (
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => void onMarkDone()}
        >
          Mark done
        </button>
      ) : null}
      {showCancel && onCancel && !isCancelled ? (
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => void onCancel()}
        >
          Cancel
        </button>
      ) : null}
      {isCancelled ? (
        <button type="button" className="btn ghost" disabled>
          Cancelled
        </button>
      ) : null}
    </div>
  );
}
