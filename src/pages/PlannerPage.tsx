import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MsWorkSidePanel } from '../components/MsWorkSidePanel';
import { PlannerPanel } from '../components/PlannerPanel';
import {
  completePlannerTask,
  createPlannerTask,
  fetchCalendarStatus,
  fetchPlannerPlans,
  fetchPlannerTasks,
  setMyWorkEmail,
  startCalendarOAuth,
  type CalendarStatus,
  type PlannerPlan,
  type PlannerTask,
} from '../lib/calendarApi';
import { loadStoredPlanId, saveStoredPlanId } from '../lib/msTaskUtils';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function PlannerPage({ salesUser }: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [status, setStatus] = useState<CalendarStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [workEmailDraft, setWorkEmailDraft] = useState('');
  const [savingEmail, setSavingEmail] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const [plans, setPlans] = useState<PlannerPlan[]>([]);
  const [planHint, setPlanHint] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string>(() => loadStoredPlanId());
  const [plannerTasks, setPlannerTasks] = useState<PlannerTask[]>([]);
  const [plannerLoading, setPlannerLoading] = useState(false);
  const [plannerTitle, setPlannerTitle] = useState('');
  const [plannerSaving, setPlannerSaving] = useState(false);

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

  const loadPlanner = useCallback(async () => {
    if (!status?.connected || !status.capabilities?.planner) {
      setPlans([]);
      setPlannerTasks([]);
      return;
    }
    setPlannerLoading(true);
    try {
      const res = await fetchPlannerPlans();
      setPlans(res.plans ?? []);
      setPlanHint(res.hint ?? res.error ?? null);
      const selected =
        (planId && res.plans?.some((p) => p.id === planId) ? planId : null) ||
        res.plans?.[0]?.id ||
        '';
      if (selected && selected !== planId) {
        setPlanId(selected);
        saveStoredPlanId(selected);
      }
      if (selected) {
        setPlannerTasks(await fetchPlannerTasks(selected));
      } else {
        setPlannerTasks([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Planner');
    } finally {
      setPlannerLoading(false);
    }
  }, [status?.connected, status?.capabilities?.planner, planId]);

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
      setNotice('Work mailbox connected. If Planner is missing, reconnect after admin consent.');
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
    void loadPlanner();
  }, [status?.connected, loadPlanner]);

  async function onConnect() {
    setConnecting(true);
    setError(null);
    try {
      const { url } = await startCalendarOAuth('/sales/planner');
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

  const openPlanner = plannerTasks.filter((t) => !t.completed);
  const donePlanner = plannerTasks.filter((t) => t.completed).slice(0, 8);

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1>Planner</h1>
          <p className="muted">
            Microsoft Planner
            {status?.microsoft_email ? ` · ${status.microsoft_email}` : ''}.{' '}
            <Link to="/sales/calendar">Calendar</Link>
            {' · '}
            <Link to="/sales/todo">To Do</Link>
          </p>
        </div>
        <div className="page-actions">
          {status?.connected ? (
            <button
              type="button"
              className="btn ghost"
              onClick={() => void loadPlanner()}
              disabled={plannerLoading}
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
          Your Microsoft connection is missing newer permissions. Click <strong>Reconnect</strong>{' '}
          after an admin grants consent in Azure.
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
                <p>Connect your Tage work mailbox to use Microsoft Planner here.</p>
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
              <PlannerPanel
                loading={plannerLoading}
                plans={plans}
                planId={planId}
                planHint={planHint}
                openTasks={openPlanner}
                doneTasks={donePlanner}
                title={plannerTitle}
                saving={plannerSaving}
                canWrite={Boolean(status.capabilities?.planner)}
                onPlanChange={(id) => {
                  setPlanId(id);
                  saveStoredPlanId(id);
                  void (async () => {
                    setPlannerLoading(true);
                    try {
                      setPlannerTasks(await fetchPlannerTasks(id));
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Failed to load plan tasks');
                    } finally {
                      setPlannerLoading(false);
                    }
                  })();
                }}
                onTitleChange={setPlannerTitle}
                onCreate={async () => {
                  const t = plannerTitle.trim();
                  if (!t || !planId) return;
                  setPlannerSaving(true);
                  setError(null);
                  try {
                    await createPlannerTask(planId, t);
                    setPlannerTitle('');
                    setNotice('Planner task created.');
                    setPlannerTasks(await fetchPlannerTasks(planId));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not create Planner task');
                  } finally {
                    setPlannerSaving(false);
                  }
                }}
                onComplete={async (task) => {
                  setError(null);
                  try {
                    await completePlannerTask(task.id);
                    setNotice('Planner task completed.');
                    if (planId) setPlannerTasks(await fetchPlannerTasks(planId));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Could not complete task');
                  }
                }}
                onReconnect={() => void onConnect()}
              />
            )}
          </div>

          <MsWorkSidePanel
            salesUser={salesUser}
            status={status}
            workEmailDraft={workEmailDraft}
            savingEmail={savingEmail}
            connecting={connecting}
            sideOpen={sideOpen}
            alertPath="/sales/planner"
            alertBlurb="While a portal tab is open: due/overdue Planner tasks, plus meeting reminders and To Do due dates."
            capabilityLabels={[
              status?.capabilities?.planner ? 'Planner' : null,
              status?.capabilities?.create_events ? 'Calendar' : null,
              status?.capabilities?.todo ? 'To Do' : null,
            ].filter(Boolean) as string[]}
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
