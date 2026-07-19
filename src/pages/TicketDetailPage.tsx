import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  TicketAttachmentPicker,
  revokeTicketAttachmentDrafts,
} from '../components/TicketAttachmentPicker';
import {
  addTicketComment,
  formatTicketRef,
  getTicket,
  getTicketAttachmentUrl,
  listSalesUsersForAssign,
  listTicketAttachments,
  listTicketComments,
  markTicketRead,
  updateTicket,
  uploadTicketAttachment,
  userDisplayName,
} from '../lib/ticketsApi';
import {
  TICKET_CATEGORIES,
  TICKET_CATEGORY_LABELS,
  TICKET_CATEGORY_PORTAL,
  TICKET_CATEGORY_QUEUE_PATH,
  TICKET_CATEGORY_TEAM,
  TICKET_PRIORITIES,
  TICKET_PRIORITY_LABELS,
  TICKET_SOURCE_PORTAL_LABELS,
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
  type PortalTicket,
  type PortalTicketAttachment,
  type PortalTicketComment,
  type TicketAttachmentDraft,
  type TicketCategory,
  type TicketDiagnosticContext,
  type TicketPriority,
  type TicketSourcePortal,
  type TicketStatus,
} from '../lib/ticketTypes';
import { userHasPortal } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

function canManage(user: SalesUser, ticket: PortalTicket): boolean {
  if (user.role === 'admin') return true;
  const portal = TICKET_CATEGORY_PORTAL[ticket.category];
  if (!portal) return false;
  return userHasPortal(user, portal);
}

function diag(
  ctx: PortalTicket['diagnostic_context'],
): TicketDiagnosticContext | null {
  if (!ctx || typeof ctx !== 'object') return null;
  return ctx as TicketDiagnosticContext;
}

function sourceLabel(portal: TicketSourcePortal | undefined): string {
  if (!portal) return TICKET_SOURCE_PORTAL_LABELS.tage;
  return TICKET_SOURCE_PORTAL_LABELS[portal] ?? portal;
}

