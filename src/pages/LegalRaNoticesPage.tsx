import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailAttachmentPreviewModal } from '../components/MailAttachmentPreviewModal';
import { MailThreadView } from '../components/MailThreadView';
import { createTask } from '../lib/api';
import {
  fetchCalendarStatus,
  fetchMailMessage,
  searchMail,
  startCalendarOAuth,
  type MailAttachmentMeta,
  type MailMessageDetail,
  type MailMessageSummary,
} from '../lib/calendarApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/**
 * Graph $search strings for registered-agent / URA notices.
 * Mail must be visible in the signed-in user's mailbox (shared mailbox
 * Full Access / Open shared, or Forwarding into their inbox).
 */
export const RA_NOTICE_SEARCH_QUERIES = [
  'registered-agent@tagevc.com',
  'legal-notices@tagevc.com',
  'universalregisteredagents.com',
  '"Universal Registered Agents"',
] as const;

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function fromLabel(m: MailMessageSummary): string {
  return m.from.name?.trim() || m.from.email?.trim() || 'Unknown';
}

function mergeOpenedIntoThread(
  thread: MailMessageDetail[],
  opened: MailMessageDetail,
): MailMessageDetail[] {
  const base = thread.length ? thread : [opened];
  const withOpen = base.map((m) => (m.id === opened.id ? opened : m));
  if (withOpen.some((m) => m.id === opened.id)) return withOpen;
  return [...withOpen, opened].sort((a, b) => {
    const ta = a.received_at ? Date.parse(a.received_at) : 0;
    const tb = b.received_at ? Date.parse(b.received_at) : 0;
    return ta - tb;
  });
}

/**
 * Phase 1: Registered agent / URA notices from Outlook (search + review).
 * Does not auto-create rows — user creates a Legal To Do after reading.
 */
