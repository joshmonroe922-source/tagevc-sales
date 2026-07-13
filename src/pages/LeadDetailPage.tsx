import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  addLeadNote,
  createTask,
  getLead,
  listActivities,
  listTasks,
  sendTrackedEmail,
  setTaskStatus,
  updateLeadViaEdge,
} from '../lib/api';
import {
  EMAIL_SOURCE_LABELS,
  formatEmailWhen,
  listEmailMessages,
  type EmailMessage,
} from '../lib/emailAnalytics';
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function plainTextToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeHtml(para).replace(/\n/g, '<br/>')}</p>`)
    .join('');
}

export function LeadDetailPage({ salesUser }: Props) {
  const { id } = useParams();
  const [lead, setLead] = useState<SalesLead | null>(null);
  const [activities, setActivities] = useState<LeadActivity[]>([]);
  const [tasks, setTasks] = useState<SalesTask[]>([]);
  const [emails, setEmails] = useState<EmailMessage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [taskTitle, setTaskTitle] = useState('');
  const [taskDue, setTaskDue] = useState('');
  const [saving, setSaving] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailNotice, setEmailNotice] = useState<string | null>(null);

  async function refresh() {
    if (!id) return;
    setError(null);
    try {
      const [l, a, t, e] = await Promise.all([
        getLead(id),
        listActivities(id),
        listTasks({ leadId: id }),
        listEmailMessages({ leadId: id, limit: 40 }),
      ]);
      setLead(l);
      setActivities(a);
      setTasks(t);
      setEmails(e);
      if (l?.email) setEmailTo((prev) => prev || l.email);
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

  async function onSendTrackedEmail(e: FormEvent) {
    e.preventDefault();
    if (!lead || !emailSubject.trim() || !emailBody.trim()) return;
    setEmailSending(true);
    setEmailNotice(null);
    setError(null);
    try {
      const result = await sendTrackedEmail({
        leadId: lead.id,
        to: emailTo.trim() || undefined,
        subject: emailSubject.trim(),
        html: plainTextToHtml(emailBody.trim()),
        replyTo: salesUser.email,
      });
      setEmailNotice(
        `Sent to ${result.to}. Opens/clicks appear after Resend webhooks fire.`,
      );
      setEmailSubject('');
      setEmailBody('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send email');
    } finally {
      setEmailSending(false);
    }
  }

  if (!lead && !error) {
    return <p className="muted">Loading deal…</p>;
  }

  if (!lead) {
    return (
      <>
        <div className="banner error">{error ?? 'Deal not found'}</div>
        <Link className="back-link" to="/sales/deal-sourcing/leads">
          ← Back to deal flow
        </Link>
      </>
    );
  }

  return (
    <>
      <Link className="back-link" to="/sales/deal-sourcing/leads">
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
            <h2>Send tracked email</h2>
            <p className="muted small">
              Sends via Resend (not Outlook). Use this when you need open/click tracking. From
              address is your Resend domain sender.
            </p>
            <form className="stack-form" onSubmit={(e) => void onSendTrackedEmail(e)}>
              <label>
                To
                <input
                  type="email"
                  value={emailTo}
                  onChange={(e) => setEmailTo(e.target.value)}
                  placeholder={lead.email || 'recipient@example.com'}
                  required
                />
              </label>
              <label>
                Subject
                <input
                  value={emailSubject}
                  onChange={(e) => setEmailSubject(e.target.value)}
                  required
                />
              </label>
              <label>
                Body
                <textarea
                  value={emailBody}
                  onChange={(e) => setEmailBody(e.target.value)}
                  rows={6}
                  required
                  placeholder="Plain text — line breaks become paragraphs. Put full https:// links for click tracking."
                />
              </label>
              <button type="submit" className="btn primary" disabled={emailSending}>
                {emailSending ? 'Sending…' : 'Send tracked email'}
              </button>
            </form>
            {emailNotice ? <p className="muted mt">{emailNotice}</p> : null}
            {emails.length > 0 ? (
              <ul className="email-lead-list mt">
                {emails.map((m) => (
                  <li key={m.id}>
                    <div className="muted small">
                      {formatEmailWhen(m.created_at)} ·{' '}
                      {EMAIL_SOURCE_LABELS[m.source] ?? m.source}
                    </div>
                    <div>{m.subject || '(no subject)'}</div>
                    <div className="muted small">
                      {m.open_count} open{m.open_count === 1 ? '' : 's'} · {m.click_count}{' '}
                      click{m.click_count === 1 ? '' : 's'} · {m.status}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted mt">No tracked emails for this lead yet.</p>
            )}
          </div>

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
