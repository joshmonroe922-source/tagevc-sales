import { Fragment, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  EMAIL_EVENT_LABELS,
  EMAIL_SOURCE_LABELS,
  formatEmailWhen,
  listEmailEventsForMessage,
  listEmailMessages,
  listRecentEmailEvents,
  summarizeMessages,
  type EmailEvent,
  type EmailMessage,
} from '../lib/emailAnalytics';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

const SOURCE_FILTERS = [
  '',
  'intake_alert',
  'drip_lead',
  'drip_reminder',
  'portal_tracked',
  'webhook',
] as const;

export function AdminEmailPage({ salesUser }: Props) {
  const [messages, setMessages] = useState<EmailMessage[]>([]);
  const [recentEvents, setRecentEvents] = useState<EmailEvent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedEvents, setExpandedEvents] = useState<EmailEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [source, setSource] = useState('');
  const [recipient, setRecipient] = useState('');
  const [since, setSince] = useState('');
  const [until, setUntil] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const sinceIso = since ? new Date(`${since}T00:00:00`).toISOString() : undefined;
      const untilIso = until ? new Date(`${until}T23:59:59`).toISOString() : undefined;
      const [rows, events] = await Promise.all([
        listEmailMessages({
          source: source || undefined,
          recipient: recipient.trim() || undefined,
          since: sinceIso,
          until: untilIso,
          limit: 200,
        }),
        listRecentEmailEvents(60),
      ]);
      setMessages(rows);
      setRecentEvents(events);
      setExpandedId(null);
      setExpandedEvents([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email analytics');
    } finally {
      setLoading(false);
    }
  }, [source, recipient, since, until]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleExpand(msg: EmailMessage) {
    if (expandedId === msg.id) {
      setExpandedId(null);
      setExpandedEvents([]);
      return;
    }
    setExpandedId(msg.id);
    try {
      const events = await listEmailEventsForMessage(msg.id);
      setExpandedEvents(events);
    } catch {
      setExpandedEvents([]);
    }
  }

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

  const summary = summarizeMessages(messages);

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Email analytics</h1>
          <p className="muted">
            Opens, clicks, and delivery for portal-sent mail via Resend. Outlook/M365
            personal sends are not tracked unless you send from this portal.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/admin/audit" className="btn ghost">
            Audit log
          </Link>
          <Link to="/sales/admin/portals" className="btn ghost">
            Assignments
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <div className="kpi-row email-kpi-row">
        <div className="kpi">
          <div className="kpi-label">Messages</div>
          <div className="kpi-value">{summary.sent}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Unique opens</div>
          <div className="kpi-value">{summary.opened}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total opens</div>
          <div className="kpi-value">{summary.totalOpens}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Unique clicks</div>
          <div className="kpi-value">{summary.clicked}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Total clicks</div>
          <div className="kpi-value">{summary.totalClicks}</div>
        </div>
        <div className="kpi">
          <div className="kpi-label">Bounced</div>
          <div className="kpi-value">{summary.bounced}</div>
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
          <span>Source</span>
          <select value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {SOURCE_FILTERS.filter(Boolean).map((s) => (
              <option key={s} value={s}>
                {EMAIL_SOURCE_LABELS[s] ?? s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Recipient</span>
          <input
            type="email"
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="email@example.com"
          />
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

      <p className="muted small email-limits-note">
        Limits: open tracking uses a pixel (image blockers under-count; some clients
        prefetch and over-count). True forward detection and attachment-open tracking are
        not available from Resend. Multiple opens may include re-opens or a forwarder’s
        image load — treat as a signal, not proof of forwarding.
      </p>

      {!loading && messages.length === 0 ? (
        <div className="empty">
          <p>No tracked emails yet.</p>
          <p className="muted">
            Enable Resend open/click tracking + webhook (see SETUP_EMAIL.md), then send a
            drip, intake alert, or tracked email from a lead.
          </p>
        </div>
      ) : null}

      {messages.length > 0 ? (
        <div className="audit-table-wrap">
          <table className="audit-table">
            <thead>
              <tr>
                <th>Sent</th>
                <th>To</th>
                <th>Subject</th>
                <th>Source</th>
                <th>Status</th>
                <th>Opens</th>
                <th>Clicks</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {messages.map((m) => (
                <Fragment key={m.id}>
                  <tr>
                    <td className="audit-when">{formatEmailWhen(m.created_at)}</td>
                    <td className="audit-email">
                      {m.to_addresses.join(', ') || '—'}
                      {m.lead_id ? (
                        <>
                          {' '}
                          <Link
                            to={`/sales/deal-sourcing/leads/${m.lead_id}`}
                            className="email-lead-link"
                          >
                            Lead
                          </Link>
                        </>
                      ) : null}
                    </td>
                    <td>{m.subject || '—'}</td>
                    <td>{EMAIL_SOURCE_LABELS[m.source] ?? m.source}</td>
                    <td>{m.status}</td>
                    <td>
                      {m.open_count}
                      {m.last_opened_at ? (
                        <div className="muted small">{formatEmailWhen(m.last_opened_at)}</div>
                      ) : null}
                    </td>
                    <td>
                      {m.click_count}
                      {m.last_clicked_at ? (
                        <div className="muted small">{formatEmailWhen(m.last_clicked_at)}</div>
                      ) : null}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => void toggleExpand(m)}
                      >
                        {expandedId === m.id ? 'Hide' : 'Events'}
                      </button>
                    </td>
                  </tr>
                  {expandedId === m.id ? (
                    <tr className="email-events-row">
                      <td colSpan={8}>
                        {expandedEvents.length === 0 ? (
                          <p className="muted">No webhook events for this message yet.</p>
                        ) : (
                          <ul className="email-event-list">
                            {expandedEvents.map((ev) => (
                              <li key={ev.id}>
                                <strong>
                                  {EMAIL_EVENT_LABELS[ev.event_type] ?? ev.event_type}
                                </strong>{' '}
                                <span className="muted">
                                  {formatEmailWhen(ev.occurred_at)}
                                </span>
                                {ev.click_url ? (
                                  <span className="email-click-url"> → {ev.click_url}</span>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        )}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {recentEvents.length > 0 ? (
        <section className="email-recent mt">
          <h2>Recent events</h2>
          <div className="audit-table-wrap">
            <table className="audit-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Event</th>
                  <th>Recipient</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {recentEvents.map((ev) => (
                  <tr key={ev.id}>
                    <td className="audit-when">{formatEmailWhen(ev.occurred_at)}</td>
                    <td>{EMAIL_EVENT_LABELS[ev.event_type] ?? ev.event_type}</td>
                    <td className="audit-email">{ev.recipient ?? '—'}</td>
                    <td className="audit-meta">{ev.click_url ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  );
}
