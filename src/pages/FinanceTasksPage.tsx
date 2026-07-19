import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatDate,
  listFinanceTasks,
  syncIncompleteFinanceTasksToTodo,
  updateFinanceTask,
} from '../lib/financeApi';
import {
  FINANCE_TASK_STATUS_LABELS,
  type FinanceTask,
  type FinanceTaskStatus,
} from '../lib/financeTypes';
import type { SalesUser } from '../lib/types';
import { PortalTasksPanel } from '../components/PortalTasksPanel';
import { AuditTaskStatusActions } from '../components/AuditTaskStatusActions';

type Props = { salesUser: SalesUser };

export function FinanceTasksPage({ salesUser }: Props) {
  const [tasks, setTasks] = useState<FinanceTask[]>([]);
  const [status, setStatus] = useState<FinanceTaskStatus | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await listFinanceTasks({ status });
    setTasks(rows);
  }, [status]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load finance tasks');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  async function onSync() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncIncompleteFinanceTasksToTodo({
        salesUserId: salesUser.id,
      });
      setNotice(
        `Created ${result.financeCreated} finance task(s); pushed ${result.todoCreated} to portal To Do.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function onMarkDone(id: string) {
    setError(null);
    const now = new Date().toISOString();
    setTasks((prev) =>
      prev.map((t) =>
        t.id === id ? { ...t, status: 'done' as const, completed_at: now } : t,
      ),
    );
    try {
      await updateFinanceTask(id, { status: 'done' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      await refresh().catch(() => undefined);
    }
  }

  async function onCancel(id: string) {
    setError(null);
    setTasks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, status: 'cancelled' as const } : t)),
    );
    try {
      await updateFinanceTask(id, { status: 'cancelled' });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      await refresh().catch(() => undefined);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Finance tasks</h1>
          <p className="muted">
            Incomplete finance controls become assignable tasks. Push them into portal To
            Do so the team can close gaps during monthly/quarterly close.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn primary"
            disabled={syncing}
            onClick={() => void onSync()}
          >
            {syncing ? 'Syncing…' : 'Sync incomplete → To Do'}
          </button>
          <Link to="/sales/finance/controls" className="btn ghost">
            Controls
          </Link>
          <Link to="/sales/finance" className="btn ghost">
            Overview
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}

      <div className="toolbar hr-toolbar">
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as FinanceTaskStatus | 'all')}
        >
          <option value="open">Open</option>
          <option value="done">Done</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </select>
      </div>

      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <section className="panel ops-compliance-hub">
          <div className="panel-head">
            <h2>Control-linked tasks</h2>
            <span className="muted small">{tasks.length} showing</span>
          </div>
          {tasks.length === 0 ? (
            <p className="muted">
              No tasks yet. Use <strong>Sync incomplete → To Do</strong> after seeding
              controls.
            </p>
          ) : (
            <ul className="ops-compliance-list">
              {tasks.map((task) => {
                const scope =
                  task.finance_controls?.ops_entities?.name ??
                  (task.finance_controls?.entity_id ? 'Entity' : 'Tage parent');
                return (
                  <li key={task.id}>
                    <div>
                      <div className="ops-compliance-title">{task.title}</div>
                      <div className="muted small">
                        {scope}
                        {task.finance_controls?.area
                          ? ` · ${task.finance_controls.area}`
                          : ''}
                        {' · '}
                        {FINANCE_TASK_STATUS_LABELS[task.status]}
                        {task.due_at ? ` · due ${formatDate(task.due_at)}` : ''}
                        {task.sales_task_id ? ' · linked to To Do' : ' · not in To Do yet'}
                      </div>
                      {task.notes ? (
                        <div className="muted small">{task.notes}</div>
                      ) : null}
                    </div>
                    <AuditTaskStatusActions
                      status={task.status}
                      completedAt={task.completed_at}
                      onMarkDone={() => onMarkDone(task.id)}
                      onCancel={() => onCancel(task.id)}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ) : null}

      <PortalTasksPanel portalSlug="accounting-finance" />
      <p className="muted small portal-todo-hint">
        Use header <strong>Add To Do</strong> for ad-hoc Finance items in Microsoft To Do.
      </p>
    </>
  );
}
