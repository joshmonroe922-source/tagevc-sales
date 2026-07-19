import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  completeFinanceClosePeriod,
  currentFinanceClosePeriodKey,
  ensureFinanceClosePeriodsForYear,
  formatDate,
  formatFinanceClosePeriodKey,
  getFinanceEvidenceSignedUrl,
  isFinanceCloseItemIncomplete,
  listFinanceCloseItems,
  listFinanceClosePeriods,
  listFinanceEntities,
  markFinanceCloseItemDone,
  openFinanceClosePeriod,
  syncIncompleteFinanceCloseTasksToTodo,
  updateFinanceCloseItem,
  uploadFinanceCloseItemEvidence,
} from '../lib/financeApi';
import {
  FINANCE_CLOSE_ITEM_STATUS_LABELS,
  FINANCE_CLOSE_ITEM_STATUSES,
  FINANCE_CLOSE_PERIOD_STATUS_LABELS,
  type FinanceCloseItem,
  type FinanceCloseItemStatus,
  type FinanceClosePeriod,
  type FinanceClosePeriodType,
} from '../lib/financeTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';
import { AuditControlStatusActions } from '../components/AuditControlStatusActions';
import { formatCompletedAt } from '../lib/auditControlUtils';

type Props = {
  salesUser: SalesUser;
  periodType: FinanceClosePeriodType;
};

type ScopeFilter = 'all' | 'parent' | string;

function buildMonthKeys(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => {
    const m = String(i + 1).padStart(2, '0');
    return `${year}-${m}`;
  });
}

/**
 * Month-end or year-end close checklist workspace.
 * Lives only under /sales/finance — never on entity-detail pages.
 */
