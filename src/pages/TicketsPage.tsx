import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useCreateTicketOptional } from '../components/CreateTicketProvider';
import {
  formatTicketRef,
  listTickets,
  userDisplayName,
} from '../lib/ticketsApi';
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_CATEGORY_PORTAL,
  TICKET_CATEGORY_TEAM,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  type PortalTicket,
  type TicketCategory,
  type TicketPriority,
  type TicketStatus,
} from '../lib/ticketTypes';
import type { SalesUser } from '../lib/types';
import { userHasPortal } from '../lib/portals';

export type TicketsPageMode = 'mine' | 'queue' | 'admin-all';

type Props = {
  salesUser: SalesUser;
  mode: TicketsPageMode;
  /** Required when mode === 'queue' */
  category?: TicketCategory;
  title?: string;
  subtitle?: string;
};

function canManageCategory(user: SalesUser, category: TicketCategory): boolean {
  if (user.role === 'admin') return true;
  const portal = TICKET_CATEGORY_PORTAL[category];
  if (!portal) return false;
  return userHasPortal(user, portal);
}

export function TicketsPage({
  salesUser,
  mode,
  category,
  title,
  subtitle,
}: Props) {
  const createTicket = useCreateTicketOptional();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<PortalTicket[]>([]);
  const [status, setStatus] = useState<TicketStatus | 'openish' | 'all'>('openish');
  const [priority, setPriority] = useState<TicketPriority | 'all'>('all');
  const [catFilter, setCatFilter] = useState<TicketCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const heading =
    title ??
    (mode === 'mine'
      ? 'My tickets'
      : mode === 'admin-all'
        ? 'All tickets'
        : `${TICKET_CATEGORY_LABELS[category!]} tickets`);

  const refresh = useCallback(async () => {
    const rows = await listTickets({
      category:
        mode === 'queue'
          ? category
          : mode === 'admin-all' && catFilter !== 'all'
            ? catFilter
            : undefined,
      status,
      mineFor: mode === 'mine' ? salesUser.id : undefined,
      search: search || undefined,
      limit: 300,
    });
    const filtered =
      priority === 'all' ? rows : rows.filter((t) => t.priority === priority);
    setTickets(filtered);
  }, [mode, category, catFilter, status, priority, search, salesUser.id]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load tickets');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const manageHint =
    mode === 'queue' && category && !canManageCategory(salesUser, category)
      ? 'You can view tickets you created; queue managers can assign and change status.'
      : null;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{heading}</h1>
          <p className="muted">
            {subtitle ??
              (mode === 'mine'
                ? 'Tickets you opened or were assigned. Create from any page via Create ticket.'
                : mode === 'admin-all'
                  ? 'Central inbox across all shared-services queues.'
                  : `Queue for ${TICKET_CATEGORY_LABELS[category!]} · routed to ${TICKET_CATEGORY_TEAM[category!].label}. Assign, set priority, and drive status.`)}
          </p>
          {manageHint ? <p className="muted">{manageHint}</p> : null}
        </div>
        <div className="page-actions">
          {mode === 'mine' && salesUser.role === 'admin' ? (
            <Link to="/sales/admin/tickets" className="btn ghost">
              All tickets
            </Link>
          ) : null}
          <button
            type="button"
            className="btn primary"
            onClick={() =>
              createTicket?.openCreateTicket(
                category ? { category } : undefined,
              )
            }
          >
            Create ticket
          </button>
        </div>
      </div>

      <div className="filters ticket-filters">
        <label>
          Status
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as TicketStatus | 'openish' | 'all')
            }
          >
            <option value="openish">Open / active</option>
            <option value="all">All statuses</option>
            {TICKET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TICKET_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select
            value={priority}
            onChange={(e) =>
              setPriority(e.target.value as TicketPriority | 'all')
            }
          >
            <option value="all">All</option>
            {TICKET_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {TICKET_PRIORITY_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        {mode === 'admin-all' ? (
          <label>
            Queue
            <select
              value={catFilter}
              onChange={(e) =>
                setCatFilter(e.target.value as TicketCategory | 'all')
              }
            >
              <option value="all">All queues</option>
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label>
          Search
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="#1001 or title"
          />
        </label>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !tickets.length ? (
        <p className="muted">No tickets match these filters.</p>
      ) : null}

      {tickets.length > 0 ? (
        <div className="table-wrap">
          <table className="data-table ticket-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                {mode !== 'queue' ? <th>Queue</th> : null}
                <th>Team</th>
                <th>Status</th>
                <th>Priority</th>
                <th>Assignee</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {tickets.map((t) => {
                const unread =
                  (t.created_by === salesUser.id && t.creator_has_unread) ||
                  (t.assignee_id === salesUser.id && t.assignee_has_unread);
                const team = TICKET_CATEGORY_TEAM[t.category];
                return (
                  <tr
                    key={t.id}
                    className={unread ? 'ticket-row-unread' : undefined}
                    onClick={() => navigate(`/sales/tickets/${t.id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <Link
                        to={`/sales/tickets/${t.id}`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {formatTicketRef(t)}
                      </Link>
                      {unread ? (
                        <span className="badge ticket-unread-badge">New</span>
                      ) : null}
                    </td>
                    <td>{t.title}</td>
                    {mode !== 'queue' ? (
                      <td>{TICKET_CATEGORY_LABELS[t.category]}</td>
                    ) : null}
                    <td className="muted">{team.label}</td>
                    <td>
                      <span className={`badge ticket-status-${t.status}`}>
                        {TICKET_STATUS_LABELS[t.status]}
                      </span>
                    </td>
                    <td>
                      <span className={`badge ticket-priority-${t.priority}`}>
                        {TICKET_PRIORITY_LABELS[t.priority]}
                      </span>
                    </td>
                    <td>{userDisplayName(t.assignee)}</td>
                    <td className="muted">
                      {new Date(t.updated_at).toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </>
  );
}
