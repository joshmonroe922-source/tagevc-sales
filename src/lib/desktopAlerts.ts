/**
 * Browser desktop alerts for calendar events, To Do / Planner tasks, and Teams chat.
 * Tab must stay open (v1). Dedupes via sessionStorage.
 */

import { logAuditEvent } from './audit';
import type {
  CalendarEvent,
  MailMessageSummary,
  PlannerTask,
  TeamsChat,
  TeamsChatMessage,
  TodoTask,
} from './calendarApi';
import type { SalesUser } from './types';

const STORAGE_PREFIX = 'ms_alert_fired:';
const PREFS_KEY = 'ms_alert_prefs';
/** Chat page writes the open conversation id so we can suppress popups while reading it. */
export const ACTIVE_CHAT_STORAGE_KEY = 'ms_chat_active';
/** Mail page writes the open message id so we can suppress popups while reading it. */
export const ACTIVE_MAIL_STORAGE_KEY = 'ms_mail_active';

export type AlertPrefs = {
  /** Minutes before event start to fire (defaults 15 and 5). */
  leadMinutes: number[];
  /** Poll interval ms for portal-wide calendar / To Do / Planner alerts. */
  pollMs: number;
  /** Poll interval ms for portal-wide Teams chat alerts. */
  chatPollMs: number;
  /** Poll interval ms for portal-wide Mail alerts. */
  mailPollMs: number;
};

const DEFAULT_PREFS: AlertPrefs = {
  leadMinutes: [15, 5],
  pollMs: 60_000,
  chatPollMs: 30_000,
  mailPollMs: 45_000,
};

/** Brief gap between chat desktop toasts (still delivered on later polls). */
const CHAT_THROTTLE_MS = 2_500;
let lastChatAlertAt = 0;
const MAIL_THROTTLE_MS = 2_500;
let lastMailAlertAt = 0;

export function loadAlertPrefs(): AlertPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<AlertPrefs>;
    const leads = Array.isArray(parsed.leadMinutes)
      ? parsed.leadMinutes.filter((n) => typeof n === 'number' && n > 0)
      : DEFAULT_PREFS.leadMinutes;
    return {
      leadMinutes: leads.length ? leads : DEFAULT_PREFS.leadMinutes,
      pollMs:
        typeof parsed.pollMs === 'number' && parsed.pollMs >= 15_000
          ? parsed.pollMs
          : DEFAULT_PREFS.pollMs,
      chatPollMs:
        typeof parsed.chatPollMs === 'number' && parsed.chatPollMs >= 15_000
          ? parsed.chatPollMs
          : DEFAULT_PREFS.chatPollMs,
      mailPollMs:
        typeof parsed.mailPollMs === 'number' && parsed.mailPollMs >= 15_000
          ? parsed.mailPollMs
          : DEFAULT_PREFS.mailPollMs,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export function saveAlertPrefs(prefs: Partial<AlertPrefs>): AlertPrefs {
  const next = { ...loadAlertPrefs(), ...prefs };
  localStorage.setItem(PREFS_KEY, JSON.stringify(next));
  return next;
}

export type NotificationPermissionState = NotificationPermission | 'unsupported';

export function getNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(
  user?: Pick<SalesUser, 'id' | 'email'> | null,
  path = '/sales/calendar',
): Promise<NotificationPermissionState> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  const before = Notification.permission;
  const result = await Notification.requestPermission();
  void logAuditEvent({
    eventType: 'notification_permission',
    path,
    user,
    metadata: {
      before,
      after: result,
      granted: result === 'granted',
    },
  });
  return result;
}

function alreadyFired(key: string): boolean {
  try {
    return sessionStorage.getItem(STORAGE_PREFIX + key) === '1';
  } catch {
    return false;
  }
}

function markFired(key: string): void {
  try {
    sessionStorage.setItem(STORAGE_PREFIX + key, '1');
  } catch {
    /* ignore quota */
  }
}

function parseEventStart(ev: CalendarEvent): Date | null {
  if (!ev.start || ev.is_all_day) return null;
  const iso = ev.start;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(iso.replace(' ', 'T'));
}

function parseDue(iso: string | null): Date | null {
  if (!iso) return null;
  if (/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  // Date-only or local
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return new Date(`${iso}T23:59:59`);
  }
  return new Date(iso.replace(' ', 'T'));
}

