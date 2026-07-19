/**
 * Morning digest: Today-page summary + Grok win-the-day note + Resend email.
 */
import { sendResendEmail } from './email.ts';
import {
  createTodoList,
  fetchCalendarView,
  fetchMailboxSettings,
  fetchTodoLists,
  fetchTodoTasks,
  getMsConfig,
  getValidAccessToken,
  listUpcomingOnlineMeetings,
  type GraphEvent,
  type TodoList,
  type TodoTask,
} from './microsoftGraph.ts';
import { createServiceClient } from './supabase.ts';
import {
  DEFAULT_TIMEZONE,
  endOfZonedDay,
  formatTimeInZone,
  getZonedParts,
  isInLocalHourWindow,
  isValidTimeZone,
  parseGraphDateTime,
  startOfZonedDay,
  windowsToIana,
  zonedDayKey,
} from './userTimezone.ts';

const XAI_CHAT_URL = 'https://api.x.ai/v1/chat/completions';
const MASTER_TODO_SLUG = 'master';
const MASTER_TODO_DISPLAY = 'Tage · Master';
const DIGEST_HOUR = 6;
const DIGEST_WINDOW_MINUTES = 15;

export type DigestUser = {
  id: string;
  email: string;
  full_name: string | null;
  timezone: string | null;
  morning_digest_enabled: boolean;
  morning_digest_last_sent_on: string | null;
};

export type TodayDigestSnapshot = {
  timeZone: string;
  dayKey: string;
  connected: boolean;
  events: Array<{
    subject: string;
    startLabel: string;
    allDay: boolean;
    location: string | null;
    isOnline: boolean;
  }>;
  meetings: Array<{
    subject: string;
    startLabel: string;
    joinUrl: string;
  }>;
  tasks: Array<{
    title: string;
    dueLabel: string | null;
    overdue: boolean;
    importance: string | null;
  }>;
  partialErrors: string[];
};

export type ProcessDigestOpts = {
  dryRun?: boolean;
  /** Bypass local 6:00 window (for local testing). */
  force?: boolean;
  /** Only process this portal login email. */
  email?: string | null;
  now?: Date;
};

