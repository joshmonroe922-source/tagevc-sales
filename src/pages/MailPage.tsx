import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  archiveMail,
  createMailFolderApi,
  deleteMail,
  ensureMailDocumentVault,
  fetchCalendarStatus,
  fetchMailFolders,
  fetchMailMessage,
  fetchMailMessages,
  forwardMail,
  MAIL_ATTACHMENT_MAX_BYTES,
  MAIL_ATTACHMENT_MAX_COUNT,
  MAIL_ATTACHMENT_MAX_TOTAL_BYTES,
  MailExternalConfirmError,
  markMailRead,
  moveMail,
  renameMailFolderApi,
  replyMail,
  saveMailAttachmentToVault,
  searchMail,
  searchMeetingPeople,
  sendMail,
  setMyWorkEmail,
  startCalendarOAuth,
  fetchMailboxSettings,
  fetchMailSendAsAddresses,
  updateMailboxAutomaticReplies,
  type CalendarStatus,
  type MailAttachmentMeta,
  type MailFolder,
  type MailMessageDetail,
  type MailMessageSummary,
  type MailOutboundAttachment,
  type MailSendAsAddress,
  type MailboxSettingsPayload,
  type PeopleSuggestion,
} from '../lib/calendarApi';
import { MailSignaturesPanel } from '../components/MailSignaturesPanel';
import { MailThreadView } from '../components/MailThreadView';
import { MailAttachmentPreviewModal } from '../components/MailAttachmentPreviewModal';
import {
  ACTIVE_MAIL_STORAGE_KEY,
  getNotificationPermission,
  requestNotificationPermission,
  type NotificationPermissionState,
} from '../lib/desktopAlerts';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

type ComposeMode = 'new' | 'reply' | 'reply_all' | 'forward' | null;

type ComposeFile = MailOutboundAttachment & { local_id: string; size: number };

type FolderRow = MailFolder & { depth: number; has_children: boolean };

const WELL_KNOWN_SORT: Record<string, number> = {
  inbox: 0,
  draft: 1,
  drafts: 1,
  sentitems: 2,
  archive: 3,
  deleteditems: 4,
};

function folderSortKey(f: MailFolder): [number, string] {
  const wk = f.well_known ? (WELL_KNOWN_SORT[f.well_known] ?? 50) : 90;
  return [wk, f.display_name.toLowerCase()];
}

function buildFolderChildMap(folders: MailFolder[]): Map<string | null, MailFolder[]> {
  const ids = new Set(folders.map((f) => f.id));
  const map = new Map<string | null, MailFolder[]>();
  for (const f of folders) {
    const parent =
      f.parent_folder_id && ids.has(f.parent_folder_id) ? f.parent_folder_id : null;
    const list = map.get(parent) ?? [];
    list.push(f);
    map.set(parent, list);
  }
  for (const [, list] of map) {
    list.sort((a, b) => {
      const [ao, an] = folderSortKey(a);
      const [bo, bn] = folderSortKey(b);
      return ao - bo || an.localeCompare(bn);
    });
  }
  return map;
}

function flattenFolderTree(
  folders: MailFolder[],
  expanded: Set<string>,
): FolderRow[] {
  const childMap = buildFolderChildMap(folders);
  const rows: FolderRow[] = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const f of childMap.get(parentId) ?? []) {
      const kids = childMap.get(f.id) ?? [];
      const hasChildren = kids.length > 0 || (f.child_folder_count ?? 0) > 0;
      rows.push({
        ...f,
        parent_folder_id: f.parent_folder_id ?? null,
        child_folder_count: f.child_folder_count ?? kids.length,
        depth,
        has_children: hasChildren,
      });
      if (hasChildren && expanded.has(f.id)) walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return rows;
}

function ancestorFolderIds(folders: MailFolder[], folderId: string | null): string[] {
  if (!folderId) return [];
  const byId = new Map(folders.map((f) => [f.id, f]));
  const out: string[] = [];
  let cur = byId.get(folderId);
  while (cur?.parent_folder_id && byId.has(cur.parent_folder_id)) {
    out.push(cur.parent_folder_id);
    cur = byId.get(cur.parent_folder_id);
  }
  return out;
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
}

function recipientLabel(r: { name: string | null; email: string | null }): string {
  return r.name?.trim() || r.email?.trim() || 'Unknown';
}