function showNotification(
  title: string,
  body: string,
  tag: string,
  user: Pick<SalesUser, 'id' | 'email'> | null | undefined,
  meta: Record<string, unknown>,
  opts?: { path?: string; href?: string },
): void {
  if (getNotificationPermission() !== 'granted') return;
  if (alreadyFired(tag)) return;
  markFired(tag);

  try {
    const n = new Notification(title, {
      body,
      tag,
      silent: false,
    });
    n.onclick = () => {
      window.focus();
      if (opts?.href) {
        try {
          const url = new URL(opts.href, window.location.origin);
          if (url.origin === window.location.origin) {
            const next = `${url.pathname}${url.search}`;
            if (`${window.location.pathname}${window.location.search}` !== next) {
              window.location.assign(next);
            }
          }
        } catch {
          /* ignore bad href */
        }
      }
      n.close();
    };
  } catch (err) {
    console.warn('Notification failed', err);
    return;
  }

  void logAuditEvent({
    eventType: 'notification_sent',
    path: opts?.path ?? '/sales/calendar',
    user,
    metadata: meta,
  });
}

function isOwnChatSender(
  meId: string | null | undefined,
  fromId: string | null | undefined,
): boolean {
  if (!meId || !fromId) return false;
  return meId.toLowerCase() === fromId.toLowerCase();
}

function viewingChatThread(chatId: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (!window.location.pathname.startsWith('/sales/chat')) return false;
    if (document.visibilityState !== 'visible') return false;
    return sessionStorage.getItem(ACTIVE_CHAT_STORAGE_KEY) === chatId;
  } catch {
    return false;
  }
}

/**
 * Teams chat alerts from chat-list `last_message` previews (portal-wide poll).
 * Call once with `seedOnly: true` after subscribe starts so backlog never dumps.
 */
export function evaluateChatDesktopAlerts(opts: {
  chats: TeamsChat[];
  meId: string | null;
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  /** Mark current last-message ids as seen without notifying. */
  seedOnly?: boolean;
}): void {
  if (getNotificationPermission() !== 'granted') return;

  const now = Date.now();

  for (const chat of opts.chats) {
    const lm = chat.last_message;
    if (!lm?.id) continue;
    const tag = `chat:${lm.id}`;

    if (opts.seedOnly) {
      markFired(tag);
      continue;
    }

    if (isOwnChatSender(opts.meId, lm.from_id)) {
      markFired(tag);
      continue;
    }

    if (alreadyFired(tag)) continue;

    if (viewingChatThread(chat.id)) {
      markFired(tag);
      continue;
    }

    if (now - lastChatAlertAt < CHAT_THROTTLE_MS) {
      // Leave unmarked so a later poll can deliver without dropping.
      continue;
    }

    const who = lm.from_name?.trim() || 'New message';
    const preview = (lm.preview || '').trim() || 'Open Chat to read';
    lastChatAlertAt = Date.now();
    showNotification(
      chat.title || 'Teams chat',
      `${who}: ${preview}`.slice(0, 180),
      tag,
      opts.user,
      {
        kind: 'teams_chat',
        chat_id: chat.id,
        message_id: lm.id,
        from_name: lm.from_name,
      },
      {
        path: '/sales/chat',
        href: `/sales/chat?chat=${encodeURIComponent(chat.id)}`,
      },
    );
  }
}

/**
 * Optional thread-level evaluation (Chat page silent polls).
 * Same dedupe keys as list-based alerts (`chat:<messageId>`).
 */
export function evaluateChatMessageDesktopAlerts(opts: {
  chatId: string;
  chatTitle?: string;
  messages: TeamsChatMessage[];
  meId: string | null;
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  seedOnly?: boolean;
}): void {
  if (getNotificationPermission() !== 'granted') return;

  const now = Date.now();
  // Newest last — Graph often returns oldest→newest; walk reverse for throttle fairness.
  const msgs = [...opts.messages].reverse();

  for (const msg of msgs) {
    if (!msg.id) continue;
    if (msg.message_type && msg.message_type !== 'message') {
      markFired(`chat:${msg.id}`);
      continue;
    }
    const tag = `chat:${msg.id}`;

    if (opts.seedOnly) {
      markFired(tag);
      continue;
    }

    if (isOwnChatSender(opts.meId, msg.from_id)) {
      markFired(tag);
      continue;
    }

    if (alreadyFired(tag)) continue;

    if (viewingChatThread(opts.chatId)) {
      markFired(tag);
      continue;
    }

    if (now - lastChatAlertAt < CHAT_THROTTLE_MS) continue;

    const who = msg.from_name?.trim() || 'New message';
    const preview = (msg.body || '').trim().slice(0, 140) || 'Open Chat to read';
    lastChatAlertAt = Date.now();
    showNotification(
      opts.chatTitle || 'Teams chat',
      `${who}: ${preview}`,
      tag,
      opts.user,
      {
        kind: 'teams_chat',
        chat_id: opts.chatId,
        message_id: msg.id,
        from_name: msg.from_name,
      },
      {
        path: '/sales/chat',
        href: `/sales/chat?chat=${encodeURIComponent(opts.chatId)}`,
      },
    );
  }
}