export function LegalRaNoticesPage({ salesUser }: Props) {
  const [connected, setConnected] = useState(false);
  const [canMail, setCanMail] = useState(false);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [thread, setThread] = useState<MailMessageDetail[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [taskBusy, setTaskBusy] = useState(false);
  const [viewerAttachment, setViewerAttachment] = useState<{
    messageId: string;
    attachment: MailAttachmentMeta;
  } | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const status = await fetchCalendarStatus();
      const mailOk = Boolean(status.connected && status.capabilities?.mail);
      setConnected(Boolean(status.connected));
      setCanMail(mailOk);
      if (!mailOk) {
        setMessages([]);
        return;
      }

      const results = await Promise.all(
        RA_NOTICE_SEARCH_QUERIES.map((q) =>
          searchMail(q, { top: 20 }).catch(() => ({ messages: [] as MailMessageSummary[] })),
        ),
      );
      const byId = new Map<string, MailMessageSummary>();
      for (const res of results) {
        for (const m of res.messages) {
          const key = m.conversation_id || m.id;
          const existing = byId.get(key);
          if (!existing) {
            byId.set(key, m);
            continue;
          }
          const tNew = m.received_at ? Date.parse(m.received_at) : 0;
          const tOld = existing.received_at ? Date.parse(existing.received_at) : 0;
          if (tNew >= tOld) byId.set(key, m);
        }
      }
      const merged = [...byId.values()].sort((a, b) => {
        const ta = a.received_at ? Date.parse(a.received_at) : 0;
        const tb = b.received_at ? Date.parse(b.received_at) : 0;
        return tb - ta;
      });
      setMessages(merged);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to search Outlook mail';
      if (/not connected|reconnect|Unauthorized|needs_reconnect/i.test(message)) {
        setConnected(false);
        setCanMail(false);
        setError(null);
      } else {
        setError(message);
      }
      setMessages([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth(
        `${window.location.pathname}${window.location.search || ''}`,
      );
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  async function openThread(id: string) {
    setActiveId(id);
    setThreadLoading(true);
    setError(null);
    try {
      const res = await fetchMailMessage(id);
      setThread(mergeOpenedIntoThread(res.thread, res.message));
      setActiveId(res.message.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to open thread';
      if (/not connected|reconnect|Unauthorized|needs_reconnect/i.test(message)) {
        setCanMail(false);
        setError('Connect Microsoft (with Mail permission) to read Outlook threads.');
      } else {
        setError(message);
      }
      setThread([]);
    } finally {
      setThreadLoading(false);
    }
  }

  async function createFollowThroughTask(msg: MailMessageDetail | MailMessageSummary) {
    setTaskBusy(true);
    setNotice(null);
    setError(null);
    try {
      const from = fromLabel(msg);
      const when = formatWhen(msg.received_at);
      const notes = [
        'Registered agent / URA notice — review and file evidence if needed.',
        `From: ${from}${msg.from.email ? ` <${msg.from.email}>` : ''}`,
        when ? `Received: ${when}` : '',
        msg.web_link ? `Outlook: ${msg.web_link}` : '',
        msg.preview ? `Preview: ${msg.preview}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      await createTask({
        sales_user_id: salesUser.id,
        title: `RA notice: ${msg.subject?.trim() || '(no subject)'}`,
        notes,
        due_at: null,
        portal_slug: 'legal',
        importance: 'high',
        sync_ms_todo: true,
      });
      setNotice('Created Legal To Do (Tage · Legal). Open Tasks or Portal To Do to follow through.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create Legal task');
    } finally {
      setTaskBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Registered agent mail</h1>
          <p className="muted">
            Notices from Universal Registered Agents (and mail to{' '}
            <code>registered-agent@</code> / <code>legal-notices@</code>) in the Outlook
            mailbox you can access. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <button type="button" className="btn ghost" onClick={() => void loadList()} disabled={loading}>
            Refresh
          </button>
          <Link to="/sales/legal/tasks" className="btn ghost">
            Legal tasks
          </Link>
          <Link to="/sales/legal" className="btn ghost">
            Overview
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>How this works</h2>
        </div>
        <p className="muted small">
          Phase 1 pulls from the signed-in user’s Graph mailbox (shared mailbox Full Access,
          or forwarding into inbox). Create an M365 address, give it to URA as the notice
          email, and ensure Legal users can open that mailbox. Automatic task creation on
          every new message is Phase 2 (webhook / app-only).
        </p>
      </section>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner notice">{notice}</div> : null}

      {!loading && !canMail ? (
        <div className="empty portal-tasks-softfail">
          <p className="muted">
            {connected
              ? 'Mail permission needed — Reconnect Microsoft after Mail.ReadWrite is granted.'
              : 'Connect Microsoft to search Outlook for registered-agent notices.'}{' '}
            <Link to="/sales/mail">Open Email</Link>
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => void onConnect()}
            disabled={connecting}
          >
            {connecting ? 'Redirecting…' : connected ? 'Reconnect Microsoft' : 'Connect Microsoft'}
          </button>
        </div>
      ) : null}

      {loading ? <p className="muted">Searching Outlook for RA notices…</p> : null}

      {!loading && canMail && !activeId ? (
        <section className="panel">
          <div className="panel-head">
            <h2>Matching messages ({messages.length})</h2>
          </div>
          {messages.length === 0 ? (
            <p className="muted">
              No matches yet. Confirm the M365 mailbox exists, URA has the address, and this
              user can see that mail (shared access or forwarding). Searches:{' '}
              {RA_NOTICE_SEARCH_QUERIES.join(' · ')}.
            </p>
          ) : (
            <ul className="deal-mail-list">
              {messages.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className="deal-mail-item"
                    onClick={() => void openThread(m.id)}
                  >
                    <div className="deal-mail-item-top">
                      <span className={!m.is_read ? 'unread' : undefined}>{fromLabel(m)}</span>
                      <span className="muted small">{formatWhen(m.received_at)}</span>
                    </div>
                    <div className="deal-mail-subject">{m.subject || '(no subject)'}</div>
                    <div className="muted small deal-mail-preview">{m.preview}</div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {activeId ? (
        <section className="panel deal-mail-thread">
          <div className="deal-mail-thread-bar">
            <button
              type="button"
              className="btn ghost small"
              onClick={() => {
                setActiveId(null);
                setThread([]);
              }}
            >
              ← Back to list
            </button>
            <Link
              className="btn ghost small"
              to={`/sales/mail?msg=${encodeURIComponent(activeId)}`}
            >
              Open in Email
            </Link>
            {thread[0] || messages.find((m) => m.id === activeId) ? (
              <button
                type="button"
                className="btn primary small"
                disabled={taskBusy}
                onClick={() => {
                  const open =
                    thread.find((t) => t.id === activeId) ??
                    messages.find((m) => m.id === activeId);
                  if (open) void createFollowThroughTask(open);
                }}
              >
                {taskBusy ? 'Creating…' : 'Create Legal To Do'}
              </button>
            ) : null}
          </div>
          {threadLoading ? (
            <p className="muted">Loading thread…</p>
          ) : thread.length === 0 ? (
            <p className="muted small">Could not load this thread.</p>
          ) : (
            <div className="mail-reading-scroll">
              <MailThreadView
                thread={thread}
                activeId={activeId}
                onSelect={(id) => setActiveId(id)}
                renderExtras={(msg) => {
                  const files = msg.attachments.filter((a) => !a.is_inline);
                  if (!files.length) return null;
                  return (
                    <div className="mail-attachments">
                      <span className="muted small">Attachments</span>
                      <ul>
                        {files.map((a) => (
                          <li key={a.id} className="mail-att-row">
                            <button
                              type="button"
                              className="btn small primary"
                              onClick={() =>
                                setViewerAttachment({ messageId: msg.id, attachment: a })
                              }
                            >
                              Open {a.name}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                }}
              />
            </div>
          )}
        </section>
      ) : null}

      {viewerAttachment ? (
        <MailAttachmentPreviewModal
          messageId={viewerAttachment.messageId}
          attachment={viewerAttachment.attachment}
          onClose={() => setViewerAttachment(null)}
          onNotice={(message) => setNotice(message)}
          onError={(message) => setError(message)}
        />
      ) : null}
    </>
  );
}
