import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MailAttachmentPreviewModal } from './MailAttachmentPreviewModal';
import { MailThreadView } from './MailThreadView';
import {
  fetchCalendarStatus,
  fetchMailMessage,
  saveMailAttachmentToVault,
  searchMail,
  startCalendarOAuth,
  type MailAttachmentMeta,
  type MailMessageDetail,
  type MailMessageSummary,
} from '../lib/calendarApi';

type Props = {
  leadEmail: string;
};

function formatWhen(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Prefer API thread; always include the opened message body. */
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
 * Outlook mailbox messages related to a deal contact — opens full conversation threads.
 */
export function DealMailPanel({ leadEmail }: Props) {
  const email = leadEmail.trim().toLowerCase();
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
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [viewerAttachment, setViewerAttachment] = useState<{
    messageId: string;
    attachment: MailAttachmentMeta;
  } | null>(null);

  const loadList = useCallback(async () => {
    if (!email) {
      setMessages([]);
      setLoading(false);
      return;
    }
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
      const res = await searchMail(email, { top: 30 });
      // Prefer one row per conversation (latest first from search); keep chronological open later.
      const seen = new Set<string>();
      const deduped: MailMessageSummary[] = [];
      for (const m of res.messages) {
        const key = m.conversation_id || m.id;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(m);
      }
      setMessages(deduped);
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
  }, [email]);

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

  async function onSaveAttachment(
    messageId: string,
    attId: string,
    destination: 'downloads' | 'company_resumes',
  ) {
    setAttachmentBusy(true);
    setError(null);
    try {
      const res = await saveMailAttachmentToVault(messageId, attId, destination);
      setNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save attachment to vault');
    } finally {
      setAttachmentBusy(false);
    }
  }

  if (!email) {
    return (
      <p className="muted small">
        Add a contact email on this deal to find matching Outlook conversations.
      </p>
    );
  }

  if (!loading && !canMail) {
    return (
      <div className="empty portal-tasks-softfail">
        <p className="muted small">
          {connected
            ? 'Mail permission needed — Reconnect Microsoft after Mail.ReadWrite is granted.'
            : 'Connect Microsoft to show Outlook threads for this contact.'}{' '}
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
    );
  }

  return (
    <div className="deal-mail-panel">
      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner notice">{notice}</div> : null}
      {loading ? <p className="muted small">Searching Outlook…</p> : null}
      {!loading && messages.length === 0 ? (
        <p className="muted small">No Outlook messages found for {email}.</p>
      ) : null}
      {!loading && messages.length > 0 && !activeId ? (
        <ul className="deal-mail-list">
          {messages.map((m) => (
            <li key={m.id}>
              <button type="button" className="deal-mail-item" onClick={() => void openThread(m.id)}>
                <div className="deal-mail-item-top">
                  <span className={!m.is_read ? 'unread' : undefined}>{fromLabel(m)}</span>
                  <span className="muted small">{formatWhen(m.received_at)}</span>
                </div>
                <div className="deal-mail-subject">{m.subject}</div>
                <div className="muted small deal-mail-preview">{m.preview}</div>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {activeId ? (
        <div className="deal-mail-thread">
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
            <Link className="btn ghost small" to={`/sales/mail?msg=${encodeURIComponent(activeId)}`}>
              Open in Email
            </Link>
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
                      <span className="muted small">
                        Attachments — Open to preview in the portal
                      </span>
                      <ul>
                        {files.map((a) => {
                          const resumeHint = /\b(resume|curriculum|cv)\b/i.test(
                            a.name.replace(/[_\-.]/g, ' '),
                          );
                          return (
                            <li key={a.id} className="mail-att-row">
                              <button
                                type="button"
                                className="btn small primary"
                                disabled={attachmentBusy}
                                onClick={() =>
                                  setViewerAttachment({ messageId: msg.id, attachment: a })
                                }
                              >
                                Open {a.name}
                                {a.size != null ? ` · ${formatFileSize(a.size)}` : ''}
                              </button>
                              <button
                                type="button"
                                className="btn small ghost"
                                disabled={attachmentBusy}
                                onClick={() => void onSaveAttachment(msg.id, a.id, 'downloads')}
                              >
                                Save to Downloads
                              </button>
                              <button
                                type="button"
                                className={`btn small ${resumeHint ? 'primary' : 'ghost'}`}
                                disabled={attachmentBusy}
                                onClick={() =>
                                  void onSaveAttachment(msg.id, a.id, 'company_resumes')
                                }
                              >
                                {resumeHint ? 'Save to company Resumes' : 'Company Resumes'}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                }}
              />
            </div>
          )}
        </div>
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
    </div>
  );
}