function viewingMailMessage(messageId: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    if (!window.location.pathname.startsWith('/sales/mail')) return false;
    if (document.visibilityState !== 'visible') return false;
    return sessionStorage.getItem(ACTIVE_MAIL_STORAGE_KEY) === messageId;
  } catch {
    return false;
  }
}

/**
 * Inbox alerts from recent message list (portal-wide poll).
 * Call once with `seedOnly: true` so backlog never dumps.
 */
export function evaluateMailDesktopAlerts(opts: {
  messages: MailMessageSummary[];
  myEmail?: string | null;
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  seedOnly?: boolean;
}): void {
  if (getNotificationPermission() !== 'granted') return;

  const now = Date.now();
  const my = (opts.myEmail ?? '').trim().toLowerCase();

  for (const msg of opts.messages) {
    if (!msg.id) continue;
    const tag = `mail:${msg.id}`;

    if (opts.seedOnly) {
      markFired(tag);
      continue;
    }

    if (!msg.is_read) {
      /* only unread */
    } else {
      markFired(tag);
      continue;
    }

    const fromEmail = (msg.from.email ?? '').trim().toLowerCase();
    if (my && fromEmail && fromEmail === my) {
      markFired(tag);
      continue;
    }

    if (alreadyFired(tag)) continue;

    if (viewingMailMessage(msg.id)) {
      markFired(tag);
      continue;
    }

    if (now - lastMailAlertAt < MAIL_THROTTLE_MS) {
      continue;
    }

    const who = msg.from.name?.trim() || msg.from.email?.trim() || 'New mail';
    const preview = (msg.preview || '').trim() || 'Open Mail to read';
    lastMailAlertAt = Date.now();
    showNotification(
      msg.subject || 'New mail',
      `${who}: ${preview}`.slice(0, 180),
      tag,
      opts.user,
      {
        kind: 'outlook_mail',
        message_id: msg.id,
        from_email: msg.from.email,
      },
      {
        path: '/sales/mail',
        href: `/sales/mail?msg=${encodeURIComponent(msg.id)}`,
      },
    );
  }
}

export function evaluateDesktopAlerts(opts: {
  events: CalendarEvent[];
  todoTasks: TodoTask[];
  plannerTasks: PlannerTask[];
  user?: Pick<SalesUser, 'id' | 'email'> | null;
  prefs?: AlertPrefs;
}): void {
  if (getNotificationPermission() !== 'granted') return;

  const prefs = opts.prefs ?? loadAlertPrefs();
  const now = Date.now();

  for (const ev of opts.events) {
    const start = parseEventStart(ev);
    if (!start) continue;
    const startMs = start.getTime();
    if (startMs <= now) continue;

    for (const lead of prefs.leadMinutes) {
      const windowStart = startMs - lead * 60_000;
      // Fire when we are within ~poll interval after the lead threshold
      if (now >= windowStart && now < startMs) {
        const tag = `event:${ev.id}:${lead}`;
        showNotification(
          `Meeting in ${lead} min`,
          ev.subject + (ev.location ? ` · ${ev.location}` : ''),
          tag,
          opts.user,
          {
            kind: 'calendar_event',
            event_id: ev.id,
            subject: ev.subject,
            lead_minutes: lead,
            start: ev.start,
          },
          { path: '/sales/calendar', href: '/sales/calendar' },
        );
      }
    }
  }

  for (const task of opts.todoTasks) {
    if (task.completed) continue;
    const due = parseDue(task.due);
    if (!due) continue;
    const dueMs = due.getTime();
    const overdue = dueMs < now;
    const dueSoon = !overdue && dueMs - now <= 60 * 60_000; // within 1h
    if (!overdue && !dueSoon) continue;
    const tag = `todo:${task.id}:${overdue ? 'overdue' : 'due'}`;
    showNotification(
      overdue ? 'To Do overdue' : 'To Do due soon',
      task.title,
      tag,
      opts.user,
      {
        kind: 'todo_task',
        task_id: task.id,
        title: task.title,
        overdue,
        due: task.due,
      },
      { path: '/sales/todo', href: '/sales/todo' },
    );
  }

  for (const task of opts.plannerTasks) {
    if (task.completed) continue;
    const due = parseDue(task.due);
    if (!due) continue;
    const dueMs = due.getTime();
    const overdue = dueMs < now;
    const dueSoon = !overdue && dueMs - now <= 60 * 60_000;
    if (!overdue && !dueSoon) continue;
    const tag = `planner:${task.id}:${overdue ? 'overdue' : 'due'}`;
    showNotification(
      overdue ? 'Planner task overdue' : 'Planner task due soon',
      task.title,
      tag,
      opts.user,
      {
        kind: 'planner_task',
        task_id: task.id,
        title: task.title,
        overdue,
        due: task.due,
      },
      { path: '/sales/planner', href: '/sales/planner' },
    );
  }
}
