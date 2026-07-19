import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MsWorkSidePanel } from '../components/MsWorkSidePanel';
import { TodoPanel } from '../components/TodoPanel';
import { listTodoLeadLinks } from '../lib/api';
import {
  completeTodoTask,
  createTodoTask,
  fetchCalendarStatus,
  fetchMasterPortalTodos,
  setMyWorkEmail,
  startCalendarOAuth,
  updateTodoTask,
  type CalendarStatus,
  type TodoImportance,
  type TodoTask,
} from '../lib/calendarApi';
import { sortTodoTasks } from '../lib/msTaskUtils';
import { MASTER_TODO_SLUG, portalTodoListName } from '../lib/portalTodo';
import {
  formatTodoContextBody,
  resolveTodoCaptureContext,
} from '../lib/todoContext';
import type { SalesUser } from '../lib/types';
import type { TodoLeadLink } from '../components/TodoPanel';

type Props = { salesUser: SalesUser };

type FlatTask = TodoTask & { portal_slug: string; list_id: string };

export function TodoPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const [listId, setListId] = useState<string | null>(null);
  const [listLabel, setListLabel] = useState(portalTodoListName(MASTER_TODO_SLUG));
  const [tasks, setTasks] = useState<FlatTask[]>([]);
  const [leadLinks, setLeadLinks] = useState<Record<string, TodoLeadLink>>({});
  const [todoLoading, setTodoLoading] = useState(false);
  const [todoTitle, setTodoTitle] = useState('');
  const [todoDue, setTodoDue] = useState('');
  const [todoImportance, setTodoImportance] = useState<TodoImportance>('normal');
  const [todoSaving, setTodoSaving] = useState(false);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Microsoft status');
    }
  }, []);

  const loadTodo = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.todo) {
      setTasks([]);
      setListId(null);
      return;
    }
    setTodoLoading(true);
    try {
      const [res, links] = await Promise.all([
        fetchMasterPortalTodos([]),
        listTodoLeadLinks().catch(() => ({}) as Record<string, TodoLeadLink>),
      ]);
      const bucket = res.portals?.[0];
      setListId(bucket?.list_id ?? null);
      setListLabel(bucket?.display_name ?? portalTodoListName(MASTER_TODO_SLUG));
      const flat: FlatTask[] = (bucket?.tasks ?? []).map((task) => ({
        ...task,
        portal_slug: bucket?.portal_slug ?? MASTER_TODO_SLUG,
        list_id: bucket?.list_id ?? '',
      }));
      setTasks(sortTodoTasks(flat) as FlatTask[]);
      setLeadLinks(links);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load To Do');
    } finally {
      setTodoLoading(false);
    }
  }, [status?.connected, status?.capabilities?.todo]);

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
    const connected = searchParams.get('calendar_connected');
    const calendarError = searchParams.get('calendar_error');
    if (connected === '1') {
      setNotice('Work mailbox connected. Master To Do is ready.');
      searchParams.delete('calendar_connected');
      setSearchParams(searchParams, { replace: true });
      void loadStatus();
    }
    if (calendarError) {
      setError(calendarError);
      searchParams.delete('calendar_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, loadStatus]);

  useEffect(() => {
    if (!status?.connected) return;
    void loadTodo();
  }, [status?.connected, loadTodo]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/todo');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  async function onSaveWorkEmail() {
    setSavingEmail(true);
    setError(null);
    try {
      await setMyWorkEmail(workEmailDraft.trim() || null);
      setNotice('Work email saved. Use Connect to link that Microsoft mailbox.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save work email');
    } finally {
      setSavingEmail(false);
    }
  }

  const openTasks = useMemo(() => tasks.filter((t) => !t.completed), [tasks]);
  const doneTasks = useMemo(
    () => tasks.filter((t) => t.completed).slice(0, 8),
    [tasks],
  );

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>To Do</h1>
          <p className="muted">
            Master Microsoft To Do list
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}. Use{' '}
            <strong>Add To Do</strong> in the header from any page — context is stamped
            automatically.{' '}
            <Link to="/sales/calendar">Calendar</Link>
            {' · '}
            <Link to="/sales/planner">Planner</Link>
          </p>
        </div>
        <div className="page-actions">
          {status?.connected ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void loadTodo()}
              disabled={todoLoading}
            >
              Refresh
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting || status?.configured === false}
            >
              {connecting ? 'Redirecting…' : 'Connect work mailbox'}
            </button>
          )}
          <button
            type="button"
            className="btn ghost app-side-toggle"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((o) => !o)}
          >
            {sideOpen ? 'Hide settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {status?.needs_scope_upgrade ? (
        <div className="banner warn">
          Your Microsoft connection is missing newer permissions. Click <strong>Reconnect</strong>{' '}
          after an admin grants consent in Azure.
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="detail-grid calendar-layout">
          <div className="panel app-main">
            {!status ? (
              <div className="empty">
                <p className="muted">Status unavailable. Retry or check the error above.</p>
              </div>
            ) : !status.configured ? (
              <div className="empty">
                <p>Microsoft Graph is not configured yet.</p>
                <p className="muted">
                  An admin needs to register an Azure app and set edge secrets — see{' '}
                  <code>SETUP_CALENDAR.md</code>.
                </p>
              </div>
            ) : !status.connected ? (
              <div className="empty">
                <p>Connect your Tage work mailbox to use Microsoft To Do here.</p>
                <p className="muted">
                  Portal login ({salesUser.email}) can differ from your Microsoft account. Set work
                  email in the sidebar, then connect.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Connect work mailbox'}
                </button>
              </div>
            ) : (
              <TodoPanel
                loading={todoLoading}
                openTasks={openTasks}
                doneTasks={doneTasks}
                title={todoTitle}
                due={todoDue}
                importance={todoImportance}
                leadLinks={leadLinks}
                saving={todoSaving}
                canWrite={Boolean(status.capabilities?.todo)}
                heading="Master To Do"
                blurb={`Synced with “${listLabel}”. Context from when you created the task appears under each item. Deal-linked tasks show Open deal.`}
                onTitleChange={setTodoTitle}
                onDueChange={setTodoDue}
                onImportanceChange={setTodoImportance}
                onCreate={async () => {
                  const t = todoTitle.trim();
                  if (!t) return;
                  setTodoSaving(true);
                  setError(null);
                  try {
                    const ctx = await resolveTodoCaptureContext(
                      '/sales/todo',
                      '',
                      salesUser,
                      window.location.origin,
                    );
                    await createTodoTask({
                      title: t,
                      body: formatTodoContextBody(ctx),
                      portal_slug: MASTER_TODO_SLUG,
                      due: todoDue ? `${todoDue}T00:00:00` : undefined,
                      importance: todoImportance,
                      time_zone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    });
                    setTodoTitle('');
                    setTodoDue('');
                    setTodoImportance('normal');
                    setNotice(`Added to ${listLabel}.`);
                    await loadTodo();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not create task');
                  } finally {
                    setTodoSaving(false);
                  }
                }}
                onUpdate={async (task, patch) => {
                  const flat = task as FlatTask;
                  const id = flat.list_id || listId;
                  if (!id) return;
                  setError(null);
                  try {
                    const { lead_id: _lead, ...msPatch } = patch;
                    await updateTodoTask({
                      list_id: id,
                      task_id: task.id,
                      portal_slug: MASTER_TODO_SLUG,
                      ...msPatch,
                      time_zone:
                        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
                    });
                    setNotice('To Do task updated.');
                    await loadTodo();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not update task');
                    throw err;
                  }
                }}
                onComplete={async (task) => {
                  const flat = task as FlatTask;
                  const id = flat.list_id || listId;
                  if (!id) return;
                  setError(null);
                  try {
                    await completeTodoTask(id, task.id, MASTER_TODO_SLUG);
                    setNotice('Task completed.');
                    await loadTodo();
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not complete task');
                  }
                }}
                onReconnect={() => void onConnect()}
              />
            )}
          </div>

          <MsWorkSidePanel
            salesUser={salesUser}
            status={status}
            workEmailDraft={workEmailDraft}
            savingEmail={savingEmail}
            connecting={connecting}
            sideOpen={sideOpen}
            alertPath="/sales/todo"
            alertBlurb="While a portal tab is open: due/overdue To Do tasks, plus meeting reminders and Planner due dates."
            capabilityLabels={[
              status?.capabilities?.todo ? 'To Do' : null,
              status?.capabilities?.create_events ? 'Calendar' : null,
              status?.capabilities?.planner ? 'Planner' : null,
            ].filter(Boolean) as string[]}
            onWorkEmailChange={setWorkEmailDraft}
            onSaveWorkEmail={onSaveWorkEmail}
            onConnect={onConnect}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
      )}
    </div>
  );
}
