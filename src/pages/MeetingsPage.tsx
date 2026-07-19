import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MsWorkSidePanel } from '../components/MsWorkSidePanel';
import {
  createTeamsOnlineMeeting,
  fetchCalendarStatus,
  fetchUpcomingOnlineMeetings,
  setMyWorkEmail,
  startCalendarOAuth,
  type CalendarStatus,
  type OnlineMeeting,
} from '../lib/calendarApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

function formatMeetingWhen(iso: string | null): string {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function defaultScheduleTimes(): { start: string; end: string } {
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start);
  end.setHours(end.getHours() + 1);
  const toLocal = (d: Date) => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  return { start: toLocal(start), end: toLocal(end) };
}

export function MeetingsPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const [upcoming, setUpcoming] = useState<OnlineMeeting[]>([]);
  const [meetingsLoading, setMeetingsLoading] = useState(false);
  const [meetingBusy, setMeetingBusy] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [scheduleSubject, setScheduleSubject] = useState('Teams meeting');
  const [scheduleStart, setScheduleStart] = useState('');
  const [scheduleEnd, setScheduleEnd] = useState('');

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

  const loadMeetings = useCallback(async (opts: { audit?: boolean } = {}) => {
    if (!status?.connected || !status.capabilities?.online_meetings) {
      setUpcoming([]);
      return;
    }
    setMeetingsLoading(true);
    try {
      const meetings = await fetchUpcomingOnlineMeetings({
        audit: opts.audit !== false,
        top: 25,
      });
      setUpcoming(meetings);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meetings');
      setUpcoming([]);
    } finally {
      setMeetingsLoading(false);
    }
  }, [status?.connected, status?.capabilities?.online_meetings]);

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
      setNotice('Work mailbox connected. If meetings are missing, reconnect after admin consent.');
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
    if (!status?.connected) return;
    void loadMeetings({ audit: true });
  }, [status?.connected, loadMeetings]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/meetings');
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

  function openSchedule() {
    const times = defaultScheduleTimes();
    setScheduleSubject('Teams meeting');
    setScheduleStart(times.start);
    setScheduleEnd(times.end);
    setScheduleOpen(true);
  }

  async function onStartInstantMeeting() {
    setMeetingBusy(true);
    setError(null);
    try {
      const meeting = await createTeamsOnlineMeeting({
        subject: 'Teams meeting',
      });
      setNotice(
        meeting.join_url
          ? 'Meeting ready — opening join link.'
          : 'Meeting created.',
      );
      if (meeting.join_url) {
        window.open(meeting.join_url, '_blank', 'noopener,noreferrer');
      }
      await loadMeetings({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start Teams meeting');
    } finally {
      setMeetingBusy(false);
    }
  }

  async function onScheduleMeeting(e: FormEvent) {
    e.preventDefault();
    if (!scheduleSubject.trim() || !scheduleStart || !scheduleEnd) {
      setError('Subject, start, and end are required.');
      return;
    }
    setMeetingBusy(true);
    setError(null);
    try {
      const meeting = await createTeamsOnlineMeeting({
        subject: scheduleSubject.trim(),
        start: new Date(scheduleStart).toISOString(),
        end: new Date(scheduleEnd).toISOString(),
      });
      setScheduleOpen(false);
      setNotice(
        meeting.join_url
          ? 'Video meeting scheduled. Join link is below.'
          : 'Video meeting scheduled.',
      );
      await loadMeetings({ audit: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to schedule meeting');
    } finally {
      setMeetingBusy(false);
    }
  }

  const canMeetings = Boolean(status?.capabilities?.online_meetings);

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Teams Meetings</h1>
          <p className="muted">
            Teams video
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}.{' '}
            <Link to="/sales/chat">Chat</Link>
            {' · '}
            <Link to="/sales/calendar">Calendar</Link>
          </p>
        </div>
        <div className="page-actions">
          {status?.connected && canMeetings ? (
            <>
              <button
                type="button"
                className="btn primary"
                onClick={() => void onStartInstantMeeting()}
                disabled={meetingBusy}
              >
                {meetingBusy ? 'Starting…' : 'Start Teams meeting'}
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={openSchedule}
                disabled={meetingBusy}
              >
                Schedule video
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() => void loadMeetings({ audit: true })}
                disabled={meetingsLoading}
              >
                Refresh
              </button>
            </>
          ) : status?.connected ? (
            <button
              type="button"
              className="btn primary"
              onClick={() => void onConnect()}
              disabled={connecting}
            >
              {connecting ? 'Redirecting…' : 'Reconnect for meetings'}
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
      {status?.needs_scope_upgrade ? (
        <div className="banner warn">
          Your Microsoft connection is missing newer permissions (online meetings). Click{' '}
          <strong>Reconnect</strong> after an admin grants consent in Azure.
        </div>
      ) : null}

      {loading ? (
        <p className="muted">Loading…</p>
      ) : (
        <div className="detail-grid calendar-layout">
          <div className="panel app-main">
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
                <p>Connect your Tage work mailbox to start and join Teams meetings here.</p>
                <p className="muted">
                  Same Microsoft connection as Chat and Calendar. Instant meetings use
                  OnlineMeetings.ReadWrite; calendar events with a Teams link also appear when you
                  create them from Calendar.
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
            ) : !canMeetings ? (
              <div className="empty">
                <p>Online meetings permission is missing on this connection.</p>
                <p className="muted">
                  After an admin grants OnlineMeetings.ReadWrite in Azure, reconnect. You can still
                  add a Teams link from{' '}
                  <Link to="/sales/calendar">Calendar → New Meeting</Link>.
                </p>
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
              <>
                <div className="panel-head">
                  <h2>Upcoming join links</h2>
                </div>
                {meetingsLoading && upcoming.length === 0 ? (
                  <p className="muted">Loading meetings…</p>
                ) : upcoming.length === 0 ? (
                  <div className="empty">
                    <p>No upcoming Teams meetings yet.</p>
                    <p className="muted">
                      Start an instant meeting, schedule video here, or create a calendar event with
                      Teams from <Link to="/sales/calendar">Calendar</Link>. Chat also has Start /
                      Schedule when you are in a conversation.
                    </p>
                  </div>
                ) : (
                  <ul className="meetings-list">
                    {upcoming.map((m) => (
                      <li key={m.id} className="meetings-list-item">
                        <div className="meetings-list-main">
                          <strong>{m.subject || 'Teams meeting'}</strong>
                          {m.start ? (
                            <span className="muted small">
                              {formatMeetingWhen(m.start)}
                              {m.end ? ` – ${formatMeetingWhen(m.end)}` : ''}
                            </span>
                          ) : (
                            <span className="muted small">Instant / no fixed time</span>
                          )}
                        </div>
                        <div className="meetings-list-actions">
                          {m.join_url ? (
                            <a
                              className="btn primary"
                              href={m.join_url}
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
                    ))}
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
            alertPath="/sales/meetings"
            alertBlurb="Meeting start reminders and work-task due alerts while a portal tab stays open."
            capabilityLabels={[
              status?.capabilities?.online_meetings ? 'Online meetings' : null,
              status?.capabilities?.chat ? 'Chat' : null,
              status?.capabilities?.create_events ? 'Calendar' : null,
            ].filter(Boolean) as string[]}
            extraMeta={[
              {
                label: 'Video meetings',
                value: canMeetings
                  ? 'Yes (OnlineMeetings.ReadWrite)'
                  : 'No — grant scope + Reconnect',
              },
            ]}
            onWorkEmailChange={setWorkEmailDraft}
            onSaveWorkEmail={onSaveWorkEmail}
            onConnect={onConnect}
            onNotice={setNotice}
            onError={setError}
          />
        </div>
      )}

      {scheduleOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onClick={() => setScheduleOpen(false)}
        >
          <div
            className="modal panel"
            role="dialog"
            aria-labelledby="meetings-schedule-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-head">
              <h2 id="meetings-schedule-title">Schedule video meeting</h2>
              <button
                type="button"
                className="btn ghost"
                onClick={() => setScheduleOpen(false)}
              >
                Close
              </button>
            </div>
            <form className="stack-form" onSubmit={(e) => void onScheduleMeeting(e)}>
              <label>
                Subject
                <input
                  type="text"
                  value={scheduleSubject}
                  onChange={(e) => setScheduleSubject(e.target.value)}
                  required
                />
              </label>
              <label>
                Start
                <input
                  type="datetime-local"
                  value={scheduleStart}
                  onChange={(e) => setScheduleStart(e.target.value)}
                  required
                />
              </label>
              <label>
                End
                <input
                  type="datetime-local"
                  value={scheduleEnd}
                  onChange={(e) => setScheduleEnd(e.target.value)}
                  required
                />
              </label>
              <p className="muted small">
                Creates a Teams online meeting via Graph. To attach
                a Teams link to a calendar invite, use{' '}
                <Link to="/sales/calendar">Calendar → New Meeting</Link>.
              </p>
              <div className="page-actions">
                <button type="submit" className="btn primary" disabled={meetingBusy}>
                  {meetingBusy ? 'Scheduling…' : 'Schedule meeting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
