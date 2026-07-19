import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { linkMsTodoToLead, notifySalesTodoSaved } from '../lib/api';
import {
  createTodoTask,
  fetchCalendarStatus,
  startCalendarOAuth,
  type CalendarStatus,
  type TodoImportance,
} from '../lib/calendarApi';
import {
  formatTodoContextBody,
  resolveTodoCaptureContext,
  type TodoCaptureContext,
} from '../lib/todoContext';
import { dueAtFromDateInput, type SalesUser } from '../lib/types';

export type AddTodoDealPrefill = {
  leadId: string;
  dealName: string;
};

type Props = {
  salesUser: SalesUser;
  open: boolean;
  onClose: () => void;
  /** When opening from a deal card Follow Up button. */
  dealPrefill?: AddTodoDealPrefill | null;
};

export function AddTodoModal({ salesUser, open, onClose, dealPrefill = null }: Props) {
  const location = useLocation();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [ctx, setCtx] = useState<TodoCaptureContext | null>(null);
  const [title, setTitle] = useState('');
  const [due, setDue] = useState('');
  const [importance, setImportance] = useState<TodoImportance>('normal');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isFollowUp = Boolean(dealPrefill?.leadId);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    setError(null);
    setNotice(null);
    setTitle('');
    setDue('');
    setImportance('normal');
    setStatusLoading(true);

    void (async () => {
      try {
        const [s, capture] = await Promise.all([
          fetchCalendarStatus(),
          resolveTodoCaptureContext(
            location.pathname,
            location.search,
            salesUser,
            window.location.origin,
            dealPrefill,
          ),
        ]);
        if (!mounted) return;
        setStatus(s);
        setCtx(capture);
        if (dealPrefill?.dealName) {
          setTitle(`Follow up: ${dealPrefill.dealName}`);
        }
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Could not prepare To Do');
      } finally {
        if (mounted) setStatusLoading(false);
      }
    })();

    return () => {
      mounted = false;
    };
  }, [open, location.pathname, location.search, salesUser, dealPrefill?.leadId, dealPrefill?.dealName]);

  if (!open) return null;

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const redirect = `${location.pathname}${location.search || ''}`;
      const { url } = await startCalendarOAuth(redirect || '/sales');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t || !ctx) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const body = formatTodoContextBody(ctx);
      const created = await createTodoTask({
        title: t,
        body,
        portal_slug: 'master',
        due: due ? `${due}T00:00:00` : undefined,
        importance,
        time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      });
      let linkWarn: string | null = null;
      if (ctx.leadId) {
        try {
          await linkMsTodoToLead({
            sales_user_id: salesUser.id,
            ms_todo_list_id: created.list_id,
            ms_todo_task_id: created.task.id,
            title: t,
            due_at: due ? dueAtFromDateInput(due) : null,
            importance,
            portal_slug: 'master',
            lead_id: ctx.leadId,
          });
        } catch {
          linkWarn =
            'Saved to Microsoft To Do. Open deal may be missing until the body link is used.';
        }
      }
      setNotice(linkWarn ?? 'Saved to Microsoft To Do.');
      setTitle('');
      setDue('');
      setImportance('normal');
      notifySalesTodoSaved();
      window.setTimeout(() => onClose(), linkWarn ? 1400 : 650);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Could not create To Do';
      if (/not connected|reconnect|Unauthorized|needs_reconnect/i.test(message)) {
        setError(
          status?.connected
            ? 'Reconnect Microsoft to save To Do items (Tasks permission).'
            : 'Connect Microsoft to save To Do items.',
        );
      } else {
        setError(message);
      }
    } finally {
      setSaving(false);
    }
  }

  const softFail =
    !statusLoading &&
    Boolean(
      status &&
        (!status.configured || !status.connected || !status.capabilities?.todo),
    );
  const needsReconnect = Boolean(
    softFail && status?.connected && !status.capabilities?.todo,
  );

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal add-todo-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-todo-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-todo-title">{isFollowUp ? 'Follow Up / Next Action' : 'Add To Do'}</h2>
        {notice ? (
          <div className={`banner ${notice.includes('Open deal may be missing') ? 'warn' : 'ok'}`}>
            {notice}
          </div>
        ) : null}
        {error ? <div className="banner error">{error}</div> : null}

        {statusLoading ? (
          <p className="muted">Loading…</p>
        ) : softFail ? (
          <div className="empty portal-tasks-softfail">
            <p>
              {needsReconnect
                ? 'Microsoft is connected but To Do permission is missing. Reconnect after an admin grants Tasks.ReadWrite.'
                : status?.configured === false
                  ? 'Microsoft Graph is not configured yet. An admin needs to finish Azure setup.'
                  : 'Connect your work mailbox to save tasks to Microsoft To Do.'}
            </p>
            {status?.configured !== false ? (
              <button
                type="button"
                className="btn primary"
                onClick={() => void onConnect()}
                disabled={connecting}
              >
                {connecting ? 'Redirecting…' : needsReconnect ? 'Reconnect Microsoft' : 'Connect Microsoft'}
              </button>
            ) : null}
            <p className="muted small">
              You can keep using the rest of the portal; To Do soft-fails until connected.
            </p>
          </div>
        ) : (
          <form className="stack-form" onSubmit={(e) => void onSubmit(e)}>
            <label>
              Title
              <input
                required
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What needs doing?"
                aria-label="To Do title"
              />
            </label>
            <div className="form-grid">
              <label>
                Due date
                <input
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                  aria-label="Due date"
                />
              </label>
              <label>
                Importance
                <select
                  value={importance}
                  onChange={(e) => setImportance(e.target.value as TodoImportance)}
                  aria-label="Importance"
                >
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>
              </label>
            </div>
            {ctx ? (
              <p className="muted small add-todo-context">
                Context: <strong>{ctx.label}</strong>
                {ctx.dealName ? (
                  <>
                    {' '}
                    · Deal: {ctx.dealName}
                  </>
                ) : null}
                {ctx.dealUrl ? (
                  <>
                    <br />
                    <span className="mono-path">{ctx.dealUrl}</span>
                  </>
                ) : (
                  <>
                    <br />
                    <span className="mono-path">{ctx.path}</span>
                  </>
                )}
              </p>
            ) : null}
            <div className="form-actions">
              <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
                Cancel
              </button>
              <button
                type="submit"
                className="btn primary"
                disabled={saving || !title.trim() || !ctx}
              >
                {saving ? 'Saving…' : 'Save to To Do'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
