import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { TodoImportance, TodoTask } from '../lib/calendarApi';
import {
  dueDateInputValue,
  formatTodoDue,
  importanceLabel,
} from '../lib/msTaskUtils';
import { getPortalDefinition } from '../lib/portals';
import { todoListDisplayLabel } from '../lib/portalTodo';
import { dealLinkFromTodoBody } from '../lib/todoContext';

export type TodoLeadLink = { lead_id: string; label: string };

export type TodoDealOption = {
  id: string;
  name: string;
  company: string | null;
};

function dealOptionLabel(d: TodoDealOption): string {
  return d.company ? `${d.name} · ${d.company}` : d.name;
}

export function TodoPanel({
  loading,
  openTasks,
  doneTasks,
  title,
  due,
  importance,
  saving,
  canWrite,
  heading = 'Microsoft To Do',
  blurb,
  leadLinks,
  deals,
  leadId,
  onLeadChange,
  onTitleChange,
  onDueChange,
  onImportanceChange,
  onCreate,
  onUpdate,
  onComplete,
  onReconnect,
}: {
  loading: boolean;
  openTasks: TodoTask[];
  doneTasks: TodoTask[];
  title: string;
  due: string;
  importance: TodoImportance;
  saving: boolean;
  canWrite: boolean;
  heading?: string;
  blurb?: string;
  /** Microsoft task id → deal card for “Open deal”. */
  leadLinks?: Record<string, TodoLeadLink>;
  /** Deal Sourcing leads for assign dropdown (master To Do). */
  deals?: TodoDealOption[];
  leadId?: string;
  onLeadChange?: (leadId: string) => void;
  onTitleChange: (v: string) => void;
  onDueChange: (v: string) => void;
  onImportanceChange: (v: TodoImportance) => void;
  onCreate: () => void | Promise<void>;
  onUpdate: (
    t: TodoTask,
    patch: {
      title?: string;
      due?: string | null;
      importance?: TodoImportance;
      lead_id?: string | null;
    },
  ) => void | Promise<void>;
  onComplete: (t: TodoTask) => void | Promise<void>;
  onReconnect: () => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDue, setEditDue] = useState('');
  const [editImportance, setEditImportance] = useState<TodoImportance>('normal');
  const [editLeadId, setEditLeadId] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  const showDealSelect = Boolean(deals && onLeadChange);

  function startEdit(task: TodoTask) {
    setEditingId(task.id);
    setEditTitle(task.title);
    setEditDue(dueDateInputValue(task.due));
    const imp = (task.importance ?? 'normal').toLowerCase();
    setEditImportance(
      imp === 'high' || imp === 'low' || imp === 'normal' ? imp : 'normal',
    );
    setEditLeadId(
      leadLinks?.[task.id]?.lead_id ?? dealLinkFromTodoBody(task.body_preview)?.lead_id ?? '',
    );
  }

  function cancelEdit() {
    setEditingId(null);
    setEditSaving(false);
  }

  async function saveEdit(task: TodoTask) {
    const nextTitle = editTitle.trim();
    if (!nextTitle) return;
    setEditSaving(true);
    try {
      await onUpdate(task, {
        title: nextTitle,
        due: editDue ? `${editDue}T00:00:00` : null,
        importance: editImportance,
        ...(showDealSelect ? { lead_id: editLeadId || null } : {}),
      });
      setEditingId(null);
    } catch {
      /* parent surfaces error */
    } finally {
      setEditSaving(false);
    }
  }

  function dealLink(taskId: string, bodyPreview?: string | null) {
    const link = leadLinks?.[taskId] ?? dealLinkFromTodoBody(bodyPreview);
    if (!link?.lead_id) return null;
    return (
      <Link
        className="cal-task-open-deal"
        to={`/sales/deal-sourcing/leads/${link.lead_id}`}
        title={link.label}
      >
        Open deal
      </Link>
    );
  }

  if (!canWrite) {
    return (
      <div className="empty">
        <p>Microsoft To Do needs Tasks.ReadWrite.</p>
        <p className="muted">Reconnect after an admin grants consent.</p>
        <button type="button" className="btn primary" onClick={onReconnect}>
          Reconnect
        </button>
      </div>
    );
  }

  return (
    <>
      {heading ? (
        <div className="panel-head">
          <h2>{heading}</h2>
          {loading ? <span className="muted small">Syncing…</span> : null}
        </div>
      ) : loading ? (
        <p className="muted small">Syncing…</p>
      ) : null}
      {blurb ? <p className="muted small">{blurb}</p> : null}
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
          placeholder="New task…"
          aria-label="New To Do title"
        />
        <label className="cal-task-meta-field">
          <span className="meeting-label">Due</span>
          <input
            type="date"
            value={due}
            onChange={(e) => onDueChange(e.target.value)}
            aria-label="Due date"
          />
        </label>
        <label className="cal-task-meta-field">
          <span className="meeting-label">Importance</span>
          <select
            value={importance}
            onChange={(e) => onImportanceChange(e.target.value as TodoImportance)}
            aria-label="Importance"
          >
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
          </select>
        </label>
        {showDealSelect ? (
          <label className="cal-task-meta-field cal-task-deal-field">
            <span className="meeting-label">Deal</span>
            <select
              value={leadId ?? ''}
              onChange={(e) => onLeadChange?.(e.target.value)}
              aria-label="Assign to deal card"
            >
              <option value="">None (personal / unscoped)</option>
              {(deals ?? []).map((d) => (
                <option key={d.id} value={d.id}>
                  {dealOptionLabel(d)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="submit" className="btn primary" disabled={saving || !title.trim()}>
          {saving ? 'Adding…' : 'Add'}
        </button>
      </form>
      <ul className="cal-task-list">
        {openTasks.length === 0 && !loading ? (
          <li className="muted">No open To Do tasks.</li>
        ) : (
          openTasks.map((t) => {
            const imp = (t.importance ?? 'normal').toLowerCase();
            const editing = editingId === t.id;
            const portalLabel = t.portal_slug
              ? todoListDisplayLabel(t.portal_slug) ||
                getPortalDefinition(t.portal_slug)?.name ||
                t.portal_slug
              : null;
            return (
              <li key={t.id} className="cal-task-item">
                <button
                  type="button"
                  className="cal-task-check"
                  title="Complete"
                  disabled={editing || editSaving}
                  onClick={() => void onComplete(t)}
                >
                  ○
                </button>
                {editing ? (
                  <div className="cal-task-edit">
                    <input
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      aria-label="Edit task title"
                    />
                    <div className="cal-task-edit-meta">
                      <label className="cal-task-meta-field">
                        <span className="meeting-label">Due</span>
                        <input
                          type="date"
                          value={editDue}
                          onChange={(e) => setEditDue(e.target.value)}
                          aria-label="Edit due date"
                        />
                      </label>
                      <label className="cal-task-meta-field">
                        <span className="meeting-label">Importance</span>
                        <select
                          value={editImportance}
                          onChange={(e) =>
                            setEditImportance(e.target.value as TodoImportance)
                          }
                          aria-label="Edit importance"
                        >
                          <option value="low">Low</option>
                          <option value="normal">Normal</option>
                          <option value="high">High</option>
                        </select>
                      </label>
                      {showDealSelect ? (
                        <label className="cal-task-meta-field cal-task-deal-field">
                          <span className="meeting-label">Deal</span>
                          <select
                            value={editLeadId}
                            onChange={(e) => setEditLeadId(e.target.value)}
                            aria-label="Assign to deal card"
                          >
                            <option value="">None (personal / unscoped)</option>
                            {(deals ?? []).map((d) => (
                              <option key={d.id} value={d.id}>
                                {dealOptionLabel(d)}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                    <div className="cal-task-edit-actions">
                      <button
                        type="button"
                        className="btn primary"
                        disabled={editSaving || !editTitle.trim()}
                        onClick={() => void saveEdit(t)}
                      >
                        {editSaving ? 'Saving…' : 'Save'}
                      </button>
                      <button
                        type="button"
                        className="btn"
                        disabled={editSaving}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="cal-task-body">
                    <div className="cal-task-title-row">
                      <div className="cal-task-title">{t.title}</div>
                      <span
                        className={`cal-task-importance imp-${imp === 'high' || imp === 'low' ? imp : 'normal'}`}
                      >
                        {importanceLabel(t.importance)}
                      </span>
                    </div>
                    <div className="cal-task-meta">
                      {t.due ? (
                        <span className="muted small">Due {formatTodoDue(t.due)}</span>
                      ) : (
                        <span className="muted small">No due date</span>
                      )}
                      {portalLabel && portalLabel !== 'Master' ? (
                        <span className="muted small portal-task-chip">{portalLabel}</span>
                      ) : null}
                      {t.body_preview ? (
                        <span className="muted small cal-task-context" title={t.body_preview}>
                          {t.body_preview.split('\n')[0]}
                        </span>
                      ) : null}
                      {dealLink(t.id, t.body_preview)}
                      <button
                        type="button"
                        className="cal-task-edit-btn"
                        onClick={() => startEdit(t)}
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })
        )}
      </ul>
      {doneTasks.length ? (
        <>
          <h3 className="cal-subhead">Recently completed</h3>
          <ul className="cal-task-list done">
            {doneTasks.map((t) => {
              const imp = (t.importance ?? 'normal').toLowerCase();
              return (
                <li key={t.id} className="cal-task-item done">
                  <span className="cal-task-check">✓</span>
                  <div className="cal-task-body">
                    <div className="cal-task-title-row">
                      <span className="cal-task-title">{t.title}</span>
                      <span
                        className={`cal-task-importance imp-${imp === 'high' || imp === 'low' ? imp : 'normal'}`}
                      >
                        {importanceLabel(t.importance)}
                      </span>
                    </div>
                    <div className="cal-task-meta">
                      {t.due ? (
                        <span className="muted small">Due {formatTodoDue(t.due)}</span>
                      ) : null}
                      {t.body_preview ? (
                        <span className="muted small cal-task-context" title={t.body_preview}>
                          {t.body_preview.split('\n')[0]}
                        </span>
                      ) : null}
                      {dealLink(t.id, t.body_preview)}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </>
  );
}