function parseAddressList(raw: string): string[] {
  return raw
    .split(/[,;\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.includes('@'));
}

function textToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p>${escaped.replace(/\n/g, '<br/>')}</p>`;
}

function readFileAsAttachment(file: File): Promise<ComposeFile> {
  return new Promise((resolve, reject) => {
    if (file.size > MAIL_ATTACHMENT_MAX_BYTES) {
      reject(
        new Error(
          `"${file.name}" is ${formatFileSize(file.size)}. Max ${formatFileSize(MAIL_ATTACHMENT_MAX_BYTES)} per file (Graph limit).`,
        ),
      );
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read "${file.name}"`));
    reader.onload = () => {
      const result = String(reader.result ?? '');
      const comma = result.indexOf(',');
      const content_base64 = comma >= 0 ? result.slice(comma + 1) : result;
      if (!content_base64) {
        reject(new Error(`Attachment "${file.name}" is empty.`));
        return;
      }
      resolve({
        local_id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name || 'attachment',
        content_type: file.type || 'application/octet-stream',
        content_base64,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

export function MailPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);

  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [orgDomains, setOrgDomains] = useState<string[]>(['tagevc.com']);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MailMessageSummary[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MailMessageDetail | null>(null);
  const [thread, setThread] = useState<MailMessageDetail[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const [searchQ, setSearchQ] = useState('');
  const [searchActive, setSearchActive] = useState(false);
  const [searchInFolder, setSearchInFolder] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(() => new Set());
  const [selectedMsgIds, setSelectedMsgIds] = useState<Set<string>>(() => new Set());
  const [moveTargetId, setMoveTargetId] = useState('');
  const [newFolderName, setNewFolderName] = useState('');
  const [folderBusy, setFolderBusy] = useState(false);

  const [composeMode, setComposeMode] = useState<ComposeMode>(null);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState('');
  const [sendAsAddresses, setSendAsAddresses] = useState<MailSendAsAddress[]>([]);
  const [allowExternal, setAllowExternal] = useState(false);
  const [externalWarn, setExternalWarn] = useState<string[] | null>(null);
  const [pickerQuery, setPickerQuery] = useState('');
  const [pickerResults, setPickerResults] = useState<PeopleSuggestion[]>([]);
  const [pickerField, setPickerField] = useState<'to' | 'cc'>('to');

  const [viewerAttachment, setViewerAttachment] = useState<{
    messageId: string;
    attachment: MailAttachmentMeta;
  } | null>(null);
  const [attachmentBusy, setAttachmentBusy] = useState(false);
  const [composeAttachments, setComposeAttachments] = useState<ComposeFile[]>([]);
  const [attachBusy, setAttachBusy] = useState(false);
  const attachInputRef = useRef<HTMLInputElement | null>(null);

  const [notifPerm, setNotifPerm] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const [sigDraft, setSigDraft] = useState(salesUser.mail_signature_html ?? '');
  const [sigEnabled, setSigEnabled] = useState(salesUser.mail_signature_enabled !== false);
  const [mailboxPayload, setMailboxPayload] = useState<MailboxSettingsPayload | null>(null);
  const [mailboxLoading, setMailboxLoading] = useState(false);
  const [oooStatus, setOooStatus] = useState<'disabled' | 'alwaysEnabled' | 'scheduled'>(
    'disabled',
  );
  const [oooInternal, setOooInternal] = useState('');
  const [oooExternal, setOooExternal] = useState('');
  const [oooAudience, setOooAudience] = useState<'none' | 'contactsOnly' | 'all'>('all');
  const [oooStart, setOooStart] = useState('');
  const [oooEnd, setOooEnd] = useState('');
  const [savingOoo, setSavingOoo] = useState(false);

  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

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

  const loadFolders = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.mail) {
      setFolders([]);
      return;
    }
    try {
      const res = await fetchMailFolders();
      const normalized = res.folders.map((f) => ({
        ...f,
        parent_folder_id: f.parent_folder_id ?? null,
        child_folder_count: f.child_folder_count ?? 0,
      }));
      setFolders(normalized);
      setOrgDomains(res.org_domains?.length ? res.org_domains : ['tagevc.com']);
      let nextFolderId = folderId;
      if (!nextFolderId && normalized.length) {
        const inbox = normalized.find((f) => f.well_known === 'inbox') ?? normalized[0];
        nextFolderId = inbox.id;
        setFolderId(inbox.id);
      }
      setExpandedFolders((prev) => {
        const next = new Set(prev);
        for (const id of ancestorFolderIds(normalized, nextFolderId)) next.add(id);
        // Expand first-level parents that have children so custom trees are discoverable
        const childMap = buildFolderChildMap(normalized);
        for (const root of childMap.get(null) ?? []) {
          if ((childMap.get(root.id) ?? []).length) next.add(root.id);
        }
        return next;
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load folders');
    }
  }, [status, folderId]);

  const folderRows = useMemo(
    () => flattenFolderTree(folders, expandedFolders),
    [folders, expandedFolders],
  );

  const selectedFolder = useMemo(
    () => folders.find((f) => f.id === folderId) ?? null,
    [folders, folderId],
  );

  const loadSendAs = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.mail) {
      setSendAsAddresses([]);
      return;
    }
    try {
      const res = await fetchMailSendAsAddresses();
      setSendAsAddresses(res.addresses);
      if (res.org_domains?.length) {
        setOrgDomains((prev) => [...new Set([...prev, ...res.org_domains])]);
      }
      const primary =
        res.primary ??
        res.addresses.find((a) => a.is_primary)?.address ??
        res.addresses[0]?.address ??
        status.microsoft_email ??
        '';
      setComposeFrom((prev) => prev || primary);
    } catch {
      /* From picker optional — mailbox default still works */
      const fallback = status.microsoft_email?.trim().toLowerCase() ?? '';
      if (fallback) {
        setSendAsAddresses([{ address: fallback, is_primary: true }]);
        setComposeFrom((prev) => prev || fallback);
      }
    }
  }, [status]);

  const loadMessages = useCallback(
    async (opts: { audit?: boolean } = {}) => {
      if (!status?.connected || !status.capabilities?.mail) {
        setMessages([]);
        return;
      }
      if (searchActive && searchQ.trim().length >= 2) return;
      if (!folderId) return;
      setMessagesLoading(true);
      if (opts.audit !== false) setError(null);
      try {
        const res = await fetchMailMessages({
          folder_id: folderId,
          audit: opts.audit !== false,
        });
        setMessages(res.messages);
      } catch (err) {
        if (opts.audit !== false) {
          setError(err instanceof Error ? err.message : 'Failed to load messages');
        }
      } finally {
        setMessagesLoading(false);
      }
    },
    [status, folderId, searchActive, searchQ],
  );

  const focusThreadMessage = useCallback(
    (id: string, opts: { scroll?: boolean } = {}) => {
      setSelectedId(id);
      setThread((prev) => {
        const found = prev.find((m) => m.id === id);
        if (found) setDetail(found);
        return prev;
      });
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('msg', id);
        return next;
      });
      try {
        sessionStorage.setItem(ACTIVE_MAIL_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      if (opts.scroll !== false) {
        requestAnimationFrame(() => {
          document
            .getElementById(`mail-thread-msg-${id}`)
            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
    },
    [setSearchParams],
  );

  const openMessage = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetailLoading(true);
    setError(null);
    setViewerAttachment(null);
    try {
      const res = await fetchMailMessage(id);
      const fullThread = res.thread.length > 0 ? res.thread : [res.message];
      // Prefer the exact opened message body from `message` (already hydrated).
      let threadWithOpen = fullThread.map((m) =>
        m.id === res.message.id ? res.message : m,
      );
      if (!threadWithOpen.some((m) => m.id === res.message.id)) {
        threadWithOpen = [...threadWithOpen, res.message].sort((a, b) => {
          const ta = a.received_at ? Date.parse(a.received_at) : 0;
          const tb = b.received_at ? Date.parse(b.received_at) : 0;
          return ta - tb;
        });
      }
      setThread(threadWithOpen);
      setDetail(res.message);
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, is_read: true } : m)),
      );
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.set('msg', id);
        return next;
      });
      try {
        sessionStorage.setItem(ACTIVE_MAIL_STORAGE_KEY, id);
      } catch {
        /* ignore */
      }
      requestAnimationFrame(() => {
        document
          .getElementById(`mail-thread-msg-${id}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open message');
    } finally {
      setDetailLoading(false);
    }
  }, [setSearchParams]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoading(true);
      await loadStatus();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loadStatus]);

  useEffect(() => {
    if (status?.connected && status.capabilities?.mail) {
      void loadFolders();
      void loadSendAs();
      void ensureMailDocumentVault().catch((err) => console.warn('mail vault', err));
    }
  }, [status, loadFolders, loadSendAs]);

  useEffect(() => {
    if (folderId && status?.connected && status.capabilities?.mail) {
      void loadMessages();
    }
  }, [folderId, status, loadMessages]);

  // Soft-refresh inbox while visible
  useEffect(() => {
    if (!status?.connected || !status.capabilities?.mail) return;
    const id = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      if (composeMode) return;
      void loadMessages({ audit: false });
    }, 45_000);
    return () => window.clearInterval(id);
  }, [status, loadMessages, composeMode]);

  useEffect(() => {
    return () => {
      try {
        sessionStorage.removeItem(ACTIVE_MAIL_STORAGE_KEY);
      } catch {
        /* ignore */
      }
    };
  }, []);

  // Deep-link ?msg=
  useEffect(() => {
    const msg = searchParams.get('msg');
    if (msg && msg !== selectedIdRef.current && status?.capabilities?.mail) {
      void openMessage(msg);
    }
  }, [searchParams, status, openMessage]);

  useEffect(() => {
    const q = pickerQuery.trim();
    if (q.length < 2 || !composeMode) {
      setPickerResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const people = await searchMeetingPeople(q, 8);
          if (!cancelled) setPickerResults(people);
        } catch {
          if (!cancelled) setPickerResults([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [pickerQuery, composeMode]);

  useEffect(() => {
    if (!settingsOpen) return;
    void loadOutlookSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when panel opens / mail connect changes
  }, [settingsOpen, status?.connected, status?.capabilities?.mail]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/mail');
      window.location.href = url;
    } catch (err) {
      setConnecting(false);
      setError(err instanceof Error ? err.message : 'OAuth start failed');
    }
  }

  async function onEnableAlerts() {
    const result = await requestNotificationPermission(salesUser, '/sales/mail');
    setNotifPerm(result);
    if (result === 'granted') {
      setNotice('Desktop alerts enabled for new mail while this portal tab stays open.');
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

  async function loadOutlookSettings() {
    if (!status?.connected || !status.capabilities?.mail) return;
    setMailboxLoading(true);
    try {
      const payload = await fetchMailboxSettings();
      setMailboxPayload(payload);
      setSigDraft(payload.portal_signature.mail_signature_html ?? '');
      setSigEnabled(payload.portal_signature.mail_signature_enabled);
      const ooo = payload.mailbox?.automaticRepliesSetting;
      const st = (ooo?.status ?? 'disabled') as 'disabled' | 'alwaysEnabled' | 'scheduled';
      setOooStatus(
        st === 'alwaysEnabled' || st === 'scheduled' ? st : 'disabled',
      );
      setOooInternal(ooo?.internalReplyMessage ?? '');
      setOooExternal(ooo?.externalReplyMessage ?? '');
      const aud = (ooo?.externalAudience ?? 'all') as 'none' | 'contactsOnly' | 'all';
      setOooAudience(
        aud === 'none' || aud === 'contactsOnly' ? aud : 'all',
      );
      const start = ooo?.scheduledStartDateTime?.dateTime;
      const end = ooo?.scheduledEndDateTime?.dateTime;
      setOooStart(start ? start.slice(0, 16) : '');
      setOooEnd(end ? end.slice(0, 16) : '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Outlook settings');
    } finally {
      setMailboxLoading(false);
    }
  }

  async function onSaveAutomaticReplies(e: FormEvent) {
    e.preventDefault();
    setSavingOoo(true);
    setError(null);
    try {
      const payload: Parameters<typeof updateMailboxAutomaticReplies>[0] = {
        status: oooStatus,
        externalAudience: oooAudience,
        internalReplyMessage: oooInternal,
        externalReplyMessage: oooExternal,
      };
      if (oooStatus === 'scheduled') {
        if (!oooStart || !oooEnd) {
          throw new Error('Scheduled automatic replies need a start and end time');
        }
        payload.scheduledStartDateTime = {
          dateTime: `${oooStart}:00`,
          timeZone: mailboxPayload?.mailbox?.timeZone ?? 'UTC',
        };
        payload.scheduledEndDateTime = {
          dateTime: `${oooEnd}:00`,
          timeZone: mailboxPayload?.mailbox?.timeZone ?? 'UTC',
        };
      }
      const res = await updateMailboxAutomaticReplies(payload);
      setMailboxPayload((prev) =>
        prev
          ? {
              ...prev,
              mailbox: res.mailbox
                ? {
                    timeZone: res.mailbox.timeZone ?? prev.mailbox?.timeZone ?? null,
                    language: res.mailbox.language ?? prev.mailbox?.language ?? null,
                    automaticRepliesSetting:
                      res.mailbox.automaticRepliesSetting ?? null,
                  }
                : prev.mailbox,
            }
          : prev,
      );
      setNotice('Automatic replies updated in your mailbox.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update automatic replies');
    } finally {
      setSavingOoo(false);
    }
  }

  async function onSearch(e: FormEvent) {
    e.preventDefault();
    const q = searchQ.trim();
    if (q.length < 2) {
      setSearchActive(false);
      void loadMessages();
      return;
    }
    setMessagesLoading(true);
    setError(null);
    setSearchActive(true);
    setSelectedMsgIds(new Set());
    try {
      const res = await searchMail(q, {
        folder_id: folderId,
        search_in_folder: searchInFolder,
      });
      setMessages(res.messages);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setMessagesLoading(false);
    }
  }

  function clearSearch() {
    setSearchQ('');
    setSearchActive(false);
    setSelectedMsgIds(new Set());
    void loadMessages();
  }

  function toggleFolderExpanded(id: string) {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectFolder(id: string) {
    setFolderId(id);
    setSearchActive(false);
    setSearchQ('');
    setSelectedId(null);
    setDetail(null);
    setSelectedMsgIds(new Set());
    setMoveTargetId('');
    setSideOpen(false);
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      for (const aid of ancestorFolderIds(folders, id)) next.add(aid);
      return next;
    });
  }

  function toggleMsgSelected(id: string) {
    setSelectedMsgIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAllVisible() {
    setSelectedMsgIds((prev) => {
      if (messages.length && messages.every((m) => prev.has(m.id))) {
        return new Set();
      }
      return new Set(messages.map((m) => m.id));
    });
  }

  async function onMoveMessages(ids: string[], destinationId: string) {
    if (!ids.length || !destinationId) return;
    setBusy(true);
    setError(null);
    try {
      await moveMail(ids, destinationId);
      const destName =
        folders.find((f) => f.id === destinationId)?.display_name ?? 'folder';
      setMessages((prev) => prev.filter((m) => !ids.includes(m.id)));
      if (selectedId && ids.includes(selectedId)) {
        setDetail(null);
        setSelectedId(null);
        setThread([]);
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.delete('msg');
          return next;
        });
      }
      setSelectedMsgIds(new Set());
      setMoveTargetId('');
      setNotice(
        ids.length === 1
          ? `Moved to ${destName}.`
          : `Moved ${ids.length} messages to ${destName}.`,
      );
      void loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCreateFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    setFolderBusy(true);
    setError(null);
    try {
      const res = await createMailFolderApi({
        display_name: name,
        parent_folder_id: folderId,
      });
      setNewFolderName('');
      setNotice(`Created folder “${res.folder.display_name}”.`);
      if (folderId) {
        setExpandedFolders((prev) => new Set(prev).add(folderId));
      }
      await loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create folder');
    } finally {
      setFolderBusy(false);
    }
  }

  async function onRenameFolder() {
    if (!selectedFolder || selectedFolder.well_known) return;
    const name = window.prompt('Rename folder', selectedFolder.display_name)?.trim();
    if (!name || name === selectedFolder.display_name) return;
    setFolderBusy(true);
    setError(null);
    try {
      await renameMailFolderApi({ folder_id: selectedFolder.id, display_name: name });
      setNotice(`Renamed folder to “${name}”.`);
      await loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not rename folder');
    } finally {
      setFolderBusy(false);
    }
  }

  function startCompose(mode: ComposeMode) {
    setExternalWarn(null);
    setAllowExternal(false);
    setPickerQuery('');
    setPickerResults([]);
    setComposeAttachments([]);
    const defaultFrom =
      sendAsAddresses.find((a) => a.is_primary)?.address ??
      sendAsAddresses[0]?.address ??
      status?.microsoft_email?.trim().toLowerCase() ??
      '';
    setComposeFrom(defaultFrom);
    const ownAddrs = new Set(
      [
        ...sendAsAddresses.map((a) => a.address),
        status?.microsoft_email?.trim().toLowerCase() ?? '',
      ].filter(Boolean),
    );
    if (mode === 'new') {
      setComposeMode('new');
      setComposeTo('');
      setComposeCc('');
      setComposeSubject('');
      setComposeBody('');
      return;
    }
    if (!detail || !mode) return;
    setComposeMode(mode);
    if (mode === 'reply' || mode === 'reply_all') {
      const from = detail.from.email ?? '';
      setComposeTo(from);
      if (mode === 'reply_all') {
        const cc = [
          ...detail.to.map((r) => r.email).filter(Boolean),
          ...detail.cc.map((r) => r.email).filter(Boolean),
        ]
          .map((e) => (e as string).toLowerCase())
          .filter((e) => e && e !== from.toLowerCase() && !ownAddrs.has(e));
        setComposeCc([...new Set(cc)].join(', '));
      } else {
        setComposeCc('');
      }
      setComposeSubject(
        detail.subject.toLowerCase().startsWith('re:')
          ? detail.subject
          : `Re: ${detail.subject}`,
      );
      setComposeBody('');
    } else if (mode === 'forward') {
      setComposeTo('');
      setComposeCc('');
      setComposeSubject(
        detail.subject.toLowerCase().startsWith('fw:') ||
          detail.subject.toLowerCase().startsWith('fwd:')
          ? detail.subject
          : `Fw: ${detail.subject}`,
      );
      setComposeBody('');
    }
  }

  async function onPickAttachments(files: FileList | null) {
    if (!files?.length) return;
    setAttachBusy(true);
    setError(null);
    try {
      const incoming = Array.from(files);
      const next = [...composeAttachments];
      for (const file of incoming) {
        if (next.length >= MAIL_ATTACHMENT_MAX_COUNT) {
          throw new Error(`Max ${MAIL_ATTACHMENT_MAX_COUNT} attachments per message.`);
        }
        const att = await readFileAsAttachment(file);
        const total = next.reduce((sum, a) => sum + a.size, 0) + att.size;
        if (total > MAIL_ATTACHMENT_MAX_TOTAL_BYTES) {
          throw new Error(
            `Total attachments would exceed ${formatFileSize(MAIL_ATTACHMENT_MAX_TOTAL_BYTES)} (under Outlook’s ~25 MB message limit).`,
          );
        }
        next.push(att);
      }
      setComposeAttachments(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not attach file');
    } finally {
      setAttachBusy(false);
      if (attachInputRef.current) attachInputRef.current.value = '';
    }
  }

  function removeComposeAttachment(localId: string) {
    setComposeAttachments((prev) => prev.filter((a) => a.local_id !== localId));
  }

  function outboundAttachments(): MailOutboundAttachment[] {
    return composeAttachments.map(({ name, content_type, content_base64 }) => ({
      name,
      content_type,
      content_base64,
    }));
  }

  function addPerson(p: PeopleSuggestion) {
    const email = p.email.trim();
    if (!email) return;
    if (pickerField === 'to') {
      const existing = parseAddressList(composeTo);
      if (!existing.includes(email.toLowerCase())) {
        setComposeTo([...existing, email].join(', '));
      }
    } else {
      const existing = parseAddressList(composeCc);
      if (!existing.includes(email.toLowerCase())) {
        setComposeCc([...existing, email].join(', '));
      }
    }
    setPickerQuery('');
    setPickerResults([]);
  }

  async function onSendCompose(e: FormEvent) {
    e.preventDefault();
    if (!composeMode) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const attachments = outboundAttachments();
      if (composeMode === 'new') {
        const to = parseAddressList(composeTo);
        if (!to.length) throw new Error('Add at least one To recipient');
        await sendMail({
          subject: composeSubject,
          body_html: textToHtml(composeBody),
          to,
          cc: parseAddressList(composeCc),
          from: composeFrom || null,
          allow_external: allowExternal,
          attachments,
        });
      } else if (composeMode === 'reply' || composeMode === 'reply_all') {
        if (!detail) throw new Error('No message selected');
        if (!composeBody.trim()) throw new Error('Write a reply');
        await replyMail({
          message_id: detail.id,
          comment: composeBody.trim(),
          reply_all: composeMode === 'reply_all',
          from: composeFrom || null,
          allow_external: allowExternal,
          attachments,
        });
      } else if (composeMode === 'forward') {
        if (!detail) throw new Error('No message selected');
        const to = parseAddressList(composeTo);
        if (!to.length) throw new Error('Add at least one forward recipient');
        await forwardMail({
          message_id: detail.id,
          to,
          comment: composeBody.trim(),
          from: composeFrom || null,
          allow_external: allowExternal,
          attachments,
        });
      }
      setComposeMode(null);
      setComposeAttachments([]);
      setExternalWarn(null);
      setAllowExternal(false);
      setNotice('Message sent.');
      void loadMessages({ audit: false });
      if (folderId) {
        const sent = folders.find((f) => f.well_known === 'sentitems');
        if (sent) void loadFolders();
      }
    } catch (err) {
      if (err instanceof MailExternalConfirmError) {
        setExternalWarn(err.external_recipients);
        setAllowExternal(false);
        setError(
          `External recipients: ${err.external_recipients.join(', ')}. Confirm to send outside ${err.org_domains.join(', ')}.`,
        );
      } else {
        setError(err instanceof Error ? err.message : 'Send failed');
      }
    } finally {
      setBusy(false);
    }
  }

  async function onMarkUnread() {
    if (!detail) return;
    setBusy(true);
    try {
      await markMailRead(detail.id, false);
      setDetail({ ...detail, is_read: false });
      setMessages((prev) =>
        prev.map((m) => (m.id === detail.id ? { ...m, is_read: false } : m)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not mark unread');
    } finally {
      setBusy(false);
    }
  }

  async function onDelete() {
    if (!detail) return;
    const inDeleted = selectedFolder?.well_known === 'deleteditems';
    setBusy(true);
    setError(null);
    try {
      const result = await deleteMail(detail.id, {
        permanent: inDeleted,
        parent_folder_id: detail.parent_folder_id ?? selectedFolder?.id ?? null,
      });
      setMessages((prev) => prev.filter((m) => m.id !== detail.id));
      setDetail(null);
      setSelectedId(null);
      setThread([]);
      setSelectedMsgIds((prev) => {
        const next = new Set(prev);
        next.delete(detail.id);
        return next;
      });
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev);
        next.delete('msg');
        return next;
      });
      setNotice(
        result.mode === 'permanent'
          ? 'Message permanently deleted in Outlook.'
          : 'Moved to Deleted Items in Outlook.',
      );
      // Re-fetch from Graph so portal matches Outlook (and clears stale rows).
      void loadMessages({ audit: false });
      void loadFolders();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
      void loadMessages({ audit: false });
    } finally {
      setBusy(false);
    }
  }

  async function onArchive() {
    if (!detail) return;
    setBusy(true);
    try {
      await archiveMail(detail.id);
      setMessages((prev) => prev.filter((m) => m.id !== detail.id));
      setDetail(null);
      setSelectedId(null);
      setNotice('Moved to Archive.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    } finally {
      setBusy(false);
    }
  }

  function onOpenAttachment(messageId: string, att: MailAttachmentMeta) {
    setViewerAttachment({ messageId, attachment: att });
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

  function onPickerKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && pickerResults[0]) {
      e.preventDefault();
      addPerson(pickerResults[0]);
    }
  }

  if (loading) {
    return (
      <div className="app-page mail-layout">
        <p className="muted">Loading Mail…</p>
      </div>
    );
  }

  const connected = Boolean(status?.connected);
  const needsUpgrade = Boolean(status?.needs_scope_upgrade || (connected && !status?.capabilities?.mail));
  const canMail = Boolean(status?.capabilities?.mail);

  return (
    <div className="app-page mail-layout">
      <aside className={`app-side${sideOpen ? ' open' : ''}`}>
        <div className="panel">
          <div className="panel-head">
            <h2>Mail</h2>
            <button
              type="button"
              className="btn ghost small app-side-toggle"
              onClick={() => setSideOpen(false)}
            >
              Close
            </button>
          </div>
          <p className="muted">
            Work Outlook mailbox inside the portal. Reads and sends as your connected Microsoft
            account.
          </p>
          {!status?.configured ? (
            <p className="error">{status?.setup_hint ?? 'Microsoft Graph is not configured.'}</p>
          ) : null}
          {!connected ? (
            <div className="stack-gap">
              <p className="muted">Connect your work Microsoft account to use Mail.</p>
              <button type="button" className="btn primary" disabled={connecting} onClick={() => void onConnect()}>
                {connecting ? 'Redirecting…' : 'Connect Microsoft'}
              </button>
            </div>
          ) : (
            <div className="stack-gap">
              {needsUpgrade ? (
                <p className="notice">
                  Microsoft permissions were updated. <strong>Reconnect</strong> so your token includes
                  Mail and MailboxSettings (automatic replies).
                </p>
              ) : (
                <p className="muted small">
                  Connected as {status?.microsoft_email ?? status?.preferred_work_email}
                </p>
              )}
              <button
                type="button"
                className={needsUpgrade ? 'btn primary' : 'btn ghost'}
                disabled={connecting}
                onClick={() => void onConnect()}
              >
                {connecting ? 'Redirecting…' : 'Reconnect'}
              </button>
            </div>
          )}

          <button
            type="button"
            className="btn ghost"
            onClick={() => setSettingsOpen((o) => !o)}
          >
            {settingsOpen ? 'Hide Outlook Settings' : 'Outlook Settings'}
          </button>
          {settingsOpen ? (
            <div className="stack-gap mail-outlook-settings">
              <form onSubmit={(e) => void onSaveWorkEmail(e)} className="stack-gap">
                <label>
                  Work email
                  <input
                    value={workEmailDraft}
                    onChange={(e) => setWorkEmailDraft(e.target.value)}
                    placeholder="you@tagevc.com"
                    autoComplete="email"
                  />
                </label>
                <button type="submit" className="btn ghost" disabled={savingEmail}>
                  {savingEmail ? 'Saving…' : 'Save work email'}
                </button>
              </form>

              <MailSignaturesPanel
                sigEnabled={sigEnabled}
                onSigEnabledChange={setSigEnabled}
                onDefaultSignatureChange={(html) => setSigDraft(html ?? '')}
              />

              <div className="mail-settings-block">
                <h3 className="mail-settings-title">Automatic replies</h3>
                {mailboxLoading ? (
                  <p className="muted small">Loading mailbox settings…</p>
                ) : mailboxPayload?.needs_scope_upgrade || !mailboxPayload?.mailbox ? (
                  <div className="stack-gap">
                    <p className="muted small">
                      {mailboxPayload?.error ??
                        'Reconnect to grant MailboxSettings.ReadWrite for out-of-office.'}
                    </p>
                    <button type="button" className="btn ghost" disabled={connecting} onClick={() => void onConnect()}>
                      Reconnect
                    </button>
                  </div>
                ) : (
                  <form onSubmit={(e) => void onSaveAutomaticReplies(e)} className="stack-gap">
                    {(mailboxPayload.mailbox.timeZone ||
                      mailboxPayload.mailbox.language?.displayName) && (
                      <dl className="mail-mailbox-meta muted small">
                        {mailboxPayload.mailbox.timeZone ? (
                          <>
                            <dt>Timezone</dt>
                            <dd>{mailboxPayload.mailbox.timeZone}</dd>
                          </>
                        ) : null}
                        {mailboxPayload.mailbox.language?.displayName ? (
                          <>
                            <dt>Language</dt>
                            <dd>{mailboxPayload.mailbox.language.displayName}</dd>
                          </>
                        ) : null}
                      </dl>
                    )}
                    <label>
                      Status
                      <select
                        value={oooStatus}
                        onChange={(e) =>
                          setOooStatus(
                            e.target.value as 'disabled' | 'alwaysEnabled' | 'scheduled',
                          )
                        }
                      >
                        <option value="disabled">Off</option>
                        <option value="alwaysEnabled">On</option>
                        <option value="scheduled">Scheduled</option>
                      </select>
                    </label>
                    {oooStatus === 'scheduled' ? (
                      <>
                        <label>
                          Starts
                          <input
                            type="datetime-local"
                            value={oooStart}
                            onChange={(e) => setOooStart(e.target.value)}
                          />
                        </label>
                        <label>
                          Ends
                          <input
                            type="datetime-local"
                            value={oooEnd}
                            onChange={(e) => setOooEnd(e.target.value)}
                          />
                        </label>
                      </>
                    ) : null}
                    {oooStatus !== 'disabled' ? (
                      <>
                        <label>
                          Internal reply
                          <textarea
                            rows={3}
                            value={oooInternal}
                            onChange={(e) => setOooInternal(e.target.value)}
                          />
                        </label>
                        <label>
                          External reply
                          <textarea
                            rows={3}
                            value={oooExternal}
                            onChange={(e) => setOooExternal(e.target.value)}
                          />
                        </label>
                        <label>
                          External audience
                          <select
                            value={oooAudience}
                            onChange={(e) =>
                              setOooAudience(
                                e.target.value as 'none' | 'contactsOnly' | 'all',
                              )
                            }
                          >
                            <option value="all">All external</option>
                            <option value="contactsOnly">Contacts only</option>
                            <option value="none">None</option>
                          </select>
                        </label>
                      </>
                    ) : null}
                    <button type="submit" className="btn ghost" disabled={savingOoo}>
                      {savingOoo ? 'Saving…' : 'Save automatic replies'}
                    </button>
                  </form>
                )}
              </div>

              {notifPerm !== 'granted' ? (
                <button type="button" className="btn ghost" onClick={() => void onEnableAlerts()}>
                  Enable desktop alerts
                </button>
              ) : (
                <p className="muted small">Desktop alerts on (tab must stay open).</p>
              )}
              <ul className="muted small mail-limits">
                <li>Choose From alias (own proxyAddresses) when composing</li>
                <li>Portal signature on send / reply / forward from this page</li>
                <li>Automatic replies sync via Graph mailboxSettings</li>
                <li>Outbound to non-org domains requires confirmation</li>
                <li>
                  Attach files on compose / reply / forward (≤{formatFileSize(MAIL_ATTACHMENT_MAX_BYTES)} each,
                  ≤{formatFileSize(MAIL_ATTACHMENT_MAX_TOTAL_BYTES)} total, max {MAIL_ATTACHMENT_MAX_COUNT})
                </li>
                <li>
                  Received attachments: in-portal preview (images / PDF / text); downloads disabled — same
                  soft gate as Files (use OneDrive / Files for shareable copies)
                </li>
                <li>Inline images in HTML bodies display when Graph provides them</li>
              </ul>
            </div>
          ) : null}

          {canMail && folders.length ? (
            <div className="mail-folder-panel">
              <nav className="mail-folder-nav" aria-label="Mail folders">
                {folderRows.map((f) => (
                  <div
                    key={f.id}
                    className={`mail-folder-row${folderId === f.id && !searchActive ? ' active' : ''}`}
                    style={{ ['--mail-folder-depth' as string]: String(f.depth) }}
                  >
                    {f.has_children ? (
                      <button
                        type="button"
                        className="mail-folder-expand"
                        aria-expanded={expandedFolders.has(f.id)}
                        aria-label={
                          expandedFolders.has(f.id)
                            ? `Collapse ${f.display_name}`
                            : `Expand ${f.display_name}`
                        }
                        onClick={() => toggleFolderExpanded(f.id)}
                      >
                        {expandedFolders.has(f.id) ? '▾' : '▸'}
                      </button>
                    ) : (
                      <span className="mail-folder-expand spacer" aria-hidden />
                    )}
                    <button
                      type="button"
                      className="mail-folder-btn"
                      onClick={() => selectFolder(f.id)}
                    >
                      <span>{f.display_name}</span>
                      {f.unread_count ? (
                        <span className="mail-unread-badge">{f.unread_count}</span>
                      ) : null}
                    </button>
                  </div>
                ))}
              </nav>
              <form
                className="mail-folder-create"
                onSubmit={(e) => {
                  e.preventDefault();
                  void onCreateFolder();
                }}
              >
                <input
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  placeholder={
                    selectedFolder
                      ? `New under ${selectedFolder.display_name}`
                      : 'New folder name'
                  }
                  aria-label="New folder name"
                />
                <button
                  type="submit"
                  className="btn small ghost"
                  disabled={folderBusy || !newFolderName.trim()}
                >
                  Add
                </button>
              </form>
              {selectedFolder && !selectedFolder.well_known ? (
                <button
                  type="button"
                  className="btn small ghost mail-folder-rename"
                  disabled={folderBusy}
                  onClick={() => void onRenameFolder()}
                >
                  Rename folder
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </aside>

      <div className="app-main mail-main">
        {error ? <p className="error">{error}</p> : null}
        {notice ? <p className="notice">{notice}</p> : null}
        {needsUpgrade ? (
          <div className="notice">
            Your Microsoft connection is missing Mail permissions. An admin must grant consent in
            Azure, then click <strong>Reconnect</strong>.{' '}
            <button type="button" className="btn ghost small" disabled={connecting} onClick={() => void onConnect()}>
              {connecting ? 'Redirecting…' : 'Reconnect'}
            </button>
          </div>
        ) : null}
        {externalWarn?.length ? (
          <div className="notice mail-external-banner">
            <p>
              Confirm send to external addresses:{' '}
              <strong>{externalWarn.join(', ')}</strong> (org: {orgDomains.join(', ')})
            </p>
            <label className="mail-external-check">
              <input
                type="checkbox"
                checked={allowExternal}
                onChange={(e) => setAllowExternal(e.target.checked)}
              />{' '}
              Allow external send this time
            </label>
          </div>
        ) : null}

        {!canMail ? (
          <div className="panel stack-gap">
            <p className="muted">Connect or reconnect Microsoft to open your mailbox here.</p>
            <button
              type="button"
              className="btn primary"
              disabled={connecting || status?.configured === false}
              onClick={() => void onConnect()}
            >
              {connecting ? 'Redirecting…' : connected ? 'Reconnect' : 'Connect Microsoft'}
            </button>
          </div>
        ) : (
          <div className={`mail-shell${selectedId || composeMode ? ' has-selection' : ''}`}>
            <section className="mail-list panel">
              <div className="panel-head mail-list-head">
                <h2>
                  {searchActive
                    ? searchInFolder
                      ? `Search in ${selectedFolder?.display_name ?? 'folder'}`
                      : 'Search mailbox'
                    : selectedFolder?.display_name ?? 'Inbox'}
                </h2>
                <div className="page-actions">
                  <button
                    type="button"
                    className="btn ghost small app-side-toggle"
                    aria-expanded={sideOpen}
                    onClick={() => setSideOpen((o) => !o)}
                  >
                    {sideOpen ? 'Hide folders' : 'Folders'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    disabled={connecting}
                    onClick={() => void onConnect()}
                  >
                    {connecting ? 'Redirecting…' : 'Reconnect'}
                  </button>
                  <button type="button" className="btn small primary" onClick={() => startCompose('new')}>
                    Compose
                  </button>
                </div>
              </div>
              <form className="mail-search" onSubmit={(e) => void onSearch(e)}>
                <input
                  value={searchQ}
                  onChange={(e) => setSearchQ(e.target.value)}
                  placeholder="Search subject, from, body…"
                  aria-label="Search mail"
                />
                <button type="submit" className="btn small ghost">
                  Search
                </button>
                {searchActive ? (
                  <button type="button" className="btn small ghost" onClick={clearSearch}>
                    Clear
                  </button>
                ) : null}
              </form>
              <label className="mail-search-scope">
                <input
                  type="checkbox"
                  checked={searchInFolder}
                  onChange={(e) => setSearchInFolder(e.target.checked)}
                />{' '}
                Search in current folder only
                {!searchInFolder ? (
                  <span className="muted small"> · whole mailbox</span>
                ) : null}
              </label>
              <div className="mail-list-toolbar">
                <label className="mail-select-all">
                  <input
                    type="checkbox"
                    checked={Boolean(messages.length && messages.every((m) => selectedMsgIds.has(m.id)))}
                    onChange={toggleSelectAllVisible}
                    disabled={!messages.length}
                    aria-label="Select all visible messages"
                  />{' '}
                  Select
                </label>
                <select
                  value={moveTargetId}
                  onChange={(e) => setMoveTargetId(e.target.value)}
                  aria-label="Move to folder"
                  disabled={!selectedMsgIds.size && !selectedId}
                >
                  <option value="">Move to…</option>
                  {folders
                    .slice()
                    .sort((a, b) => {
                      const [ao, an] = folderSortKey(a);
                      const [bo, bn] = folderSortKey(b);
                      return ao - bo || an.localeCompare(bn);
                    })
                    .map((f) => (
                      <option key={f.id} value={f.id} disabled={f.id === folderId}>
                        {f.display_name}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  className="btn small ghost"
                  disabled={
                    busy ||
                    !moveTargetId ||
                    (!selectedMsgIds.size && !selectedId)
                  }
                  onClick={() => {
                    const ids = selectedMsgIds.size
                      ? Array.from(selectedMsgIds)
                      : selectedId
                        ? [selectedId]
                        : [];
                    void onMoveMessages(ids, moveTargetId);
                  }}
                >
                  Move{selectedMsgIds.size > 1 ? ` (${selectedMsgIds.size})` : ''}
                </button>
              </div>
              {messagesLoading ? <p className="muted mail-list-empty">Loading…</p> : null}
              {!messagesLoading && !messages.length ? (
                <p className="muted mail-list-empty">No messages</p>
              ) : null}
              <ul className="mail-msg-list">
                {messages.map((m) => (
                  <li key={m.id} className="mail-msg-row">
                    <label className="mail-msg-check">
                      <input
                        type="checkbox"
                        checked={selectedMsgIds.has(m.id)}
                        onChange={() => toggleMsgSelected(m.id)}
                        aria-label={`Select ${m.subject}`}
                      />
                    </label>
                    <button
                      type="button"
                      className={`mail-msg-item${!m.is_read ? ' unread' : ''}${selectedId === m.id ? ' active' : ''}`}
                      onClick={() => void openMessage(m.id)}
                    >
                      <div className="mail-msg-from">{recipientLabel(m.from)}</div>
                      <div className="mail-msg-subject">{m.subject}</div>
                      <div className="mail-msg-preview">{m.preview}</div>
                      <div className="mail-msg-meta">
                        {formatMsgTime(m.received_at)}
                        {m.has_attachments ? ' · 📎' : ''}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="mail-reading panel">
              {composeMode ? (
                <form className="mail-compose" onSubmit={(e) => void onSendCompose(e)}>
                  <div className="panel-head">
                    <h2>
                      {composeMode === 'new'
                        ? 'New message'
                        : composeMode === 'forward'
                          ? 'Forward'
                          : composeMode === 'reply_all'
                            ? 'Reply all'
                            : 'Reply'}
                    </h2>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => {
                        setComposeMode(null);
                        setComposeAttachments([]);
                        setExternalWarn(null);
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                  {sendAsAddresses.length > 0 || composeFrom ? (
                    <label>
                      From
                      {sendAsAddresses.length > 1 ? (
                        <select
                          value={composeFrom}
                          onChange={(e) => setComposeFrom(e.target.value)}
                          aria-label="Send from address"
                        >
                          {sendAsAddresses.map((a) => (
                            <option key={a.address} value={a.address}>
                              {a.address}
                              {a.is_primary ? ' (primary)' : ''}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input value={composeFrom} readOnly aria-label="From address" />
                      )}
                    </label>
                  ) : null}
                  {(composeMode === 'new' || composeMode === 'forward') ? (
                    <label>
                      To
                      <input
                        value={composeTo}
                        onChange={(e) => setComposeTo(e.target.value)}
                        onFocus={() => setPickerField('to')}
                        placeholder="name@tagevc.com"
                        required={composeMode === 'new' || composeMode === 'forward'}
                      />
                    </label>
                  ) : null}
                  {composeMode === 'new' ? (
                    <label>
                      Cc
                      <input
                        value={composeCc}
                        onChange={(e) => setComposeCc(e.target.value)}
                        onFocus={() => setPickerField('cc')}
                        placeholder="optional"
                      />
                    </label>
                  ) : null}
                  {(composeMode === 'new' || composeMode === 'forward') ? (
                    <div className="mail-people-picker">
                      <input
                        value={pickerQuery}
                        onChange={(e) => setPickerQuery(e.target.value)}
                        onKeyDown={onPickerKey}
                        placeholder={`People search for ${pickerField === 'to' ? 'To' : 'Cc'}…`}
                        aria-label="People search"
                      />
                      {pickerResults.length ? (
                        <ul className="chat-people-results">
                          {pickerResults.map((p) => (
                            <li key={p.id}>
                              <button type="button" onClick={() => addPerson(p)}>
                                {p.display_name ?? p.email} · {p.email}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </div>
                  ) : null}
                  {composeMode === 'new' ? (
                    <label>
                      Subject
                      <input
                        value={composeSubject}
                        onChange={(e) => setComposeSubject(e.target.value)}
                      />
                    </label>
                  ) : (
                    <p className="muted small">Subject: {composeSubject}</p>
                  )}
                  <label>
                    Message
                    <textarea
                      rows={10}
                      value={composeBody}
                      onChange={(e) => setComposeBody(e.target.value)}
                      required={composeMode === 'reply' || composeMode === 'reply_all'}
                    />
                  </label>
                  {sigEnabled && (sigDraft.trim() || salesUser.mail_signature_html) ? (
                    <p className="muted small">
                      Portal signature will be appended on send
                      {composeMode === 'new' ? ' (HTML)' : ' (plain text for reply/forward)'}.
                    </p>
                  ) : null}
                  <div className="mail-compose-attach">
                    <input
                      ref={attachInputRef}
                      type="file"
                      multiple
                      hidden
                      onChange={(e) => void onPickAttachments(e.target.files)}
                    />
                    <button
                      type="button"
                      className="btn ghost small"
                      disabled={busy || attachBusy}
                      onClick={() => attachInputRef.current?.click()}
                    >
                      {attachBusy ? 'Adding…' : 'Attach files'}
                    </button>
                    <span className="muted small">
                      Up to {MAIL_ATTACHMENT_MAX_COUNT} files · {formatFileSize(MAIL_ATTACHMENT_MAX_BYTES)} each ·{' '}
                      {formatFileSize(MAIL_ATTACHMENT_MAX_TOTAL_BYTES)} total
                    </span>
                  </div>
                  {composeAttachments.length ? (
                    <ul className="mail-compose-chips" aria-label="Attachments to send">
                      {composeAttachments.map((a) => (
                        <li key={a.local_id} className="mail-compose-chip">
                          <span title={a.name}>
                            {a.name} · {formatFileSize(a.size)}
                          </span>
                          <button
                            type="button"
                            className="mail-compose-chip-remove"
                            aria-label={`Remove ${a.name}`}
                            disabled={busy}
                            onClick={() => removeComposeAttachment(a.local_id)}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  <div className="mail-compose-actions">
                    <button type="submit" className="btn primary" disabled={busy || attachBusy}>
                      {busy ? 'Sending…' : allowExternal && externalWarn ? 'Send externally' : 'Send'}
                    </button>
                  </div>
                </form>
              ) : detailLoading ? (
                <p className="muted">Loading message…</p>
              ) : !detail ? (
                <div className="mail-thread-empty">
                  <p className="muted">Select a message to read it here.</p>
                  <button type="button" className="btn primary" onClick={() => startCompose('new')}>
                    Compose
                  </button>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    className="btn ghost small chat-back"
                    onClick={() => {
                      setSelectedId(null);
                      setDetail(null);
                      setThread([]);
                    }}
                  >
                    ← Back
                  </button>
                  <div className="mail-thread-head">
                    <h2>{detail.subject}</h2>
                    <div className="mail-thread-actions">
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => startCompose('reply')}>
                        Reply
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => startCompose('reply_all')}>
                        Reply all
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => startCompose('forward')}>
                        Forward
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void onMarkUnread()}>
                        Unread
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void onArchive()}>
                        Archive
                      </button>
                      <button
                        type="button"
                        className="btn small ghost"
                        disabled={busy || !moveTargetId}
                        onClick={() => {
                          if (detail && moveTargetId) {
                            void onMoveMessages([detail.id], moveTargetId);
                          }
                        }}
                      >
                        Move
                      </button>
                      <button type="button" className="btn small ghost" disabled={busy} onClick={() => void onDelete()}>
                        {selectedFolder?.well_known === 'deleteditems' ? 'Delete permanently' : 'Delete'}
                      </button>
                    </div>
                  </div>
                  <p className="muted small mail-thread-focus-hint">
                    Reply / Forward apply to the highlighted message
                    {thread.length > 1 ? ' — click a message header to focus it' : ''}.
                  </p>
                  <div className="mail-reading-scroll">
                    <MailThreadView
                      thread={thread.length ? thread : [detail]}
                      activeId={detail.id}
                      onSelect={(id) => focusThreadMessage(id)}
                      renderExtras={(msg) => {
                        const files = msg.attachments.filter((a) => !a.is_inline);
                        if (!files.length) return null;
                        return (
                          <div className="mail-attachments">
                            <span className="muted small">
                              Attachments — Open to preview in the portal; Save keeps a OneDrive vault
                              copy (no local download)
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
                                      onClick={() => onOpenAttachment(msg.id, a)}
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
                                      title="Company Shared / Resumes — stays if the user leaves"
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
                </>
              )}
            </section>
          </div>
        )}
      </div>

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
