import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createTeamsChat,
  fetchCalendarStatus,
  fetchTeamsChatMessages,
  fetchTeamsChats,
  hideTeamsChat,
  searchMeetingPeople,
  sendTeamsChatMessage,
  setMyWorkEmail,
  startCalendarOAuth,
  type CalendarStatus,
  type PeopleSuggestion,
  type TeamsChat,
  type TeamsChatMessage,
} from '../lib/calendarApi';
import { logAuditEvent } from '../lib/audit';
import {
  clearDismissedChat,
  isMeetingChatId,
  loadDismissedChats,
  persistDismissedChat,
} from '../lib/chatDismiss';
import {
  ACTIVE_CHAT_STORAGE_KEY,
  evaluateChatDesktopAlerts,
  evaluateChatMessageDesktopAlerts,
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../lib/desktopAlerts';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };

const POLL_MS = 20_000;

function chatTypeLabel(chatType: string | null): string {
  if (chatType === 'meeting') return 'Meeting';
  if (chatType === 'group') return 'Group';
  return '1:1';
}

function formatMsgTime(iso: string | null): string {
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

function chatMatchesListQuery(chat: TeamsChat, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  if (chat.title.toLowerCase().includes(needle)) return true;
  if (chat.topic?.toLowerCase().includes(needle)) return true;
  if (chat.last_message?.preview?.toLowerCase().includes(needle)) return true;
  if (chat.last_message?.from_name?.toLowerCase().includes(needle)) return true;
  return chat.members.some((m) => {
    const name = (m.display_name ?? '').toLowerCase();
    const email = (m.email ?? '').toLowerCase();
    return name.includes(needle) || email.includes(needle);
  });
}

function messageMatchesFind(msg: TeamsChatMessage, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return false;
  if (msg.message_type === 'systemEventMessage') return false;
  if ((msg.body ?? '').toLowerCase().includes(needle)) return true;
  if ((msg.from_name ?? '').toLowerCase().includes(needle)) return true;
  return false;
}

function highlightMatch(text: string, q: string): ReactNode {
  const needle = q.trim();
  if (!needle) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  const idx = lower.indexOf(n);
  if (idx < 0) return text;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="chat-find-mark">{text.slice(idx, idx + needle.length)}</mark>
      {text.slice(idx + needle.length)}
    </>
  );
}

export function TeamsChatPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const [chats, setChats] = useState<TeamsChat[]>([]);
  const [meId, setMeId] = useState<string | null>(null);
  const [chatsLoading, setChatsLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<TeamsChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [compose, setCompose] = useState('');
  const [sending, setSending] = useState(false);

  const [newOpen, setNewOpen] = useState(false);
  const [newMode, setNewMode] = useState<'oneOnOne' | 'group'>('oneOnOne');
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<PeopleSuggestion[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [selectedPeople, setSelectedPeople] = useState<PeopleSuggestion[]>([]);
  const [groupTopic, setGroupTopic] = useState('');
  const [creating, setCreating] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);
  const [notifPerm, setNotifPerm] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );
  const [listQuery, setListQuery] = useState('');
  const [threadFind, setThreadFind] = useState('');
  const [threadFindOpen, setThreadFindOpen] = useState(false);
  const [findIndex, setFindIndex] = useState(0);
  const [hidingId, setHidingId] = useState<string | null>(null);
  /** Hide times (Graph hide + portal soft-dismiss); persisted so meeting dismiss survives refresh. */
  const hiddenAtRef = useRef<Map<string, number>>(loadDismissedChats(salesUser.id));

  const threadEndRef = useRef<HTMLDivElement | null>(null);
  const findHitRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const chatsSeededRef = useRef(false);
  const messageSeededForRef = useRef<string | null>(null);
  const lastListSearchAuditRef = useRef('');
  const lastThreadSearchAuditRef = useRef('');

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Microsoft status');
    }
  }, []);

  const loadChats = useCallback(
    async (opts: { audit?: boolean } = {}) => {
      if (!status?.connected || !status.configured) {
        setChats([]);
        return;
      }
      if (!status.capabilities?.chat) {
        setChats([]);
        return;
      }
      setChatsLoading(true);
      if (opts.audit !== false) setError(null);
      try {
        const res = await fetchTeamsChats({ audit: opts.audit !== false });
        const hiddenAt = hiddenAtRef.current;
        const visible = res.chats.filter((c) => {
          const hidAt = hiddenAt.get(c.id);
          if (hidAt == null) return true;
          const msgAt = Date.parse(c.last_message?.created_at ?? '') || 0;
          // Graph unhid (new activity after our hide) — show again.
          if (msgAt > hidAt) {
            clearDismissedChat(salesUser.id, hiddenAt, c.id);
            return true;
          }
          return false;
        });
        setChats(visible);
        setMeId(res.me_id);
        if (getNotificationPermission() === 'granted') {
          evaluateChatDesktopAlerts({
            chats: visible,
            meId: res.me_id,
            user: salesUser,
            seedOnly: !chatsSeededRef.current,
          });
          chatsSeededRef.current = true;
        }
      } catch (err) {
        if (opts.audit !== false) {
          setError(err instanceof Error ? err.message : 'Failed to load chats');
        }
      } finally {
        setChatsLoading(false);
      }
    },
    [status?.connected, status?.configured, status?.capabilities?.chat, salesUser],
  );

  const loadMessages = useCallback(
    async (chatId: string, opts: { audit?: boolean; silent?: boolean } = {}) => {
      if (!opts.silent) setMessagesLoading(true);
      if (opts.audit !== false && !opts.silent) setError(null);
      try {
        const res = await fetchTeamsChatMessages(chatId, {
          audit: opts.audit !== false,
        });
        if (selectedIdRef.current === chatId) {
          setMessages(res.messages);
          if (res.me_id) setMeId(res.me_id);
          if (getNotificationPermission() === 'granted') {
            const seedOnly = messageSeededForRef.current !== chatId;
            evaluateChatMessageDesktopAlerts({
              chatId,
              chatTitle: chatsRef.current.find((c) => c.id === chatId)?.title,
              messages: res.messages,
              meId: res.me_id,
              user: salesUser,
              seedOnly,
            });
            messageSeededForRef.current = chatId;
          }
        }
      } catch (err) {
        if (!opts.silent) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
        }
      } finally {
        if (!opts.silent) setMessagesLoading(false);
      }
    },
    [salesUser],
  );

  useEffect(() => {
    void (async () => {
      setLoading(true);
      await loadStatus();
      setLoading(false);
    })();
  }, [loadStatus]);

  useEffect(() => {
    const connected = searchParams.get('calendar_connected');
    const err = searchParams.get('calendar_error');
    const chatParam = searchParams.get('chat');
    if (connected === '1') {
      setNotice('Microsoft account connected. Teams chat is ready.');
      setSearchParams({}, { replace: true });
      void loadStatus();
    } else if (err) {
      setError(decodeURIComponent(err));
      setSearchParams({}, { replace: true });
    } else if (chatParam) {
      setSelectedId(chatParam);
    }
  }, [searchParams, setSearchParams, loadStatus]);

  useEffect(() => {
    try {
      if (selectedId) sessionStorage.setItem(ACTIVE_CHAT_STORAGE_KEY, selectedId);
      else sessionStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    return () => {
      try {
        sessionStorage.removeItem(ACTIVE_CHAT_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    };
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      messageSeededForRef.current = null;
      setThreadFind('');
      setThreadFindOpen(false);
      setFindIndex(0);
    }
  }, [selectedId]);

  useEffect(() => {
    if (status?.connected && status.capabilities?.chat) {
      void loadChats({ audit: true });
    }
  }, [status?.connected, status?.capabilities?.chat, loadChats]);

  useEffect(() => {
    if (!selectedId || !status?.capabilities?.chat) {
      setMessages([]);
      return;
    }
    void loadMessages(selectedId, { audit: true });
  }, [selectedId, status?.capabilities?.chat, loadMessages]);

  // Soft-refresh poll
  useEffect(() => {
    if (!status?.connected || !status.capabilities?.chat) return;
    const id = window.setInterval(() => {
      void loadChats({ audit: false });
      const chatId = selectedIdRef.current;
      if (chatId) void loadMessages(chatId, { audit: false, silent: true });
    }, POLL_MS);
    return () => window.clearInterval(id);
  }, [status?.connected, status?.capabilities?.chat, loadChats, loadMessages]);

  useEffect(() => {
    if (threadFind.trim()) return;
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, threadFind]);

  useEffect(() => {
    if (!threadFind.trim()) return;
    findHitRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [findIndex, threadFind, messages]);

  // Debounced audit for conversation list filter (client-side; no Graph round-trip).
  useEffect(() => {
    const q = listQuery.trim();
    if (q.length < 2) {
      lastListSearchAuditRef.current = '';
      return;
    }
    const t = window.setTimeout(() => {
      if (lastListSearchAuditRef.current === q) return;
      lastListSearchAuditRef.current = q;
      const matchCount = chatsRef.current.filter((c) => chatMatchesListQuery(c, q)).length;
      void logAuditEvent({
        eventType: 'chat_search',
        path: '/sales/chat',
        user: salesUser,
        metadata: {
          scope: 'list_filter',
          query: q.slice(0, 80),
          match_count: matchCount,
        },
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [listQuery, salesUser]);

  // Debounced audit for in-thread keyword find.
  useEffect(() => {
    const q = threadFind.trim();
    if (q.length < 2) {
      lastThreadSearchAuditRef.current = '';
      return;
    }
    const chatId = selectedIdRef.current;
    const t = window.setTimeout(() => {
      const key = `${chatId ?? ''}:${q}`;
      if (lastThreadSearchAuditRef.current === key) return;
      lastThreadSearchAuditRef.current = key;
      const matchCount = messagesRef.current.filter((m) => messageMatchesFind(m, q)).length;
      void logAuditEvent({
        eventType: 'chat_search',
        path: '/sales/chat',
        user: salesUser,
        metadata: {
          scope: 'thread_keyword',
          chat_id: chatId,
          query: q.slice(0, 80),
          match_count: matchCount,
        },
      });
    }, 700);
    return () => window.clearTimeout(t);
  }, [threadFind, salesUser]);

  useEffect(() => {
    const q = pickerQuery.trim();
    if (q.length < 2 || !newOpen) {
      setPickerResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        setPickerLoading(true);
        try {
          const people = await searchMeetingPeople(q, 8);
          if (!cancelled) setPickerResults(people);
        } catch {
          if (!cancelled) setPickerResults([]);
        } finally {
          if (!cancelled) setPickerLoading(false);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pickerQuery, newOpen]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/chat');
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'OAuth start failed');
    }
  }

  async function onEnableAlerts() {
    const result = await requestNotificationPermission(salesUser, '/sales/chat');
    setNotifPerm(result);
    if (result === 'granted') {
      setNotice(
        'Desktop alerts enabled. New Teams messages notify while this portal tab stays open.',
      );
      // Seed current last-messages so enabling does not dump a backlog.
      if (chats.length) {
        evaluateChatDesktopAlerts({
          chats,
          meId,
          user: salesUser,
          seedOnly: true,
        });
        chatsSeededRef.current = true;
      }
      if (selectedId && messages.length) {
        evaluateChatMessageDesktopAlerts({
          chatId: selectedId,
          chatTitle: chats.find((c) => c.id === selectedId)?.title,
          messages,
          meId,
          user: salesUser,
          seedOnly: true,
        });
        messageSeededForRef.current = selectedId;
      }
    } else if (result === 'denied') {
      setError('Desktop notifications were blocked. Enable them in browser site settings.');
    }
  }

  async function onSaveWorkEmail(e: FormEvent) {
    e.preventDefault();
    setSavingEmail(true);
    setError(null);
    try {
      await setMyWorkEmail(workEmailDraft.trim() || null);
      setNotice('Work email saved.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save work email');
    } finally {
      setSavingEmail(false);
    }
  }

  async function onSend(e: FormEvent) {
    e.preventDefault();
    if (!selectedId || !compose.trim()) return;
    setSending(true);
    setError(null);
    try {
      const msg = await sendTeamsChatMessage(selectedId, compose.trim());
      setMessages((prev) => [...prev, msg]);
      setCompose('');
      void loadChats({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send message');
    } finally {
      setSending(false);
    }
  }

  function addPerson(p: PeopleSuggestion) {
    setSelectedPeople((prev) => {
      if (prev.some((x) => x.email === p.email)) return prev;
      if (newMode === 'oneOnOne') return [p];
      return [...prev, p];
    });
    setPickerQuery('');
    setPickerResults([]);
  }

  function removePerson(email: string) {
    setSelectedPeople((prev) => prev.filter((p) => p.email !== email));
  }

  async function onCreateChat(e: FormEvent) {
    e.preventDefault();
    if (!selectedPeople.length) {
      setError('Pick at least one person from the org directory.');
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const members = selectedPeople.map((p) => p.email);
      const chat = await createTeamsChat(
        newMode === 'group'
          ? { chat_type: 'group', members, topic: groupTopic.trim() || undefined }
          : { chat_type: 'oneOnOne', member: members[0] },
      );
      clearDismissedChat(salesUser.id, hiddenAtRef.current, chat.id);
      setNewOpen(false);
      setSelectedPeople([]);
      setGroupTopic('');
      setPickerQuery('');
      await loadChats({ audit: false });
      setSelectedId(chat.id);
      setNotice(newMode === 'group' ? 'Group chat started.' : 'Chat started.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start chat');
    } finally {
      setCreating(false);
    }
  }

  async function onRemoveChat(chatId: string) {
    const target = chats.find((c) => c.id === chatId);
    const label = target?.title || 'this chat';
    const meeting =
      target?.chat_type === 'meeting' || isMeetingChatId(chatId);
    if (
      !window.confirm(
        meeting
          ? `Remove “${label}” from this portal list?\n\nMeeting chats can’t be removed from Teams the same way as 1:1 chats. This only hides it here; it stays in Microsoft Teams.`
          : `Remove “${label}” from your chat list?\n\nThis matches Teams “Remove from list” — it hides the chat for you only. It does not delete the conversation for others. Sending a message later can bring it back.`,
      )
    ) {
      return;
    }
    setHidingId(chatId);
    setError(null);
    try {
      const result = await hideTeamsChat(chatId);
      const at = Date.now();
      persistDismissedChat(salesUser.id, hiddenAtRef.current, chatId, at);
      setChats((prev) => prev.filter((c) => c.id !== chatId));
      if (selectedIdRef.current === chatId) {
        setSelectedId(null);
        setMessages([]);
      }
      if (result.mode === 'ui_dismiss') {
        const teamsUrl = target?.web_url?.trim();
        setNotice(
          teamsUrl
            ? 'Removed from this portal list. Meeting chats can’t be removed from Teams the same way as 1:1 — use Open in Teams to manage.'
            : 'Removed from this portal list. Meeting chats can’t be removed from Teams the same way as 1:1.',
        );
      } else {
        setNotice('Chat removed from your list.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove chat');
    } finally {
      setHidingId(null);
    }
  }

  const selected = chats.find((c) => c.id === selectedId) ?? null;
  const canChat = Boolean(status?.capabilities?.chat);
  const filteredChats = listQuery.trim()
    ? chats.filter((c) => chatMatchesListQuery(c, listQuery))
    : chats;
  const findHits = threadFind.trim()
    ? messages.filter((m) => messageMatchesFind(m, threadFind))
    : [];
  const safeFindIndex = findHits.length ? Math.min(findIndex, findHits.length - 1) : 0;
  const activeFindId = findHits.length ? findHits[safeFindIndex]?.id : null;

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Teams chat</h1>
          <p className="muted">
            Microsoft Teams 1:1 and group chats
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}.
          </p>
        </div>
        <div className="page-actions">
          {status?.connected && canChat ? (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setNewOpen(true);
                  setNewMode('oneOnOne');
                  setSelectedPeople([]);
                  setGroupTopic('');
                  setPickerQuery('');
                }}
              >
                New chat
              </button>
              <Link to="/sales/meetings" className="btn ghost">
                Open Teams Meetings
              </Link>
              <button
                type="button"
                className="btn ghost"
                onClick={() => {
                  void loadChats({ audit: true });
                  if (selectedId) void loadMessages(selectedId, { audit: false, silent: true });
                }}
                disabled={chatsLoading || messagesLoading}
              >
                Refresh
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting || status?.configured === false}
            >
              {connecting ? 'Redirecting…' : status?.connected ? 'Reconnect' : 'Connect Microsoft'}
            </button>
          )}
          <button
            type="button"
            className="btn ghost app-side-toggle"
            aria-expanded={sideOpen}
            onClick={() => setSideOpen((o) => !o)}
          >
            {sideOpen ? 'Hide settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {status?.needs_scope_upgrade || (status?.connected && !canChat) ? (
        <div className="banner warn">
          Your Microsoft connection is missing newer permissions (Teams chat / directory /
          online meetings). An admin must grant consent in Azure, then you must click{' '}
          <strong>Reconnect</strong> (admin consent alone does not refresh your token).
          {status?.connected ? (
            <>
              {' '}
              <button type="button" className="btn ghost" onClick={() => void onConnect()} disabled={connecting}>
                Reconnect
              </button>
            </>
          ) : null}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="detail-grid chat-layout">
          <div className="panel chat-main app-main">
            {!status ? (
              <div className="empty">
                <p className="muted">Status unavailable. Retry or check the error above.</p>
              </div>
            ) : !status.configured ? (
              <div className="empty">
                <p>Microsoft Graph is not configured yet.</p>
                <p className="muted">
                  An admin needs to register an Azure app and set edge secrets — see{' '}
                  <code>SETUP_CALENDAR.md</code>.
                </p>
              </div>
            ) : !status.connected ? (
              <div className="empty">
                <p>Connect your Tage work mailbox to use Teams chat here.</p>
                <p className="muted">
                  Uses the same Microsoft connection as Calendar / To Do / Planner. Requires a Teams
                  license.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Connect Microsoft'}
                </button>
              </div>
            ) : !canChat ? (
              <div className="empty">
                <p>Chat scopes are not on your token yet.</p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Reconnect'}
                </button>
              </div>
            ) : (
              <div className={`chat-shell${selectedId ? ' has-selection' : ''}`}>
                <aside className="chat-list">
                  <div className="panel-head">
                    <h2>Conversations</h2>
                    {chatsLoading ? <span className="muted small">Syncing…</span> : null}
                  </div>
                  <div className="chat-list-search">
                    <input
                      type="search"
                      value={listQuery}
                      onChange={(e) => setListQuery(e.target.value)}
                      placeholder="Filter by name or topic…"
                      aria-label="Filter conversations"
                      autoComplete="off"
                    />
                  </div>
                  {chats.length === 0 ? (
                    <p className="muted small chat-list-empty">
                      No chats yet. Start a 1:1 or group chat with someone in the org.
                    </p>
                  ) : filteredChats.length === 0 ? (
                    <p className="muted small chat-list-empty">
                      No conversations match “{listQuery.trim()}”.
                    </p>
                  ) : (
                    <ul className="chat-conv-list">
                      {filteredChats.map((c) => (
                        <li key={c.id} className="chat-conv-row">
                          <button
                            type="button"
                            className={
                              selectedId === c.id ? 'chat-conv-item active' : 'chat-conv-item'
                            }
                            onClick={() => setSelectedId(c.id)}
                          >
                            <span className="chat-conv-title">{c.title}</span>
                            <span className="chat-conv-meta">
                              {chatTypeLabel(c.chat_type)}
                              {c.last_message?.created_at
                                ? ` · ${formatMsgTime(c.last_message.created_at)}`
                                : ''}
                            </span>
                            {c.last_message?.preview ? (
                              <span className="chat-conv-preview">{c.last_message.preview}</span>
                            ) : null}
                          </button>
                          <button
                            type="button"
                            className="btn ghost chat-conv-remove"
                            title="Remove from list"
                            aria-label={`Remove ${c.title} from list`}
                            disabled={hidingId === c.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              void onRemoveChat(c.id);
                            }}
                          >
                            {hidingId === c.id ? '…' : '×'}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </aside>

                <section className="chat-thread">
                  {!selectedId || !selected ? (
                    <div className="empty chat-thread-empty">
                      <p>Select a conversation or start a new chat.</p>
                    </div>
                  ) : (
                    <>
                      <div className="panel-head chat-thread-head">
                        <div>
                          <h2>{selected.title}</h2>
                          <p className="muted small">
                            {chatTypeLabel(selected.chat_type)} chat
                            {selected.web_url ? (
                              <>
                                {' · '}
                                <a href={selected.web_url} target="_blank" rel="noreferrer">
                                  Open in Teams
                                </a>
                              </>
                            ) : null}
                          </p>
                        </div>
                        <div className="page-actions">
                          <button
                            type="button"
                            className="btn ghost"
                            aria-expanded={threadFindOpen}
                            onClick={() => {
                              setThreadFindOpen((o) => !o);
                              if (threadFindOpen) {
                                setThreadFind('');
                                setFindIndex(0);
                              }
                            }}
                          >
                            Find
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => void onRemoveChat(selected.id)}
                            disabled={hidingId === selected.id}
                            title="Remove from your list"
                          >
                            {hidingId === selected.id ? 'Removing…' : 'Remove'}
                          </button>
                          <button
                            type="button"
                            className="btn ghost chat-back"
                            onClick={() => setSelectedId(null)}
                          >
                            ← Chats
                          </button>
                        </div>
                      </div>
                      {threadFindOpen ? (
                        <div className="chat-thread-find">
                          <input
                            type="search"
                            value={threadFind}
                            onChange={(e) => {
                              setThreadFind(e.target.value);
                              setFindIndex(0);
                            }}
                            placeholder="Find in this thread…"
                            aria-label="Find in this thread"
                            autoComplete="off"
                          />
                          <span className="muted small chat-find-count">
                            {threadFind.trim()
                              ? findHits.length
                                ? `${safeFindIndex + 1} / ${findHits.length}`
                                : '0 matches'
                              : 'Loaded messages only'}
                          </span>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={!findHits.length}
                            onClick={() =>
                              setFindIndex((i) =>
                                findHits.length ? (i - 1 + findHits.length) % findHits.length : 0,
                              )
                            }
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn ghost"
                            disabled={!findHits.length}
                            onClick={() =>
                              setFindIndex((i) =>
                                findHits.length ? (i + 1) % findHits.length : 0,
                              )
                            }
                          >
                            ↓
                          </button>
                        </div>
                      ) : null}
                      <div className="chat-messages">
                        {messagesLoading ? (
                          <p className="muted small">Loading messages…</p>
                        ) : messages.length === 0 ? (
                          <p className="muted small">No messages yet. Say hello.</p>
                        ) : (
                          messages
                            .filter((m) => m.message_type !== 'systemEventMessage')
                            .map((m) => {
                              const mine =
                                Boolean(meId && m.from_id && m.from_id === meId) ||
                                (!m.from_name && Boolean(m.from_id === meId));
                              const isHit = Boolean(activeFindId && m.id === activeFindId);
                              const showHighlight = Boolean(
                                threadFind.trim() && messageMatchesFind(m, threadFind),
                              );
                              return (
                                <div
                                  key={m.id}
                                  ref={isHit ? findHitRef : undefined}
                                  className={
                                    mine
                                      ? `chat-bubble mine${isHit ? ' chat-bubble-find' : ''}`
                                      : `chat-bubble${isHit ? ' chat-bubble-find' : ''}`
                                  }
                                >
                                  {!mine && m.from_name ? (
                                    <div className="chat-bubble-from">
                                      {showHighlight
                                        ? highlightMatch(m.from_name, threadFind)
                                        : m.from_name}
                                    </div>
                                  ) : null}
                                  <div className="chat-bubble-body">
                                    {showHighlight
                                      ? highlightMatch(m.body || '(empty)', threadFind)
                                      : m.body || '(empty)'}
                                  </div>
                                  <div className="chat-bubble-time">
                                    {formatMsgTime(m.created_at)}
                                  </div>
                                </div>
                              );
                            })
                        )}
                        <div ref={threadEndRef} />
                      </div>
                      <form className="chat-compose" onSubmit={(e) => void onSend(e)}>
                        <input
                          type="text"
                          value={compose}
                          onChange={(e) => setCompose(e.target.value)}
                          placeholder="Type a message…"
                          disabled={sending}
                          autoComplete="off"
                        />
                        <button
                          type="submit"
                          className="btn primary"
                          disabled={sending || !compose.trim()}
                        >
                          {sending ? 'Sending…' : 'Send'}
                        </button>
                      </form>
                    </>
                  )}
                </section>
              </div>
            )}
          </div>

          <aside className={`panel app-side${sideOpen ? ' open' : ''}`}>
            <div className="panel-head">
              <h2>Connection</h2>
            </div>
            <dl className="cal-meta">
              <div>
                <dt>Portal login</dt>
                <dd>{salesUser.email}</dd>
              </div>
              <div>
                <dt>Microsoft</dt>
                <dd>{status?.microsoft_email ?? 'Not connected'}</dd>
              </div>
              <div>
                <dt>Connected</dt>
                <dd>
                  {status?.connected_at
                    ? formatDateTime(status.connected_at)
                    : '—'}
                </dd>
              </div>
              <div>
                <dt>Chat capability</dt>
                <dd>{canChat ? 'Yes' : 'No — reconnect after Azure consent'}</dd>
              </div>
            </dl>

            <div className="cal-alerts-block" style={{ marginTop: '1rem' }}>
              <h3>Video meetings</h3>
              <p className="muted small">
                Start, schedule, and join on the{' '}
                <Link to="/sales/meetings">Teams Meetings</Link> page.
              </p>
            </div>

            {status?.configured ? (
              <form className="stack-form" onSubmit={(e) => void onSaveWorkEmail(e)}>
                <label>
                  Work email (login hint)
                  <input
                    type="email"
                    value={workEmailDraft}
                    onChange={(e) => setWorkEmailDraft(e.target.value)}
                    placeholder="you@tagevc.com"
                  />
                </label>
                <button type="submit" className="btn ghost" disabled={savingEmail}>
                  {savingEmail ? 'Saving…' : 'Save work email'}
                </button>
              </form>
            ) : null}

            {status?.connected ? (
              <p className="muted small" style={{ marginTop: '1rem' }}>
                Same OAuth connection as Calendar. After Azure adds chat scopes, use{' '}
                <button type="button" className="btn ghost" onClick={() => void onConnect()} disabled={connecting}>
                  Reconnect
                </button>
                .
              </p>
            ) : null}

            <div className="cal-alerts-block" style={{ marginTop: '1.25rem' }}>
              <h3>Desktop alerts</h3>
              <p className="muted small">
                New incoming Teams messages (not ones you send) while any portal page stays open.
                Same browser permission as Calendar alerts.
              </p>
              {notifPerm === 'unsupported' ? (
                <p className="muted small">This browser does not support notifications.</p>
              ) : notifPerm === 'granted' ? (
                <p className="muted small">Alerts enabled.</p>
              ) : (
                <button type="button" className="btn ghost" onClick={() => void onEnableAlerts()}>
                  Enable desktop alerts
                </button>
              )}
            </div>

            <div className="cal-alerts-block" style={{ marginTop: '1.25rem' }}>
              <h3>Limits (v1)</h3>
              <ul className="muted small" style={{ margin: '0.5rem 0 0', paddingLeft: '1.1rem' }}>
                <li>Requires Microsoft Teams licenses for participants</li>
                <li>Video meetings: use the Teams Meetings page</li>
                <li>Admin consent + Reconnect required for new scopes</li>
                <li>Messages soft-refresh ~every 20s (not realtime)</li>
                <li>Desktop alerts need an open portal tab (no push when closed)</li>
                <li>
                  Remove from list: Graph hideForUser for 1:1/group; meeting chats soft-hide in
                  the portal only (Graph often 404s)
                </li>
                <li>Find searches loaded thread messages (up to ~50); list filter is local</li>
              </ul>
            </div>
          </aside>
        </div>
      )}

      {newOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setNewOpen(false)}>
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="new-chat-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="new-chat-title">New chat</h2>
              <button type="button" className="btn ghost" onClick={() => setNewOpen(false)}>
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={(e) => void onCreateChat(e)}>
              <div className="seg">
                <button
                  type="button"
                  className={newMode === 'oneOnOne' ? 'active' : ''}
                  onClick={() => {
                    setNewMode('oneOnOne');
                    setSelectedPeople((p) => (p[0] ? [p[0]] : []));
                  }}
                >
                  1:1
                </button>
                <button
                  type="button"
                  className={newMode === 'group' ? 'active' : ''}
                  onClick={() => setNewMode('group')}
                >
                  Group
                </button>
              </div>

              {newMode === 'group' ? (
                <label>
                  Topic (optional)
                  <input
                    type="text"
                    value={groupTopic}
                    onChange={(e) => setGroupTopic(e.target.value)}
                    placeholder="Project sync"
                  />
                </label>
              ) : null}

              <label>
                Find people
                <input
                  type="search"
                  value={pickerQuery}
                  onChange={(e) => setPickerQuery(e.target.value)}
                  placeholder="Name or email…"
                  autoComplete="off"
                />
              </label>
              {pickerLoading ? <p className="muted small">Searching…</p> : null}
              {pickerResults.length > 0 ? (
                <ul className="chat-people-results">
                  {pickerResults.map((p) => (
                    <li key={p.email}>
                      <button type="button" onClick={() => addPerson(p)}>
                        <span>{p.display_name || p.email}</span>
                        <span className="muted small">{p.email}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              {selectedPeople.length > 0 ? (
                <div className="chat-people-chips">
                  {selectedPeople.map((p) => (
                    <button
                      key={p.email}
                      type="button"
                      className="chat-chip"
                      onClick={() => removePerson(p.email)}
                      title="Remove"
                    >
                      {p.display_name || p.email} ×
                    </button>
                  ))}
                </div>
              ) : (
                <p className="muted small">Pick someone from the org directory (People.Read).</p>
              )}

              <div className="page-actions">
                <button
                  type="submit"
                  className="btn primary"
                  disabled={creating || selectedPeople.length === 0}
                >
                  {creating ? 'Starting…' : 'Start chat'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