export function TicketDetailPage({ salesUser }: Props) {
  const { id } = useParams<{ id: string }>();
  const [ticket, setTicket] = useState<PortalTicket | null>(null);
  const [comments, setComments] = useState<PortalTicketComment[]>([]);
  const [attachments, setAttachments] = useState<PortalTicketAttachment[]>([]);
  const [assignees, setAssignees] = useState<
    Pick<SalesUser, 'id' | 'email' | 'full_name' | 'role'>[]
  >([]);
  const [comment, setComment] = useState('');
  const [commentFiles, setCommentFiles] = useState<TicketAttachmentDraft[]>([]);
  const [internal, setInternal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [snapshotUrl, setSnapshotUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  const refresh = useCallback(async () => {
    if (!id) return;
    const [t, c, a] = await Promise.all([
      getTicket(id),
      listTicketComments(id),
      listTicketAttachments(id),
    ]);
    setTicket(t);
    setComments(c);
    setAttachments(a);
    if (t) {
      try {
        await markTicketRead(t.id);
      } catch {
        /* ignore */
      }
    }
    const snap = a.find((x) => x.kind === 'page_snapshot');
    if (snap) {
      try {
        setSnapshotUrl(await getTicketAttachmentUrl(snap.storage_path));
      } catch {
        setSnapshotUrl(null);
      }
    } else {
      setSnapshotUrl(null);
    }
  }, [id]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const users = await listSalesUsersForAssign();
        if (mounted) setAssignees(users);
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load ticket');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  async function patch(
    updates: Parameters<typeof updateTicket>[1],
    opts?: { notifyAssignee?: boolean },
  ) {
    if (!ticket) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updateTicket(ticket.id, updates, opts);
      setTicket(next);
      setNotice('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    } finally {
      setSaving(false);
    }
  }

  async function onComment(e: FormEvent) {
    e.preventDefault();
    if (!ticket) return;
    if (!comment.trim() && commentFiles.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await addTicketComment({
        ticketId: ticket.id,
        authorId: salesUser.id,
        body: comment,
        isInternal: internal && canManage(salesUser, ticket),
        ticket,
        attachments: commentFiles.map((a) => ({
          file: a.file,
          fileName: a.fileName,
          mimeType: a.mimeType,
        })),
      });
      revokeTicketAttachmentDrafts(commentFiles);
      setComment('');
      setCommentFiles([]);
      setInternal(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Comment failed');
    } finally {
      setSaving(false);
    }
  }

  async function onUpload(file: File | null) {
    if (!ticket || !file) return;
    setUploading(true);
    setError(null);
    try {
      await uploadTicketAttachment({
        ticketId: ticket.id,
        uploadedBy: salesUser.id,
        kind: 'upload',
        file,
        fileName: file.name,
        mimeType: file.type,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  if (loading) {
    return <p className="muted">Loading ticket…</p>;
  }
  if (!ticket) {
    return (
      <div className="page-header">
        <div>
          <h1>Ticket not found</h1>
          <p className="muted">{error ?? 'This ticket may have been removed.'}</p>
          <Link to="/sales/tickets">← My tickets</Link>
        </div>
      </div>
    );
  }

  const manage = canManage(salesUser, ticket);
  const d = diag(ticket.diagnostic_context);
  const queuePath = TICKET_CATEGORY_QUEUE_PATH[ticket.category];
  const routingTeam = TICKET_CATEGORY_TEAM[ticket.category];

  return (
    <>
      <div className="page-header">
        <div>
          <p className="muted" style={{ marginBottom: 4 }}>
            <Link to="/sales/tickets">My tickets</Link>
            {' · '}
            <Link to={queuePath}>
              {TICKET_CATEGORY_LABELS[ticket.category]} queue
            </Link>
          </p>
          <h1>
            {formatTicketRef(ticket)}{' '}
            <span style={{ fontWeight: 500 }}>{ticket.title}</span>
          </h1>
          <p className="muted">
            Opened by {userDisplayName(ticket.creator)} ·{' '}
            {new Date(ticket.created_at).toLocaleString()}
            {' · '}
            Team: {routingTeam.label}
            {' · '}
            Source: {sourceLabel(ticket.source_portal)}
            {ticket.external_id ? (
              <>
                {' · '}
                Ext: <code>{ticket.external_id}</code>
              </>
            ) : null}
            {ticket.external_url ? (
              <>
                {' · '}
                <a href={ticket.external_url} target="_blank" rel="noreferrer">
                  Open in source
                </a>
              </>
            ) : null}
          </p>
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="ok">{notice}</p> : null}

      <div className="ticket-detail-grid">
        <section className="ticket-detail-main">
          <h2>Description</h2>
          <div className="ticket-body">
            {ticket.description.trim()
              ? ticket.description
              : 'No description provided.'}
          </div>

          <h2>Comments</h2>
          <ul className="ticket-comments">
            {comments.length === 0 ? (
              <li className="muted">No comments yet.</li>
            ) : (
              comments.map((c) => {
                const commentAtts = attachments.filter(
                  (a) => a.comment_id === c.id,
                );
                return (
                  <li
                    key={c.id}
                    className={c.is_internal ? 'internal' : undefined}
                  >
                    <div className="ticket-comment-meta">
                      <strong>{userDisplayName(c.author)}</strong>
                      <span className="muted">
                        {new Date(c.created_at).toLocaleString()}
                      </span>
                      {c.is_internal ? (
                        <span className="badge">Internal</span>
                      ) : null}
                    </div>
                    <div className="ticket-comment-body">{c.body}</div>
                    {commentAtts.length > 0 ? (
                      <ul
                        className="ticket-attachments"
                        style={{ marginTop: 8 }}
                      >
                        {commentAtts.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              className="btn ghost"
                              onClick={() =>
                                void (async () => {
                                  const url = await getTicketAttachmentUrl(
                                    a.storage_path,
                                  );
                                  window.open(
                                    url,
                                    '_blank',
                                    'noopener,noreferrer',
                                  );
                                })()
                              }
                            >
                              {a.file_name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </li>
                );
              })
            )}
          </ul>
          <form
            className="ticket-comment-form"
            onSubmit={(e) => void onComment(e)}
          >
            <label>
              Add comment
              <textarea
                ref={commentRef}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={3}
                placeholder="Update the requester or leave notes… Paste screenshots here."
              />
            </label>
            <TicketAttachmentPicker
              files={commentFiles}
              onChange={setCommentFiles}
              disabled={saving}
              compact
              pasteTargetRef={commentRef}
              label="Reply attachments"
            />
            {manage ? (
              <label className="checkbox-inline">
                <input
                  type="checkbox"
                  checked={internal}
                  onChange={(e) => setInternal(e.target.checked)}
                />
                Internal note (hidden from requester unless they manage this
                queue)
              </label>
            ) : null}
            <button
              type="submit"
              className="btn primary"
              disabled={
                saving || (!comment.trim() && commentFiles.length === 0)
              }
            >
              Post comment
            </button>
          </form>

          <h2>Attachments</h2>
          <ul className="ticket-attachments">
            {attachments.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() =>
                    void (async () => {
                      const url = await getTicketAttachmentUrl(a.storage_path);
                      window.open(url, '_blank', 'noopener,noreferrer');
                    })()
                  }
                >
                  {a.kind === 'page_snapshot' ? '📷 ' : ''}
                  {a.file_name}
                </button>
                <span className="muted">
                  {a.kind === 'page_snapshot' ? 'Page snapshot' : a.mime_type} ·{' '}
                  {Math.round(a.byte_size / 1024)} KB
                  {a.comment_id ? ' · on reply' : ''}
                </span>
              </li>
            ))}
          </ul>
          <label className="ticket-upload">
            Attach file
            <input
              type="file"
              disabled={uploading}
              onChange={(e) => {
                const f = e.target.files?.[0] ?? null;
                e.target.value = '';
                void onUpload(f);
              }}
            />
          </label>

          {snapshotUrl ? (
            <>
              <h2>Page snapshot</h2>
              <p className="muted">
                Captured from the portal browser tab when the ticket was created
                (not OS desktop capture).
              </p>
              <a href={snapshotUrl} target="_blank" rel="noreferrer">
                <img
                  src={snapshotUrl}
                  alt="Portal page snapshot"
                  className="ticket-snapshot"
                />
              </a>
            </>
          ) : null}

          {d ? (
            <>
              <h2>Diagnostics</h2>
              <dl className="ticket-diag">
                <dt>URL</dt>
                <dd>
                  <code>{d.url}</code>
                </dd>
                <dt>Page</dt>
                <dd>{d.page_title}</dd>
                <dt>Portal</dt>
                <dd>{d.portal_slug ?? '—'}</dd>
                <dt>User</dt>
                <dd>
                  {d.user_email} <span className="muted">({d.user_id})</span>
                </dd>
                <dt>Captured</dt>
                <dd>{new Date(d.captured_at).toLocaleString()}</dd>
                <dt>Viewport</dt>
                <dd>
                  {d.viewport?.width}×{d.viewport?.height} @{' '}
                  {d.viewport?.device_pixel_ratio ?? 1}x
                </dd>
                <dt>User agent</dt>
                <dd>
                  <code className="ticket-ua">{d.user_agent}</code>
                </dd>
              </dl>
            </>
          ) : null}
        </section>

        <aside className="ticket-detail-side">
          <h2>Manage</h2>
          {ticket.source_portal !== 'tage' ||
          ticket.sync_status !== 'local_only' ? (
            <p className="muted small">
              Sync: <code>{ticket.sync_status}</code>
              {ticket.last_synced_at
                ? ` · last ${new Date(ticket.last_synced_at).toLocaleString()}`
                : ''}
            </p>
          ) : null}
          <label>
            Status
            <select
              value={ticket.status}
              disabled={!manage || saving}
              onChange={(e) =>
                void patch({ status: e.target.value as TicketStatus })
              }
            >
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
              value={ticket.priority}
              disabled={!manage || saving}
              onChange={(e) =>
                void patch({ priority: e.target.value as TicketPriority })
              }
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {TICKET_PRIORITY_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Queue
            <select
              value={ticket.category}
              disabled={!manage || saving}
              onChange={(e) =>
                void patch({ category: e.target.value as TicketCategory })
              }
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {TICKET_CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <p className="muted" style={{ marginTop: 0 }}>
            Routing team: {TICKET_CATEGORY_TEAM[ticket.category].label}
          </p>
          <label>
            Assignee
            <select
              value={ticket.assignee_id ?? ''}
              disabled={!manage || saving}
              onChange={(e) => {
                const v = e.target.value || null;
                void patch({ assignee_id: v }, { notifyAssignee: Boolean(v) });
              }}
            >
              <option value="">Unassigned</option>
              {assignees.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.full_name || u.email}
                </option>
              ))}
            </select>
          </label>
          {!manage ? (
            <p className="muted">
              Only {TICKET_CATEGORY_LABELS[ticket.category]} queue managers (or
              admins) can change status, priority, and assignee.
            </p>
          ) : null}
          <div className="ticket-status-actions">
            {ticket.status === 'open' && manage ? (
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => void patch({ status: 'in_progress' })}
              >
                Start work
              </button>
            ) : null}
            {(ticket.status === 'in_progress' || ticket.status === 'waiting') &&
            manage ? (
              <button
                type="button"
                className="btn primary"
                disabled={saving}
                onClick={() => void patch({ status: 'resolved' })}
              >
                Mark resolved
              </button>
            ) : null}
            {ticket.status === 'resolved' && manage ? (
              <button
                type="button"
                className="btn ghost"
                disabled={saving}
                onClick={() => void patch({ status: 'closed' })}
              >
                Close
              </button>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}
