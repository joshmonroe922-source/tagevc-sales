import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MsWorkSidePanel } from '../components/MsWorkSidePanel';
import {
  CalendarApiError,
  addPersonalCalendarFeed,
  createCalendarMeeting,
  eventCalendarKey,
  fetchCalendarEventsDetailed,
  fetchCalendarStatus,
  fetchMailboxSettings,
  listPersonalCalendarFeeds,
  loadDisabledCalendarIds,
  removePersonalCalendarFeed,
  saveDisabledCalendarIds,
  searchMeetingPeople,
  setMyCalendarDefaultView,
  setMyTimezone,
  setMyWorkEmail,
  startCalendarOAuth,
  suggestMeetingLocations,
  type CalendarEvent,
  type CalendarStatus,
  type CalendarViewMode,
  type LocationSuggestion,
  type OutlookCalendar,
  type PeopleSuggestion,
  type PersonalCalendarFeed,
} from '../lib/calendarApi';
import { loadAlertPrefs } from '../lib/desktopAlerts';
import type { SalesUser } from '../lib/types';
import {
  addZonedDays,
  cacheMailboxTimezone,
  defaultMeetingTimesInZone,
  endOfZonedMonth,
  formatInTimeZone,
  formatTimeInZone,
  getZonedParts,
  parseGraphDateTime,
  resolveUserTimezone,
  setPreferredTimezoneOverride,
  startOfZonedDay,
  startOfZonedMonth,
  startOfZonedWeek,
  wallTimeInZoneToUtc,
  zonedDayKey,
  type ResolvedTimezone,
} from '../lib/userTimezone';

type Props = { salesUser: SalesUser };

type ViewMode = CalendarViewMode;

function resolveDefaultView(
  salesUser: SalesUser,
  status: CalendarStatus | null,
): ViewMode {
  const fromStatus = status?.calendar_default_view;
  const fromUser = salesUser.calendar_default_view;
  const v = fromStatus || fromUser || 'agenda';
  return v === 'month' || v === 'week' || v === 'agenda' ? v : 'agenda';
}

function isEventEnabled(ev: CalendarEvent, disabledIds: string[]): boolean {
  if (!disabledIds.length) return true;
  if (!ev.calendar_id) return true;
  return !disabledIds.includes(ev.calendar_id);
}

const SETTINGS_OPEN_KEY = 'ms_calendar_settings_open';

/** Settings panel starts collapsed so the calendar has more room. */
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

