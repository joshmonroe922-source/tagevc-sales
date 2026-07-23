'use client';

import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from 'react';
import {
  ArrowLeft,
  Hash,
  Link2,
  Lock,
  MessageSquarePlus,
  Paperclip,
  Reply,
  Search,
  Send,
  Settings,
  Trash2,
  Upload,
  Users,
  X,
} from 'lucide-react';
import {
  addChannelMembersAction,
  getMessagingBootstrapAction,
  linkConversationAction,
  listAttachableDocumentsAction,
  loadMessagesAction,
  markConversationReadAction,
  muteConversationAction,
  removeChannelMemberAction,
  searchConversationMessagesAction,
  searchMessagesGlobalAction,
  sendMessageAction,
  softDeleteMessageAction,
  startChannelAction,
  startDirectMessageAction,
  startGroupChatAction,
  toggleReactionAction,
  updateChannelSettingsAction,
} from '@/app/(app)/messages/actions';
import { getNotificationPrefsAction } from '@/app/(app)/settings/notifications/actions';
import { createClient } from '@/lib/supabase/client';
import type {
  ConversationListItem,
  DirectoryProfile,
  MessageAttachment,
  MessageFile,
  MessageRow,
  UploadedChatFile,
} from '@/lib/messaging/types';
import { uploadChatFile } from '@/lib/messaging/upload';
import {
  formatMessageBody,
  linkedObjectHref,
  linkedObjectLabel,
} from '@/lib/messaging/format';
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

type SearchHit = {
  id: string;
  body: string;
  created_at: string;
  sender_id: string;
};

type GlobalSearchHit = {
  id: string;
  conversation_id: string;
  body: string;
  created_at: string;
  conversation_title: string;
};

type AttachableDoc = {
  doc_id: string;
  title: string;
  entity_id: string | null;
  status: string;
};

type LinkRefType = 'lead' | 'deal' | 'entity' | 'task' | 'ticket' | 'document';
type NewMode = 'dm' | 'group' | 'channel';

const LINK_REF_TYPES: LinkRefType[] = [
  'lead', 'deal', 'entity', 'task', 'ticket', 'document',
];
const QUICK_REACTIONS = ['👍', '👀', '✅'] as const;

type Props = { initial: Bootstrap };

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

