import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createTask, listTasks, setTaskStatus } from '../lib/api';
import type { SalesTask, SalesUser } from '../lib/types';
import { dueAtFromDateInput, formatDate, isTaskOverdue } from '../lib/types';

type Props = { salesUser: SalesUser };

export function TasksPage({ salesUser }: Props) {
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [filter, setFilter] = useState<'open' | 'done' | 'all'>('open');
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setError(null);
    try {
      const all = await listTasks(filter === 'all' ? undefined : { status: filter });
      setTasks(all);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load follow-ups');
    }
  }

  useEffect(() => {
    void refresh();
  }, [filter]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    try {
      await createTask({
        sales_user_id: salesUser.id,
        title: title.trim(),
        due_at: due ? dueAtFromDateInput(due) : null,
      });
      setTitle('');
      setDue('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Follow-ups</h1>
          <p className="muted">Deal-linked and standalone founder/operator follow-ups.</p>
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
                  <span className={isTaskOverdue(task) ? 'warn-text' : 'muted'}>
                    {formatDate(task.due_at)}
                  </span>
                  {task.sales_leads ? (
                    <Link to={`/sales/deal-sourcing/leads/${task.sales_leads.id}`}>
                      {task.sales_leads.name}
                    </Link>
                  ) : (
                    <span className="muted">Standalone</span>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {tasks.length === 0 ? <p className="muted">No follow-ups in this view.</p> : null}
        </div>

        <div className="panel">
          <h2>New standalone follow-up</h2>
          <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
            <label>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            </label>
            <label>
              Due date
              <input type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            </label>
            <button type="submit" className="btn primary">
              Create follow-up
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