export function CalendarPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [allEvents, setAllEvents] = useState<CalendarEvent[]>([]);
  const [calendars, setCalendars] = useState<OutlookCalendar[]>([]);
  const [disabledCalendarIds, setDisabledCalendarIds] = useState<string[]>(() =>
    loadDisabledCalendarIds(),
  );
  const [view, setView] = useState<ViewMode>(() =>
    resolveDefaultView(salesUser, null),
  );
  const [viewInitialized, setViewInitialized] = useState(false);
  const [tzInfo, setTzInfo] = useState<ResolvedTimezone>(() =>
    resolveUserTimezone({ profileTimezone: salesUser.timezone }),
  );
  const timeZone = tzInfo.timeZone;
  const [cursor, setCursor] = useState(() =>
    startOfZonedDay(
      new Date(),
      resolveUserTimezone({ profileTimezone: salesUser.timezone }).timeZone,
    ),
  );
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [meetingOpen, setMeetingOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(() => loadSettingsOpen());
  const [needsReconnect, setNeedsReconnect] = useState(false);
  const [personalFeeds, setPersonalFeeds] = useState<PersonalCalendarFeed[]>([]);
  const [personalHint, setPersonalHint] = useState<string | null>(null);
  const [icsName, setIcsName] = useState('Personal / Google');
  const [icsUrl, setIcsUrl] = useState('');
  const [icsSaving, setIcsSaving] = useState(false);

  const events = useMemo(
    () => allEvents.filter((ev) => isEventEnabled(ev, disabledCalendarIds)),
    [allEvents, disabledCalendarIds],
  );

  const openSettings = useCallback(() => {
    setSideOpen(true);
    saveSettingsOpen(true);
    requestAnimationFrame(() => {
      document
        .getElementById('cal-personal-google')
        ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }, []);

  const toggleSettings = useCallback(() => {
    setSideOpen((prev) => {
      const next = !prev;
      saveSettingsOpen(next);
      if (next) {
        requestAnimationFrame(() => {
          document
            .getElementById('cal-personal-google')
            ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
      }
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

  const range = useMemo(() => {
    if (view === 'week') {
      const start = startOfZonedWeek(cursor, timeZone);
      return { start, end: addZonedDays(start, 7, timeZone) };
    }
    if (view === 'agenda') {
      const start = startOfZonedDay(cursor, timeZone);
      return { start, end: addZonedDays(start, 14, timeZone) };
    }
    const monthStart = startOfZonedMonth(cursor, timeZone);
    const gridStart = startOfZonedWeek(monthStart, timeZone);
    const monthEnd = endOfZonedMonth(cursor, timeZone);
    const gridEnd = addZonedDays(startOfZonedWeek(monthEnd, timeZone), 7, timeZone);
    return { start: gridStart, end: gridEnd };
  }, [cursor, view, timeZone]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');
      if (!viewInitialized) {
        setView(resolveDefaultView(salesUser, s));
        setViewInitialized(true);
      }

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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar status');
    }
  }, [salesUser, viewInitialized, refreshTimezone]);

  const loadEvents = useCallback(
    async (opts: { audit?: boolean } = {}) => {
      if (!status?.configured) {
        setAllEvents([]);
        setCalendars([]);
        return;
      }
      // Graph path needs Connect; ICS-only works after feeds are saved.
      if (!status.connected && personalFeeds.length === 0) {
        setAllEvents([]);
        setCalendars([]);
        return;
      }
      setEventsLoading(true);
      if (opts.audit !== false) setError(null);
      try {
        const res = await fetchCalendarEventsDetailed(
          range.start.toISOString(),
          range.end.toISOString(),
          { audit: opts.audit !== false },
        );
        setAllEvents(res.events);
        setCalendars(res.calendars);
        setNeedsReconnect(false);
        if (res.personal_calendar_hint) setPersonalHint(res.personal_calendar_hint);
        if (res.calendar_errors?.length && opts.audit !== false) {
          const throttled = res.calendar_errors.some((e) =>
            /429|throttl|MailboxConcurrency|ApplicationThrottled/i.test(e.error),
          );
          const names = res.calendar_errors
            .map((e) => e.calendar_name)
            .filter(Boolean)
            .slice(0, 3);
          if (names.length) {
            setNotice(
              throttled
                ? `Outlook briefly rate-limited some calendars (${names.join(', ')}${
                    res.calendar_errors.length > 3 ? '…' : ''
                  }). Personal and other calendars are shown — try refresh in a moment.`
                : `Some calendars could not load (${names.join(', ')}${
                    res.calendar_errors.length > 3 ? '…' : ''
                  }). Others are shown.`,
            );
          }
        } else if (opts.audit !== false) {
          setNotice(null);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load events';
        const reconnect =
          err instanceof CalendarApiError
            ? Boolean(err.needs_reconnect || err.needs_scope_upgrade)
            : /reconnect|scope|Calendars\.Read/i.test(msg);
        const throttled = /429|throttl|MailboxConcurrency|ApplicationThrottled/i.test(msg);
        if (opts.audit !== false) {
          // Soft UX: keep any already-loaded events; throttle is transient.
          if (throttled) {
            setNotice(
              'Outlook calendar API is briefly rate-limited. Personal calendars stay available — retry in a moment.',
            );
            setError(null);
          } else {
            setError(msg);
            setAllEvents([]);
          }
          setNeedsReconnect(reconnect);
        }
      } finally {
        setEventsLoading(false);
      }
    },
    [status?.configured, status?.connected, personalFeeds.length, range.start, range.end],
  );

  const loadPersonalFeeds = useCallback(async () => {
    try {
      const res = await listPersonalCalendarFeeds();
      setPersonalFeeds(res.feeds);
      if (res.hint) setPersonalHint(res.hint);
    } catch {
      /* feeds optional until migration is applied */
    }
  }, []);

  async function onAddPersonalFeed(e: FormEvent) {
    e.preventDefault();
    const url = icsUrl.trim();
    if (!url) {
      setError('Paste a Google secret ICS URL first.');
      return;
    }
    setIcsSaving(true);
    setError(null);
    try {
      await addPersonalCalendarFeed({
        name: icsName.trim() || 'Personal / Google',
        url,
      });
      setIcsUrl('');
      setNotice('Personal calendar added. Events will overlay with Outlook.');
      await loadPersonalFeeds();
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add personal calendar');
    } finally {
      setIcsSaving(false);
    }
  }

  async function onRemovePersonalFeed(feedId: string) {
    setIcsSaving(true);
    setError(null);
    try {
      await removePersonalCalendarFeed(feedId);
      // Clear disabled flag for this feed id if present
      setDisabledCalendarIds((prev) =>
        saveDisabledCalendarIds(prev.filter((id) => id !== `ics:${feedId}`)),
      );
      await loadPersonalFeeds();
      await loadEvents();
      setNotice('Personal calendar removed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove personal calendar');
    } finally {
      setIcsSaving(false);
    }
  }

  function toggleCalendar(id: string, enabled: boolean) {
    setDisabledCalendarIds((prev) => {
      const next = enabled ? prev.filter((x) => x !== id) : [...new Set([...prev, id])];
      return saveDisabledCalendarIds(next);
    });
  }

  function enableAllCalendars() {
    setDisabledCalendarIds(saveDisabledCalendarIds([]));
  }

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      await loadStatus();
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [loadStatus]);

  useEffect(() => {
    const connected = searchParams.get('calendar_connected');
    const calendarError = searchParams.get('calendar_error');
    if (connected === '1') {
      setNotice(
        'Work calendar connected. If New Meeting is missing, reconnect after admin consent.',
      );
      searchParams.delete('calendar_connected');
      setSearchParams(searchParams, { replace: true });
      void loadStatus();
    }
    if (calendarError) {
      setError(calendarError);
      searchParams.delete('calendar_error');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams, loadStatus]);

  useEffect(() => {
    if (!status) return;
    void loadEvents({ audit: true });
  }, [status, loadEvents]);

  useEffect(() => {
    void loadPersonalFeeds();
  }, [loadPersonalFeeds]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/calendar');
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

  async function onChangeView(next: ViewMode) {
    setView(next);
    try {
      await setMyCalendarDefaultView(next);
      setStatus((s) => (s ? { ...s, calendar_default_view: next } : s));
    } catch {
      /* preference save is best-effort */
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
    setCursor(startOfZonedDay(new Date(), next.timeZone));
    setNotice(
      value === '__auto__'
        ? `Timezone set to auto (${next.timeZone}).`
        : `Timezone set to ${next.timeZone}.`,
    );
  }

  function shift(delta: number) {
    if (view === 'month') {
      const p = getZonedParts(cursor, timeZone);
      const nextMonth = p.month + delta;
      let year = p.year;
      let month = nextMonth;
      if (month < 1) {
        month = 12;
        year -= 1;
      } else if (month > 12) {
        month = 1;
        year += 1;
      }
      setCursor(startOfZonedMonth(
        wallTimeInZoneToUtc(year, month, 15, 12, 0, 0, timeZone),
        timeZone,
      ));
    } else if (view === 'week') {
      setCursor(addZonedDays(cursor, delta * 7, timeZone));
    } else {
      setCursor(addZonedDays(cursor, delta * 14, timeZone));
    }
  }

  const today = startOfZonedDay(new Date(), timeZone);
  const todayKey = zonedDayKey(today, timeZone);
  const cursorParts = getZonedParts(cursor, timeZone);

  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = parseGraphDateTime(ev.start, ev.start_timezone);
      if (!start) continue;
      const key = zonedDayKey(start, timeZone);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events, timeZone]);

  const monthCells = useMemo(() => {
    if (view !== 'month') return [];
    const cells: Date[] = [];
    let d = range.start;
    while (d < range.end) {
      cells.push(d);
      d = addZonedDays(d, 1, timeZone);
    }
    return cells;
  }, [view, range, timeZone]);

  const weekDays = useMemo(() => {
    if (view !== 'week') return [];
    return Array.from({ length: 7 }, (_, i) => addZonedDays(range.start, i, timeZone));
  }, [view, range, timeZone]);

  const title =
    view === 'month'
      ? formatInTimeZone(cursor, timeZone, { month: 'long', year: 'numeric' })
      : view === 'week'
        ? `${formatInTimeZone(range.start, timeZone, { month: 'short', day: 'numeric' })} – ${formatInTimeZone(
            addZonedDays(range.start, 6, timeZone),
            timeZone,
            { month: 'short', day: 'numeric', year: 'numeric' },
          )}`
        : `Next 14 days from ${formatInTimeZone(cursor, timeZone, { month: 'short', day: 'numeric' })}`;

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Calendar</h1>
          <p className="muted">
            Outlook meetings
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}
            {calendars.length > 0
              ? ` · ${
                  calendars.filter((c) => !disabledCalendarIds.includes(c.id)).length
                }/${calendars.length} calendars overlaid`
              : ''}
            .{' '}
            <Link to="/sales/todo">To Do</Link>
            {' · '}
            <Link to="/sales/planner">Planner</Link>
          </p>
        </div>
        <div className="page-actions">
          {status?.connected && status.capabilities?.create_events ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => setMeetingOpen(true)}
            >
              New Meeting
            </button>
          ) : null}
          {status?.connected ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void loadEvents({ audit: true })}
              disabled={eventsLoading}
            >
              Refresh
            </button>
          ) : (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting || status?.configured === false}
            >
              {connecting ? 'Redirecting…' : 'Connect work calendar'}
            </button>
          )}
          <button
            type="button"
            className="btn cal-settings-toggle"
            aria-expanded={sideOpen}
            aria-controls="calendar-settings"
            onClick={toggleSettings}
          >
            {sideOpen ? 'Hide Settings' : 'Settings'}
          </button>
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}
      {status?.configured && personalFeeds.length === 0 ? (
        <div className="banner warn">
          To overlay Google/personal events, open{' '}
          <button
            type="button"
            className="btn ghost"
            style={{ display: 'inline', padding: '0 0.2rem', verticalAlign: 'baseline' }}
            onClick={openSettings}
          >
            Settings → Personal / Google calendar
          </button>{' '}
          and paste your secret ICS URL.
        </div>
      ) : null}
      {needsReconnect || status?.needs_scope_upgrade ? (
        <div className="banner warn">
          {needsReconnect
            ? 'Calendar permissions may be missing. Open Settings and click Reconnect after admin consent (Calendars.Read / Calendars.ReadWrite).'
            : 'Your Microsoft connection is missing newer permissions (meetings / To Do / people search / Teams chat / directory / online meetings). Click Reconnect after an admin grants consent in Azure — consent alone does not refresh your token.'}
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div
          className={`detail-grid calendar-layout${sideOpen ? '' : ' settings-collapsed'}`}
        >
          <div className="panel app-main">
            {!status ? (
              <div className="empty">
                <p className="muted">Calendar status unavailable. Retry or check the error above.</p>
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
                <p>Connect your Tage work mailbox to use Calendar here.</p>
                <p className="muted">
                  Portal login ({salesUser.email}) can differ from your Microsoft account. Set work
                  email in the sidebar, then connect. To Do and Planner are separate pages in the
                  header.
                </p>
                <button
                  type="button"
                  className="btn primary"
                  onClick={() => void onConnect()}
                  disabled={connecting}
                >
                  {connecting ? 'Redirecting…' : 'Connect work calendar'}
                </button>
              </div>
            ) : (
              <>
                <div className="panel-head cal-toolbar">
                  <h2>{title}</h2>
                  <div className="page-actions">
                    <div className="seg">
                      {(['agenda', 'week', 'month'] as const).map((v) => (
                        <button
                          key={v}
                          type="button"
                          className={view === v ? 'active' : ''}
                          onClick={() => void onChangeView(v)}
                        >
                          {v === 'month' ? 'Month' : v === 'week' ? 'Week' : 'Agenda'}
                        </button>
                      ))}
                    </div>
                    <button type="button" className="btn ghost" onClick={() => shift(-1)}>
                      ←
                    </button>
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() => setCursor(startOfZonedDay(new Date(), timeZone))}
                    >
                      Today
                    </button>
                    <button type="button" className="btn ghost" onClick={() => shift(1)}>
                      →
                    </button>
                  </div>
                </div>
                {eventsLoading ? <p className="muted small">Syncing…</p> : null}
                {view === 'month' ? (
                  <div className="cal-month">
                    <div className="cal-weekdays">
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                        <div key={d} className="cal-weekday">
                          {d}
                        </div>
                      ))}
                    </div>
                    <div className="cal-grid">
                      {monthCells.map((day) => {
                        const key = zonedDayKey(day, timeZone);
                        const dayEvents = eventsByDay.get(key) ?? [];
                        const dayParts = getZonedParts(day, timeZone);
                        const inMonth = dayParts.month === cursorParts.month;
                        return (
                          <div
                            key={key}
                            className={`cal-cell ${inMonth ? '' : 'muted-month'} ${
                              key === todayKey ? 'today' : ''
                            }`}
                          >
                            <div className="cal-cell-day">{dayParts.day}</div>
                            <ul className="cal-cell-events">
                              {dayEvents.slice(0, 3).map((ev) => {
                                const start = parseGraphDateTime(ev.start, ev.start_timezone);
                                return (
                                  <li key={eventCalendarKey(ev)}>
                                    {ev.web_link ? (
                                      <a
                                        href={ev.web_link}
                                        target="_blank"
                                        rel="noreferrer"
                                        title={`${ev.subject}${ev.calendar_name ? ` · ${ev.calendar_name}` : ''}`}
                                      >
                                        <span
                                          className="cal-dot"
                                          style={{
                                            background: ev.calendar_color || 'var(--gold)',
                                          }}
                                          aria-hidden
                                        />
                                        <span className="cal-time">
                                          {start
                                            ? formatTimeInZone(start, timeZone, ev.is_all_day)
                                            : ''}
                                        </span>{' '}
                                        {ev.subject}
                                      </a>
                                    ) : (
                                      <span
                                        title={`${ev.subject}${ev.calendar_name ? ` · ${ev.calendar_name}` : ''}`}
                                      >
                                        <span
                                          className="cal-dot"
                                          style={{
                                            background: ev.calendar_color || 'var(--gold)',
                                          }}
                                          aria-hidden
                                        />
                                        <span className="cal-time">
                                          {start
                                            ? formatTimeInZone(start, timeZone, ev.is_all_day)
                                            : ''}
                                        </span>{' '}
                                        {ev.subject}
                                      </span>
                                    )}
                                  </li>
                                );
                              })}
                              {dayEvents.length > 3 ? (
                                <li className="muted small">+{dayEvents.length - 3} more</li>
                              ) : null}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : view === 'week' ? (
                  <div className="cal-week">
                    {weekDays.map((day) => {
                      const key = zonedDayKey(day, timeZone);
                      const dayEvents = eventsByDay.get(key) ?? [];
                      return (
                        <div
                          key={key}
                          className={`cal-week-day ${key === todayKey ? 'today' : ''}`}
                        >
                          <div className="cal-week-label">
                            {formatInTimeZone(day, timeZone, {
                              weekday: 'short',
                              month: 'short',
                              day: 'numeric',
                            })}
                          </div>
                          {dayEvents.length === 0 ? (
                            <p className="muted small">No events</p>
                          ) : (
                            <ul className="cal-agenda-list">
                              {dayEvents.map((ev) => (
                                <EventRow
                                  key={eventCalendarKey(ev)}
                                  event={ev}
                                  timeZone={timeZone}
                                />
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <ul className="cal-agenda-list large">
                    {events.length === 0 ? (
                      <li className="muted">No upcoming events in this range.</li>
                    ) : (
                      events.map((ev) => (
                        <EventRow
                          key={eventCalendarKey(ev)}
                          event={ev}
                          showDate
                          timeZone={timeZone}
                        />
                      ))
                    )}
                  </ul>
                )}
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
            title="Calendar settings"
            alertPath="/sales/calendar"
            alertBlurb={`While a portal tab is open: reminders ${loadAlertPrefs().leadMinutes.join(' / ')} min before meetings, plus due/overdue To Do & Planner tasks.`}
            extraMeta={[
              {
                label: 'Default view',
                value: status?.calendar_default_view ?? view,
              },
              {
                label: 'Timezone',
                value: timeZone,
              },
            ]}
            resolvedTimezone={tzInfo}
            onTimezoneChange={onTimezoneChange}
            onWorkEmailChange={setWorkEmailDraft}
            onSaveWorkEmail={onSaveWorkEmail}
            onConnect={onConnect}
            onNotice={setNotice}
            onError={setError}
            leadingSections={
              <div id="cal-personal-google" className="cal-alerts-block cal-personal-block">
                <h3>Personal / Google calendar</h3>
                <p className="muted small">
                  {personalHint ||
                    'Outlook “Add personal calendars” (Google) does not appear in Microsoft Graph. Paste your Google secret ICS URL below to overlay it here.'}
                </p>
                {personalFeeds.length > 0 ? (
                  <ul className="cal-toggle-list" style={{ marginBottom: '0.75rem' }}>
                    {personalFeeds.map((feed) => (
                      <li key={feed.id} className="cal-toggle-row">
                        <span
                          className="cal-swatch"
                          style={{ background: feed.color || '#5B8DEF' }}
                          aria-hidden
                        />
                        <span style={{ flex: 1 }}>{feed.name}</span>
                        <button
                          type="button"
                          className="btn ghost"
                          disabled={icsSaving}
                          onClick={() => void onRemovePersonalFeed(feed.id)}
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <form className="cal-ics-form" onSubmit={(e) => void onAddPersonalFeed(e)}>
                  <label className="field">
                    <span className="muted small">Display name</span>
                    <input
                      type="text"
                      value={icsName}
                      onChange={(e) => setIcsName(e.target.value)}
                      placeholder="Personal / Google"
                      disabled={icsSaving}
                    />
                  </label>
                  <label className="field">
                    <span className="muted small">
                      Google secret ICS URL (calendar settings → Integrate calendar)
                    </span>
                    <input
                      type="url"
                      value={icsUrl}
                      onChange={(e) => setIcsUrl(e.target.value)}
                      placeholder="https://calendar.google.com/calendar/ical/…/basic.ics"
                      disabled={icsSaving}
                      autoComplete="off"
                    />
                  </label>
                  <button type="submit" className="btn primary" disabled={icsSaving || !icsUrl.trim()}>
                    {icsSaving ? 'Saving…' : 'Add personal calendar'}
                  </button>
                </form>
                <p className="muted small" style={{ marginTop: '0.75rem' }}>
                  Alternate: in{' '}
                  <a
                    href="https://outlook.office.com/calendar"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Outlook on the web
                  </a>
                  , use Add calendar → Subscribe from web with the same ICS URL (creates an
                  Exchange calendar Graph can list).
                </p>
              </div>
            }
            extraSections={
              calendars.length > 0 ? (
                <div className="cal-alerts-block">
                  <h3>Calendars</h3>
                  <p className="muted small">
                    Outlook mailbox calendars and personal ICS feeds overlay together. Uncheck to
                    hide (saved for Today too).
                  </p>
                  <ul className="cal-toggle-list">
                    {calendars.map((cal) => {
                      const on = !disabledCalendarIds.includes(cal.id);
                      return (
                        <li key={cal.id}>
                          <label className="cal-check cal-toggle-row">
                            <input
                              type="checkbox"
                              checked={on}
                              onChange={(e) => toggleCalendar(cal.id, e.target.checked)}
                            />
                            <span
                              className="cal-swatch"
                              style={{ background: cal.color || 'var(--gold)' }}
                              aria-hidden
                            />
                            <span>
                              {cal.name}
                              {cal.is_default ? (
                                <span className="muted small"> · primary</span>
                              ) : null}
                              {cal.source === 'ics' ? (
                                <span className="muted small"> · personal ICS</span>
                              ) : null}
                              {cal.owner_email && !cal.is_default ? (
                                <span className="muted small"> · {cal.owner_email}</span>
                              ) : null}
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {disabledCalendarIds.length > 0 ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: '0.5rem' }}
                      onClick={enableAllCalendars}
                    >
                      Show all calendars
                    </button>
                  ) : null}
                </div>
              ) : null
            }
          />
        </div>
      )}

      {meetingOpen ? (
        <NewMeetingModal
          timeZone={timeZone}
          onClose={() => setMeetingOpen(false)}
          onCreated={async (ev) => {
            setMeetingOpen(false);
            setNotice(`Meeting created: ${ev.subject}`);
            await loadEvents({ audit: false });
          }}
          onError={(msg) => setError(msg)}
          canPeopleSearch={status?.capabilities?.people_search !== false}
          canLocationSuggest={status?.capabilities?.location_suggest !== false}
        />
      ) : null}
    </div>
  );
}

function NewMeetingModal({
  timeZone,
  onClose,
  onCreated,
  onError,
  canPeopleSearch = true,
  canLocationSuggest = true,
}: {
  timeZone: string;
  onClose: () => void;
  onCreated: (ev: CalendarEvent) => void | Promise<void>;
  onError: (msg: string) => void;
  canPeopleSearch?: boolean;
  canLocationSuggest?: boolean;
}) {
  const defaults = defaultMeetingTimesInZone(timeZone);
  const [subject, setSubject] = useState('');
  const [start, setStart] = useState(defaults.start);
  const [end, setEnd] = useState(defaults.end);
  const [attendeeChips, setAttendeeChips] = useState<
    Array<{ email: string; name?: string | null }>
  >([]);
  const [attendeeQuery, setAttendeeQuery] = useState('');
  const [peopleHits, setPeopleHits] = useState<PeopleSuggestion[]>([]);
  const [peopleOpen, setPeopleOpen] = useState(false);
  const [peopleLoading, setPeopleLoading] = useState(false);
  const [location, setLocation] = useState('');
  const [locationHits, setLocationHits] = useState<LocationSuggestion[]>([]);
  const [locationOpen, setLocationOpen] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [body, setBody] = useState('');
  const [teams, setTeams] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!canPeopleSearch) {
      setPeopleHits([]);
      return;
    }
    const q = attendeeQuery.trim();
    if (q.length < 2) {
      setPeopleHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setPeopleLoading(true);
      void searchMeetingPeople(q)
        .then((hits) => {
          if (!cancelled) {
            setPeopleHits(hits);
            setPeopleOpen(true);
          }
        })
        .catch(() => {
          if (!cancelled) setPeopleHits([]);
        })
        .finally(() => {
          if (!cancelled) setPeopleLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [attendeeQuery, canPeopleSearch]);

  useEffect(() => {
    if (!canLocationSuggest) {
      setLocationHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setLocationLoading(true);
      void suggestMeetingLocations(location)
        .then((hits) => {
          if (!cancelled) setLocationHits(hits);
        })
        .catch(() => {
          if (!cancelled) setLocationHits([]);
        })
        .finally(() => {
          if (!cancelled) setLocationLoading(false);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [location, canLocationSuggest]);

  function addAttendee(emailRaw: string, name?: string | null) {
    const email = emailRaw.trim().toLowerCase();
    if (!email || !email.includes('@')) return;
    setAttendeeChips((prev) =>
      prev.some((a) => a.email === email) ? prev : [...prev, { email, name }],
    );
    setAttendeeQuery('');
    setPeopleHits([]);
    setPeopleOpen(false);
  }

  function removeAttendee(email: string) {
    setAttendeeChips((prev) => prev.filter((a) => a.email !== email));
  }

  function commitAttendeeQuery() {
    const raw = attendeeQuery.trim();
    if (!raw) return;
    for (const part of raw.split(/[,;\s]+/)) {
      addAttendee(part);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!subject.trim()) {
      onError('Title is required');
      return;
    }
    commitAttendeeQuery();
    const emails = [
      ...attendeeChips.map((a) => a.email),
      ...attendeeQuery
        .split(/[,;\s]+/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.includes('@')),
    ];
    const unique = Array.from(new Set(emails));
    setSaving(true);
    try {
      const ev = await createCalendarMeeting({
        subject: subject.trim(),
        start: `${start.length === 16 ? `${start}:00` : start}`,
        end: `${end.length === 16 ? `${end}:00` : end}`,
        time_zone: timeZone,
        attendees: unique,
        location: location.trim() || undefined,
        body: body.trim() || undefined,
        is_online_meeting: teams,
      });
      await onCreated(ev);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not create meeting');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="new-meeting-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-meeting-title">New Meeting</h2>
        <form className="form-grid" onSubmit={(e) => void submit(e)}>
          <label className="full">
            Title
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label>
            Start
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              required
            />
          </label>
          <label>
            End
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              required
            />
          </label>
          <div className="full meeting-field">
            <span className="meeting-label">Attendees</span>
            <div
              className="meeting-chips-input"
              onClick={() => {
                const el = document.getElementById('meeting-attendee-input');
                el?.focus();
              }}
            >
              {attendeeChips.map((a) => (
                <span key={a.email} className="meeting-chip">
                  <span className="meeting-chip-text">
                    {a.name ? `${a.name} · ${a.email}` : a.email}
                  </span>
                  <button
                    type="button"
                    className="meeting-chip-remove"
                    aria-label={`Remove ${a.email}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      removeAttendee(a.email);
                    }}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                id="meeting-attendee-input"
                value={attendeeQuery}
                onChange={(e) => {
                  setAttendeeQuery(e.target.value);
                  setPeopleOpen(true);
                }}
                onFocus={() => setPeopleOpen(true)}
                onBlur={() => {
                  window.setTimeout(() => setPeopleOpen(false), 150);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
                    e.preventDefault();
                    if (peopleHits[0] && attendeeQuery.trim().length >= 2) {
                      addAttendee(peopleHits[0].email, peopleHits[0].display_name);
                    } else {
                      commitAttendeeQuery();
                    }
                  } else if (
                    e.key === 'Backspace' &&
                    !attendeeQuery &&
                    attendeeChips.length
                  ) {
                    removeAttendee(attendeeChips[attendeeChips.length - 1].email);
                  } else if (e.key === 'Escape') {
                    setPeopleOpen(false);
                  }
                }}
                placeholder={
                  attendeeChips.length
                    ? 'Add another…'
                    : canPeopleSearch
                      ? 'Search people or type an email'
                      : 'alex@tagevc.com, jordan@…'
                }
                autoComplete="off"
              />
            </div>
            {peopleOpen && (peopleLoading || peopleHits.length > 0) ? (
              <ul className="meeting-suggest" role="listbox">
                {peopleLoading && peopleHits.length === 0 ? (
                  <li className="muted small">Searching…</li>
                ) : null}
                {peopleHits.map((p) => (
                  <li key={`${p.source}-${p.id}-${p.email}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addAttendee(p.email, p.display_name)}
                    >
                      <strong>{p.display_name || p.email}</strong>
                      {p.display_name ? (
                        <span className="muted small">{p.email}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div className="full meeting-field">
            <label className="meeting-label" htmlFor="meeting-location-input">
              Location
            </label>
            <input
              id="meeting-location-input"
              value={location}
              onChange={(e) => {
                setLocation(e.target.value);
                setLocationOpen(true);
              }}
              onFocus={() => setLocationOpen(true)}
              onBlur={() => {
                window.setTimeout(() => setLocationOpen(false), 150);
              }}
              placeholder={
                canLocationSuggest
                  ? 'Type or pick a recent location…'
                  : 'Conference room / address'
              }
              autoComplete="off"
            />
            {locationOpen && canLocationSuggest && (locationLoading || locationHits.length > 0) ? (
              <ul className="meeting-suggest" role="listbox">
                {locationLoading && locationHits.length === 0 ? (
                  <li className="muted small">Loading suggestions…</li>
                ) : null}
                {locationHits.map((loc) => (
                  <li key={`${loc.source}-${loc.display_name}`}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setLocation(loc.display_name);
                        setLocationOpen(false);
                      }}
                    >
                      <strong>{loc.display_name}</strong>
                      <span className="muted small">
                        {loc.source === 'room' ? 'Room' : 'Recent'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <label className="full">
            Body
            <textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </label>
          <label className="full cal-check">
            <input
              type="checkbox"
              checked={teams}
              onChange={(e) => setTeams(e.target.checked)}
            />
            Add Teams online meeting link
          </label>
          <p className="muted small full">
            Calendar Teams links use Calendars.ReadWrite. Instant / scheduled video from{' '}
            <Link to="/sales/meetings">Teams Meetings</Link> or Chat uses{' '}
            <code>OnlineMeetings.ReadWrite</code> — grant in Azure, then Reconnect.
          </p>
          <div className="modal-actions full">
            <button type="button" className="btn ghost" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={saving}>
              {saving ? 'Creating…' : 'Create meeting'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EventRow({
  event,
  showDate,
  timeZone,
}: {
  event: CalendarEvent;
  showDate?: boolean;
  timeZone: string;
}) {
  const start = parseGraphDateTime(event.start, event.start_timezone);
  const end = parseGraphDateTime(event.end, event.end_timezone);
  const when = start
    ? showDate
      ? `${formatInTimeZone(start, timeZone, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })} · ${formatTimeInZone(start, timeZone, event.is_all_day)}`
      : formatTimeInZone(start, timeZone, event.is_all_day)
    : '—';
  const endBit =
    end && !event.is_all_day
      ? `–${formatInTimeZone(end, timeZone, { hour: 'numeric', minute: '2-digit' })}`
      : '';
  const color = event.calendar_color || 'var(--gold)';

  return (
    <li className="cal-agenda-item">
      <span className="cal-dot cal-dot-lg" style={{ background: color }} aria-hidden />
      {event.web_link ? (
        <a href={event.web_link} target="_blank" rel="noreferrer">
          <span className="cal-agenda-when">
            {when}
            {endBit}
          </span>
          <span className="cal-agenda-title">{event.subject}</span>
          {event.calendar_name ? (
            <span className="muted small cal-source">{event.calendar_name}</span>
          ) : null}
          {event.location ? <span className="muted small">{event.location}</span> : null}
        </a>
      ) : (
        <div>
          <span className="cal-agenda-when">
            {when}
            {endBit}
          </span>
          <span className="cal-agenda-title">{event.subject}</span>
          {event.calendar_name ? (
            <span className="muted small cal-source">{event.calendar_name}</span>
          ) : null}
          {event.location ? <span className="muted small">{event.location}</span> : null}
        </div>
      )}
      {event.online_meeting_url ? (
        <a
          className="muted small"
          href={event.online_meeting_url}
          target="_blank"
          rel="noreferrer"
          style={{ marginLeft: '0.35rem' }}
        >
          Join Teams
        </a>
      ) : null}
    </li>
  );
}
