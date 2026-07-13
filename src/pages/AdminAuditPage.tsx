import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AUDIT_EVENT_TYPE_LABELS,
  listAuditEvents,
  type AuditEvent,
} from '../lib/audit';
import { fetchSalesUsersForAdmin } from '../lib/portalApi';
import { formatDateTime } from '../lib/types';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

const EVENT_FILTER_OPTIONS = [
  '',
  'login',
  'logout',
  'login_failed',
  'session_heartbeat',
  'portal_opened',
  'page_view',
  'entity_view',
  'link_click',
  'download',
  'export',
  'print',
  'email_sent',
  'permission_request',
] as const;

type UserOption = Pick<SalesUser, 'id' | 'email' | 'full_name'>;

function metaPreview(meta: Record<string, unknown>): string {
  const dest = meta.destination_url;
  if (typeof dest === 'string' && dest) return dest;
  const portal = meta.portal;
  if (typeof portal === 'string' && portal) return `portal: ${portal}`;
  const entity = meta.entity_id ?? meta.lead_id;
  if (typeof entity === 'string') return `id: ${entity}`;
  const mins = meta.session_minutes;
  if (typeof mins === 'number') return `${mins}m in session`;
  const keys = Object.keys(meta).filter((k) => k !== 'user_agent' && k !== 'language');
  if (!keys.length) return '—';
  try {
    return JSON.stringify(
      Object.fromEntries(keys.slice(0, 4).map((k) => [k, meta[k]])),
    ).slice(0, 120);
  } catch {
    return '—';
  }
}

export function AdminAuditPage({ salesUser }: Props) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [eventType, setEventType] = useState('');
  const [userId, setUserId] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sinceIso = since ? new Date(`${since}T00:00:00`).toISOString() : undefined;
      const untilIso = until ? new Date(`${until}T23:59:59`).toISOString() : undefined;
      const rows = await listAuditEvents({
        eventType: eventType || undefined,
        userId: userId || undefined,
        since: sinceIso,
        until: untilIso,
        limit: 250,
      });
      setEvents(rows);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load audit events');
    } finally {
      setLoading(false);
    }
  }, [eventType, userId, since, until]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let mounted = true;
    void fetchSalesUsersForAdmin()
      .then((rows) => {
        if (!mounted) return;
        setUsers(
          rows
            .filter((u) => !u.is_house_account)
            .map((u) => ({ id: u.id, email: u.email, full_name: u.full_name })),
        );
      })
      .catch(() => {
        /* filter still works by event type / date */
      });
    return () => {
      mounted = false;
    };
  }, []);

  if (salesUser.role !== 'admin') {
    return (
      <div className="empty">
        <p>Admin only.</p>
        <Link to="/sales" className="btn ghost">
          Back to portals
        </Link>
      </div>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Audit log</h1>
          <p className="muted">
            Recent portal activity. Protected-account rows (Josh) are only visible to that
            account; other admins never see them.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/admin/email" className="btn ghost">
            Email analytics
          </Link>
          <Link to="/sales/admin/portals" className="btn ghost">
            Assignments
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <form
        className="audit-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label className="field">
          <span>Event type</span>
          <select value={eventType} onChange={(e) => setEventType(e.target.value)}>
            <option value="">All types</option>
            {EVENT_FILTER_OPTIONS.filter(Boolean).map((t) => (
              <option key={t} value={t}>
                {AUDIT_EVENT_TYPE_LABELS[t] ?? t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>User</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {(u.full_name || u.email) + ` (${u.email})`}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>From</span>
          <input type="date" value={since} onChange={(e) => setSince(e.target.value)} />
        </label>
        <label className="field">
          <span>To</span>
          <input type="date" value={until} onChange={(e) => setUntil(e.target.value)} />
        </label>
        <div className="audit-filters-actions">
          <button type="submit" className="btn primary" disabled={loading}>
            {loading ? 'Loading…' : 'Apply'}
          </button>
        </div>
      </form>

      {error ? <p className="form-error">{error}</p> : null}

      {!loading && events.length === 0 ? (
        <div className="empty">
          <p>No audit events match these filters.</p>
        </div>
      ) : null}

      {events.length > 0 ? (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>When</th>
                <th>User</th>
                <th>Event</th>
                <th>Path</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.map((ev) => (
                <tr key={ev.id}>
                  <td className="audit-when">{formatDateTime(ev.created_at)}</td>
                  <td>
                    <span className="audit-email">{ev.email ?? '—'}</span>
                    {ev.actor_protected ? (
                      <span className="audit-badge" title="Visible only to this account">
                        private
                      </span>
                    ) : null}
                  </td>
                  <td>{AUDIT_EVENT_TYPE_LABELS[ev.event_type] ?? ev.event_type}</td>
                  <td className="audit-path">{ev.path ?? '—'}</td>
                  <td className="audit-meta">{metaPreview(ev.metadata ?? {})}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
