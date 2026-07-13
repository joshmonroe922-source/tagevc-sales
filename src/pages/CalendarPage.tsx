import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  disconnectCalendar,
  fetchCalendarEvents,
  fetchCalendarStatus,
  setMyWorkEmail,
  startCalendarOAuth,
  type CalendarEvent,
  type CalendarStatus,
} from '../lib/calendarApi';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';

type Props = { salesUser: SalesUser };

type ViewMode = 'month' | 'week' | 'agenda';

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeek(d: Date): Date {
  const x = startOfDay(d);
  const day = x.getDay(); // 0 Sun
  return addDays(x, -day);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
}

function parseGraphLocal(iso: string | null): Date | null {
  if (!iso) return null;
  // Graph returns local-ish datetime without Z when Prefer timezone is set;
  // treat trailing Z / offset normally, else as local.
  if (/Z$|[+-]\d{2}:\d{2}$/.test(iso)) return new Date(iso);
  return new Date(iso.replace(' ', 'T'));
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function formatTime(d: Date, allDay: boolean): string {
  if (allDay) return 'All day';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function monthLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function weekLabel(start: Date): string {
  const end = addDays(start, 6);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${start.toLocaleDateString(undefined, opts)} – ${end.toLocaleDateString(undefined, {
    ...opts,
    year: 'numeric',
  })}`;
}

export function CalendarPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [view, setView] = useState<ViewMode>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [loading, setLoading] = useState(true);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);

  const range = useMemo(() => {
    if (view === 'week') {
      const start = startOfWeek(cursor);
      return { start, end: addDays(start, 7) };
    }
    if (view === 'agenda') {
      const start = startOfDay(cursor);
      return { start, end: addDays(start, 14) };
    }
    // month: full calendar grid (Sun before → Sat after)
    const monthStart = startOfMonth(cursor);
    const gridStart = startOfWeek(monthStart);
    const monthEnd = endOfMonth(cursor);
    const gridEnd = addDays(startOfWeek(monthEnd), 7);
    return { start: gridStart, end: gridEnd };
  }, [cursor, view]);

  const loadStatus = useCallback(async () => {
    setError(null);
    try {
      const s = await fetchCalendarStatus();
      setStatus(s);
      setWorkEmailDraft(s.work_email ?? s.preferred_work_email ?? '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load calendar status');
    }
  }, []);

  const loadEvents = useCallback(async () => {
    if (!status?.connected || !status.configured) {
      setEvents([]);
      return;
    }
    setEventsLoading(true);
    setError(null);
    try {
      const list = await fetchCalendarEvents(
        range.start.toISOString(),
        range.end.toISOString(),
      );
      setEvents(list);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load events';
      setError(msg);
      setEvents([]);
    } finally {
      setEventsLoading(false);
    }
  }, [status?.connected, status?.configured, range.start, range.end]);

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
      setNotice('Work calendar connected.');
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
    void loadEvents();
  }, [status, loadEvents]);

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

  async function onDisconnect() {
    if (!window.confirm('Disconnect your Microsoft work calendar from the portal?')) return;
    setError(null);
    try {
      await disconnectCalendar();
      setEvents([]);
      setNotice('Calendar disconnected.');
      await loadStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Disconnect failed');
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

  function shift(delta: number) {
    if (view === 'month') {
      setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + delta, 1));
    } else if (view === 'week') {
      setCursor(addDays(cursor, delta * 7));
    } else {
      setCursor(addDays(cursor, delta * 14));
    }
  }

  const today = startOfDay(new Date());
  const eventsByDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const ev of events) {
      const start = parseGraphLocal(ev.start);
      if (!start) continue;
      const key = `${start.getFullYear()}-${start.getMonth()}-${start.getDate()}`;
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
    return map;
  }, [events]);

  const monthCells = useMemo(() => {
    if (view !== 'month') return [];
    const cells: Date[] = [];
    let d = range.start;
    while (d < range.end) {
      cells.push(d);
      d = addDays(d, 1);
    }
    return cells;
  }, [view, range]);

  const weekDays = useMemo(() => {
    if (view !== 'week') return [];
    return Array.from({ length: 7 }, (_, i) => addDays(range.start, i));
  }, [view, range]);

  const title =
    view === 'month'
      ? monthLabel(cursor)
      : view === 'week'
        ? weekLabel(range.start)
        : `Next 14 days from ${cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Calendar</h1>
          <p className="muted">
            Your Microsoft 365 / Outlook work calendar
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            {(['month', 'week', 'agenda'] as const).map((v) => (
              <button
                key={v}
                type="button"
                className={view === v ? 'active' : ''}
                onClick={() => setView(v)}
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
            onClick={() => setCursor(startOfDay(new Date()))}
          >
            Today
          </button>
          <button type="button" className="btn ghost" onClick={() => shift(1)}>
            →
          </button>
          {status?.connected ? (
            <>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void loadEvents()}
                disabled={eventsLoading}
              >
                Refresh
              </button>
              <button type="button" className="btn ghost" onClick={() => void onDisconnect()}>
                Disconnect
              </button>
            </>
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
        </div>
      </div>

      {notice ? <div className="banner ok">{notice}</div> : null}
      {error ? <div className="banner error">{error}</div> : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <>
          <div className="detail-grid calendar-layout">
            <div className="panel">
              <div className="panel-head">
                <h2>{title}</h2>
                {eventsLoading ? <span className="muted small">Syncing…</span> : null}
              </div>

              {!status?.configured ? (
                <div className="empty">
                  <p>Microsoft Graph is not configured yet.</p>
                  <p className="muted">
                    An admin needs to register an Azure app and set edge secrets — see{' '}
                    <code>SETUP_CALENDAR.md</code> in the repo.
                  </p>
                </div>
              ) : !status.connected ? (
                <div className="empty">
                  <p>Connect your Tage work mailbox to see Outlook events here.</p>
                  <p className="muted">
                    Portal login ({salesUser.email}) can differ from your Microsoft account. Set
                    work email below, then connect.
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
              ) : view === 'month' ? (
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
                      const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                      const dayEvents = eventsByDay.get(key) ?? [];
                      const inMonth = day.getMonth() === cursor.getMonth();
                      return (
                        <div
                          key={key}
                          className={`cal-cell ${inMonth ? '' : 'muted-month'} ${
                            sameDay(day, today) ? 'today' : ''
                          }`}
                        >
                          <div className="cal-cell-day">{day.getDate()}</div>
                          <ul className="cal-cell-events">
                            {dayEvents.slice(0, 3).map((ev) => {
                              const start = parseGraphLocal(ev.start);
                              return (
                                <li key={ev.id}>
                                  {ev.web_link ? (
                                    <a
                                      href={ev.web_link}
                                      target="_blank"
                                      rel="noreferrer"
                                      title={ev.subject}
                                    >
                                      <span className="cal-time">
                                        {start ? formatTime(start, ev.is_all_day) : ''}
                                      </span>{' '}
                                      {ev.subject}
                                    </a>
                                  ) : (
                                    <span title={ev.subject}>
                                      <span className="cal-time">
                                        {start ? formatTime(start, ev.is_all_day) : ''}
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
                    const key = `${day.getFullYear()}-${day.getMonth()}-${day.getDate()}`;
                    const dayEvents = eventsByDay.get(key) ?? [];
                    return (
                      <div
                        key={key}
                        className={`cal-week-day ${sameDay(day, today) ? 'today' : ''}`}
                      >
                        <div className="cal-week-label">
                          {day.toLocaleDateString(undefined, {
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
                              <EventRow key={ev.id} event={ev} />
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
                    events.map((ev) => <EventRow key={ev.id} event={ev} showDate />)
                  )}
                </ul>
              )}
            </div>

            <div className="panel">
              <div className="panel-head">
                <h2>Work mailbox</h2>
              </div>
              <p className="muted small">
                Used as the Microsoft sign-in hint. Set this if your portal login email is not your
                @tagevc.com mailbox.
              </p>
              <div className="field">
                <label htmlFor="work-email">Work email</label>
                <input
                  id="work-email"
                  type="email"
                  value={workEmailDraft}
                  onChange={(e) => setWorkEmailDraft(e.target.value)}
                  placeholder="you@tagevc.com"
                />
              </div>
              <div className="page-actions" style={{ marginTop: '0.75rem' }}>
                <button
                  type="button"
                  className="btn primary"
                  disabled={savingEmail}
                  onClick={() => void onSaveWorkEmail()}
                >
                  {savingEmail ? 'Saving…' : 'Save work email'}
                </button>
                {status?.connected ? (
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => void onConnect()}
                    disabled={connecting}
                  >
                    Reconnect
                  </button>
                ) : null}
              </div>
              <dl className="cal-meta">
                <div>
                  <dt>Portal login</dt>
                  <dd>{salesUser.email}</dd>
                </div>
                <div>
                  <dt>Connected mailbox</dt>
                  <dd>{status?.microsoft_email ?? '—'}</dd>
                </div>
                <div>
                  <dt>Last sync</dt>
                  <dd>{formatDateTime(status?.last_synced_at)}</dd>
                </div>
                <div>
                  <dt>v1 capabilities</dt>
                  <dd>View events (month / week / agenda). Create & edit come later.</dd>
                </div>
              </dl>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function EventRow({
  event,
  showDate,
}: {
  event: CalendarEvent;
  showDate?: boolean;
}) {
  const start = parseGraphLocal(event.start);
  const end = parseGraphLocal(event.end);
  const when = start
    ? showDate
      ? `${start.toLocaleDateString(undefined, {
          weekday: 'short',
          month: 'short',
          day: 'numeric',
        })} · ${formatTime(start, event.is_all_day)}`
      : formatTime(start, event.is_all_day)
    : '—';
  const endBit =
    end && !event.is_all_day
      ? `–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
      : '';

  const inner = (
    <>
      <span className="cal-agenda-when">
        {when}
        {endBit}
      </span>
      <span className="cal-agenda-title">{event.subject}</span>
      {event.location ? <span className="muted small">{event.location}</span> : null}
    </>
  );

  return (
    <li className="cal-agenda-item">
      {event.web_link ? (
        <a href={event.web_link} target="_blank" rel="noreferrer">
          {inner}
        </a>
      ) : (
        <div>{inner}</div>
      )}
    </li>
  );
}
