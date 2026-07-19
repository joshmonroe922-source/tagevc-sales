import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createTask, listTasks, setTaskStatus } from '../lib/api';
import { importanceLabel } from '../lib/msTaskUtils';
import type { SalesTask, SalesUser, TaskImportance } from '../lib/types';
import { dueAtFromDateInput, formatDate, isTaskOverdue } from '../lib/types';

type Props = { salesUser: SalesUser };

export function TasksPage({ salesUser }: Props) {
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [importance, setImportance] = useState<TaskImportance>('normal');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const all = await listTasks(filter === 'all' ? undefined : { status: filter });
      setTasks(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal tasks');
    }
  }

  useEffect(() => {
    void refresh();
  }, [filter]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    setNotice(null);
    try {
      const result = await createTask({
        sales_user_id: salesUser.id,
        title: title.trim(),
        due_at: due ? dueAtFromDateInput(due) : null,
        importance,
        portal_slug: 'deal-sourcing',
      });
      setTitle('');
      setDue('');
      setImportance('normal');
      setNotice(
        result.synced
          ? 'Synced to To Do (Tage · Deal Sourcing).'
          : (result.syncError ?? 'Saved locally — connect Microsoft to sync.'),
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Deal tasks</h1>
          <p className="muted">
            Deal-linked tasks sync to Microsoft list “Tage · Deal Sourcing”. Prefer{' '}
            <Link to="/sales/todo">master To Do</Link> (header <strong>Add To Do</strong> / deal{' '}
            <strong>Follow Up / Next Action</strong>) for new items.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {(['open', 'done', 'all'] as const).map((f) => (
              <button
                key={f}
                type="button"
                className={filter === f ? 'active' : ''}
                onClick={() => setFilter(f)}
              >
                {f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Done'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {notice ? (
        <div className={`banner ${notice.startsWith('Synced') ? 'ok' : 'warn'}`}>{notice}</div>
      ) : null}
      {error ? <div className="banner error">{error}</div> : null}

      <div className="detail-grid">
        <div className="panel">
          <ul className="task-list large">
            {tasks.map((task) => (
              <li
                key={task.id}
                className={`${task.status === 'done' ? 'done' : ''} ${
                  isTaskOverdue(task) ? 'overdue' : ''
                }`}
              >
                <label className="task-check">
                  <input
                    type="checkbox"
                    checked={task.status === 'done'}
                    onChange={() =>
                      void setTaskStatus(task.id, task.status === 'done' ? 'open' : 'done').then(
                        refresh,
                      )
                    }
                  />
                  <span>{task.title}</span>
                </label>
                <div className="task-meta">
                  <span
                    className={`cal-task-importance imp-${
                      (task.importance ?? 'normal') === 'high' ||
                      (task.importance ?? 'normal') === 'low'
                        ? task.importance
                        : 'normal'
                    }`}
                  >
                    {importanceLabel(task.importance)}
                  </span>
                  <span className={isTaskOverdue(task) ? 'warn-text' : 'muted'}>
                    {formatDate(task.due_at)}
                  </span>
                  {task.ms_todo_task_id ? (
                    <span className="muted small todo-sync-badge">Synced to To Do</span>
                  ) : (
                    <span className="muted small todo-sync-badge local-only">Local only</span>
                  )}
                  {task.sales_leads ? (
                    <Link to={`/sales/deal-sourcing/leads/${task.sales_leads.id}`}>
                      Open deal
                    </Link>
                  ) : (
                    <span className="muted">Unscoped</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {tasks.length === 0 ? <p className="muted">No tasks in this view.</p> : null}
        </div>

        <div className="panel">
          <h2>New Deal Sourcing task</h2>
          <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              Due date
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <label>
              Importance
              <select
                value={importance}
                onChange={(e) => setImportance(e.target.value as TaskImportance)}
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
            <button type="submit" className="btn primary">
              Create task
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
