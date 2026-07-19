import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MsWorkSidePanel } from '../components/MsWorkSidePanel';
import {
  completeTodoTask,
  eventCalendarKey,
  fetchCalendarEventsDetailed,
  fetchCalendarStatus,
  fetchMailboxSettings,
  fetchMasterPortalTodos,
  fetchUpcomingOnlineMeetings,
  loadDisabledCalendarIds,
  setMyMorningDigestEnabled,
  setMyTimezone,
  setMyWorkEmail,
  startCalendarOAuth,
  type CalendarEvent,
  type CalendarStatus,
  type OnlineMeeting,
  type TodoTask,
} from '../lib/calendarApi';
import { dueDateInputValue, formatTodoDue, sortTodoTasks } from '../lib/msTaskUtils';
import { MASTER_TODO_SLUG } from '../lib/portalTodo';
import type { SalesUser } from '../lib/types';
import {
  cacheMailboxTimezone,
  endOfZonedDay,
  formatInTimeZone,
  formatTimeInZone,
  parseGraphDateTime,
  resolveUserTimezone,
  setPreferredTimezoneOverride,
  startOfZonedDay,
  zonedDayKey,
  type ResolvedTimezone,
} from '../lib/userTimezone';

type Props = { salesUser: SalesUser };

type FlatTask = TodoTask & { portal_slug: string; list_id: string };

type TimelineItem =
  | {
      kind: 'calendar';
      id: string;
      sortKey: number;
      allDay: boolean;
      event: CalendarEvent;
      start: Date | null;
    }
  | {
      kind: 'meeting';
      id: string;
      sortKey: number;
      allDay: boolean;
      meeting: OnlineMeeting;
      start: Date | null;
    };

