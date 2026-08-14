'use client';

/**
 * Portable Think Tank desk — thread list + named switch + document upload.
 * Copy into each OS and wrap with portal server actions.
 *
 * Home pages should mount this without SSR messages so TTFB stays off AI/DB scans.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import { Check, Paperclip, Pencil, Plus, RefreshCw, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { thinkTankLastThreadKey } from '@/lib/platform/think-tank/scope';
import {
  THINK_TANK_FILE_ACCEPT,
  type ThinkTankAttachmentDto,
  type ThinkTankDeskState,
  type ThinkTankMessageDto,
  type ThinkTankSendResult,
  type ThinkTankThreadDto,
} from '@/lib/platform/think-tank/types';
import { cn } from '@/lib/utils';

export type ThinkTankDeskCopy = {
  title?: string;
  subtitle: string;
  intro: string;
  emptyHint: string;
  chips: string[];
  advisorLabel: string;
};

export type ThinkTankDeskActions = {
  loadDesk: (conversationId?: string | null) => Promise<ThinkTankDeskState>;
  sendChat: (
    conversationId: string | null,
    message: string,
  ) => Promise<ThinkTankSendResult>;
  createThread: (title?: string) => Promise<
    | { thread: ThinkTankThreadDto }
    | { error: string }
  >;
  renameThread: (
    conversationId: string,
    title: string,
  ) => Promise<{ thread: ThinkTankThreadDto } | { error: string }>;
  uploadAttachment: (formData: FormData) => Promise<
    | { conversationId: string; attachment: ThinkTankAttachmentDto }
    | { error: string }
  >;
  removeAttachment: (
    attachmentId: string,
  ) => Promise<{ ok: true } | { error: string }>;
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function ThinkTankDesk({
  copy,
  compact = false,
  portalKey,
  actions,
}: {
  copy: ThinkTankDeskCopy;
  compact?: boolean;
  portalKey: string;
  actions: ThinkTankDeskActions;
}) {
  const [threads, setThreads] = useState<ThinkTankThreadDto[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThinkTankMessageDto[]>([]);
  const [attachments, setAttachments] = useState<ThinkTankAttachmentDto[]>([]);
  const [entityOs, setEntityOs] = useState('ENT-FIRM');
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [setupHint, setSetupHint] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [pending, startTransition] = useTransition();
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, pending, attachments.length]);

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      try {
        const unscoped =
          typeof window !== 'undefined'
            ? localStorage.getItem(`think-tank:last:${portalKey}`)
            : null;
        let data = await actions.loadDesk(unscoped);
        if (cancelled) return;
        const scoped =
          typeof window !== 'undefined'
            ? localStorage.getItem(
                thinkTankLastThreadKey({
                  portalKey,
                  entityOs: data.entityOs,
                }),
              )
            : null;
        if (scoped && scoped !== data.conversationId) {
          data = await actions.loadDesk(scoped);
          if (cancelled) return;
        }
        applyDesk(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not load Think Tank.');
          setLoaded(true);
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // Mount-only: portal actions are stable server actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyDesk(data: ThinkTankDeskState) {
    setThreads(data.threads);
    setActiveId(data.conversationId);
    setMessages(data.messages);
    setAttachments(data.attachments);
    setEntityOs(data.entityOs);
    setLoaded(true);
    if (typeof window !== 'undefined' && data.conversationId) {
      rememberThread(data.conversationId, data.entityOs);
    }
  }

  function rememberThread(id: string, os = entityOs) {
    if (typeof window === 'undefined') return;
    localStorage.setItem(`think-tank:last:${portalKey}`, id);
    localStorage.setItem(thinkTankLastThreadKey({ portalKey, entityOs: os }), id);
  }

  function noteSetupError(msg: string) {
    if (/ANTHROPIC|Claude|CLAUDE_/i.test(msg)) {
      setSetupHint(
        'Claude is gated: set ANTHROPIC_API_KEY and ANTHROPIC_LIVE=1. Or choose Grok in Settings → AI.',
      );
    } else if (/XAI_API_KEY|GROK_API_KEY|not configured|Grok/i.test(msg)) {
      setSetupHint(
        'Set XAI_API_KEY (or GROK_API_KEY) in Vercel / .env.local. Optional XAI_MODEL. Preferred model: Settings → AI.',
      );
    }
  }

  function onSelectThread(id: string) {
    if (id === activeId || pending) return;
    setError(null);
    rememberThread(id);
    startTransition(async () => {
      const data = await actions.loadDesk(id);
      applyDesk(data);
    });
  }

  function onNewThread() {
    setError(null);
    startTransition(async () => {
      const result = await actions.createThread();
      if ('error' in result) {
        setError(result.error);
        return;
      }
      rememberThread(result.thread.id);
      setThreads((prev) => [
        result.thread,
        ...prev.filter((t) => t.id !== result.thread.id),
      ]);
      setActiveId(result.thread.id);
      setMessages([]);
      setAttachments([]);
    });
  }

  function onRefresh() {
    startTransition(async () => {
      const data = await actions.loadDesk(activeId);
      applyDesk(data);
      setError(null);
    });
  }

  async function commitRename(id: string) {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title) return;
    startTransition(async () => {
      const result = await actions.renameThread(id, title);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setThreads((prev) =>
        prev.map((t) => (t.id === id ? result.thread : t)),
      );
    });
  }

  function onSend() {
    const text = draft.trim();
    if (!text || pending) return;
    setError(null);
    setSetupHint(null);
    setDraft('');
    const optimistic: ThinkTankMessageDto = {
      id: `local-${Date.now()}`,
      conversationId: activeId ?? '',
      role: 'user',
      content: text,
      model: null,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, optimistic]);

    startTransition(async () => {
      const result = await actions.sendChat(activeId, text);
      if ('error' in result) {
        noteSetupError(result.error);
        setError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        return;
      }
      rememberThread(result.conversationId);
      setActiveId(result.conversationId);
      setThreads((prev) => {
        const without = prev.filter((t) => t.id !== result.thread.id);
        return [result.thread, ...without];
      });
      setMessages((prev) => {
        const without = prev.filter((m) => m.id !== optimistic.id);
        return [...without, result.userMessage, result.assistantMessage];
      });
    });
  }

  function onPickFile(file: File | undefined) {
    if (!file || pending) return;
    setError(null);
    const fd = new FormData();
    if (activeId) fd.set('conversationId', activeId);
    fd.set('file', file);
    startTransition(async () => {
      const result = await actions.uploadAttachment(fd);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      rememberThread(result.conversationId);
      setActiveId(result.conversationId);
      setAttachments((prev) => {
        const without = prev.filter((a) => a.id !== result.attachment.id);
        return [...without, result.attachment];
      });
      const data = await actions.loadDesk(result.conversationId);
      applyDesk(data);
    });
    if (fileRef.current) fileRef.current.value = '';
  }

  function onRemoveAttachment(id: string) {
    startTransition(async () => {
      const result = await actions.removeAttachment(id);
      if ('error' in result) {
        setError(result.error);
        return;
      }
      setAttachments((prev) => prev.filter((a) => a.id !== id));
    });
  }

  const activeThread = threads.find((t) => t.id === activeId) ?? null;

  return (
    <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
        <div>
          <h2 className="font-heading text-lg text-foreground">
            {copy.title ?? 'Think Tank'}
          </h2>
          <p className="text-sm text-muted-foreground">
            {compact ? copy.subtitle : `${copy.advisorLabel} · preferred AI · named threads`}
          </p>
        </div>
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onRefresh}>
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={onNewThread}>
            <Plus className="size-3.5" />
            New thread
          </Button>
        </div>
      </div>

      <div className={cn('grid', compact ? 'lg:grid-cols-[14rem_minmax(0,1fr)]' : 'lg:grid-cols-[16rem_minmax(0,1fr)]')}>
        <aside className="border-b border-border lg:border-r lg:border-b-0">
          <div className="flex items-center justify-between gap-2 px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Threads
            </p>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {threads.length}
            </span>
          </div>
          <div className="max-h-48 space-y-1 overflow-y-auto px-2 pb-3 lg:max-h-[min(28rem,50vh)]">
            {!loaded ? (
              <div className="space-y-2 px-2 py-1">
                <div className="h-8 animate-pulse rounded bg-muted" />
                <div className="h-8 animate-pulse rounded bg-muted" />
              </div>
            ) : threads.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground">
                No threads yet. Send a message or upload a doc to start one — history
                survives refresh.
              </p>
            ) : (
              threads.map((thread) => {
                const active = thread.id === activeId;
                const editing = renamingId === thread.id;
                return (
                  <div
                    key={thread.id}
                    className={cn(
                      'group flex items-start gap-1 rounded-md px-1 py-0.5',
                      active ? 'bg-muted' : 'hover:bg-muted/60',
                    )}
                  >
                    {editing ? (
                      <form
                        className="flex min-w-0 flex-1 items-center gap-1 px-1 py-1"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void commitRename(thread.id);
                        }}
                      >
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(e) => setRenameDraft(e.target.value)}
                          className="min-w-0 flex-1 rounded border border-input bg-background px-1.5 py-0.5 text-xs"
                          onKeyDown={(e) => {
                            if (e.key === 'Escape') setRenamingId(null);
                          }}
                        />
                        <button
                          type="submit"
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Save name"
                        >
                          <Check className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                          aria-label="Cancel rename"
                          onClick={() => setRenamingId(null)}
                        >
                          <X className="size-3.5" />
                        </button>
                      </form>
                    ) : (
                      <>
                        <button
                          type="button"
                          className="min-w-0 flex-1 rounded px-2 py-1.5 text-left"
                          onClick={() => onSelectThread(thread.id)}
                        >
                          <span className="block truncate text-sm font-medium text-foreground">
                            {thread.title}
                          </span>
                          <span className="block text-[11px] text-muted-foreground">
                            {relativeTime(thread.updatedAt)}
                          </span>
                        </button>
                        <button
                          type="button"
                          className="mt-1 rounded p-1 text-muted-foreground opacity-70 hover:text-foreground lg:opacity-0 lg:group-hover:opacity-100"
                          aria-label={`Rename ${thread.title}`}
                          onClick={() => {
                            setRenamingId(thread.id);
                            setRenameDraft(thread.title);
                          }}
                        >
                          <Pencil className="size-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <div className="space-y-3 px-5 py-4">
          <p className="text-sm text-muted-foreground">{copy.intro}</p>

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

          {attachments.length > 0 ? (
            <ul className="flex flex-wrap gap-2">
              {attachments.map((file) => (
                <li
                  key={file.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-1 text-xs"
                >
                  {file.signedUrl ? (
                    <a
                      href={file.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="min-w-0 truncate underline-offset-2 hover:underline"
                    >
                      {file.fileName}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate">{file.fileName}</span>
                  )}
                  {file.extractError ? (
                    <span className="text-amber-800" title={file.extractError}>
                      (unread)
                    </span>
                  ) : null}
                  <button
                    type="button"
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    aria-label={`Remove ${file.fileName}`}
                    onClick={() => onRemoveAttachment(file.id)}
                  >
                    <X className="size-3" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <div
            className="max-h-[min(32rem,55vh)] space-y-3 overflow-y-auto rounded-md bg-muted/40 p-3"
            role="log"
            aria-live="polite"
          >
            {!loaded ? (
              <div className="space-y-2" aria-busy="true" aria-label="Loading Think Tank">
                <div className="h-3 w-10/12 animate-pulse rounded bg-muted" />
                <div className="h-3 w-8/12 animate-pulse rounded bg-muted" />
              </div>
            ) : messages.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">{copy.emptyHint}</p>
                <div className="flex flex-wrap gap-2">
                  {copy.chips.map((prompt) => (
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
              placeholder={
                activeThread
                  ? `Continue “${activeThread.title}”…`
                  : 'Ask for coaching or start a new named thread…'
              }
              className="min-h-[5rem] flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return;
                e.preventDefault();
                onSend();
              }}
            />
            <div className="flex gap-2">
              <input
                ref={fileRef}
                type="file"
                className="sr-only"
                accept={THINK_TANK_FILE_ACCEPT}
                onChange={(e) => onPickFile(e.target.files?.[0])}
              />
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => fileRef.current?.click()}
                aria-label="Attach document to this thread"
              >
                <Paperclip className="size-4" />
                Attach
              </Button>
              <Button
                type="button"
                disabled={pending || !draft.trim()}
                onClick={onSend}
                className="bg-[#3b4559] text-[#f8f6f2]"
              >
                {pending ? 'Sending…' : 'Send'}
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter to send · Shift+Enter for a new line · Word and Excel stay on this thread only
          </p>
        </div>
      </div>
    </section>
  );
}
