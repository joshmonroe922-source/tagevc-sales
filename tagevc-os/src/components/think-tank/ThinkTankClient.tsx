'use client';

import { useEffect, useRef, useState, useTransition } from 'react';

import {
  loadThinkTank,
  resetThinkTankThread,
  sendThinkTankChat,
} from '@/app/(app)/think-tank/actions';
import { Button } from '@/components/ui/button';
import type { ThinkTankMessageDto } from '@/lib/think-tank/service';

const ROLE_LABEL: Record<string, string> = {
  leadership: 'Leadership advisor',
  operator: 'Operator advisor',
  deal: 'Deal-team advisor',
  admin: 'Admin advisor',
};

export function ThinkTankClient({
  initialMessages,
  roleBand,
  viewAsLabel,
  compact = false,
}: {
  initialMessages: ThinkTankMessageDto[];
  roleBand: string;
  viewAsLabel: string | null;
  compact?: boolean;
}) {
  const [messages, setMessages] = useState(initialMessages);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending]);

  function onSend() {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    setSetupHint(null);
    setDraft('');
    const optimistic: ThinkTankMessageDto = {
      id: `local-${Date.now()}`,
      conversationId: '',
      role: 'user',
      content: text,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    startTransition(async () => {
      const result = await sendThinkTankChat(text);
      if ('error' in result) {
        const msg = result.error;
        if (/ANTHROPIC|Claude|CLAUDE_/i.test(msg)) {
          setSetupHint(
            'Claude is gated: set ANTHROPIC_API_KEY and ANTHROPIC_LIVE=1. Or choose Grok in Settings → AI.',
          );
        } else if (/XAI_API_KEY|GROK_API_KEY|not configured|Grok/i.test(msg)) {
          setSetupHint(
            'Set XAI_API_KEY (or GROK_API_KEY) in Vercel / .env.local. Optional XAI_MODEL. Preferred model: Settings → AI.',
          );
        }
        setError(msg);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        return;
      }
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimistic.id);
        return [...without, result.userMessage, result.assistantMessage];
      });
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-heading text-lg text-foreground">
            {compact ? 'Think Tank' : 'Think Tank'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {compact
              ? 'Ask how to hit today’s goals and clear hot items'
              : `${ROLE_LABEL[roleBand] ?? 'Personal advisor'} · preferred AI · persistent thread`}
            {viewAsLabel ? ` · view-as: ${viewAsLabel}` : ''}
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              startTransition(async () => {
                const data = await loadThinkTank();
                setMessages(data.messages);
                setError(null);
              });
            }}
          >
            Refresh
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              if (!confirm('Start a new Think Tank thread? Current history clears.')) {
                return;
              }
              startTransition(async () => {
                await resetThinkTankThread();
                setMessages([]);
              });
            }}
          >
            New thread
          </Button>
        </div>
      </div>

      <div className="space-y-3 px-5 py-4">
        <p className="text-sm text-muted-foreground">
          Your personal operating advisor for Tage VC. Advice uses live firm
          context (funnel, tickets, portfolio). You remain the decision-maker —
          Think Tank does not execute privileged actions.
        </p>

        {setupHint ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
            {setupHint}
          </div>
        ) : null}
        {error ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            {error}
          </div>
        ) : null}

        <div
          className="max-h-[min(32rem,55vh)] space-y-3 overflow-y-auto rounded-md bg-muted/40 p-3"
          role="log"
          aria-live="polite"
        >
          {messages.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Ask what to win today: deal actions, Shared Services backlog,
                portfolio risks, or approvals due.
              </p>
              <div className="flex flex-wrap gap-2">
                {[
                  'What should I win today?',
                  'Where am I behind on goals this week?',
                  'Prioritize my open service and deal queues.',
                ].map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    className="rounded-md border border-border bg-background px-2.5 py-1.5 text-left text-xs hover:bg-muted"
                    onClick={() => setDraft(prompt)}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m) => (
              <div
                key={m.id}
                className={`rounded-md px-3 py-2 text-sm ${
                  m.role === 'user'
                    ? 'ml-6 bg-[#3b4559] text-[#f8f6f2]'
                    : 'mr-6 border border-border bg-background text-foreground'
                }`}
              >
                <div
                  className={`mb-1 text-[11px] font-semibold tracking-wide uppercase ${
                    m.role === 'user' ? 'text-[#b2a384]' : 'text-muted-foreground'
                  }`}
                >
                  {m.role === 'user' ? 'You' : 'Assistant'}
                </div>
                <div className="whitespace-pre-wrap">{m.content}</div>
              </div>
            ))
          )}
          {pending ? (
            <div className="mr-6 rounded-md border border-border bg-background px-3 py-2 text-sm text-muted-foreground">
              Thinking…
            </div>
          ) : null}
          <div ref={bottomRef} />
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            rows={3}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ask for coaching or log what you are working…"
            className="min-h-[5rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey) return;
              e.preventDefault();
              onSend();
            }}
          />
          <Button
            type="button"
            disabled={pending || !draft.trim()}
            onClick={onSend}
            className="bg-[#3b4559] text-[#f8f6f2]"
          >
            {pending ? 'Sending…' : 'Send'}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Enter to send · Shift+Enter for a new line
        </p>
      </div>
    </section>
  );
}
