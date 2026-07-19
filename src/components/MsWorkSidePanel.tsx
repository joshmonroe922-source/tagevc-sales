import {
  getNotificationPermission,
  loadAlertPrefs,
  requestNotificationPermission,
  saveAlertPrefs,
  type AlertPrefs,
  type NotificationPermissionState,
} from '../lib/desktopAlerts';
import type { CalendarStatus } from '../lib/calendarApi';
import type { SalesUser } from '../lib/types';
import { formatDateTime } from '../lib/types';
import {
  COMMON_TIMEZONES,
  timezoneSourceLabel,
  type ResolvedTimezone,
} from '../lib/userTimezone';
import { useState, type ReactNode } from 'react';

type Props = {
  salesUser: SalesUser;
  status: CalendarStatus | null;
  workEmailDraft: string;
  savingEmail: boolean;
  connecting: boolean;
  sideOpen: boolean;
  /** When provided, renders a collapse control in the panel header. */
  onClose?: () => void;
  /** DOM id for aria-controls / panel anchor (default: calendar-settings). */
  panelId?: string;
  alertPath: string;
  alertBlurb: string;
  /** Side panel heading (Calendar uses “Calendar settings”). */
  title?: string;
  capabilityLabels?: string[];
  extraMeta?: Array<{ label: string; value: string }>;
  /** Optional block below timezone (e.g. calendar overlay toggles). */
  extraSections?: ReactNode;
  /** Rendered at the top of the side panel (e.g. Personal / Google ICS). */
  leadingSections?: ReactNode;
  /** When set, shows timezone preference control (Calendar / Today). */
  resolvedTimezone?: ResolvedTimezone | null;
  onTimezoneChange?: (ianaOrAuto: string) => void;
  /** Morning digest email opt-out (Today settings). */
  morningDigestEnabled?: boolean;
  onMorningDigestChange?: (enabled: boolean) => void | Promise<void>;
  savingDigest?: boolean;
  onWorkEmailChange: (v: string) => void;
  onSaveWorkEmail: () => void | Promise<void>;
  onConnect: () => void | Promise<void>;
  onNotice: (msg: string) => void;
  onError: (msg: string) => void;
};

