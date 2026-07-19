import { useEffect, useRef, useState } from 'react';
import {
  getOrCreateThinkTankConversation,
  listThinkTankMessages,
  type ThinkTankMessage,
  type ThinkTankScope,
} from '../lib/portfolioEntityApi';
import { sendThinkTankMessage } from '../lib/thinkTankApi';

type Props = {
  userId: string;
  scope: ThinkTankScope;
  entityId?: string;
  /** Shown in header subtitle / intro */
  subtitle: string;
  intro: string;
  emptyHint: string;
  setupDocHint?: string;
};

/**
 * Shared Think Tank chat UI for personal (global) and entity-scoped journals.
 */
export function ThinkTankPanel({
  userId,
  scope,
  entityId,
  subtitle,
  intro,
  emptyHint,
  setupDocHint = 'Set XAI_API_KEY (and optional XAI_MODEL) as a Supabase Edge Function secret. See SETUP_THINK_TANK.md.',
}: Props) {
  const [messages, setMessages] = useState<ThinkTankMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const conv = await getOrCreateThinkTankConversation({
          userId,
          scope,
          entityId: scope === 'entity' ? entityId : undefined,
        });
        const rows = await listThinkTankMessages(conv.id);
        if (!mounted) return;
        setMessages(rows.filter((m) => m.role !== 'system'));
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load journal');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [userId, scope, entityId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  async function onSend() {
    const text = draft.trim();
    if (!text || sending) return;
    setSending(true);
    setError(null);
    setSetupHint(null);
    setDraft('');
    const optimistic: ThinkTankMessage = {
      id: `local-${Date.now()}`,
      conversation_id: '',
      role: 'user',
      content: text,
      model: null,
      created_at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);
    try {
      const result = await sendThinkTankMessage({
        scope,
        entityId: scope === 'entity' ? entityId : undefined,
        message: text,
      });
      setMessages((prev) => {
        const withoutOptimistic = prev.filter((m) => m.id !== optimistic.id);
        return [
          ...withoutOptimistic,
          result.userMessage,
          result.assistantMessage,
        ];
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Send failed';
      if (/XAI_API_KEY|not configured|503/i.test(msg)) {
        setSetupHint(setupDocHint);
      }
      setError(msg);
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setDraft(text);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel recruit619-section think-tank-panel">
      <div className="panel-head">
        <h2>Think Tank</h2>
        <span className="muted small">{subtitle}</span>
      </div>
      <p className="muted">{intro}</p>
      {setupHint ? <div className="banner warn">{setupHint}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {loading ? (
        <p className="muted">Loading journal…</p>
      ) : (
        <>
          <div className="think-tank-thread" role="log" aria-live="polite">
            {messages.length === 0 ? (
              <p className="muted">{emptyHint}</p>
            ) : (
              messages.map((m) => (
                <div
                  key={m.id}
                  className={`think-tank-msg think-tank-msg--${m.role}`}
                >
                  <div className="think-tank-msg-role">
                    {m.role === 'user' ? 'You' : 'Grok'}
                  </div>
                  <div className="think-tank-msg-body">{m.content}</div>
                </div>
              ))
            )}
            {sending ? (
              <div className="think-tank-msg think-tank-msg--assistant">
                <div className="think-tank-msg-role">Grok</div>
                <div className="think-tank-msg-body muted">Thinking…</div>
              </div>
            ) : null}
            <div ref={bottomRef} />
          </div>
          <div className="think-tank-composer">
            <textarea
              rows={3}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Write a journal note or ask for coaching…"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  void onSend();
                }
              }}
            />
            <button
              type="button"
              className="btn primary"
              disabled={sending || !draft.trim()}
              onClick={() => void onSend()}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <p className="muted small">⌘/Ctrl+Enter to send</p>
        </>
      )}
    </section>
  );
}
