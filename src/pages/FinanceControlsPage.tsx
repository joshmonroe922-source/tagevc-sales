import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createFinanceControl,
  formatDate,
  getFinanceEvidenceSignedUrl,
  isFinanceControlOverdue,
  listFinanceControls,
  listFinanceEntities,
  markFinanceControlReviewed,
  syncIncompleteFinanceTasksToTodo,
  updateFinanceControl,
  uploadFinanceControlEvidence,
} from '../lib/financeApi';
import {
  FINANCE_AREAS,
  FINANCE_COMPLIANCE_CADENCES,
  FINANCE_COMPLIANCE_CADENCE_LABELS,
  FINANCE_CONTROL_SOURCE_LABELS,
  FINANCE_CONTROL_SOURCES,
  FINANCE_CONTROL_STATUS_LABELS,
  FINANCE_CONTROL_STATUSES,
  type FinanceComplianceCadence,
  type FinanceControl,
  type FinanceControlSource,
  type FinanceControlStatus,
} from '../lib/financeTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';
import { AuditControlStatusActions } from '../components/AuditControlStatusActions';

type Props = { salesUser: SalesUser };
type ScopeFilter = 'all' | 'parent' | string;

/**
 * Finance & accounting compliance matrix (parent + each portfolio entity).
 * Lives only under /sales/finance — never on entity-detail pages.
 */