export function MsWorkSidePanel({
  salesUser,
  status,
  workEmailDraft,
  savingEmail,
  connecting,
  sideOpen,
  onClose,
  panelId = 'calendar-settings',
  alertPath,
  alertBlurb,
  title = 'Work mailbox',
  capabilityLabels,
  extraMeta,
  extraSections,
  leadingSections,
  resolvedTimezone,
  onTimezoneChange,
  morningDigestEnabled,
  onMorningDigestChange,
  savingDigest,
  onWorkEmailChange,
  onSaveWorkEmail,
  onConnect,
  onNotice,
  onError,
}: Props) {
  const [notifPerm, setNotifPerm] = useState<NotificationPermissionState>(() =>
    getNotificationPermission(),
  );
  const [alertPrefs, setAlertPrefs] = useState<AlertPrefs>(() => loadAlertPrefs());

  async function onEnableAlerts() {
    const result = await requestNotificationPermission(salesUser, alertPath);
    setNotifPerm(result);
    if (result === 'granted') {
      onNotice('Desktop alerts enabled while a portal tab stays open.');
    } else if (result === 'denied') {
      onError('Desktop notifications were blocked. Enable them in browser site settings.');
    }
  }

  const caps =
    capabilityLabels ??
    [
      status?.capabilities?.create_events ? 'New Meeting' : null,
      status?.capabilities?.todo ? 'To Do' : null,
      status?.capabilities?.planner ? 'Planner' : null,
    ].filter(Boolean) as string[];

  return (
    <div
      id={panelId}
      className={`panel app-side${sideOpen ? ' open' : ''}`}
    >
      <div className="panel-head cal-settings-head">
        <h2>{title}</h2>
        {onClose ? (
          <button
            type="button"
            className="btn ghost cal-settings-collapse"
            onClick={onClose}
            aria-label="Collapse settings panel"
            aria-expanded={sideOpen}
            aria-controls={panelId}
            title="Collapse settings"
          >
            <span aria-hidden>›</span>
          </button>
        ) : null}
      </div>
      {leadingSections}
      <div className={leadingSections ? 'cal-alerts-block' : undefined}>
        {title !== 'Work mailbox' ? <h3>Work mailbox</h3> : null}
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
            onChange={(e) => onWorkEmailChange(e.target.value)}
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
      </div>

      {resolvedTimezone && onTimezoneChange ? (
        <div className="cal-alerts-block">
          <h3>Time zone</h3>
          <p className="muted small">
            Used for Calendar, Today, and the 6:00 AM morning digest. Source:{' '}
            {timezoneSourceLabel(resolvedTimezone.source)}.
          </p>
          <div className="field">
            <label htmlFor="portal-timezone">Display timezone</label>
            <select
              id="portal-timezone"
              value={
                resolvedTimezone.source === 'override'
                  ? resolvedTimezone.timeZone
                  : '__auto__'
              }
              onChange={(e) => onTimezoneChange(e.target.value)}
            >
              <option value="__auto__">
                Auto
                {resolvedTimezone.source !== 'override'
                  ? ` (${resolvedTimezone.timeZone})`
                  : ''}
              </option>
              {COMMON_TIMEZONES.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
              {resolvedTimezone.source === 'override' &&
              !COMMON_TIMEZONES.some((z) => z.value === resolvedTimezone.timeZone) ? (
                <option value={resolvedTimezone.timeZone}>
                  {resolvedTimezone.timeZone}
                </option>
              ) : null}
            </select>
          </div>
        </div>
      ) : null}

      {onMorningDigestChange != null && morningDigestEnabled != null ? (
        <div className="cal-alerts-block">
          <h3>Morning digest</h3>
          <p className="muted small">
            Around 6:00 AM in your timezone, your personal AI assistant emails a Today summary
            and a short win-the-day note (powered by Grok). Default is on.
          </p>
          <label className="field" style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={morningDigestEnabled}
              disabled={savingDigest}
              onChange={(e) => void onMorningDigestChange(e.target.checked)}
            />
            <span>Email me a daily morning briefing</span>
          </label>
        </div>
      ) : null}

      {extraSections}

      <div className="cal-alerts-block">
        <h3>Desktop alerts</h3>
        <p className="muted small">{alertBlurb}</p>
        {notifPerm === 'unsupported' ? (
          <p className="muted small">This browser does not support notifications.</p>
        ) : notifPerm === 'granted' ? (
          <p className="muted small">Alerts enabled.</p>
        ) : (
          <button type="button" className="btn ghost" onClick={() => void onEnableAlerts()}>
            Enable desktop alerts
          </button>
        )}
        <div className="field" style={{ marginTop: '0.65rem' }}>
          <label htmlFor="alert-leads">Remind before (minutes, comma-separated)</label>
          <input
            id="alert-leads"
            type="text"
            defaultValue={alertPrefs.leadMinutes.join(', ')}
            onBlur={(e) => {
              const mins = e.target.value
                .split(/[,;\s]+/)
                .map((s) => Number(s.trim()))
                .filter((n) => Number.isFinite(n) && n > 0 && n <= 1440);
              if (!mins.length) return;
              const next = saveAlertPrefs({
                leadMinutes: [...new Set(mins)].sort((a, b) => b - a),
              });
              setAlertPrefs(next);
            }}
          />
        </div>
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
        {extraMeta?.map((m) => (
          <div key={m.label}>
            <dt>{m.label}</dt>
            <dd>{m.value}</dd>
          </div>
        ))}
        <div>
          <dt>Capabilities</dt>
          <dd>{caps.join(' · ') || 'View only — reconnect for write scopes'}</dd>
        </div>
      </dl>
    </div>
  );
}