export type ProcessDigestResult = {
  scanned: number;
  eligible: number;
  sent: number;
  skipped: number;
  errors: Array<{ email: string; error: string }>;
  dry_run: boolean;
  samples?: Array<{
    email: string;
    dayKey: string;
    timeZone: string;
    subject: string;
    preview: string;
  }>;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function portalBaseUrl(): string {
  return (
    Deno.env.get('PUBLIC_APP_URL')?.replace(/\/$/, '') ||
    Deno.env.get('SITE_URL')?.replace(/\/$/, '') ||
    Deno.env.get('SALES_PORTAL_URL')?.replace(/\/$/, '') ||
    'https://portal.tagevc.com'
  );
}

function grokConfigured(): boolean {
  return Boolean(Deno.env.get('XAI_API_KEY')?.trim());
}

function grokModel(): string {
  return Deno.env.get('XAI_MODEL')?.trim() || 'grok-3-mini';
}

function firstName(fullName: string | null, email: string): string {
  const fromName = (fullName ?? '').trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const local = email.split('@')[0] ?? 'there';
  return local.charAt(0).toUpperCase() + local.slice(1);
}

function dueDateKey(task: TodoTask): string | null {
  const raw = task.dueDateTime?.dateTime?.trim();
  if (!raw) return null;
  // Graph due dates are often date-only at midnight
  const m = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

async function ensureMasterList(
  accessToken: string,
  service: ReturnType<typeof createServiceClient>,
  salesUserId: string,
): Promise<TodoList | null> {
  const lists = await fetchTodoLists(accessToken);

  const { data: cached } = await service
    .from('sales_user_todo_lists')
    .select('ms_list_id')
    .eq('sales_user_id', salesUserId)
    .eq('portal_slug', MASTER_TODO_SLUG)
    .maybeSingle();

  const cachedId = (cached?.ms_list_id as string | undefined)?.trim();
  if (cachedId) {
    const still = lists.find((l) => l.id === cachedId);
    if (still) return still;
  }

  const byName = lists.find(
    (l) =>
      (l.displayName ?? '').trim().toLowerCase() ===
      MASTER_TODO_DISPLAY.toLowerCase(),
  );
  if (byName) {
    await service.from('sales_user_todo_lists').upsert(
      {
        sales_user_id: salesUserId,
        portal_slug: MASTER_TODO_SLUG,
        ms_list_id: byName.id,
        list_display_name: MASTER_TODO_DISPLAY,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'sales_user_id,portal_slug' },
    );
    return byName;
  }

  const defaultList =
    lists.find((l) => l.wellknownListName === 'defaultList') ?? lists[0];
  if (defaultList) return defaultList;

  try {
    return await createTodoList(accessToken, MASTER_TODO_DISPLAY);
  } catch {
    return null;
  }
}

export async function resolveDigestTimezone(
  user: DigestUser,
  accessToken: string | null,
): Promise<string> {
  const stored = (user.timezone ?? '').trim();
  if (stored && isValidTimeZone(stored)) return stored;

  if (accessToken) {
    try {
      const mailbox = await fetchMailboxSettings(accessToken);
      const iana = windowsToIana(mailbox.timeZone ?? null);
      if (iana) return iana;
    } catch {
      /* fall through */
    }
  }

  return DEFAULT_TIMEZONE;
}

function joinUrlKey(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

export async function buildTodaySnapshot(
  service: ReturnType<typeof createServiceClient>,
  user: DigestUser,
  timeZone: string,
  accessToken: string | null,
): Promise<TodayDigestSnapshot> {
  const now = new Date();
  const dayKey = zonedDayKey(now, timeZone);
  const start = startOfZonedDay(now, timeZone);
  const end = endOfZonedDay(now, timeZone);
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const partialErrors: string[] = [];

  if (!accessToken) {
    return {
      timeZone,
      dayKey,
      connected: false,
      events: [],
      meetings: [],
      tasks: [],
      partialErrors: [
        'Microsoft work mailbox not connected — open Today in the portal to connect.',
      ],
    };
  }

  let events: GraphEvent[] = [];
  let meetings: Awaited<ReturnType<typeof listUpcomingOnlineMeetings>> = [];
  let tasks: TodoTask[] = [];

  const [calRes, meetRes, todoRes] = await Promise.allSettled([
    fetchCalendarView(accessToken, startIso, endIso),
    listUpcomingOnlineMeetings(accessToken, {
      start: startIso,
      end: endIso,
      top: 50,
    }),
    (async () => {
      const list = await ensureMasterList(accessToken, service, user.id);
      if (!list) return [] as TodoTask[];
      return fetchTodoTasks(accessToken, list.id);
    })(),
  ]);

  if (calRes.status === 'fulfilled') {
    events = calRes.value.filter((ev) => {
      const startAt = parseGraphDateTime(ev.start?.dateTime, ev.start?.timeZone);
      if (!startAt) return Boolean(ev.isAllDay);
      return zonedDayKey(startAt, timeZone) === dayKey;
    });
  } else {
    partialErrors.push(
      calRes.reason instanceof Error
        ? `Calendar: ${calRes.reason.message}`
        : 'Calendar: could not load',
    );
  }

  if (meetRes.status === 'fulfilled') {
    meetings = meetRes.value.filter((m) => {
      if (!m.start) return true;
      const startAt = parseGraphDateTime(m.start, 'UTC');
      return startAt ? zonedDayKey(startAt, timeZone) === dayKey : true;
    });
  } else {
    partialErrors.push(
      meetRes.reason instanceof Error
        ? `Meetings: ${meetRes.reason.message}`
        : 'Meetings: could not load',
    );
  }

  if (todoRes.status === 'fulfilled') {
    tasks = todoRes.value.filter((t) => {
      if ((t.status ?? '').toLowerCase() === 'completed') return false;
      const due = dueDateKey(t);
      if (!due) return false;
      return due <= dayKey;
    });
  } else {
    partialErrors.push(
      todoRes.reason instanceof Error
        ? `To Do: ${todoRes.reason.message}`
        : 'To Do: could not load',
    );
  }

  // Dedupe online meetings that already appear as calendar events
  const eventJoinKeys = new Set(
    events
      .map((e) => joinUrlKey(e.onlineMeeting?.joinUrl))
      .filter(Boolean) as string[],
  );
  const uniqueMeetings = meetings.filter((m) => {
    const key = joinUrlKey(m.join_url);
    return !key || !eventJoinKeys.has(key);
  });

  return {
    timeZone,
    dayKey,
    connected: true,
    events: events.map((ev) => {
      const startAt = parseGraphDateTime(ev.start?.dateTime, ev.start?.timeZone);
      return {
        subject: (ev.subject || '(No title)').trim(),
        startLabel: startAt
          ? formatTimeInZone(startAt, timeZone, { allDay: Boolean(ev.isAllDay) })
          : ev.isAllDay
            ? 'All day'
            : '—',
        allDay: Boolean(ev.isAllDay),
        location: ev.location?.displayName?.trim() || null,
        isOnline: Boolean(ev.onlineMeeting?.joinUrl || ev.isOnlineMeeting),
      };
    }),
    meetings: uniqueMeetings.map((m) => {
      const startAt = parseGraphDateTime(m.start, 'UTC');
      return {
        subject: (m.subject || '(No title)').trim(),
        startLabel: startAt ? formatTimeInZone(startAt, timeZone) : '—',
        joinUrl: m.join_url,
      };
    }),
    tasks: tasks.map((t) => {
      const due = dueDateKey(t);
      return {
        title: (t.title || '(Untitled)').trim(),
        dueLabel: due,
        overdue: Boolean(due && due < dayKey),
        importance: t.importance ?? null,
      };
    }),
    partialErrors,
  };
}

export function snapshotToPlainText(snapshot: TodayDigestSnapshot): string {
  const lines: string[] = [
    `Day: ${snapshot.dayKey} (${snapshot.timeZone})`,
    `Microsoft connected: ${snapshot.connected ? 'yes' : 'no'}`,
    '',
    `Schedule (${snapshot.events.length}):`,
  ];
  if (!snapshot.events.length) {
    lines.push('  (none)');
  } else {
    for (const e of snapshot.events.slice(0, 20)) {
      lines.push(
        `  - ${e.startLabel}: ${e.subject}${e.location ? ` @ ${e.location}` : ''}${e.isOnline ? ' [online]' : ''}`,
      );
    }
  }
  lines.push('', `Extra Teams meetings (${snapshot.meetings.length}):`);
  if (!snapshot.meetings.length) {
    lines.push('  (none)');
  } else {
    for (const m of snapshot.meetings.slice(0, 10)) {
      lines.push(`  - ${m.startLabel}: ${m.subject}`);
    }
  }
  lines.push('', `To Do due today / overdue (${snapshot.tasks.length}):`);
  if (!snapshot.tasks.length) {
    lines.push('  (none)');
  } else {
    for (const t of snapshot.tasks.slice(0, 25)) {
      lines.push(
        `  - ${t.title}${t.overdue ? ' (overdue)' : ''}${t.dueLabel ? ` — due ${t.dueLabel}` : ''}`,
      );
    }
  }
  if (snapshot.partialErrors.length) {
    lines.push('', 'Notes:', ...snapshot.partialErrors.map((e) => `  - ${e}`));
  }
  return lines.join('\n');
}

async function callGrokWinTheDay(opts: {
  firstName: string;
  snapshotText: string;
}): Promise<{ note: string; model: string | null }> {
  if (!grokConfigured()) {
    return {
      note: buildFallbackWinNote(opts.firstName),
      model: null,
    };
  }

  const apiKey = Deno.env.get('XAI_API_KEY')!.trim();
  const model = grokModel();
  const system = [
    'You are the personal AI assistant for a Tage Venture Capital portal user.',
    'Write a short, warm, practical “win the day” note (3–6 short sentences or a tiny numbered list).',
    'Tone: encouraging personal assistant — positive, concrete, never preachy or corporate.',
    'Ground suggestions in the Today summary (meetings + To Do). If the day looks light, suggest one high-leverage focus.',
    'Do not invent meetings or tasks that are not in the summary.',
    'Do not mention that you are Grok, xAI, or an API. Sign off as their Tage AI assistant only if natural.',
    'Plain text only — no markdown headings, no HTML.',
  ].join(' ');

  const user = [
    `User first name: ${opts.firstName}`,
    '',
    'Today summary from their Tage portal:',
    opts.snapshotText,
    '',
    'Write the win-the-day note now.',
  ].join('\n');

  try {
    const res = await fetch(XAI_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('morning digest Grok error', res.status, text.slice(0, 300));
      return { note: buildFallbackWinNote(opts.firstName), model: null };
    }
    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content?.trim();
    if (!content) {
      return { note: buildFallbackWinNote(opts.firstName), model: null };
    }
    return { note: content, model };
  } catch (err) {
    console.warn('morning digest Grok failed', err);
    return { note: buildFallbackWinNote(opts.firstName), model: null };
  }
}

function buildFallbackWinNote(name: string): string {
  return [
    `Good morning, ${name}.`,
    'Open your Today view, pick the one meeting or task that moves the needle most, and protect focus time around it.',
    'Knock out any overdue To Dos first so the rest of the day feels lighter — you’ve got this.',
  ].join(' ');
}

function renderDigestHtml(opts: {
  firstName: string;
  snapshot: TodayDigestSnapshot;
  winNote: string;
  todayUrl: string;
}): string {
  const { firstName, snapshot, winNote, todayUrl } = opts;

  const eventRows = snapshot.events.length
    ? snapshot.events
        .map(
          (e) =>
            `<li><strong>${escapeHtml(e.startLabel)}</strong> — ${escapeHtml(e.subject)}${
              e.location ? ` <span style="color:#666;">@ ${escapeHtml(e.location)}</span>` : ''
            }</li>`,
        )
        .join('')
    : '<li style="color:#666;">Nothing on the calendar</li>';

  const meetingRows = snapshot.meetings.length
    ? snapshot.meetings
        .map(
          (m) =>
            `<li><strong>${escapeHtml(m.startLabel)}</strong> — ${escapeHtml(m.subject)}</li>`,
        )
        .join('')
    : '';

  const taskRows = snapshot.tasks.length
    ? snapshot.tasks
        .map(
          (t) =>
            `<li>${escapeHtml(t.title)}${
              t.overdue
                ? ' <span style="color:#b45309;">(overdue)</span>'
                : t.dueLabel
                  ? ` <span style="color:#666;">— due ${escapeHtml(t.dueLabel)}</span>`
                  : ''
            }</li>`,
        )
        .join('')
    : '<li style="color:#666;">No To Dos due today</li>';

  const winHtml = escapeHtml(winNote).replace(/\n/g, '<br/>');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6f8;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e5e7eb;">
        <tr><td style="background:#0f172a;color:#fff;padding:20px 24px;">
          <div style="font-size:13px;letter-spacing:0.04em;opacity:0.85;">TAGE VENTURE CAPITAL</div>
          <div style="font-size:22px;font-weight:600;margin-top:4px;">Your morning briefing</div>
          <div style="font-size:14px;opacity:0.9;margin-top:6px;">From your personal AI assistant · ${escapeHtml(snapshot.dayKey)}</div>
        </td></tr>
        <tr><td style="padding:24px;">
          <p style="margin:0 0 16px;font-size:15px;line-height:1.5;">Good morning, ${escapeHtml(firstName)}.</p>
          <h2 style="margin:0 0 8px;font-size:16px;">Win the day</h2>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;background:#f8fafc;border-left:3px solid #0f172a;padding:12px 14px;">${winHtml}</p>
          <h2 style="margin:0 0 8px;font-size:16px;">Today’s schedule</h2>
          <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.5;">${eventRows}</ul>
          ${
            meetingRows
              ? `<h2 style="margin:0 0 8px;font-size:16px;">Teams meetings</h2><ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.5;">${meetingRows}</ul>`
              : ''
          }
          <h2 style="margin:0 0 8px;font-size:16px;">To Do (due / overdue)</h2>
          <ul style="margin:0 0 20px;padding-left:20px;font-size:14px;line-height:1.5;">${taskRows}</ul>
          ${
            snapshot.partialErrors.length
              ? `<p style="font-size:12px;color:#666;margin:0 0 16px;">${escapeHtml(snapshot.partialErrors.join(' · '))}</p>`
              : ''
          }
          <p style="margin:0;">
            <a href="${escapeHtml(todayUrl)}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:10px 16px;border-radius:6px;font-size:14px;font-weight:600;">Open Today</a>
          </p>
          <p style="margin:20px 0 0;font-size:12px;color:#888;line-height:1.4;">
            You’re receiving this because morning digest is on in Today settings.
            Opt out anytime under <strong>Today → settings → Morning digest</strong>.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function claimDigestDay(
  service: ReturnType<typeof createServiceClient>,
  userId: string,
  dayKey: string,
): Promise<boolean> {
  const { data, error } = await service
    .from('sales_users')
    .update({ morning_digest_last_sent_on: dayKey })
    .eq('id', userId)
    .or(
      `morning_digest_last_sent_on.is.null,morning_digest_last_sent_on.neq."${dayKey}"`,
    )
    .select('id')
    .maybeSingle();

  if (error) {
    console.warn('digest claim failed', userId, error.message);
    return false;
  }
  return Boolean(data?.id);
}

export async function processMorningDigests(
  opts: ProcessDigestOpts = {},
): Promise<ProcessDigestResult> {
  const service = createServiceClient();
  const now = opts.now ?? new Date();
  const dryRun = Boolean(opts.dryRun);
  const force = Boolean(opts.force);
  const filterEmail = opts.email?.trim().toLowerCase() || null;

  let query = service
    .from('sales_users')
    .select(
      'id, email, full_name, timezone, morning_digest_enabled, morning_digest_last_sent_on',
    )
    .eq('active', true)
    .eq('morning_digest_enabled', true);

  if (filterEmail) {
    query = query.eq('email', filterEmail);
  }

  const { data: users, error } = await query;
  if (error) throw new Error(error.message);

  const list = (users ?? []) as DigestUser[];
  const result: ProcessDigestResult = {
    scanned: list.length,
    eligible: 0,
    sent: 0,
    skipped: 0,
    errors: [],
    dry_run: dryRun,
    samples: dryRun ? [] : undefined,
  };

  let msConfig: ReturnType<typeof getMsConfig> | null = null;
  try {
    msConfig = getMsConfig();
  } catch {
    msConfig = null;
  }

  for (const user of list) {
    let accessToken: string | null = null;
    if (msConfig) {
      try {
        const tok = await getValidAccessToken(service, msConfig, user.id);
        accessToken = tok.accessToken;
      } catch {
        accessToken = null;
      }
    }

    const timeZone = await resolveDigestTimezone(user, accessToken);
    const dayKey = zonedDayKey(now, timeZone);

    if (!force && !isInLocalHourWindow(now, timeZone, DIGEST_HOUR, DIGEST_WINDOW_MINUTES)) {
      result.skipped += 1;
      continue;
    }

    if (!force && user.morning_digest_last_sent_on === dayKey) {
      result.skipped += 1;
      continue;
    }

    result.eligible += 1;

    try {
      const snapshot = await buildTodaySnapshot(
        service,
        user,
        timeZone,
        accessToken,
      );
      const name = firstName(user.full_name, user.email);
      const { note } = await callGrokWinTheDay({
        firstName: name,
        snapshotText: snapshotToPlainText(snapshot),
      });

      const todayUrl = `${portalBaseUrl()}/sales/today`;
      const subject = `Your morning briefing · ${snapshot.dayKey}`;
      const html = renderDigestHtml({
        firstName: name,
        snapshot,
        winNote: note,
        todayUrl,
      });

      if (dryRun) {
        result.samples?.push({
          email: user.email,
          dayKey,
          timeZone,
          subject,
          preview: note.slice(0, 240),
        });
        result.sent += 1;
        continue;
      }

      if (!force) {
        const claimed = await claimDigestDay(service, user.id, dayKey);
        if (!claimed) {
          result.skipped += 1;
          result.eligible -= 1;
          continue;
        }
      } else {
        await service
          .from('sales_users')
          .update({ morning_digest_last_sent_on: dayKey })
          .eq('id', user.id);
      }

      const send = await sendResendEmail({
        to: user.email,
        subject,
        html,
        tags: {
          kind: 'morning-digest',
          day: dayKey,
        },
      });

      if (!send.ok) {
        result.errors.push({
          email: user.email,
          error: send.error ?? 'send failed',
        });
        continue;
      }

      result.sent += 1;
    } catch (err) {
      result.errors.push({
        email: user.email,
        error: err instanceof Error ? err.message : 'Unexpected error',
      });
    }
  }

  return result;
}

/** Exported for unit-style checks in dry runs. */
export function localPartsForDebug(now: Date, timeZone: string) {
  return getZonedParts(now, timeZone);
}
