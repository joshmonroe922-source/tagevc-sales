'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { MessageSquarePlus, Search, Send, Users } from 'lucide-react';
import {
  getMessagingBootstrapAction,
  loadMessagesAction,
  markConversationReadAction,
  sendMessageAction,
  startDirectMessageAction,
  startGroupChatAction,
} from '@/app/(app)/messages/actions';
import { createClient } from '@/lib/supabase/client';
import type {
  ConversationListItem,
  MessageRow,
} from '@/lib/messaging/types';
import { displayName } from '@/lib/messaging/repo-client';
import { Avatar, AvatarFallback, AvatarImage, AvatarBadge } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

type Bootstrap = Extract<
  Awaited<ReturnType<typeof getMessagingBootstrapAction>>,
  { ok: true }
>;

type Props = {
  initial: Bootstrap;
};

function initials(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

function formatTime(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

export function MessagesShell({ initial }: Props) {
  const [conversations, setConversations] = useState(initial.conversations);
  const [directory] = useState(initial.directory);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [messages, setMessages] = useState<MessageRow[]>(initial.messages);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(initial.messagesError);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [composerPending, startComposer] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<'dm' | 'group'>('dm');
  const [groupTitle, setGroupTitle] = useState('');
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const me = initial.me;

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const refreshList = useCallback(async (keepId?: string | null) => {
    const boot = await getMessagingBootstrapAction(keepId ?? selectedId);
    if (!boot.ok) {
      setError(boot.error);
      return;
    }
    setConversations(boot.conversations);
    if (boot.selectedId) {
      setSelectedId(boot.selectedId);
      setMessages(boot.messages);
    }
  }, [selectedId]);

  const selectConversation = useCallback(
    async (id: string) => {
      setSelectedId(id);
      setError(null);
      const result = await loadMessagesAction(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setMessages(result.messages);
      await markConversationReadAction(id);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)),
      );
    },
    [],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedId]);

  // Realtime: messages + conversation list updates
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel('os-messaging')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'os_messages' },
        async (payload) => {
          const row = payload.new as MessageRow;
          if (row.conversation_id === selectedId) {
            setMessages((prev) => {
              if (prev.some((m) => m.id === row.id)) return prev;
              const sender =
                directory.find((p) => p.id === row.sender_id) ??
                (row.sender_id === me.id ? me : null);
              return [...prev, { ...row, sender }];
            });
            if (row.sender_id !== me.id) {
              void markConversationReadAction(row.conversation_id);
            }
          }
          await refreshList(selectedId);
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'os_conversations' },
        () => {
          void refreshList(selectedId);
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedId, directory, me, refreshList]);

  // Presence
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel('os-presence', {
      config: { presence: { key: me.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState() as Record<
          string,
          Array<{ user_id?: string }>
        >;
        const next = new Set<string>();
        for (const [key, metas] of Object.entries(state)) {
          next.add(key);
          for (const meta of metas) {
            if (meta.user_id) next.add(meta.user_id);
          }
        }
        setOnlineIds(next);
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await channel.track({
            user_id: me.id,
            online_at: new Date().toISOString(),
          });
        }
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [me.id]);

  function send() {
    if (!selectedId || !draft.trim() || composerPending) return;
    const text = draft.trim();
    setDraft('');
    const optimistic: MessageRow = {
      id: `tmp-${Date.now()}`,
      conversation_id: selectedId,
      sender_id: me.id,
      body: text,
      parent_id: null,
      metadata: {},
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      sender: me,
    };
    setMessages((prev) => [...prev, optimistic]);

    startComposer(async () => {
      const result = await sendMessageAction(selectedId, text);
      if (!result.ok) {
        setError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? {
                ...(result.message as MessageRow),
                sender: me,
              }
            : m,
        ),
      );
      await refreshList(selectedId);
    });
  }

  async function createDm(userId: string) {
    const result = await startDirectMessageAction(userId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewOpen(false);
    setPicked([]);
    await refreshList(result.conversationId);
    await selectConversation(result.conversationId);
  }

  async function createGroup() {
    if (!groupTitle.trim() || picked.length === 0) return;
    const result = await startGroupChatAction(groupTitle.trim(), picked);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewOpen(false);
    setGroupTitle('');
    setPicked([]);
    await refreshList(result.conversationId);
    await selectConversation(result.conversationId);
  }

  const filteredDirectory = directory.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="-mx-6 -my-8 md:-mx-10 flex h-[calc(100dvh)] min-h-[28rem] border-t border-border bg-background">
      {/* Conversation list */}
      <aside className="flex w-full max-w-[20rem] shrink-0 flex-col border-r border-border bg-[#f7f5f2] md:max-w-xs">
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-[#3a414f]">
              Messages
            </h1>
            <p className="text-xs text-muted-foreground">Firm DMs & small groups</p>
          </div>
          <Button
            size="icon-sm"
            variant="outline"
            onClick={() => {
              setNewMode('dm');
              setNewOpen(true);
            }}
            aria-label="New message"
          >
            <MessageSquarePlus className="size-4" />
          </Button>
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No conversations yet. Start a direct message or group.
            </div>
          ) : (
            conversations.map((c) => (
              <ConversationRowButton
                key={c.id}
                conversation={c}
                active={c.id === selectedId}
                onlineIds={onlineIds}
                meId={me.id}
                onClick={() => void selectConversation(c.id)}
              />
            ))
          )}
        </div>
      </aside>

      {/* Thread */}
      <section className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex items-center gap-3 border-b border-border px-5 py-3">
              <ConversationAvatar
                conversation={selected}
                meId={me.id}
                onlineIds={onlineIds}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-[#3a414f]">
                  {selected.display_title}
                </p>
                <p className="truncate text-xs text-muted-foreground">
                  {selected.kind === 'group'
                    ? `${selected.members.length} members`
                    : selected.peer_ids.some((id) => onlineIds.has(id))
                      ? 'Online'
                      : 'Offline'}
                </p>
              </div>
              {selected.kind === 'group' ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Users className="size-3" />
                  Group
                </Badge>
              ) : null}
            </header>

            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {error ? (
                <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {messages.length === 0 ? (
                <p className="py-12 text-center text-sm text-muted-foreground">
                  No messages yet. Say hello.
                </p>
              ) : (
                messages.map((m) => {
                  const mine = m.sender_id === me.id;
                  const name = displayName(m.sender);
                  return (
                    <div
                      key={m.id}
                      className={cn(
                        'flex gap-2',
                        mine ? 'justify-end' : 'justify-start',
                      )}
                    >
                      {!mine ? (
                        <Avatar size="sm">
                          {m.sender?.avatar_url ? (
                            <AvatarImage src={m.sender.avatar_url} alt="" />
                          ) : null}
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                      ) : null}
                      <div
                        className={cn(
                          'max-w-[min(36rem,75%)] rounded-2xl px-3.5 py-2 text-sm',
                          mine
                            ? 'rounded-br-md bg-[#3a414f] text-white'
                            : 'rounded-bl-md bg-[#ece9e6] text-[#3a414f]',
                        )}
                      >
                        {!mine ? (
                          <p className="mb-0.5 text-[11px] font-medium opacity-70">
                            {name}
                          </p>
                        ) : null}
                        <p className="whitespace-pre-wrap break-words">{m.body}</p>
                        <p
                          className={cn(
                            'mt-1 text-[10px]',
                            mine ? 'text-white/60' : 'text-muted-foreground',
                          )}
                        >
                          {formatTime(m.created_at)}
                        </p>
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={bottomRef} />
            </div>

            <form
              className="flex items-end gap-2 border-t border-border px-4 py-3"
              onSubmit={(e) => {
                e.preventDefault();
                send();
              }}
            >
              <Input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Write a message…"
                className="min-h-10 flex-1"
                autoComplete="off"
              />
              <Button
                type="submit"
                disabled={!draft.trim() || composerPending}
                className="gap-1.5"
              >
                <Send className="size-4" />
                Send
              </Button>
            </form>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-heading text-2xl font-semibold text-[#3a414f]">
              Your messages
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Start a direct message or a small group chat. Conversations stay
              with the firm and can later attach to leads, deals, and entities.
            </p>
            <Button
              onClick={() => {
                setNewMode('dm');
                setNewOpen(true);
              }}
              className="gap-2"
            >
              <MessageSquarePlus className="size-4" />
              New conversation
            </Button>
          </div>
        )}
      </section>

      <Sheet open={newOpen} onOpenChange={setNewOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>New conversation</SheetTitle>
            <SheetDescription>
              Direct messages are 1:1. Groups are capped at 12 people for now.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex gap-2 px-4">
            <Button
              size="sm"
              variant={newMode === 'dm' ? 'default' : 'outline'}
              onClick={() => {
                setNewMode('dm');
                setPicked([]);
              }}
            >
              Direct
            </Button>
            <Button
              size="sm"
              variant={newMode === 'group' ? 'default' : 'outline'}
              onClick={() => setNewMode('group')}
            >
              Group
            </Button>
          </div>
          {newMode === 'group' ? (
            <div className="mt-3 px-4">
              <Input
                placeholder="Group name"
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
              />
            </div>
          ) : null}
          <div className="relative mt-3 px-4">
            <Search className="pointer-events-none absolute top-2.5 left-6 size-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search people"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="mt-3 flex-1 space-y-1 overflow-y-auto px-2 pb-4">
            {filteredDirectory.map((p) => {
              const name = displayName(p);
              const checked = picked.includes(p.id);
              const online = onlineIds.has(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted',
                    checked && 'bg-muted',
                  )}
                  onClick={() => {
                    if (newMode === 'dm') {
                      void createDm(p.id);
                      return;
                    }
                    setPicked((prev) =>
                      prev.includes(p.id)
                        ? prev.filter((id) => id !== p.id)
                        : prev.length >= 11
                          ? prev
                          : [...prev, p.id],
                    );
                  }}
                >
                  <Avatar size="sm">
                    {p.avatar_url ? <AvatarImage src={p.avatar_url} alt="" /> : null}
                    <AvatarFallback>{initials(name)}</AvatarFallback>
                    {online ? (
                      <AvatarBadge className="bg-emerald-500 ring-background" />
                    ) : null}
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {p.email}
                    </span>
                  </span>
                  {newMode === 'group' && checked ? (
                    <Badge variant="secondary">Added</Badge>
                  ) : null}
                </button>
              );
            })}
          </div>
          {newMode === 'group' ? (
            <div className="border-t border-border p-4">
              <Button
                className="w-full"
                disabled={!groupTitle.trim() || picked.length === 0}
                onClick={() => void createGroup()}
              >
                Create group ({picked.length + 1})
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ConversationRowButton({
  conversation,
  active,
  onlineIds,
  meId,
  onClick,
}: {
  conversation: ConversationListItem;
  active: boolean;
  onlineIds: Set<string>;
  meId: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors',
        active
          ? 'bg-white shadow-sm ring-1 ring-border'
          : 'hover:bg-white/70',
      )}
    >
      <ConversationAvatar
        conversation={conversation}
        meId={meId}
        onlineIds={onlineIds}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-sm font-medium text-[#3a414f]">
            {conversation.display_title}
          </span>
          {conversation.last_message_at ? (
            <span className="shrink-0 text-[10px] text-muted-foreground">
              {formatTime(conversation.last_message_at)}
            </span>
          ) : null}
        </span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className="truncate text-xs text-muted-foreground">
            {conversation.last_message_preview ?? 'No messages yet'}
          </span>
          {conversation.unread_count > 0 ? (
            <Badge className="h-5 min-w-5 justify-center rounded-full px-1.5 text-[10px]">
              {conversation.unread_count > 99 ? '99+' : conversation.unread_count}
            </Badge>
          ) : null}
        </span>
      </span>
    </button>
  );
}

function ConversationAvatar({
  conversation,
  meId,
  onlineIds,
}: {
  conversation: ConversationListItem;
  meId: string;
  onlineIds: Set<string>;
}) {
  const peer =
    conversation.members.find((m) => m.user_id !== meId)?.profile ?? null;
  const name = conversation.display_title;
  const online =
    conversation.kind === 'dm'
      ? conversation.peer_ids.some((id) => onlineIds.has(id))
      : false;

  return (
    <Avatar size="default">
      {peer?.avatar_url && conversation.kind === 'dm' ? (
        <AvatarImage src={peer.avatar_url} alt="" />
      ) : null}
      <AvatarFallback>
        {conversation.kind === 'group' ? (
          <Users className="size-3.5" />
        ) : (
          initials(name)
        )}
      </AvatarFallback>
      {online ? <AvatarBadge className="bg-emerald-500" /> : null}
    </Avatar>
  );
}
