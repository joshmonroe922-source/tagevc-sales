import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  formatDate,
  listTechnologyTasks,
  syncIncompleteTechnologyTasksToTodo,
  updateTechnologyTask,
} from '../lib/technologyApi';
import {
  TECHNOLOGY_TASK_STATUS_LABELS,
  type TechnologyTask,
  type TechnologyTaskStatus,
} from '../lib/technologyTypes';
import type { SalesUser } from '../lib/types';
import { PortalTasksPanel } from '../components/PortalTasksPanel';
import { AuditTaskStatusActions } from '../components/AuditTaskStatusActions';

type Props = { salesUser: SalesUser };

export function TechnologyTasksPage({ salesUser }: Props) {
  const [tasks, setTasks] = useState<TechnologyTask[]>([]);
  const [status, setStatus] = useState<TechnologyTaskStatus | 'all'>('open');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const refresh = useCallback(async () => {
    const rows = await listTechnologyTasks({ status });
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
          setError(err instanceof Error ? err.message : 'Failed to load technology tasks');
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
      const result = await syncIncompleteTechnologyTasksToTodo({
        salesUserId: salesUser.id,
      });
      setNotice(
        `Created ${result.technologyCreated} technology task(s); pushed ${result.todoCreated} to portal To Do.`,
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
      await updateTechnologyTask(id, { status: 'done' });
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
      await updateTechnologyTask(id, { status: 'cancelled' });
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
          <h1>Technology tasks</h1>
          <p className="muted">
            Incomplete technology controls become assignable tasks. Push them into portal To
            Do so the team can close gaps during security & portfolio reviews.
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
          <Link to="/sales/technology/controls" className="btn ghost">
            Controls
          </Link>
          <Link to="/sales/technology" className="btn ghost">
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
          onChange={(e) => setStatus(e.target.value as TechnologyTaskStatus | 'all')}
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
                  task.technology_controls?.ops_entities?.name ??
                  (task.technology_controls?.entity_id ? 'Entity' : 'Tage parent');
                return (
                  <li key={task.id}>
                    <div>
                      <div className="ops-compliance-title">{task.title}</div>
                      <div className="muted small">
                        {scope}
                        {task.technology_controls?.area
                          ? ` · ${task.technology_controls.area}`
                          : ''}
                        {' · '}
                        {TECHNOLOGY_TASK_STATUS_LABELS[task.status]}
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

      <PortalTasksPanel portalSlug="technology" />
      <p className="muted small portal-todo-hint">
        Use header <strong>Add To Do</strong> for ad-hoc Technology items in Microsoft To Do.
      </p>
    </>
  );
}
