import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  completeChecklist,
  listChecklistItems,
  listChecklists,
  listEmployees,
  startChecklist,
  updateChecklistItemStatus,
} from '../lib/hrApi';
import {
  HR_CHECKLIST_KIND_LABELS,
  HR_ITEM_SCOPE_LABELS,
  HR_ITEM_STATUSES,
  HR_ITEM_STATUS_LABELS,
  HR_SYSTEM_HOOK_LABELS,
  type HrChecklistItem,
  type HrChecklistKind,
  type HrEmployee,
  type HrItemScope,
  type HrItemStatus,
  type HrOnboardingChecklist,
  type HrSystemHook,
} from '../lib/hrTypes';
import type { SalesUser } from '../lib/types';
import { formatCompletedAt } from '../lib/auditControlUtils';

type Props = { salesUser: SalesUser; kind: HrChecklistKind };

export function HrChecklistPage({ salesUser, kind }: Props) {
  const label = HR_CHECKLIST_KIND_LABELS[kind];
  const [checklists, setChecklists] = useState<HrOnboardingChecklist[]>([]);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [items, setItems] = useState<HrChecklistItem[]>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [lists, people] = await Promise.all([listChecklists(kind), listEmployees()]);
    setChecklists(lists);
    const eligible =
      kind === 'talent_acquisition'
        ? people.filter((p) =>
            ['prospect', 'onboarding', 'active'].includes(p.employment_status),
          )
        : kind === 'onboarding'
          ? people.filter((p) =>
              ['prospect', 'onboarding', 'active'].includes(p.employment_status),
            )
          : people.filter((p) =>
              ['active', 'offboarding'].includes(p.employment_status),
            );
    setEmployees(eligible.length ? eligible : people);
    setEmployeeId((prev) => prev || eligible[0]?.id || people[0]?.id || '');
    setSelectedId((prev) => prev ?? lists[0]?.id ?? null);
  }, [kind]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load checklists (run migration 0035 if tables are missing)',
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setItems([]);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const next = await listChecklistItems(selectedId);
        if (mounted) setItems(next);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load items');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedId]);

  async function onStart(e: FormEvent) {
    e.preventDefault();
    if (!employeeId) return;
    setBusy(true);
    setError(null);
    try {
      const { checklist } = await startChecklist({
        employee_id: employeeId,
        kind,
        created_by: salesUser.id,
      });
      await refresh();
      setSelectedId(checklist.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checklist');
    } finally {
      setBusy(false);
    }
  }

  async function onItemStatus(id: string, status: HrItemStatus) {
    setError(null);
    try {
      await updateChecklistItemStatus(id, status);
      if (selectedId) setItems(await listChecklistItems(selectedId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function onComplete() {
    if (!selectedId) return;
    setBusy(true);
    setError(null);
    try {
      await completeChecklist(selectedId);
      await refresh();
      if (selectedId) setItems(await listChecklistItems(selectedId));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed');
    } finally {
      setBusy(false);
    }
  }

  const selected = checklists.find((c) => c.id === selectedId) ?? null;
  const doneCount = items.filter((i) => i.status === 'done' || i.status === 'na').length;

  const blurb =
    kind === 'talent_acquisition'
      ? 'Recruiting pipeline through offer accepted. On the employee file, use Offer accepted → Onboarding to start the Signent/TAGE hire checklist.'
      : kind === 'onboarding'
        ? 'Post–offer hire checklist (Signent/TAGE template) — payroll, IT, assets, and compliance hooks.'
        : 'Reverse checklist for exit — revoke access, recover assets, and close payroll/benefits.';

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{label}</h1>
          <p className="muted">{blurb}</p>
        </div>
        <div className="page-actions">
          <Link to="/sales/hr/employees" className="btn ghost">
            Employees
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <div className="hr-split">
          <section className="panel">
            <div className="panel-head">
              <h2>Checklists</h2>
            </div>
            <form className="hr-start-form" onSubmit={(e) => void onStart(e)}>
              <label>
                Employee
                <select
                  className="input"
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  required
                >
                  <option value="" disabled>
                    Select…
                  </option>
                  {employees.map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name}
                      {emp.role_title ? ` — ${emp.role_title}` : ''}
                    </option>
                  ))}
                </select>
              </label>
              <button type="submit" className="btn" disabled={busy || !employeeId}>
                {busy ? 'Starting…' : `Start ${label.toLowerCase()}`}
              </button>
            </form>
            {employees.length === 0 ? (
              <p className="muted small">
                Add a person first under{' '}
                <Link to="/sales/hr/employees">Employees</Link>.
              </p>
            ) : null}
            {checklists.length === 0 ? (
              <p className="muted">No {label.toLowerCase()} checklists yet.</p>
            ) : (
              <ul className="hr-list">
                {checklists.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={`hr-list-pick${selectedId === c.id ? ' active' : ''}`}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span className="hr-list-title">
                        {c.hr_employees?.full_name ?? 'Employee'}
                      </span>
                      <span className="muted small">
                        {c.status.replace('_', ' ')} · {c.template_slug || 'custom'}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>
                {selected
                  ? `${selected.hr_employees?.full_name ?? 'Checklist'} items`
                  : 'Items'}
              </h2>
              {selected && selected.status !== 'complete' ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void onComplete()}
                >
                  Mark complete
                </button>
              ) : null}
            </div>
            {!selected ? (
              <p className="muted">Select or start a checklist.</p>
            ) : (
              <>
                <p className="muted small">
                  {doneCount}/{items.length} done
                  {selected.status === 'complete' && selected.completed_at
                    ? ` · ${formatCompletedAt(selected.completed_at)}`
                    : selected.status === 'complete'
                      ? ' · completed'
                      : ''}
                </p>
                <ul className="hr-item-list">
                  {items.map((item) => (
                    <li key={item.id}>
                      <div>
                        <div className="hr-list-title">{item.title}</div>
                        <div className="muted small">
                          {item.category}
                          {item.scope
                            ? ` · ${HR_ITEM_SCOPE_LABELS[item.scope as HrItemScope] ?? item.scope}`
                            : ''}
                          {item.assignee_hint ? ` · ${item.assignee_hint}` : ''}
                          {item.system_hook
                            ? ` · hook: ${HR_SYSTEM_HOOK_LABELS[item.system_hook as HrSystemHook] ?? item.system_hook}`
                            : ''}
                          {item.status === 'done' && item.completed_at
                            ? ` · ${formatCompletedAt(item.completed_at)}`
                            : ''}
                        </div>
                      </div>
                      <select
                        className="input hr-item-status"
                        value={item.status}
                        disabled={selected.status === 'complete'}
                        onChange={(e) =>
                          void onItemStatus(item.id, e.target.value as HrItemStatus)
                        }
                      >
                        {HR_ITEM_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {HR_ITEM_STATUS_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
