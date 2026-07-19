import type { ReactNode } from 'react';
import type { MailMessageDetail } from '../lib/calendarApi';

type Recipient = { name: string | null; email: string | null };

function formatMsgTime(iso: string | null): string {
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

function recipientLabel(r: Recipient): string {
  return r.name?.trim() || r.email?.trim() || 'Unknown';
}

type Props = {
  thread: MailMessageDetail[];
  /** Message that reply / toolbar actions apply to */
  activeId: string | null;
  onSelect?: (id: string) => void;
  /** Optional extra chrome under a message’s headers (attachments, etc.) */
  renderExtras?: (msg: MailMessageDetail) => ReactNode;
};

/**
 * Stacked conversation view — oldest → newest — with clear separation per message.
 */
export function MailThreadView({ thread, activeId, onSelect, renderExtras }: Props) {
  if (!thread.length) return null;

  return (
    <div className="mail-thread-stack" role="list" aria-label="Conversation thread">
      {thread.length > 1 ? (
        <p className="muted small mail-thread-count">
          Thread · {thread.length} messages (oldest → newest)
        </p>
      ) : null}
      {thread.map((msg) => {
        const active = msg.id === activeId;
        return (
          <article
            key={msg.id}
            role="listitem"
            className={`mail-thread-msg${active ? ' active' : ''}${!msg.is_read ? ' unread' : ''}`}
            id={`mail-thread-msg-${msg.id}`}
          >
            <button
              type="button"
              className="mail-thread-msg-head"
              onClick={() => onSelect?.(msg.id)}
              aria-current={active ? 'true' : undefined}
            >
              <div className="mail-thread-msg-from">
                <strong>{recipientLabel(msg.from)}</strong>
                {msg.from.email ? (
                  <span className="muted small"> &lt;{msg.from.email}&gt;</span>
                ) : null}
              </div>
              <div className="muted small mail-thread-msg-when">
                {formatMsgTime(msg.received_at)}
              </div>
            </button>
            <div className="mail-headers mail-thread-msg-headers">
              <div>
                <span className="muted">To</span> {msg.to.map(recipientLabel).join(', ') || '—'}
              </div>
              {msg.cc.length ? (
                <div>
                  <span className="muted">Cc</span> {msg.cc.map(recipientLabel).join(', ')}
                </div>
              ) : null}
            </div>
            {renderExtras?.(msg) ?? null}
            <div className="mail-body mail-thread-msg-body">
              {msg.body_html ? (
                <div
                  className="mail-body-html"
                  dangerouslySetInnerHTML={{ __html: msg.body_html }}
                />
              ) : (
                <pre className="mail-body-text">
                  {(msg.body_text && msg.body_text.trim()) || msg.preview || '(No body)'}
                </pre>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