export function FinanceClosePage({ salesUser, periodType }: Props) {
  const isMonth = periodType === 'month';
  const title = isMonth ? 'Month End Close' : 'Year End Close';
  const currentKey = currentFinanceClosePeriodKey(periodType);
  const currentYear = new Date().getFullYear();

  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [periods, setPeriods] = useState<FinanceClosePeriod[]>([]);
  const [items, setItems] = useState<FinanceCloseItem[]>([]);
  const [activePeriod, setActivePeriod] = useState<FinanceClosePeriod | null>(null);

  const [scope, setScope] = useState<ScopeFilter>('parent');
  const [year, setYear] = useState(String(currentYear));
  const [periodKey, setPeriodKey] = useState(currentKey);
  const [statusFilter, setStatusFilter] = useState<'all' | FinanceCloseItemStatus>('all');
  const [q, setQ] = useState('');

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const periodOptions = useMemo(() => {
    const y = Number(year) || currentYear;
    if (isMonth) return buildMonthKeys(y);
    return [String(y - 1), String(y), String(y + 1)];
  }, [year, isMonth, currentYear]);

  const refreshPeriods = useCallback(async () => {
    const ents = await listFinanceEntities();
    setEntities([...ents].sort((a, b) => a.name.localeCompare(b.name)));

    // "all" is open-for-each only — pick a company to view a checklist
    if (scope === 'all') {
      setPeriods([]);
      setActivePeriod(null);
      setItems([]);
      return;
    }

    const rows = await listFinanceClosePeriods({
      periodType,
      periodKey,
      entityId: scope,
    });
    setPeriods(rows);
    const pick = rows[0] ?? null;
    setActivePeriod(pick);
    if (pick) {
      const checklist = await listFinanceCloseItems(pick.id);
      setItems(checklist);
    } else {
      setItems([]);
    }
  }, [periodType, periodKey, scope]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refreshPeriods();
      } catch (err) {
        if (mounted) {
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load close periods (run migration 0034)',
          );
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refreshPeriods]);

  const filtered = useMemo(() => {
    let rows = items;
    if (statusFilter !== 'all') {
      rows = rows.filter((i) => i.status === statusFilter);
    }
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (i) =>
        i.title.toLowerCase().includes(needle) ||
        i.item_key.toLowerCase().includes(needle) ||
        i.area.toLowerCase().includes(needle) ||
        i.owner_role.toLowerCase().includes(needle),
    );
  }, [items, statusFilter, q]);

  const doneCount = useMemo(
    () => items.filter((i) => i.status === 'done' || i.status === 'na').length,
    [items],
  );
  const openCount = useMemo(
    () => items.filter((i) => isFinanceCloseItemIncomplete(i)).length,
    [items],
  );

  async function onEnsureYear() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const n = await ensureFinanceClosePeriodsForYear(Number(year) || currentYear);
      setNotice(
        n > 0
          ? `Provisioned ${n} new close period(s) for ${year}.`
          : `Close periods for ${year} already seeded (parent + entities).`,
      );
      await refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Provision failed');
    } finally {
      setBusy(false);
    }
  }

  async function onOpenPeriod() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const entityId = scope === 'parent' || scope === 'all' ? null : scope;
      if (scope === 'all') {
        // Open for parent + every entity
        await openFinanceClosePeriod({
          entityId: null,
          periodType,
          periodKey,
        });
        for (const ent of entities) {
          await openFinanceClosePeriod({
            entityId: ent.id,
            periodType,
            periodKey,
          });
        }
        setNotice(
          `Opened ${formatFinanceClosePeriodKey(periodType, periodKey)} for parent + ${entities.length} entiti(es).`,
        );
        setScope('parent');
      } else {
        const id = await openFinanceClosePeriod({
          entityId,
          periodType,
          periodKey,
        });
        setNotice(
          `Opened ${formatFinanceClosePeriodKey(periodType, periodKey)} checklist (${id.slice(0, 8)}…).`,
        );
      }
      await refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Open period failed');
    } finally {
      setBusy(false);
    }
  }

  async function onCompletePeriod() {
    if (!activePeriod) return;
    if (
      !window.confirm(
        `Mark ${formatFinanceClosePeriodKey(periodType, activePeriod.period_key)} closed? This opens the next period checklist.`,
      )
    ) {
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const nextId = await completeFinanceClosePeriod(activePeriod.id, salesUser.id);
      setNotice(
        `Period closed. Next period checklist ready (${String(nextId).slice(0, 8)}…).`,
      );
      // Roll UI to next period key when possible
      if (isMonth) {
        const [y, m] = periodKey.split('-').map(Number);
        if (m === 12) {
          setYear(String(y + 1));
          setPeriodKey(`${y + 1}-01`);
        } else {
          setPeriodKey(`${y}-${String(m + 1).padStart(2, '0')}`);
        }
      } else {
        const y = Number(periodKey);
        setYear(String(y + 1));
        setPeriodKey(String(y + 1));
      }
      await refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed');
    } finally {
      setBusy(false);
    }
  }

  async function onSyncTasks() {
    if (!activePeriod) return;
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncIncompleteFinanceCloseTasksToTodo({
        salesUserId: salesUser.id,
        periodId: activePeriod.id,
      });
      setNotice(
        `Created ${result.closeCreated} close task(s); pushed ${result.todoCreated} to portal To Do.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sync failed');
    } finally {
      setSyncing(false);
    }
  }

  async function patchItem(
    id: string,
    patch: Parameters<typeof updateFinanceCloseItem>[1],
  ) {
    setError(null);
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
    try {
      await updateFinanceCloseItem(id, patch);
      await refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      await refreshPeriods().catch(() => undefined);
    }
  }

  async function onMarkDone(id: string) {
    setError(null);
    setItems((prev) =>
      prev.map((i) =>
        i.id === id
          ? {
              ...i,
              status: 'done',
              completed_at: new Date().toISOString().slice(0, 10),
            }
          : i,
      ),
    );
    try {
      await markFinanceCloseItemDone(id, salesUser.id);
      await refreshPeriods();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mark done failed');
      await refreshPeriods().catch(() => undefined);
    }
  }

  const scopeLabel =
    scope === 'parent'
      ? 'Tage parent'
      : scope === 'all'
        ? 'All companies'
        : (entities.find((e) => e.id === scope)?.name ?? 'Entity');

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            Checklist for each company (Tage parent + subsidiaries). Mark steps done, attach
            evidence, sync incomplete items to tasks. Not on Manage Portfolio entity pages.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/finance" className="btn ghost">
            Finance overview
          </Link>
          <Link to="/sales/finance/tasks" className="btn ghost">
            Tasks
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner success">{notice}</div> : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Period</h2>
          <div className="page-actions">
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={() => void onEnsureYear()}
            >
              Seed {year} periods
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={busy}
              onClick={() => void onOpenPeriod()}
            >
              Open / seed checklist
            </button>
          </div>
        </div>
        <div className="form-grid filters-row">
          <label>
            Company
            <select
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeFilter)}
            >
              <option value="parent">Tage parent</option>
              <option value="all">All (open for each)</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Year
            <select
              className="input"
              value={year}
              onChange={(e) => {
                const y = e.target.value;
                setYear(y);
                if (isMonth) {
                  const month = periodKey.includes('-')
                    ? periodKey.split('-')[1]
                    : String(new Date().getMonth() + 1).padStart(2, '0');
                  setPeriodKey(`${y}-${month}`);
                } else {
                  setPeriodKey(y);
                }
              }}
            >
              {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
                <option key={y} value={String(y)}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            {isMonth ? 'Month' : 'Close year'}
            <select
              className="input"
              value={periodKey}
              onChange={(e) => setPeriodKey(e.target.value)}
            >
              {periodOptions.map((k) => (
                <option key={k} value={k}>
                  {formatFinanceClosePeriodKey(periodType, k)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Item status
            <select
              className="input"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as 'all' | FinanceCloseItemStatus)
              }
            >
              <option value="all">All items</option>
              {FINANCE_CLOSE_ITEM_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FINANCE_CLOSE_ITEM_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="full">
            Search
            <input
              className="input"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Title, area, key…"
            />
          </label>
        </div>
      </section>

      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && scope === 'all' ? (
        <section className="panel">
          <p className="muted">
            Select a company above to view its checklist, or click{' '}
            <strong>Open / seed checklist</strong> to provision{' '}
            {formatFinanceClosePeriodKey(periodType, periodKey)} for parent and every
            subsidiary.
          </p>
        </section>
      ) : null}

      {!loading && !activePeriod && scope !== 'all' ? (
        <section className="panel">
          <p className="muted">
            No {title.toLowerCase()} checklist for{' '}
            <strong>{formatFinanceClosePeriodKey(periodType, periodKey)}</strong> ·{' '}
            {scopeLabel}. Click <strong>Open / seed checklist</strong> (or{' '}
            <strong>Seed {year} periods</strong> to provision the full year).
          </p>
        </section>
      ) : null}

      {!loading && activePeriod ? (
        <>
          <div className="hr-compliance-stats muted small">
            <span>
              {formatFinanceClosePeriodKey(periodType, activePeriod.period_key)} · {scopeLabel}
            </span>
            <span>
              Status:{' '}
              {activePeriod.status === 'closed' && activePeriod.closed_at
                ? formatCompletedAt(activePeriod.closed_at, 'Closed')
                : (FINANCE_CLOSE_PERIOD_STATUS_LABELS[activePeriod.status] ??
                  activePeriod.status)}
            </span>
            {activePeriod.due_at ? <span>Due {formatDate(activePeriod.due_at)}</span> : null}
            <span>
              {doneCount}/{items.length} complete
            </span>
            {openCount > 0 ? (
              <span className="warn-text">{openCount} incomplete</span>
            ) : null}
            <span className="page-actions" style={{ display: 'inline-flex', gap: '0.5rem' }}>
              <button
                type="button"
                className="btn ghost"
                disabled={syncing || openCount === 0}
                onClick={() => void onSyncTasks()}
              >
                {syncing ? 'Syncing…' : 'Tasks for incomplete'}
              </button>
              {activePeriod.status !== 'closed' ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void onCompletePeriod()}
                >
                  Mark period closed
                </button>
              ) : null}
            </span>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Checklist</h2>
            </div>
            {filtered.length === 0 ? (
              <p className="muted">No checklist items match filters.</p>
            ) : (
              <ul className="ops-compliance-list">
                {filtered.map((item) => {
                  const expanded = expandedId === item.id;
                  return (
                    <li key={item.id}>
                      <div className="ops-compliance-row">
                        <button
                          type="button"
                          className="ops-compliance-title"
                          onClick={() =>
                            setExpandedId(expanded ? null : item.id)
                          }
                        >
                          {item.title}
                        </button>
                        <span className="muted small">{item.area}</span>
                        <span className="muted small">
                          {FINANCE_CLOSE_ITEM_STATUS_LABELS[item.status]}
                        </span>
                        {item.due_at ? (
                          <span className="muted small">Due {formatDate(item.due_at)}</span>
                        ) : null}
                        <AuditControlStatusActions
                          status={
                            item.status === 'done'
                              ? 'compliant'
                              : item.status === 'blocked'
                                ? 'gap'
                                : item.status
                          }
                          completedAt={item.completed_at}
                          reviewLabel="Done"
                          onMarkReviewed={() => onMarkDone(item.id)}
                          onGap={() =>
                            patchItem(item.id, { status: 'blocked' })
                          }
                          onInProgress={() =>
                            patchItem(item.id, { status: 'in_progress' })
                          }
                        />
                      </div>
                      {expanded ? (
                        <CloseItemEditor
                          item={item}
                          period={activePeriod}
                          onSave={(patch) => patchItem(item.id, patch)}
                          onDone={() => onMarkDone(item.id)}
                          onUploaded={() => void refreshPeriods()}
                          onError={setError}
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {periods.length > 1 ? (
            <p className="muted small">
              {periods.length} period row(s) matched filters (showing first / selected scope).
            </p>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function CloseItemEditor({
  item,
  period,
  onSave,
  onDone,
  onUploaded,
  onError,
}: {
  item: FinanceCloseItem;
  period: FinanceClosePeriod;
  onSave: (patch: {
    owner_role?: string;
    due_at?: string | null;
    evidence_url?: string;
    evidence_notes?: string;
    notes?: string;
    status?: FinanceCloseItemStatus;
  }) => void;
  onDone: () => Promise<void>;
  onUploaded: () => void;
  onError: (msg: string | null) => void;
}) {
  const [owner, setOwner] = useState(item.owner_role);
  const [due, setDue] = useState(item.due_at ?? '');
  const [evidenceUrl, setEvidenceUrl] = useState(item.evidence_url);
  const [evidenceNotes, setEvidenceNotes] = useState(item.evidence_notes ?? '');
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<FinanceCloseItemStatus>(item.status);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setOwner(item.owner_role);
    setDue(item.due_at ?? '');
    setEvidenceUrl(item.evidence_url);
    setEvidenceNotes(item.evidence_notes ?? '');
    setNotes(item.notes);
    setStatus(item.status);
  }, [item]);

  async function onFile(file: File | null) {
    if (!file) return;
    setUploading(true);
    onError(null);
    try {
      const result = await uploadFinanceCloseItemEvidence({
        item,
        period,
        file,
      });
      if (!result.ok) {
        onError(result.message);
        return;
      }
      onUploaded();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function openAttached() {
    if (!item.evidence_storage_path) return;
    const url = await getFinanceEvidenceSignedUrl(item.evidence_storage_path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else onError('Could not open attached evidence');
  }

  return (
    <div className="hr-control-editor form-grid">
      {item.description ? (
        <p className="muted small full">{item.description}</p>
      ) : null}
      {item.evidence_expectation ? (
        <p className="muted small full">
          Evidence: {item.evidence_expectation}
          {item.source_control_key ? ` · control ${item.source_control_key}` : ''}
        </p>
      ) : null}
      <label>
        Owner role
        <input
          className="input"
          value={owner}
          onChange={(e) => setOwner(e.target.value)}
        />
      </label>
      <label>
        Status
        <select
          className="input"
          value={status}
          onChange={(e) => setStatus(e.target.value as FinanceCloseItemStatus)}
        >
          {FINANCE_CLOSE_ITEM_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FINANCE_CLOSE_ITEM_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Due
        <input
          className="input"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
        />
      </label>
      <label className="full">
        Evidence URL
        <input
          className="input"
          value={evidenceUrl}
          onChange={(e) => setEvidenceUrl(e.target.value)}
          placeholder="https://…"
        />
      </label>
      <label className="full">
        Evidence notes
        <input
          className="input"
          value={evidenceNotes}
          onChange={(e) => setEvidenceNotes(e.target.value)}
        />
      </label>
      <label className="full">
        Attach evidence file
        <input
          className="input"
          type="file"
          disabled={uploading}
          onChange={(e) => void onFile(e.target.files?.[0] ?? null)}
        />
      </label>
      {item.evidence_file_name ? (
        <div className="full muted small">
          Attached: {item.evidence_file_name}{' '}
          <button type="button" className="btn ghost" onClick={() => void openAttached()}>
            Open
          </button>
        </div>
      ) : null}
      <label className="full">
        Notes
        <input
          className="input"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
      </label>
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            onSave({
              owner_role: owner,
              due_at: due || null,
              evidence_url: evidenceUrl,
              evidence_notes: evidenceNotes,
              notes,
              status,
            })
          }
        >
          Save
        </button>
        <button type="button" className="btn primary" onClick={() => void onDone()}>
          Mark done
        </button>
        <button
          type="button"
          className="btn ghost"
          onClick={() => onSave({ status: 'na' })}
        >
          Mark N/A
        </button>
      </div>
    </div>
  );
}
