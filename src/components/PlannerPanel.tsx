import type { PlannerPlan, PlannerTask } from '../lib/calendarApi';
import { formatDateTime } from '../lib/types';

export function PlannerPanel({
  loading,
  plans,
  planId,
  planHint,
  openTasks,
  doneTasks,
  title,
  saving,
  canWrite,
  onPlanChange,
  onTitleChange,
  onCreate,
  onComplete,
  onReconnect,
}: {
  loading: boolean;
  plans: PlannerPlan[];
  planId: string;
  planHint: string | null;
  openTasks: PlannerTask[];
  doneTasks: PlannerTask[];
  title: string;
  saving: boolean;
  canWrite: boolean;
  onPlanChange: (id: string) => void;
  onTitleChange: (v: string) => void;
  onCreate: () => void | Promise<void>;
  onComplete: (t: PlannerTask) => void | Promise<void>;
  onReconnect: () => void;
}) {
  if (!canWrite) {
    return (
      <div className="empty">
        <p>Microsoft Planner needs Tasks.ReadWrite (and often a plan in Teams).</p>
        <button type="button" className="btn primary" onClick={onReconnect}>
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="panel-head">
        <h2>Microsoft Planner</h2>
        {loading ? <span className="muted small">Syncing…</span> : null}
      </div>
      {plans.length === 0 ? (
        <div className="empty">
          <p>No Planner plans found for your account.</p>
          <p className="muted">{planHint ?? 'Create a plan in Teams / Planner, then Refresh.'}</p>
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="planner-plan">Plan</label>
            <select
              id="planner-plan"
              value={planId}
              onChange={(e) => onPlanChange(e.target.value)}
            >
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </div>
          <form
            className="cal-task-create"
            onSubmit={(e) => {
              e.preventDefault();
              void onCreate();
            }}
          >
            <input
              value={title}
              onChange={(e) => onTitleChange(e.target.value)}
              placeholder="New Planner task…"
              aria-label="New Planner task title"
              disabled={!planId}
            />
            <button
              type="submit"
              className="btn primary"
              disabled={saving || !title.trim() || !planId}
            >
              {saving ? 'Adding…' : 'Add'}
            </button>
          </form>
          <ul className="cal-task-list">
            {openTasks.length === 0 && !loading ? (
              <li className="muted">No open tasks in this plan.</li>
            ) : (
              openTasks.map((t) => (
                <li key={t.id} className="cal-task-item">
                  <button
                    type="button"
                    className="cal-task-check"
                    title="Mark complete"
                    onClick={() => void onComplete(t)}
                  >
                    ○
                  </button>
                  <div>
                    <div className="cal-task-title">{t.title}</div>
                    {t.due ? (
                      <div className="muted small">Due {formatDateTime(t.due)}</div>
                    ) : null}
                  </div>
                </li>
              ))
            )}
          </ul>
          {doneTasks.length ? (
            <>
              <h3 className="cal-subhead">Recently completed</h3>
              <ul className="cal-task-list done">
                {doneTasks.map((t) => (
                  <li key={t.id} className="cal-task-item done">
                    <span className="cal-task-check">✓</span>
                    <span className="cal-task-title">{t.title}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </>
  );
}
