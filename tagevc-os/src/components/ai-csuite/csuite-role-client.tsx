'use client';

import { useState, useTransition } from 'react';
import {
  proposeCsuiteActionAction,
  sendCsuiteMessageAction,
} from '@/app/(app)/c-suite/actions';
import { CsuiteAnalysisCard } from '@/components/ai-csuite/csuite-analysis-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { CsuiteBriefing } from '@/lib/ai-csuite/briefing';
import type { CsuiteMessageDto } from '@/lib/ai-csuite/service';
import type { AiCsuiteNavRole } from '@/lib/ai-csuite/roles';
import type { CsuiteContextPack } from '@/lib/ai-csuite/context';

type Props = {
  role: AiCsuiteNavRole;
  title: string;
  subtitle: string;
  initialMessages: CsuiteMessageDto[];
  context: CsuiteContextPack;
  briefing: CsuiteBriefing;
  contextError?: string;
};

export function CsuiteRoleClient({
  role,
  title,
  subtitle,
  initialMessages,
  context,
  briefing,
  contextError,
}: Props) {
  const [messages, setMessages] = useState(initialMessages);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send() {
    const content = text.trim();
    if (!content) return;
    const fd = new FormData();
    fd.set('role', role);
    fd.set('content', content);
    startTransition(async () => {
      setError(null);
      const res = await sendCsuiteMessageAction(fd);
      if (res && 'error' in res && res.error && !('messages' in res)) {
        setError(String(res.error));
        return;
      }
      if (res && 'messages' in res && res.messages) {
        setMessages(res.messages);
        setText('');
        if (res.error) setError(res.error);
      }
    });
  }

  function proposeTicket() {
    const fd = new FormData();
    fd.set('role', role);
    fd.set('action_type', 'ticket');
    fd.set('title', `${title} follow-up`);
    fd.set(
      'body',
      'Draft from C-Suite — human must confirm before any ticket create.',
    );
    startTransition(async () => {
      const res = await proposeCsuiteActionAction(fd);
      if (res && 'error' in res && res.error) setError(String(res.error));
      else setError(null);
    });
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <p className="text-xs font-medium tracking-[0.18em] text-muted-foreground uppercase">
          AI C-Suite · Visionary
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          {title}
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Badge variant="outline">Draft-only actions</Badge>
          <Badge variant="secondary">
            Gaps: {context.data_gaps.length || 0}
          </Badge>
          {contextError ? (
            <Badge variant="destructive">Context error</Badge>
          ) : null}
        </div>
      </header>

      <CsuiteAnalysisCard role={role} initial={briefing} />

      <section className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Open tickets (pack)</p>
          <p className="text-2xl font-semibold">{context.open_tickets.length}</p>
        </div>
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">KPIs (known)</p>
          <p className="text-2xl font-semibold">{context.kpis.length}</p>
        </div>
        <div className="rounded-md border border-border p-3 text-sm">
          <p className="text-xs text-muted-foreground">Anomalies</p>
          <p className="text-2xl font-semibold">{context.anomalies.length}</p>
        </div>
      </section>

      {context.data_gaps.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Partial data: {context.data_gaps.slice(0, 4).join(' · ')}
          {context.data_gaps.length > 4 ? '…' : ''}
        </p>
      ) : null}

      <section className="space-y-3 rounded-md border border-border p-4">
        <h2 className="text-sm font-semibold">Thread</h2>
        <div className="max-h-80 space-y-3 overflow-y-auto text-sm">
          {messages.length === 0 ? (
            <p className="text-muted-foreground">
              Ask for a status brief, risks, or draft follow-ups. No autonomous
              money or legal send.
            </p>
          ) : (
            messages.map((m) => (
              <div key={m.id} className="space-y-1">
                <p className="text-xs font-medium uppercase text-muted-foreground">
                  {m.role}
                  {m.model ? ` · ${m.model}` : ''}
                </p>
                <p className="whitespace-pre-wrap">{m.content}</p>
              </div>
            ))
          )}
        </div>
        <textarea
          className="min-h-[88px] w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          placeholder="Ask this executive…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={pending}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" disabled={pending} onClick={send}>
            Send
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={proposeTicket}
          >
            Propose ticket draft
          </Button>
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
      </section>
    </div>
  );
}
