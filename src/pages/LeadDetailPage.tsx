import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addLeadNote,
  createTask,
  getLead,
  listActivities,
  listTasks,
  setTaskStatus,
  updateLeadViaEdge,
} from '../lib/api';
import type {
  DealPath,
  LeadActivity,
  LeadSource,
  LeadStage,
  SalesLead,
  SalesTask,
  SalesUser,
} from '../lib/types';
import {
  DEAL_PATH_LABELS,
  DEAL_PATH_THESES,
  DEAL_PATHS,
  LEAD_SOURCES,
  SOURCE_LABELS,
  STAGE_LABELS,
  STAGES,
  dueAtFromDateInput,
  formatDate,
  formatDateTime,
  isTaskOverdue,
} from '../lib/types';

type Props = { salesUser: SalesUser };

export function LeadDetailPage({ salesUser }: Props) {
  const { id } = useParams();
  const [lead, setLead] = useState<SalesLead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [saving, setSaving] = useState(false);

  async function refresh() {
    if (!id) return;
    setError(null);
    try {
      const [l, a, t] = await Promise.all([
        getLead(id),
        listActivities(id),
        listTasks({ leadId: id }),
      ]);
      setLead(l);
      setActivities(a);
      setTasks(t);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal');
    }
  }

  useEffect(() => {
    void refresh();
  }, [id]);

  async function saveField<K extends keyof SalesLead>(key: K, value: SalesLead[K]) {
    if (!lead) return;
    setSaving(true);
    try {
      const updated = await updateLeadViaEdge(lead.id, { [key]: value } as never);
      setLead(updated);
      if (key === 'stage') {
        setActivities(await listActivities(lead.id));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!lead || !note.trim()) return;
    await addLeadNote(lead.id, note.trim(), salesUser.id);
    setNote('');
    await refresh();
  }

  async function onAddTask(e: FormEvent) {
    e.preventDefault();
    if (!lead || !taskTitle.trim()) return;
    await createTask({
      sales_user_id: salesUser.id,
      lead_id: lead.id,
      title: taskTitle.trim(),
      due_at: taskDue ? dueAtFromDateInput(taskDue) : null,
    });
    setTaskTitle('');
    setTaskDue('');
    await refresh();
  }

  if (!lead && !error) {
    return <p className="muted">Loading deal…</p>;
  }

  if (!lead) {
    return (
      <>
        <div className="banner error">{error ?? 'Deal not found'}</div>
        <Link className="back-link" to="/sales/leads">
          ← Back to deal flow
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className="back-link" to="/sales/leads">
        ← Deal flow
      </Link>
      <div className="page-header">
        <div>
          <h1>{lead.name}</h1>
          <p className="muted">
            {lead.company || 'No company'} · {DEAL_PATH_LABELS[lead.deal_path]} ·{' '}
            <span className="stage-pill">{STAGE_LABELS[lead.stage]}</span>
          </p>
          <p className="muted small">{DEAL_PATH_THESES[lead.deal_path]}</p>
        </div>
        {saving ? <span className="muted">Saving…</span> : null}
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="detail-grid">
        <div className="panel">
          <h2>Details</h2>
          <div className="form-grid">
            <label>
              Name
              <input
                defaultValue={lead.name}
                onBlur={(e) => {
                  if (e.target.value.trim() !== lead.name) {
                    void saveField('name', e.target.value.trim());
                  }
                }}
              />
            </label>
            <label>
              Company
              <input
                defaultValue={lead.company}
                onBlur={(e) => {
                  if (e.target.value !== lead.company) void saveField('company', e.target.value);
                }}
              />
            </label>
            <label>
              Email
              <input
                type="email"
                defaultValue={lead.email}
                onBlur={(e) => {
                  if (e.target.value !== lead.email) void saveField('email', e.target.value);
                }}
              />
            </label>
            <label>
              Phone
              <input
                defaultValue={lead.phone}
                onBlur={(e) => {
                  if (e.target.value !== lead.phone) void saveField('phone', e.target.value);
                }}
              />
            </label>
            <label>
              Stage
              <select
                value={lead.stage}
                onChange={(e) => void saveField('stage', e.target.value as LeadStage)}
              >
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Thesis / path
              <select
                value={lead.deal_path}
                onChange={(e) => void saveField('deal_path', e.target.value as DealPath)}
              >
                {DEAL_PATHS.map((p) => (
                  <option key={p} value={p}>
                    {DEAL_PATH_LABELS[p]} — {DEAL_PATH_THESES[p]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Source
              <select
                value={lead.source}
                onChange={(e) => void saveField('source', e.target.value as LeadSource)}
              >
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {SOURCE_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Next action
              <input
                type="date"
                value={lead.next_action_at ? lead.next_action_at.slice(0, 10) : ''}
                onChange={(e) =>
                  void saveField(
                    'next_action_at',
                    e.target.value ? dueAtFromDateInput(e.target.value) : null,
                  )
                }
              />
            </label>
            <label className="full">
              Notes
              <textarea
                defaultValue={lead.notes}
                onBlur={(e) => {
                  if (e.target.value !== lead.notes) void saveField('notes', e.target.value);
                }}
              />
            </label>
          </div>
          <p className="muted small mt">
            Created {formatDateTime(lead.created_at)} · Updated {formatDateTime(lead.updated_at)}
          </p>
        </div>

        <div>
          <div className="panel mb">
            <h2>Follow-ups</h2>
            <form className="stack-form" onSubmit={(e) => void onAddTask(e)}>
              <label>
                New follow-up
                <input
                  value={taskTitle}
                  onChange={(e) => setTaskTitle(e.target.value)}
                  placeholder="Follow up call"
                  required
                />
              </label>
              <label>
                Due
                <input type="date" value={taskDue} onChange={(e) => setTaskDue(e.target.value)} />
              </label>
              <button type="submit" className="btn primary">
                Add follow-up
              </button>
            </form>
            <ul className="task-list mt">
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
                  <span className="task-meta muted">{formatDate(task.due_at)}</span>
                </li>
              ))}
            </ul>
            {tasks.length === 0 ? <p className="muted">No follow-ups for this deal.</p> : null}
          </div>

          <div className="panel">
            <h2>Activity</h2>
            <form className="stack-form" onSubmit={(e) => void onAddNote(e)}>
              <label>
                Add note
                <textarea value={note} onChange={(e) => setNote(e.target.value)} required />
              </label>
              <button type="submit" className="btn ghost">
                Save note
              </button>
            </form>
            <ul className="activity-list mt">
              {activities.map((a) => (
                <li key={a.id}>
                  <div className="muted small">
                    {formatDateTime(a.created_at)} · {a.activity_type}
                  </div>
                  <div className="activity-sum">{a.summary}</div>
                </li>
              ))}
            </ul>
            {activities.length === 0 ? <p className="muted">No activity yet.</p> : null}
          </div>
        </div>
      </div>
    </>
  );
}
