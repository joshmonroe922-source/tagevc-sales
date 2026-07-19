import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listTodoLeadLinks } from '../lib/api';
import {
  completeTodoTask,
  createTodoTask,
  fetchCalendarStatus,
  fetchTodoTasks,
  startCalendarOAuth,
  updateTodoTask,
  type CalendarStatus,
  type TodoImportance,
  type TodoTask,
} from '../lib/calendarApi';
import { sortTodoTasks } from '../lib/msTaskUtils';
import { getPortalDefinition } from '../lib/portals';
import { portalTodoListName } from '../lib/portalTodo';
import type { PortalSlug } from '../lib/types';
import { TodoPanel, type TodoLeadLink } from './TodoPanel';

type Props = {
  portalSlug: PortalSlug;
  /** Compact embedding under portal homes / stubs. */
  compact?: boolean;
  className?: string;
};

/**
 * Portal-scoped Microsoft To Do panel (list: Tage · {Portal}).
 * Soft-fails when Microsoft is not connected.
 */
export function PortalTasksPanel({ portalSlug, compact = true, className }: Props) {
  const def = getPortalDefinition(portalSlug);
  const listLabel = portalTodoListName(portalSlug);

  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [todoLoading, setTodoLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  const [listId, setListId] = useState<string | null>(null);
  const [tasks, setTasks] = useState<TodoTask[]>([]);
  const [leadLinks, setLeadLinks] = useState<Record<string, TodoLeadLink>>({});
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [importance, setImportance] = useState<TodoImportance>('normal');
  const [saving, setSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
    } catch (err) {
      setStatus(null);
      setError(err instanceof Error ? err.message : 'Could not load Microsoft status');
    }
  }, []);

  const loadTasks = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.todo) {
      setTasks([]);
      return;
    }
    setTodoLoading(true);
    setError(null);
    try {
      const [res, links] = await Promise.all([
        fetchTodoTasks(undefined, portalSlug),
        listTodoLeadLinks().catch(() => ({}) as Record<string, TodoLeadLink>),
      ]);
      setListId(res.list_id);
      setTasks(sortTodoTasks(res.tasks ?? []));
      setLeadLinks(links);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load portal tasks');
    } finally {
      setTodoLoading(false);
    }
  }, [status?.connected, status?.capabilities?.todo, portalSlug]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      await loadStatus();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    void loadTasks();
  }, [status?.connected, loadTasks]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const returnTo =
        typeof window !== 'undefined'
          ? `${window.location.pathname}${window.location.search}`
          : '/sales/todo';
      const { url } = await startCalendarOAuth(returnTo);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  const sorted = sortTodoTasks(tasks);
  const openTasks = sorted.filter((t) => !t.completed);
  const doneTasks = sorted.filter((t) => t.completed).slice(0, compact ? 5 : 8);

  return (
    <div className={`panel portal-tasks-panel ${className ?? ''}`.trim()}>
      {!compact ? (
        <div className="panel-head">
          <h2>{def?.name ?? 'Portal'} tasks</h2>
          <Link to="/sales/todo" className="muted small">
            Master To Do →
          </Link>
        </div>
      ) : (
        <div className="panel-head">
          <h2>To Do</h2>
          <span className="muted small">{listLabel}</span>
        </div>
      )}

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <p className="muted small">Loading tasks…</p>
      ) : !status?.configured ? (
        <p className="muted small">
          Microsoft Graph is not configured yet. Tasks stay available after an admin finishes
          setup — see <code>SETUP_CALENDAR.md</code>.
        </p>
      ) : !status.connected ? (
        <div className="empty portal-tasks-softfail">
          <p className="muted small">
            Connect your work mailbox to sync {def?.name ?? 'portal'} tasks with Microsoft To Do.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => void onConnect()}
            disabled={connecting}
          >
            {connecting ? 'Redirecting…' : 'Connect Microsoft'}
          </button>
          <p className="muted small">
            You can still use other portal features; tasks soft-fail until connected.
          </p>
        </div>
      ) : (
        <TodoPanel
          loading={todoLoading}
          openTasks={openTasks}
          doneTasks={doneTasks}
          title={title}
          due={due}
          importance={importance}
          saving={saving}
          canWrite={Boolean(status.capabilities?.todo)}
          heading={compact ? '' : `${def?.name ?? 'Portal'} · To Do`}
          blurb={`Synced with Microsoft list “${listLabel}”. Also in header To Do. Deal-linked tasks show Open deal.`}
          leadLinks={leadLinks}
          onTitleChange={setTitle}
          onDueChange={setDue}
          onImportanceChange={setImportance}
          onCreate={async () => {
            const t = title.trim();
            if (!t) return;
            setSaving(true);
            setError(null);
            try {
              await createTodoTask({
                title: t,
                portal_slug: portalSlug,
                due: due ? `${due}T00:00:00` : undefined,
                importance,
                time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              });
              setTitle('');
              setDue('');
              setImportance('normal');
              setNotice('Task added to Microsoft To Do.');
              await loadTasks();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not create task');
            } finally {
              setSaving(false);
            }
          }}
          onUpdate={async (task, patch) => {
            if (!listId) return;
            setError(null);
            try {
              await updateTodoTask({
                list_id: listId,
                task_id: task.id,
                portal_slug: portalSlug,
                ...patch,
                time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
              });
              setNotice('Task updated.');
              await loadTasks();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not update task');
              throw err;
            }
          }}
          onComplete={async (task) => {
            if (!listId) return;
            setError(null);
            try {
              await completeTodoTask(listId, task.id, portalSlug);
              setNotice('Task completed.');
              await loadTasks();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not complete task');
            }
          }}
          onReconnect={() => void onConnect()}
        />
      )}
    </div>
  );
}