function isDueTodayOrOverdue(task: TodoTask, dayKey: string): boolean {
  if (task.completed) return false;
  const due = dueDateInputValue(task.due);
  if (!due) return false;
  return due <= dayKey;
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

const SETTINGS_OPEN_KEY = 'ms_today_settings_open';

/** Settings panel starts collapsed so Today content has more room. */
function loadSettingsOpen(): boolean {
  try {
    return localStorage.getItem(SETTINGS_OPEN_KEY) === '1';
  } catch {
    return false;
  }
}

function saveSettingsOpen(open: boolean): void {
  try {
    localStorage.setItem(SETTINGS_OPEN_KEY, open ? '1' : '0');
  } catch {
    /* ignore quota */
  }
}

export function TodayPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [partialErrors, setPartialErrors] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => loadSettingsOpen());
  const [tzInfo, setTzInfo] = useState<ResolvedTimezone>(() =>
    resolveUserTimezone({ profileTimezone: salesUser.timezone }),
  );
  const [digestEnabled, setDigestEnabled] = useState(
    salesUser.morning_digest_enabled !== false,
  );
  const [savingDigest, setSavingDigest] = useState(false);
  const timeZone = tzInfo.timeZone;

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [meetings, setMeetings] = useState<OnlineMeeting[]>([]);
  const [tasks, setTasks] = useState<FlatTask[]>([]);
  const [completingId, setCompletingId] = useState<string | null>(null);

  const dayAnchor = useMemo(() => startOfZonedDay(new Date(), timeZone), [timeZone]);
  const dayKey = useMemo(() => zonedDayKey(dayAnchor, timeZone), [dayAnchor, timeZone]);

  const toggleSettings = useCallback(() => {
    setSideOpen((prev) => {
      const next = !prev;
      saveSettingsOpen(next);
      return next;
    });
  }, []);

  const closeSettings = useCallback(() => {
    setSideOpen(false);
    saveSettingsOpen(false);
  }, []);

  const refreshTimezone = useCallback(
    (mailboxRaw?: string | null) => {
      const next = resolveUserTimezone({
        profileTimezone: salesUser.timezone,
        ...(mailboxRaw !== undefined ? { mailboxTimeZone: mailboxRaw } : {}),
      });
      setTzInfo(next);
      return next;
    },
    [salesUser.timezone],
  );

  const loadStatus = useCallback(async () => {
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');

      if (s.connected && s.capabilities?.mailbox_settings) {
        try {
          const mailbox = await fetchMailboxSettings();
          const raw = mailbox.mailbox?.timeZone ?? null;
          cacheMailboxTimezone(raw);
          refreshTimezone(raw);
        } catch {
          refreshTimezone();
        }
      } else {
        refreshTimezone();
      }
      return s;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Microsoft status');
      return null;
    }
  }, [refreshTimezone]);

  const loadDay = useCallback(
    async (s: CalendarStatus | null, opts: { audit?: boolean } = {}) => {
      if (!s?.connected) {
        setEvents([]);
        setMeetings([]);
        setTasks([]);
        setPartialErrors([]);
        return;
      }

      const start = startOfZonedDay(new Date(), timeZone);
      const end = endOfZonedDay(start, timeZone);
      const startIso = start.toISOString();
      const endIso = end.toISOString();
      const todayKey = zonedDayKey(start, timeZone);
      const soft: string[] = [];

      const canCal = Boolean(s.capabilities?.list_events);
      const canTodo = Boolean(s.capabilities?.todo);
      const canMeetings = Boolean(s.capabilities?.online_meetings);

      const [calRes, todoRes, meetRes] = await Promise.allSettled([
        canCal
          ? fetchCalendarEventsDetailed(startIso, endIso, { audit: opts.audit !== false })
          : Promise.resolve({ events: [] as CalendarEvent[], calendars: [] }),
        canTodo
          ? fetchMasterPortalTodos([])
          : Promise.resolve({ portals: [] as Awaited<ReturnType<typeof fetchMasterPortalTodos>>['portals'] }),
        canMeetings
          ? fetchUpcomingOnlineMeetings({
              start: startIso,
              end: endIso,
              top: 50,
              audit: opts.audit !== false,
            })
          : Promise.resolve([] as OnlineMeeting[]),
      ]);

      if (calRes.status === 'fulfilled') {
        const disabled = loadDisabledCalendarIds();
        const disabledSet = new Set(disabled);
        const filtered = (calRes.value.events ?? []).filter((ev) => {
          if (ev.calendar_id && disabledSet.has(ev.calendar_id)) return false;
          const startAt = parseGraphDateTime(ev.start, ev.start_timezone);
          if (!startAt) return ev.is_all_day;
          return zonedDayKey(startAt, timeZone) === todayKey;
        });
        setEvents(filtered);
      } else {
        setEvents([]);
        soft.push(
          calRes.reason instanceof Error
            ? `Calendar: ${calRes.reason.message}`
            : 'Calendar: could not load events',
        );
      }

      if (todoRes.status === 'fulfilled') {
        const bucket = todoRes.value.portals?.[0];
        const flat: FlatTask[] = (bucket?.tasks ?? []).map((task) => ({
          ...task,
          portal_slug: bucket?.portal_slug ?? MASTER_TODO_SLUG,
          list_id: bucket?.list_id ?? '',
        }));
        const todayTasks = sortTodoTasks(
          flat.filter((t) => isDueTodayOrOverdue(t, todayKey)),
        ) as FlatTask[];
        setTasks(todayTasks);
      } else {
        setTasks([]);
        soft.push(
          todoRes.reason instanceof Error
            ? `To Do: ${todoRes.reason.message}`
            : 'To Do: could not load tasks',
        );
      }

      if (meetRes.status === 'fulfilled') {
        const filtered = (meetRes.value ?? []).filter((m) => {
          if (!m.start) return true;
          const startAt = parseGraphDateTime(m.start, 'UTC');
          return startAt ? zonedDayKey(startAt, timeZone) === todayKey : true;
        });
        setMeetings(filtered);
      } else {
        setMeetings([]);
        soft.push(
          meetRes.reason instanceof Error
            ? `Meetings: ${meetRes.reason.message}`
            : 'Meetings: could not load Teams meetings',
        );
      }

      if (!canCal) soft.push('Calendar permission missing — reconnect after admin consent.');
      if (!canTodo) soft.push('To Do permission missing — reconnect after admin consent.');
      if (!canMeetings) soft.push('Online meetings permission missing — reconnect after admin consent.');

      setPartialErrors(soft);
    },
    [timeZone],
  );

  const refreshAll = useCallback(
    async (opts: { audit?: boolean; initial?: boolean } = {}) => {
      setError(null);
      if (opts.initial) setLoading(true);
      else setRefreshing(true);
      try {
        const s = await loadStatus();
        await loadDay(s, { audit: opts.audit });
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [loadDay, loadStatus],
  );

  useEffect(() => {
    void refreshAll({ initial: true, audit: true });
  }, [refreshAll]);

  useEffect(() => {
    const connected = searchParams.get('calendar_connected');
    const calendarError = searchParams.get('calendar_error');
    if (connected === '1') {
      setNotice('Work mailbox connected. Today is ready to refresh.');
      searchParams.delete('calendar_connected');
      setSearchParams(searchParams, { replace: true });
      void refreshAll({ audit: true });
    }
    if (calendarError) {
      setError(calendarError);
      searchParams.delete('calendar_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, refreshAll]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/today');
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start Microsoft sign-in');
      setConnecting(false);
    }
  }

  async function onSaveWorkEmail() {
    setSavingEmail(true);
    setError(null);
    try {
      await setMyWorkEmail(workEmailDraft.trim() || null);
      setNotice('Work email saved. Use Connect to link that Microsoft mailbox.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save work email');
    } finally {
      setSavingEmail(false);
    }
  }

  function onTimezoneChange(value: string) {
    if (value === '__auto__') {
      setPreferredTimezoneOverride(null);
      void setMyTimezone(null).catch(() => {
        /* local UI still updates */
      });
    } else {
      setPreferredTimezoneOverride(value);
      void setMyTimezone(value).catch(() => {
        /* local UI still updates */
      });
    }
    const next = resolveUserTimezone({
      profileTimezone: value === '__auto__' ? null : value,
    });
    setTzInfo(next);
    setNotice(
      value === '__auto__'
        ? `Timezone set to auto (${next.timeZone}).`
        : `Timezone set to ${next.timeZone}.`,
    );
  }

  async function onMorningDigestChange(enabled: boolean) {
    setSavingDigest(true);
    setError(null);
    try {
      await setMyMorningDigestEnabled(enabled);
      setDigestEnabled(enabled);
      setNotice(
        enabled
          ? 'Morning digest enabled — briefing around 6:00 AM in your timezone.'
          : 'Morning digest turned off.',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update digest preference');
    } finally {
      setSavingDigest(false);
    }
  }

  async function onCompleteTask(task: FlatTask) {
    const listId = task.list_id;
    if (!listId) return;
    setCompletingId(task.id);
    setError(null);
    try {
      await completeTodoTask(listId, task.id, MASTER_TODO_SLUG);
      setTasks((prev) => prev.filter((t) => t.id !== task.id));
      setNotice('Task completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not complete task');
    } finally {
      setCompletingId(null);
    }
  }

  const timeline = useMemo(() => {
    const calItems: TimelineItem[] = events.map((event) => {
      const start = parseGraphDateTime(event.start, event.start_timezone);
      const allDay = Boolean(event.is_all_day);
      return {
        kind: 'calendar' as const,
        id: `cal-${eventCalendarKey(event)}`,
        sortKey: allDay ? 0 : start?.getTime() ?? Number.MAX_SAFE_INTEGER,
        allDay,
        event,
        start,
      };
    });

    const calJoinKeys = new Set(
      events
        .map((e) => joinUrlKey(e.online_meeting_url))
        .filter((k): k is string => Boolean(k)),
    );

    const meetingItems: TimelineItem[] = meetings
      .filter((m) => {
        const key = joinUrlKey(m.join_url);
        if (key && calJoinKeys.has(key)) return false;
        return true;
      })
      .map((meeting) => {
        const start = parseGraphDateTime(meeting.start, 'UTC');
        return {
          kind: 'meeting' as const,
          id: `meet-${meeting.id}`,
          sortKey: start?.getTime() ?? Number.MAX_SAFE_INTEGER - 1,
          allDay: false,
          meeting,
          start,
        };
      });

    return [...calItems, ...meetingItems].sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.sortKey !== b.sortKey) return a.sortKey - b.sortKey;
      const aTitle =
        a.kind === 'calendar' ? a.event.subject : a.meeting.subject || 'Teams meeting';
      const bTitle =
        b.kind === 'calendar' ? b.event.subject : b.meeting.subject || 'Teams meeting';
      return aTitle.localeCompare(bTitle, undefined, { sensitivity: 'base' });
    });
  }, [events, meetings]);

  const overdueCount = useMemo(
    () => tasks.filter((t) => dueDateInputValue(t.due) < dayKey).length,
    [tasks, dayKey],
  );

  const canWriteTodo = Boolean(status?.capabilities?.todo);
  const busy = loading || refreshing;

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Today</h1>
          <p className="muted">
            {formatInTimeZone(dayAnchor, timeZone, {
              weekday: 'long',
              month: 'long',
              day: 'numeric',
              year: 'numeric',
            })}
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}
            {` · ${timeZone}`}. Calendar, Teams
            meetings, and To Dos due today or overdue — one place to clear the day.{' '}
            <Link to="/sales/calendar">Calendar</Link>
            {' · '}
            <Link to="/sales/todo">To Do</Link>
            {' · '}
            <Link to="/sales/meetings">Meetings</Link>
          </p>
        </div>
        <div className="page-actions">
          {status?.connected ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void refreshAll({ audit: true })}
              disabled={busy}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting || status?.configured === false}
            >
              {connecting ? 'Redirecting…' : 'Connect work mailbox'}
            </button>
          )}
          {status?.connected && status.needs_scope_upgrade ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting}
            >
              {connecting ? 'Redirecting…' : 'Reconnect'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn cal-settings-toggle"
            aria-expanded={sideOpen}
            aria-controls="today-settings"
            onClick={toggleSettings}
          >
            {sideOpen ? 'Hide Settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {partialErrors.length > 0 ? (
        <div className="banner warn">
          Some sections could not load:{' '}
          {partialErrors.join(' · ')}
          {status?.connected ? (
            <>
              {' '}
              Try <strong>Refresh</strong> or{' '}
              <button type="button" className="btn ghost today-inline-btn" onClick={() => void onConnect()}>
                Reconnect
              </button>
              .
            </>
          ) : null}
        </div>
      ) : null}
      {status?.needs_scope_upgrade ? (
        <div className="banner warn">
          Your Microsoft connection is missing newer permissions. Click <strong>Reconnect</strong>{' '}
          after an admin grants consent in Azure.
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div
          className={`detail-grid calendar-layout${sideOpen ? '' : ' settings-collapsed'}`}
        >
          <div className="panel app-main today-main">
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
                <p>Connect your Tage work mailbox to see today’s calendar, meetings, and To Dos.</p>
                <p className="muted">
                  Portal login ({salesUser.email}) can differ from your Microsoft account. Set work
                  email in the sidebar, then connect.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Connect work mailbox'}
                </button>
              </div>
            ) : (
              <>
                <section className="today-section">
                  <div className="panel-head">
                    <h2>Schedule</h2>
                    {refreshing ? <span className="muted small">Syncing…</span> : null}
                  </div>
                  <p className="muted small">
                    Calendar events and Teams meetings for today, sorted by time. Calendar selection
                    matches <Link to="/sales/calendar">Calendar</Link> (all selected by default).
                  </p>
                  {timeline.length === 0 ? (
                    <div className="empty today-empty">
                      <p>Nothing on the schedule for today.</p>
                      <p className="muted">
                        Add from <Link to="/sales/calendar">Calendar</Link> or{' '}
                        <Link to="/sales/meetings">Teams Meetings</Link>.
                      </p>
                    </div>
                  ) : (
                    <ul className="today-timeline">
                      {timeline.map((item) => {
                        if (item.kind === 'calendar') {
                          const { event, start, allDay } = item;
                          const when = start ? formatTimeInZone(start, timeZone, allDay) : '—';
                          return (
                            <li key={item.id} className="today-timeline-item">
                              <div className="today-when">{when}</div>
                              <div className="today-body">
                                <div className="today-title-row">
                                  <span className="today-kind">
                                    <span
                                      className="cal-dot"
                                      style={{
                                        background: event.calendar_color || 'var(--gold)',
                                        marginRight: '0.35rem',
                                      }}
                                      aria-hidden
                                    />
                                    {event.calendar_name || 'Calendar'}
                                  </span>
                                  <span className="today-title">{event.subject}</span>
                                </div>
                                {event.location ? (
                                  <span className="muted small">{event.location}</span>
                                ) : null}
                              </div>
                              <div className="today-actions">
                                {event.online_meeting_url ? (
                                  <a
                                    className="btn primary"
                                    href={event.online_meeting_url}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Join
                                  </a>
                                ) : null}
                                {event.web_link ? (
                                  <a
                                    className="btn ghost"
                                    href={event.web_link}
                                    target="_blank"
                                    rel="noreferrer"
                                  >
                                    Open
                                  </a>
                                ) : null}
                              </div>
                            </li>
                          );
                        }

                        const { meeting, start } = item;
                        const when = start ? formatTimeInZone(start, timeZone, false) : 'Anytime';
                        return (
                          <li key={item.id} className="today-timeline-item">
                            <div className="today-when">{when}</div>
                            <div className="today-body">
                              <div className="today-title-row">
                                <span className="today-kind">Teams</span>
                                <span className="today-title">
                                  {meeting.subject || 'Teams meeting'}
                                </span>
                              </div>
                            </div>
                            <div className="today-actions">
                              {meeting.join_url ? (
                                <a
                                  className="btn primary"
                                  href={meeting.join_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  Join
                                </a>
                              ) : (
                                <span className="muted small">No join link</span>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                <section className="today-section">
                  <div className="panel-head">
                    <h2>To Do</h2>
                    {overdueCount > 0 ? (
                      <span className="muted small">{overdueCount} overdue</span>
                    ) : null}
                  </div>
                  <p className="muted small">
                    Open Master To Do items due today or overdue.
                  </p>
                  {!canWriteTodo ? (
                    <div className="empty today-empty">
                      <p>Microsoft To Do needs Tasks.ReadWrite.</p>
                      <p className="muted">Reconnect after an admin grants consent.</p>
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() => void onConnect()}
                      >
                        Reconnect
                      </button>
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="empty today-empty">
                      <p>No To Dos due today or overdue.</p>
                      <p className="muted">
                        Capture more from the header, or open the full{' '}
                        <Link to="/sales/todo">To Do</Link> list.
                      </p>
                    </div>
                  ) : (
                    <ul className="cal-task-list">
                      {tasks.map((t) => {
                        const dueDay = dueDateInputValue(t.due);
                        const overdue = Boolean(dueDay && dueDay < dayKey);
                        return (
                          <li key={t.id} className="cal-task-item">
                            <button
                              type="button"
                              className="cal-task-check"
                              title="Complete"
                              disabled={completingId === t.id}
                              onClick={() => void onCompleteTask(t)}
                            >
                              {completingId === t.id ? '…' : '○'}
                            </button>
                            <div className="cal-task-body">
                              <div className="cal-task-title-row">
                                <span className="cal-task-title">{t.title}</span>
                                {overdue ? (
                                  <span className="today-overdue-badge">Overdue</span>
                                ) : null}
                              </div>
                              <div className="cal-task-meta">
                                {t.due ? (
                                  <span className="muted small">{formatTodoDue(t.due)}</span>
                                ) : null}
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>
              </>
            )}
          </div>

          <MsWorkSidePanel
            salesUser={salesUser}
            status={status}
            workEmailDraft={workEmailDraft}
            savingEmail={savingEmail}
            connecting={connecting}
            sideOpen={sideOpen}
            onClose={closeSettings}
            panelId="today-settings"
            title="Today settings"
            alertPath="/sales/today"
            alertBlurb="While a portal tab is open: due/overdue To Do tasks and meeting reminders."
            capabilityLabels={[
              status?.capabilities?.list_events ? 'Calendar' : null,
              status?.capabilities?.todo ? 'To Do' : null,
              status?.capabilities?.online_meetings ? 'Online meetings' : null,
            ].filter(Boolean) as string[]}
            extraMeta={[{ label: 'Timezone', value: timeZone }]}
            resolvedTimezone={tzInfo}
            onTimezoneChange={onTimezoneChange}
            morningDigestEnabled={digestEnabled}
            onMorningDigestChange={onMorningDigestChange}
            savingDigest={savingDigest}
            onWorkEmailChange={setWorkEmailDraft}
            onSaveWorkEmail={onSaveWorkEmail}
            onConnect={onConnect}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
      )}
    </div>
  );
}