export function FinanceControlsPage({ salesUser }: Props) {
  const [controls, setControls] = useState<FinanceControl[]>([]);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [scope, setScope] = useState<ScopeFilter>('all');
  const [area, setArea] = useState<string>('all');
  const [source, setSource] = useState<FinanceControlSource | 'all'>('all');
  const [status, setStatus] = useState<FinanceControlStatus | 'all'>('all');
  const [q, setQ] = useState('');

  const [title, setTitle] = useState('');
  const [entityId, setEntityId] = useState('');
  const [cadence, setCadence] = useState<FinanceComplianceCadence>('annual');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [newArea, setNewArea] = useState('Platform Setup');

  const refresh = useCallback(async () => {
    const [rows, ents] = await Promise.all([
      listFinanceControls({
        entityId: scope,
        area,
        source,
        status,
      }),
      listFinanceEntities(),
    ]);
    setControls(rows);
    setEntities([...ents].sort((a, b) => a.name.localeCompare(b.name)));
  }, [scope, area, source, status]);

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
              : 'Failed to load finance controls (run migration 0027)',
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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return controls;
    return controls.filter(
      (c) =>
        c.title.toLowerCase().includes(needle) ||
        c.control_key.toLowerCase().includes(needle) ||
        c.area.toLowerCase().includes(needle) ||
        c.owner_role.toLowerCase().includes(needle) ||
        (c.ops_entities?.name ?? 'tage parent').toLowerCase().includes(needle),
    );
  }, [controls, q]);

  const overdueCount = useMemo(
    () => filtered.filter((c) => isFinanceControlOverdue(c)).length,
    [filtered],
  );
  const gapCount = useMemo(
    () => filtered.filter((c) => c.status === 'gap').length,
    [filtered],
  );
  const auditCount = useMemo(
    () => filtered.filter((c) => c.source === 'audit').length,
    [filtered],
  );
  const recommendedCount = useMemo(
    () => filtered.filter((c) => c.source === 'recommended').length,
    [filtered],
  );

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    setError(null);
    try {
      await createFinanceControl({
        title,
        entity_id: entityId || null,
        cadence,
        next_due_at: due || null,
        notes,
        area: newArea,
        source: 'manual',
        created_by: salesUser.id,
      });
      setTitle('');
      setDue('');
      setNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function patchControl(
    id: string,
    patch: Parameters<typeof updateFinanceControl>[1],
  ) {
    setError(null);
    if (patch.status) {
      setControls((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch, status: patch.status! } : c)),
      );
    }
    try {
      await updateFinanceControl(id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      await refresh().catch(() => undefined);
    }
  }

  async function onMarkReviewed(id: string) {
    setError(null);
    setControls((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              status: 'compliant',
              last_reviewed_at: new Date().toISOString().slice(0, 10),
            }
          : c,
      ),
    );
    try {
      await markFinanceControlReviewed(id, salesUser.id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mark reviewed failed');
      await refresh().catch(() => undefined);
    }
  }

  async function onSyncTasks() {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const result = await syncIncompleteFinanceTasksToTodo({
        salesUserId: salesUser.id,
      });
      setNotice(
        `Tasks ready: ${result.financeCreated} new finance task(s), ${result.todoCreated} pushed to portal To Do.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Task sync failed');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Compliance / controls</h1>
          <p className="muted">
            Accounting &amp; finance controls for Tage parent and each subsidiary (Intuit
            Enterprise Suite). Set per-company next due / review frequency (
            <code>cadence</code>, annual default), attach evidence files, and mark reviewed
            to roll the next due forward. Incomplete items become finance tasks using those
            due dates.
          </p>
        </div>
        <div className="page-actions">
          <button
            type="button"
            className="btn primary"
            disabled={syncing}
            onClick={() => void onSyncTasks()}
          >
            {syncing ? 'Creating…' : 'Tasks for incomplete'}
          </button>
          <Link to="/sales/finance/tasks" className="btn ghost">
            Open tasks
          </Link>
          <Link to="/sales/finance" className="btn ghost">
            Overview
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {notice ? <div className="banner">{notice}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <>
          <div className="toolbar hr-toolbar hr-compliance-filters">
            <input
              className="input"
              placeholder="Search control, area, owner…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <select
              className="input"
              value={scope}
              onChange={(e) => setScope(e.target.value as ScopeFilter)}
            >
              <option value="all">All companies</option>
              <option value="parent">Tage parent only</option>
              {entities.map((ent) => (
                <option key={ent.id} value={ent.id}>
                  {ent.name}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={area}
              onChange={(e) => setArea(e.target.value)}
            >
              <option value="all">All areas</option>
              {FINANCE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as FinanceControlSource | 'all')}
            >
              <option value="all">All sources</option>
              {FINANCE_CONTROL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {FINANCE_CONTROL_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as FinanceControlStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {FINANCE_CONTROL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {FINANCE_CONTROL_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="hr-compliance-stats muted small">
            <span>{filtered.length} showing</span>
            <span>{auditCount} from audit</span>
            <span>{recommendedCount} recommended</span>
            {overdueCount > 0 ? (
              <span className="warn-text">{overdueCount} overdue</span>
            ) : null}
            {gapCount > 0 ? <span className="warn-text">{gapCount} gaps</span> : null}
          </div>

          <section className="panel ops-compliance-hub">
            <div className="panel-head">
              <h2>Controls</h2>
            </div>
            {filtered.length === 0 ? (
              <p className="muted">
                No controls match. Apply migration{' '}
                <code>0027_finance_accounting_audit.sql</code> to seed the finance audit.
              </p>
            ) : (
              <ul className="ops-compliance-list hr-control-list">
                {filtered.map((item) => {
                  const overdue = isFinanceControlOverdue(item);
                  const open = expandedId === item.id;
                  return (
                    <li key={item.id} className={overdue ? 'overdue' : undefined}>
                      <div className="hr-control-main">
                        <button
                          type="button"
                          className="ops-compliance-title hr-control-toggle"
                          onClick={() =>
                            setExpandedId((cur) => (cur === item.id ? null : item.id))
                          }
                        >
                          {item.title}
                        </button>
                        <div className="muted small">
                          {item.ops_entities?.name ?? 'Tage parent'}
                          {' · '}
                          {item.area}
                          {' · '}
                          {item.document_kind}
                          {' · '}
                          <span
                            className={
                              item.source === 'recommended'
                                ? 'hr-source-recommended'
                                : undefined
                            }
                          >
                            {FINANCE_CONTROL_SOURCE_LABELS[
                              (item.source as FinanceControlSource) ?? 'manual'
                            ] ?? item.source}
                          </span>
                          {' · '}
                          {FINANCE_COMPLIANCE_CADENCE_LABELS[item.cadence]}
                          {' · '}
                          {FINANCE_CONTROL_STATUS_LABELS[item.status]}
                          {item.next_due_at
                            ? ` · due ${formatDate(item.next_due_at)}`
                            : ''}
                          {item.owner_role ? ` · ${item.owner_role}` : ''}
                        </div>
                        {item.evidence_expectation ? (
                          <div className="muted small">
                            Evidence: {item.evidence_expectation}
                          </div>
                        ) : null}
                        {item.evidence_file_name ? (
                          <div className="muted small">
                            Attached: {item.evidence_file_name}
                          </div>
                        ) : null}
                        {open ? (
                          <ControlEditor
                            item={item}
                            onSave={(patch) => void patchControl(item.id, patch)}
                            onReviewed={() => onMarkReviewed(item.id)}
                            onUploaded={() => void refresh()}
                            onError={setError}
                          />
                        ) : null}
                      </div>
                      <AuditControlStatusActions
                        status={item.status}
                        completedAt={item.last_reviewed_at}
                        onMarkReviewed={() => onMarkReviewed(item.id)}
                        onGap={() => void patchControl(item.id, { status: 'gap' })}
                        onInProgress={() =>
                          void patchControl(item.id, { status: 'in_progress' })
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel">
            <h3 className="subhead">Add manual control</h3>
            <form className="form-grid" onSubmit={(e) => void onAdd(e)}>
              <label>
                Title
                <input
                  className="input"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label>
                Company scope
                <select
                  className="input"
                  value={entityId}
                  onChange={(e) => setEntityId(e.target.value)}
                >
                  <option value="">Tage parent / shared</option>
                  {entities.map((ent) => (
                    <option key={ent.id} value={ent.id}>
                      {ent.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Area
                <select
                  className="input"
                  value={newArea}
                  onChange={(e) => setNewArea(e.target.value)}
                >
                  {FINANCE_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Cadence
                <select
                  className="input"
                  value={cadence}
                  onChange={(e) =>
                    setCadence(e.target.value as FinanceComplianceCadence)
                  }
                >
                  {FINANCE_COMPLIANCE_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {FINANCE_COMPLIANCE_CADENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Next due
                <input
                  className="input"
                  type="date"
                  value={due}
                  onChange={(e) => setDue(e.target.value)}
                />
              </label>
              <label className="full">
                Notes
                <input
                  className="input"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn">
                  Add control
                </button>
              </div>
            </form>
          </section>
        </>
      ) : null}
    </>
  );
}

function ControlEditor({
  item,
  onSave,
  onReviewed,
  onUploaded,
  onError,
}: {
  item: FinanceControl;
  onSave: (patch: {
    owner_role?: string;
    next_due_at?: string | null;
    evidence_url?: string;
    evidence_notes?: string;
    notes?: string;
    status?: FinanceControlStatus;
    cadence?: FinanceComplianceCadence;
  }) => void;
  onReviewed: () => Promise<void>;
  onUploaded: () => void;
  onError: (msg: string | null) => void;
}) {
  const [owner, setOwner] = useState(item.owner_role);
  const [due, setDue] = useState(item.next_due_at ?? '');
  const [cadence, setCadence] = useState<FinanceComplianceCadence>(item.cadence);
  const [evidenceUrl, setEvidenceUrl] = useState(item.evidence_url);
  const [evidenceNotes, setEvidenceNotes] = useState(item.evidence_notes ?? '');
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<FinanceControlStatus>(item.status);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setOwner(item.owner_role);
    setDue(item.next_due_at ?? '');
    setCadence(item.cadence);
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
      const result = await uploadFinanceControlEvidence({ control: item, file });
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
          onChange={(e) => setStatus(e.target.value as FinanceControlStatus)}
        >
          {FINANCE_CONTROL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {FINANCE_CONTROL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Review frequency
        <select
          className="input"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as FinanceComplianceCadence)}
        >
          {FINANCE_COMPLIANCE_CADENCES.map((c) => (
            <option key={c} value={c}>
              {FINANCE_COMPLIANCE_CADENCE_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next due
        <input
          className="input"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
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
          Current file: {item.evidence_file_name}{' '}
          <button type="button" className="btn ghost" onClick={() => void openAttached()}>
            Open
          </button>
        </div>
      ) : null}
      <label>
        Evidence URL
        <input
          className="input"
          value={evidenceUrl}
          onChange={(e) => setEvidenceUrl(e.target.value)}
          placeholder="https://… (optional link)"
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
              next_due_at: due || null,
              evidence_url: evidenceUrl,
              evidence_notes: evidenceNotes,
              notes,
              status,
              cadence,
            })
          }
        >
          Save
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void onReviewed()}
        >
          {item.status === 'compliant' ? 'Completed' : 'Mark reviewed (roll due)'}
        </button>
      </div>
    </div>
  );
}