function previewText(body: string, max = 72) {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function parseAttachments(metadata: Record<string, unknown> | undefined) {
  const raw = metadata?.attachments;
  if (!Array.isArray(raw)) return [] as MessageAttachment[];
  return raw.filter(
    (a): a is MessageAttachment =>
      !!a &&
      typeof a === 'object' &&
      typeof (a as MessageAttachment).doc_id === 'string' &&
      typeof (a as MessageAttachment).title === 'string',
  );
}

function mentionQueryAtEnd(draft: string): string | null {
  const match = draft.match(/(?:^|[\s])@([^\s@]*)$/);
  return match ? (match[1] ?? '') : null;
}

export function MessagesShell({ initial }: Props) {
  const [conversations, setConversations] = useState(initial.conversations);
  const [directory] = useState(initial.directory);
  const [selectedId, setSelectedId] = useState<string | null>(initial.selectedId);
  const [messages, setMessages] = useState<MessageRow[]>(initial.messages);
  const [draft, setDraft] = useState('');
  const [replyTo, setReplyTo] = useState<MessageRow | null>(null);
  const [attachments, setAttachments] = useState<MessageAttachment[]>([]);
  const [pendingUploads, setPendingUploads] = useState<UploadedChatFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [attachDocs, setAttachDocs] = useState<AttachableDoc[]>([]);
  const [attachOpen, setAttachOpen] = useState(false);
  const [error, setError] = useState<string | null>(initial.messagesError);
  const [onlineIds, setOnlineIds] = useState<Set<string>>(new Set());
  const [composerPending, startComposer] = useTransition();
  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<NewMode>('dm');
  const [groupTitle, setGroupTitle] = useState('');
  const [channelTopic, setChannelTopic] = useState('');
  const [channelPrivate, setChannelPrivate] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [threadSearch, setThreadSearch] = useState('');
  const [searchHits, setSearchHits] = useState<SearchHit[]>([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalHits, setGlobalHits] = useState<GlobalSearchHit[]>([]);
  const [globalOpen, setGlobalOpen] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkRefType, setLinkRefType] = useState<LinkRefType>('lead');
  const [linkRefId, setLinkRefId] = useState('');
  const [linkEntityId, setLinkEntityId] = useState('');
  const [linkPending, startLink] = useTransition();
  const [mentionOpen, setMentionOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsTitle, setSettingsTitle] = useState('');
  const [settingsDescription, setSettingsDescription] = useState('');
  const [settingsPrivate, setSettingsPrivate] = useState(false);
  const [settingsAddIds, setSettingsAddIds] = useState<string[]>([]);
  const [settingsQuery, setSettingsQuery] = useState('');
  const [settingsMuted, setSettingsMuted] = useState(false);
  const [settingsPending, startSettings] = useTransition();
  const [mutedIds, setMutedIds] = useState<Set<string>>(new Set());
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const me = initial.me;

  const selected = useMemo(
    () => conversations.find((c) => c.id === selectedId) ?? null,
    [conversations, selectedId],
  );

  const myMembership = useMemo(
    () => selected?.members.find((m) => m.user_id === me.id) ?? null,
    [selected, me.id],
  );
  const isChannelOwner = myMembership?.member_role === 'owner';

  const messagesById = useMemo(() => {
    const map = new Map<string, MessageRow>();
    for (const m of messages) map.set(m.id, m);
    return map;
  }, [messages]);

  const mentionToken = mentionQueryAtEnd(draft);
  const mentionSuggestions = useMemo(() => {
    if (mentionToken === null) return [] as DirectoryProfile[];
    const q = mentionToken.toLowerCase();
    return directory
      .filter((p) => p.id !== me.id)
      .filter(
        (p) =>
          !q ||
          p.full_name?.toLowerCase().includes(q) ||
          p.email.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [directory, mentionToken, me.id]);

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

  const selectConversation = useCallback(async (id: string, scrollMsgId?: string) => {
    setSelectedId(id);
    setError(null);
    setReplyTo(null);
    setAttachments([]);
    setPendingUploads([]);
    setAttachOpen(false);
    setThreadSearch('');
    setSearchHits([]);
    setSearchOpen(false);
    setGlobalOpen(false);
    setHighlightId(null);
    setSettingsOpen(false);
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
    if (scrollMsgId) {
      window.setTimeout(() => {
        setHighlightId(scrollMsgId);
        document
          .getElementById(`msg-${scrollMsgId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 80);
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, selectedId]);

  useEffect(() => {
    if (!selectedId || threadSearch.trim().length < 2) {
      setSearchHits([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        const result = await searchConversationMessagesAction(
          selectedId,
          threadSearch.trim(),
        );
        if (cancelled || !result.ok) {
          if (!cancelled) setSearchHits([]);
          return;
        }
        setSearchHits(result.results);
        setSearchOpen(true);
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [selectedId, threadSearch]);

  useEffect(() => {
    if (globalQuery.trim().length < 2) {
      setGlobalHits([]);
      return;
    }
    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        const result = await searchMessagesGlobalAction(globalQuery.trim());
        if (cancelled || !result.ok) {
          if (!cancelled) setGlobalHits([]);
          return;
        }
        setGlobalHits(result.results);
        setGlobalOpen(true);
      })();
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [globalQuery]);

  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlightId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  useEffect(() => {
    setMentionOpen(mentionToken !== null && mentionSuggestions.length > 0);
  }, [mentionToken, mentionSuggestions.length]);

  useEffect(() => {
    void (async () => {
      const result = await getNotificationPrefsAction();
      if (!result.ok) return;
      setMutedIds(new Set(result.prefs.muted_conversation_ids ?? []));
    })();
  }, []);

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
              return [...prev, { ...row, sender, reactions: [], files: [] }];
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

  function scrollToMessage(id: string) {
    setSearchOpen(false);
    setHighlightId(id);
    document
      .getElementById(`msg-${id}`)
      ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function insertMention(profile: DirectoryProfile) {
    const label = profile.full_name?.trim() || profile.email;
    setDraft((prev) =>
      prev.replace(/(?:^|[\s])@[^\s@]*$/, (m) => {
        const lead = m.startsWith('@') ? '' : (m[0] ?? '');
        return `${lead}@${label} `;
      }),
    );
    setMentionOpen(false);
  }

  async function openAttachPicker() {
    if (attachOpen) {
      setAttachOpen(false);
      return;
    }
    const result = await listAttachableDocumentsAction();
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setAttachDocs(result.documents);
    setAttachOpen(true);
  }

  function toggleAttach(doc: AttachableDoc) {
    setAttachments((prev) =>
      prev.some((a) => a.doc_id === doc.doc_id)
        ? prev.filter((a) => a.doc_id !== doc.doc_id)
        : [...prev, { doc_id: doc.doc_id, title: doc.title }],
    );
  }

  async function onFilesSelected(fileList: FileList | null) {
    if (!selectedId || !fileList?.length) return;
    setUploading(true);
    setError(null);
    const uploaded: UploadedChatFile[] = [];
    for (const file of Array.from(fileList)) {
      const result = await uploadChatFile(selectedId, file);
      if (!result.ok) {
        setError(result.error);
        continue;
      }
      uploaded.push(result.file);
    }
    if (uploaded.length) {
      setPendingUploads((prev) => [...prev, ...uploaded]);
    }
    setUploading(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function react(messageId: string, emoji: string) {
    if (messageId.startsWith('tmp-') || !selectedId) return;
    const result = await toggleReactionAction(messageId, emoji);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const loaded = await loadMessagesAction(selectedId);
    if (loaded.ok) setMessages(loaded.messages);
  }

  async function deleteMessage(messageId: string) {
    if (messageId.startsWith('tmp-') || !selectedId) return;
    const result = await softDeleteMessageAction(messageId);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const loaded = await loadMessagesAction(selectedId);
    if (loaded.ok) setMessages(loaded.messages);
  }

  function openChannelSettings() {
    if (!selected || selected.kind !== 'channel') return;
    setSettingsTitle(selected.title ?? selected.display_title);
    setSettingsDescription(selected.description ?? '');
    setSettingsPrivate(Boolean(selected.is_private));
    setSettingsAddIds([]);
    setSettingsQuery('');
    setSettingsMuted(mutedIds.has(selected.id));
    setSettingsOpen(true);
  }

  function send() {
    if (!selectedId || composerPending || uploading) return;
    const text = draft.trim();
    if (!text && attachments.length === 0 && pendingUploads.length === 0) return;
    const parentId = replyTo?.id ?? null;
    const pendingAttachments = [...attachments];
    const pendingFiles = [...pendingUploads];
    setDraft('');
    setReplyTo(null);
    setAttachments([]);
    setPendingUploads([]);
    setAttachOpen(false);
    setMentionOpen(false);
    const optimistic: MessageRow = {
      id: `tmp-${Date.now()}`,
      conversation_id: selectedId,
      sender_id: me.id,
      body:
        text ||
        (pendingFiles.length
          ? `Shared ${pendingFiles.length} file(s)`
          : pendingAttachments.length
            ? `Shared ${pendingAttachments.length} document(s)`
            : ''),
      parent_id: parentId,
      metadata: {
        ...(pendingAttachments.length
          ? { attachments: pendingAttachments }
          : {}),
        ...(pendingFiles.length ? { files: pendingFiles } : {}),
      },
      created_at: new Date().toISOString(),
      edited_at: null,
      deleted_at: null,
      sender: me,
      reactions: [],
      files: [],
    };
    setMessages((prev) => [...prev, optimistic]);

    startComposer(async () => {
      const result = await sendMessageAction(
        selectedId,
        text,
        parentId,
        pendingAttachments.length ? pendingAttachments : undefined,
        pendingFiles.length ? pendingFiles : undefined,
      );
      if (!result.ok) {
        setError(result.error);
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        setDraft(text);
        setAttachments(pendingAttachments);
        setPendingUploads(pendingFiles);
        if (parentId) {
          const parent = messagesById.get(parentId);
          if (parent) setReplyTo(parent);
        }
        return;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === optimistic.id
            ? { ...(result.message as MessageRow), sender: me, reactions: [] }
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

  async function createChannel() {
    if (!groupTitle.trim()) return;
    const result = await startChannelAction({
      title: groupTitle.trim(),
      memberIds: picked,
      topic: channelTopic.trim() || null,
      isPrivate: channelPrivate,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNewOpen(false);
    setGroupTitle('');
    setChannelTopic('');
    setChannelPrivate(false);
    setPicked([]);
    await refreshList(result.conversationId);
    await selectConversation(result.conversationId);
  }

  function submitLink() {
    if (!selectedId || !linkRefId.trim() || linkPending) return;
    startLink(async () => {
      const result = await linkConversationAction({
        conversationId: selectedId,
        refType: linkRefType,
        refId: linkRefId.trim(),
        entityId: linkEntityId.trim() || null,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setLinkOpen(false);
      setLinkRefId('');
      setLinkEntityId('');
      await refreshList(selectedId);
    });
  }

  function saveChannelSettings() {
    if (!selectedId || settingsPending) return;
    startSettings(async () => {
      const result = await updateChannelSettingsAction({
        conversationId: selectedId,
        title: settingsTitle.trim() || undefined,
        description: settingsDescription.trim() || null,
        isPrivate: settingsPrivate,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      if (settingsAddIds.length > 0) {
        const addResult = await addChannelMembersAction(
          selectedId,
          settingsAddIds,
        );
        if (!addResult.ok) {
          setError(addResult.error);
          return;
        }
        setSettingsAddIds([]);
      }
      await refreshList(selectedId);
      setSettingsOpen(false);
    });
  }

  function removeMember(userId: string) {
    if (!selectedId) return;
    startSettings(async () => {
      const result = await removeChannelMemberAction(selectedId, userId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      await refreshList(selectedId);
    });
  }

  function toggleMute(mute: boolean) {
    if (!selectedId) return;
    startSettings(async () => {
      const result = await muteConversationAction(selectedId, mute);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSettingsMuted(mute);
      setMutedIds((prev) => {
        const next = new Set(prev);
        if (mute) next.add(selectedId);
        else next.delete(selectedId);
        return next;
      });
    });
  }

  const filteredDirectory = directory.filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q)
    );
  });

  const memberIds = new Set(selected?.members.map((m) => m.user_id) ?? []);
  const settingsDirectory = directory.filter((p) => {
    if (memberIds.has(p.id)) return false;
    const q = settingsQuery.trim().toLowerCase();
    if (!q) return true;
    return (
      p.full_name?.toLowerCase().includes(q) ||
      p.email.toLowerCase().includes(q)
    );
  });

  const linkedHref = selected
    ? linkedObjectHref(selected.linked_ref_type, selected.linked_ref_id)
    : null;
  const linkedLabel = selected
    ? linkedObjectLabel(selected.linked_ref_type, selected.linked_ref_id)
    : '';
  const canSend = Boolean(
    draft.trim() || attachments.length > 0 || pendingUploads.length > 0,
  );

  return (
    <div className="-mx-6 -my-8 md:-mx-10 flex h-[calc(100dvh)] min-h-[28rem] flex-col border-t border-border bg-background md:flex-row">
      <aside
        className={cn(
          'w-full shrink-0 flex-col border-r border-border bg-[#f7f5f2] md:max-w-xs',
          selectedId ? 'hidden md:flex' : 'flex',
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 py-4">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-[#3a414f]">
              Message Center
            </h1>
            <p className="text-xs text-muted-foreground">
              Direct messages, groups & channels
            </p>
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
        <div className="relative px-3 pb-3">
          <Search className="pointer-events-none absolute top-2.5 left-5 size-3.5 text-muted-foreground" />
          <Input
            className="h-9 pl-8 text-sm"
            placeholder="Search all messages…"
            value={globalQuery}
            onChange={(e) => {
              setGlobalQuery(e.target.value);
              setGlobalOpen(true);
            }}
            onFocus={() => {
              if (globalHits.length > 0) setGlobalOpen(true);
            }}
            onBlur={() => {
              window.setTimeout(() => setGlobalOpen(false), 150);
            }}
          />
          {globalOpen && globalQuery.trim().length >= 2 ? (
            <div className="absolute top-full right-3 left-3 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-md">
              {globalHits.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">No matches</p>
              ) : (
                globalHits.map((hit) => (
                  <button
                    key={hit.id}
                    type="button"
                    className="block w-full px-3 py-2 text-left text-xs hover:bg-[#f7f5f2]"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setGlobalOpen(false);
                      void selectConversation(hit.conversation_id, hit.id);
                    }}
                  >
                    <span className="block truncate font-medium text-[#3a414f]">
                      {hit.conversation_title || 'Conversation'}
                    </span>
                    <span className="mt-0.5 line-clamp-2 text-muted-foreground">
                      {previewText(hit.body, 100)}
                    </span>
                    <span className="mt-0.5 block text-[10px] text-muted-foreground">
                      {formatTime(hit.created_at)}
                    </span>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </div>
        <Separator />
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.length === 0 ? (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              No conversations yet. Start a DM, group, or channel.
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

      <section
        className={cn(
          'min-w-0 flex-1 flex-col',
          selectedId ? 'flex' : 'hidden md:flex',
        )}
      >
        {selected ? (
          <>
            <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="gap-1.5 md:hidden"
                onClick={() => setSelectedId(null)}
              >
                <ArrowLeft className="size-3.5" />
                Chats
              </Button>
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
                  {selected.kind === 'group' || selected.kind === 'channel'
                    ? `${selected.members.length} members`
                    : selected.peer_ids.some((id) => onlineIds.has(id))
                      ? 'Online'
                      : 'Offline'}
                </p>
              </div>
              {linkedLabel ? (
                linkedHref ? (
                  <Badge
                    variant="secondary"
                    className="max-w-[10rem] truncate font-normal"
                    render={<Link href={linkedHref} />}
                  >
                    {linkedLabel}
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="max-w-[10rem] truncate font-normal"
                  >
                    {linkedLabel}
                  </Badge>
                )
              ) : null}
              {selected.kind === 'group' ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Users className="size-3" />
                  Group
                </Badge>
              ) : null}
              {selected.kind === 'channel' ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Hash className="size-3" />
                  Channel
                </Badge>
              ) : null}
              {selected.is_private ? (
                <Badge variant="secondary" className="gap-1 font-normal">
                  <Lock className="size-3" />
                  Private
                </Badge>
              ) : null}
              <div className="relative w-full max-w-[14rem] sm:w-auto sm:flex-none">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="h-9 pl-8 text-sm"
                  placeholder="Search messages…"
                  value={threadSearch}
                  onChange={(e) => {
                    setThreadSearch(e.target.value);
                    setSearchOpen(true);
                  }}
                  onFocus={() => {
                    if (searchHits.length > 0) setSearchOpen(true);
                  }}
                  onBlur={() => {
                    window.setTimeout(() => setSearchOpen(false), 150);
                  }}
                />
                {searchOpen && threadSearch.trim().length >= 2 ? (
                  <div className="absolute top-full right-0 z-20 mt-1 max-h-56 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-md">
                    {searchHits.length === 0 ? (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        No matches
                      </p>
                    ) : (
                      searchHits.map((hit) => (
                        <button
                          key={hit.id}
                          type="button"
                          className="block w-full px-3 py-2 text-left text-xs hover:bg-[#f7f5f2]"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => scrollToMessage(hit.id)}
                        >
                          <span className="line-clamp-2 text-[#3a414f]">
                            {previewText(hit.body, 100)}
                          </span>
                          <span className="mt-0.5 block text-[10px] text-muted-foreground">
                            {formatTime(hit.created_at)}
                          </span>
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </div>
              {selected.kind === 'channel' ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openChannelSettings()}
                >
                  <Settings className="size-3.5" />
                  Settings
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => {
                  setLinkRefType(
                    (selected.linked_ref_type as LinkRefType) || 'lead',
                  );
                  setLinkRefId(selected.linked_ref_id ?? '');
                  setLinkEntityId(selected.entity_id ?? '');
                  setLinkOpen(true);
                }}
              >
                <Link2 className="size-3.5" />
                Link
              </Button>
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
                messages.map((m) => (
                  <MessageBubble
                    key={m.id}
                    message={m}
                    mine={m.sender_id === me.id}
                    parent={m.parent_id ? messagesById.get(m.parent_id) : null}
                    highlight={highlightId === m.id}
                    canDelete={
                      (m.sender_id === me.id ||
                        (selected.kind === 'channel' && isChannelOwner)) &&
                      !m.deleted_at &&
                      !m.id.startsWith('tmp-')
                    }
                    onReply={() => setReplyTo(m)}
                    onReact={(emoji) => void react(m.id, emoji)}
                    onDelete={() => void deleteMessage(m.id)}
                  />
                ))
              )}
              <div ref={bottomRef} />
            </div>

            <div className="border-t border-border">
              {replyTo ? (
                <div className="flex items-start gap-2 bg-[#f7f5f2] px-4 py-2 text-xs text-[#3a414f]">
                  <Reply className="mt-0.5 size-3.5 shrink-0 opacity-60" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      Replying to {displayName(replyTo.sender)}
                    </p>
                    <p className="truncate text-muted-foreground">
                      {previewText(replyTo.body)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label="Clear reply"
                    onClick={() => setReplyTo(null)}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
              ) : null}
              {attachments.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 bg-[#f7f5f2] px-4 py-2">
                  {attachments.map((a) => (
                    <Badge
                      key={a.doc_id}
                      variant="secondary"
                      className="gap-1 font-normal"
                    >
                      <Paperclip className="size-3" />
                      <span className="max-w-[10rem] truncate">{a.title}</span>
                      <button
                        type="button"
                        className="ml-0.5 rounded-sm hover:text-destructive"
                        aria-label={`Remove ${a.title}`}
                        onClick={() =>
                          setAttachments((prev) =>
                            prev.filter((x) => x.doc_id !== a.doc_id),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {pendingUploads.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 bg-[#f7f5f2] px-4 py-2">
                  {pendingUploads.map((f) => (
                    <Badge
                      key={f.storage_path}
                      variant="secondary"
                      className="gap-1 font-normal"
                    >
                      <Upload className="size-3" />
                      <span className="max-w-[10rem] truncate">{f.file_name}</span>
                      <button
                        type="button"
                        className="ml-0.5 rounded-sm hover:text-destructive"
                        aria-label={`Remove ${f.file_name}`}
                        onClick={() =>
                          setPendingUploads((prev) =>
                            prev.filter((x) => x.storage_path !== f.storage_path),
                          )
                        }
                      >
                        <X className="size-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              ) : null}
              {attachOpen ? (
                <div className="max-h-40 overflow-y-auto border-b border-border bg-white px-3 py-2">
                  {attachDocs.length === 0 ? (
                    <p className="px-1 py-2 text-xs text-muted-foreground">
                      No documents available
                    </p>
                  ) : (
                    attachDocs.map((doc) => {
                      const on = attachments.some((a) => a.doc_id === doc.doc_id);
                      return (
                        <button
                          key={doc.doc_id}
                          type="button"
                          className={cn(
                            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[#f7f5f2]',
                            on && 'bg-[#ece9e6]',
                          )}
                          onClick={() => toggleAttach(doc)}
                        >
                          <Paperclip className="size-3 shrink-0 text-muted-foreground" />
                          <span className="min-w-0 flex-1 truncate text-[#3a414f]">
                            {doc.title}
                          </span>
                          {on ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Added
                            </Badge>
                          ) : null}
                        </button>
                      );
                    })
                  )}
                </div>
              ) : null}
              <form
                className="relative flex items-end gap-2 px-4 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                {mentionOpen && mentionSuggestions.length > 0 ? (
                  <div className="absolute bottom-full left-4 z-20 mb-1 max-h-48 w-[min(18rem,calc(100%-2rem))] overflow-y-auto rounded-lg border border-border bg-white py-1 shadow-md">
                    {mentionSuggestions.map((p) => {
                      const name = displayName(p);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-[#f7f5f2]"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => insertMention(p)}
                        >
                          <Avatar size="sm">
                            {p.avatar_url ? (
                              <AvatarImage src={p.avatar_url} alt="" />
                            ) : null}
                            <AvatarFallback>{initials(name)}</AvatarFallback>
                          </Avatar>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-medium text-[#3a414f]">
                              {name}
                            </span>
                            <span className="block truncate text-muted-foreground">
                              {p.email}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => void onFilesSelected(e.target.files)}
                />
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Attach document"
                  onClick={() => void openAttachPicker()}
                >
                  <Paperclip className="size-4" />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  aria-label="Upload file"
                  disabled={uploading || !selectedId}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload className="size-4" />
                </Button>
                <Input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={
                    uploading
                      ? 'Uploading…'
                      : replyTo
                        ? 'Write a reply…'
                        : 'Write a message…'
                  }
                  className="min-h-10 flex-1"
                  autoComplete="off"
                  disabled={uploading}
                />
                <Button
                  type="submit"
                  disabled={!canSend || composerPending || uploading}
                  className="gap-1.5"
                >
                  <Send className="size-4" />
                  Send
                </Button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="font-heading text-2xl font-semibold text-[#3a414f]">
              Your messages
            </p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Start a direct message, group, or channel. Conversations stay with
              the firm and can attach to leads, deals, and entities.
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
              Direct messages are 1:1. Groups and channels can include more people.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 flex flex-wrap gap-2 px-4">
            {(['dm', 'group', 'channel'] as const).map((mode) => (
              <Button
                key={mode}
                size="sm"
                variant={newMode === mode ? 'default' : 'outline'}
                onClick={() => {
                  setNewMode(mode);
                  if (mode === 'dm') setPicked([]);
                }}
              >
                {mode === 'dm' ? 'Direct' : mode === 'group' ? 'Group' : 'Channel'}
              </Button>
            ))}
          </div>
          {newMode === 'group' || newMode === 'channel' ? (
            <div className="mt-3 space-y-2 px-4">
              <Input
                placeholder={newMode === 'channel' ? 'Channel name' : 'Group name'}
                value={groupTitle}
                onChange={(e) => setGroupTitle(e.target.value)}
              />
              {newMode === 'channel' ? (
                <>
                  <Input
                    placeholder="Topic (optional)"
                    value={channelTopic}
                    onChange={(e) => setChannelTopic(e.target.value)}
                  />
                  <label className="flex items-center gap-2 text-sm text-[#3a414f]">
                    <input
                      type="checkbox"
                      checked={channelPrivate}
                      onChange={(e) => setChannelPrivate(e.target.checked)}
                    />
                    Private channel
                  </label>
                </>
              ) : null}
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
                  {(newMode === 'group' || newMode === 'channel') && checked ? (
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
          {newMode === 'channel' ? (
            <div className="border-t border-border p-4">
              <Button
                className="w-full"
                disabled={!groupTitle.trim()}
                onClick={() => void createChannel()}
              >
                Create channel
                {picked.length > 0 ? ` (+${picked.length})` : ''}
                {channelPrivate ? ' · Private' : ''}
              </Button>
            </div>
          ) : null}
        </SheetContent>
      </Sheet>

      <Sheet open={linkOpen} onOpenChange={setLinkOpen}>
        <SheetContent side="right" className="w-full sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Link conversation</SheetTitle>
            <SheetDescription>
              Attach this chat to a lead, deal, entity, task, ticket, or document.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-3 px-4">
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Type</span>
              <select
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                value={linkRefType}
                onChange={(e) => setLinkRefType(e.target.value as LinkRefType)}
              >
                {LINK_REF_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Ref ID</span>
              <Input
                value={linkRefId}
                onChange={(e) => setLinkRefId(e.target.value)}
                placeholder="Object id"
                autoComplete="off"
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Entity ID (optional)</span>
              <Input
                value={linkEntityId}
                onChange={(e) => setLinkEntityId(e.target.value)}
                placeholder="Related entity id"
                autoComplete="off"
              />
            </label>
            <Button
              className="w-full gap-1.5"
              disabled={!linkRefId.trim() || linkPending}
              onClick={() => submitLink()}
            >
              <Link2 className="size-4" />
              {linkPending ? 'Linking…' : 'Save link'}
            </Button>
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          <SheetHeader>
            <SheetTitle>Channel settings</SheetTitle>
            <SheetDescription>
              Update details, manage members, and mute notifications.
            </SheetDescription>
          </SheetHeader>
          <div className="mt-4 space-y-4 px-4 pb-6">
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Title</span>
              <Input
                value={settingsTitle}
                onChange={(e) => setSettingsTitle(e.target.value)}
              />
            </label>
            <label className="block space-y-1.5 text-sm">
              <span className="text-muted-foreground">Description</span>
              <Input
                value={settingsDescription}
                onChange={(e) => setSettingsDescription(e.target.value)}
                placeholder="Optional"
              />
            </label>
            <label className="flex items-center gap-2 text-sm text-[#3a414f]">
              <input
                type="checkbox"
                checked={settingsPrivate}
                onChange={(e) => setSettingsPrivate(e.target.checked)}
              />
              Private channel
            </label>
            <label className="flex items-center gap-2 text-sm text-[#3a414f]">
              <input
                type="checkbox"
                checked={settingsMuted}
                disabled={settingsPending}
                onChange={(e) => toggleMute(e.target.checked)}
              />
              Mute conversation
            </label>
            <Button
              className="w-full"
              disabled={!settingsTitle.trim() || settingsPending}
              onClick={() => saveChannelSettings()}
            >
              {settingsPending ? 'Saving…' : 'Save settings'}
            </Button>

            <Separator />

            <div>
              <p className="mb-2 text-sm font-medium text-[#3a414f]">Members</p>
              <div className="space-y-1">
                {(selected?.members ?? []).map((m) => {
                  const profile =
                    m.profile ?? directory.find((p) => p.id === m.user_id) ?? null;
                  const name = displayName(profile);
                  const isOwner = m.member_role === 'owner';
                  return (
                    <div
                      key={m.user_id}
                      className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm"
                    >
                      <Avatar size="sm">
                        {profile?.avatar_url ? (
                          <AvatarImage src={profile.avatar_url} alt="" />
                        ) : null}
                        <AvatarFallback>{initials(name)}</AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      {isOwner ? (
                        <Badge variant="secondary" className="text-[10px]">
                          Owner
                        </Badge>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-destructive"
                          disabled={settingsPending || !isChannelOwner}
                          onClick={() => removeMember(m.user_id)}
                        >
                          Remove
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-[#3a414f]">Add members</p>
              <div className="relative mb-2">
                <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                <Input
                  className="h-9 pl-8 text-sm"
                  placeholder="Search directory"
                  value={settingsQuery}
                  onChange={(e) => setSettingsQuery(e.target.value)}
                />
              </div>
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {settingsDirectory.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">
                    No people to add
                  </p>
                ) : (
                  settingsDirectory.map((p) => {
                    const name = displayName(p);
                    const checked = settingsAddIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-[#f7f5f2]',
                          checked && 'bg-[#ece9e6]',
                        )}
                        onClick={() =>
                          setSettingsAddIds((prev) =>
                            prev.includes(p.id)
                              ? prev.filter((id) => id !== p.id)
                              : [...prev, p.id],
                          )
                        }
                      >
                        <Avatar size="sm">
                          {p.avatar_url ? (
                            <AvatarImage src={p.avatar_url} alt="" />
                          ) : null}
                          <AvatarFallback>{initials(name)}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1 truncate text-[#3a414f]">
                          {name}
                        </span>
                        {checked ? (
                          <Badge variant="secondary" className="text-[10px]">
                            Added
                          </Badge>
                        ) : null}
                      </button>
                    );
                  })
                )}
              </div>
              {settingsAddIds.length > 0 ? (
                <p className="mt-2 text-xs text-muted-foreground">
                  {settingsAddIds.length} selected — saved with settings
                </p>
              ) : null}
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function MessageBubble({
  message: m,
  mine,
  parent,
  highlight,
  canDelete,
  onReply,
  onReact,
  onDelete,
}: {
  message: MessageRow;
  mine: boolean;
  parent: MessageRow | null | undefined;
  highlight: boolean;
  canDelete: boolean;
  onReply: () => void;
  onReact: (emoji: string) => void;
  onDelete: () => void;
}) {
  const name = displayName(m.sender);
  const parentName = parent ? displayName(parent.sender) : null;
  const msgAttachments = parseAttachments(m.metadata);
  const files = (m.files ?? []) as MessageFile[];
  const reactions = m.reactions ?? [];
  const deleted = Boolean(m.deleted_at);

  return (
    <div
      id={`msg-${m.id}`}
      className={cn(
        'flex scroll-mt-4 flex-col gap-1 transition-colors',
        mine ? 'items-end' : 'items-start',
        highlight && 'rounded-lg bg-[#ece9e6]/70 ring-2 ring-[#3a414f]/25',
      )}
    >
      <div
        className={cn(
          'flex gap-2',
          mine ? 'justify-end' : 'justify-start',
          m.parent_id && (mine ? 'pr-2' : 'pl-6'),
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
            'group relative max-w-[min(36rem,75%)] rounded-2xl px-3.5 py-2 text-sm',
            mine
              ? 'rounded-br-md bg-[#3a414f] text-white'
              : 'rounded-bl-md bg-[#ece9e6] text-[#3a414f]',
            m.parent_id &&
              (mine
                ? 'border-r-2 border-white/40'
                : 'border-l-2 border-[#3a414f]/25'),
            deleted && 'opacity-60',
          )}
        >
          {!mine ? (
            <p className="mb-0.5 text-[11px] font-medium opacity-70">{name}</p>
          ) : null}
          {m.parent_id ? (
            <p
              className={cn(
                'mb-1 text-[11px]',
                mine ? 'text-white/70' : 'text-muted-foreground',
              )}
            >
              ↩ reply to {parentName ?? 'message'}
              {parent ? `: ${previewText(parent.body, 48)}` : ''}
            </p>
          ) : null}
          {deleted ? (
            <p
              className={cn(
                'italic text-[12px]',
                mine ? 'text-white/70' : 'text-muted-foreground',
              )}
            >
              Message deleted
            </p>
          ) : (
            <div className="whitespace-pre-wrap break-words">
              {formatMessageBody(m.body)}
            </div>
          )}
          {!deleted && msgAttachments.length > 0 ? (
            <ul className="mt-1.5 space-y-1">
              {msgAttachments.map((a) => (
                <li key={a.doc_id}>
                  <Link
                    href={`/documents/${a.doc_id}`}
                    className={cn(
                      'inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline',
                      mine ? 'text-white/85' : 'text-[#3a414f]/80',
                    )}
                  >
                    <Paperclip className="size-3" />
                    {a.title}
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {!deleted && files.length > 0 ? (
            <ul className="mt-1.5 space-y-1.5">
              {files.map((f) => (
                <li key={f.id}>
                  {f.mime_type.startsWith('image/') && f.signed_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={f.signed_url}
                      alt={f.file_name}
                      className="max-h-40 max-w-full rounded-md object-contain"
                    />
                  ) : f.signed_url ? (
                    <a
                      href={f.signed_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={cn(
                        'inline-flex items-center gap-1 text-[11px] underline-offset-2 hover:underline',
                        mine ? 'text-white/85' : 'text-[#3a414f]/80',
                      )}
                    >
                      <Upload className="size-3" />
                      {f.file_name}
                    </a>
                  ) : (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 text-[11px]',
                        mine ? 'text-white/70' : 'text-muted-foreground',
                      )}
                    >
                      <Upload className="size-3" />
                      {f.file_name}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          <div className="mt-1 flex items-center justify-between gap-2">
            <p
              className={cn(
                'text-[10px]',
                mine ? 'text-white/60' : 'text-muted-foreground',
              )}
            >
              {formatTime(m.created_at)}
            </p>
            <div className="flex items-center gap-1.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              {!deleted ? (
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-0.5 text-[10px]',
                    mine
                      ? 'text-white/80 hover:text-white'
                      : 'text-[#3a414f]/70 hover:text-[#3a414f]',
                  )}
                  onClick={onReply}
                >
                  <Reply className="size-3" />
                  Reply
                </button>
              ) : null}
              {canDelete ? (
                <button
                  type="button"
                  className={cn(
                    'inline-flex items-center gap-0.5 text-[10px]',
                    mine
                      ? 'text-white/80 hover:text-white'
                      : 'text-[#3a414f]/70 hover:text-destructive',
                  )}
                  aria-label="Delete message"
                  onClick={onDelete}
                >
                  <Trash2 className="size-3" />
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {!deleted ? (
        <div className={cn('flex flex-wrap items-center gap-1', mine ? 'mr-1' : 'ml-10')}>
          {reactions.map((r) => (
            <button
              key={r.emoji}
              type="button"
              className={cn(
                'inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] transition-colors',
                r.mine
                  ? 'border-[#3a414f]/40 bg-[#ece9e6]'
                  : 'border-border bg-white hover:bg-[#f7f5f2]',
              )}
              onClick={() => onReact(r.emoji)}
            >
              <span>{r.emoji}</span>
              <span className="text-muted-foreground">{r.count}</span>
            </button>
          ))}
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className="rounded-full px-1 py-0.5 text-[11px] text-muted-foreground opacity-60 transition-opacity hover:bg-[#f7f5f2] hover:opacity-100"
              title={`React ${emoji}`}
              onClick={() => onReact(emoji)}
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
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
        active ? 'bg-white shadow-sm ring-1 ring-border' : 'hover:bg-white/70',
      )}
    >
      <ConversationAvatar
        conversation={conversation}
        meId={meId}
        onlineIds={onlineIds}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="flex min-w-0 items-center gap-1 truncate text-sm font-medium text-[#3a414f]">
            {conversation.is_private ? (
              <Lock className="size-3 shrink-0 opacity-60" />
            ) : null}
            <span className="truncate">{conversation.display_title}</span>
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
        {conversation.kind === 'channel' ? (
          conversation.is_private ? (
            <Lock className="size-3.5" />
          ) : (
            <Hash className="size-3.5" />
          )
        ) : conversation.kind === 'group' ? (
          <Users className="size-3.5" />
        ) : (
          initials(name)
        )}
      </AvatarFallback>
      {online ? <AvatarBadge className="bg-emerald-500" /> : null}
    </Avatar>
  );
}
