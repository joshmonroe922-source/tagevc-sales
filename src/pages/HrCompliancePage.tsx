import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createComplianceControl,
  formatDate,
  getHrEvidenceSignedUrl,
  isControlOverdue,
  listComplianceControls,
  listHrEntities,
  markHrControlReviewed,
  updateComplianceControl,
  uploadHrControlEvidence,
} from '../lib/hrApi';
import { isAuditControlDueSoon } from '../lib/auditControlUtils';
import {
  HR_COMPLIANCE_AREAS,
  HR_COMPLIANCE_CADENCES,
  HR_COMPLIANCE_CADENCE_LABELS,
  HR_CONTROL_SOURCE_LABELS,
  HR_CONTROL_SOURCES,
  HR_CONTROL_STATUS_LABELS,
  HR_CONTROL_STATUSES,
  type HrComplianceCadence,
  type HrComplianceControl,
  type HrControlSource,
  type HrControlStatus,
} from '../lib/hrTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';
import { AuditControlStatusActions } from '../components/AuditControlStatusActions';

type Props = { salesUser: SalesUser };

type ScopeFilter = 'all' | 'parent' | string;

/**
 * Company-scoped HR audit matrix (parent + each portfolio entity).
 * Lives only under HR — never on entity-detail pages.
 * Per-person evidence sits on employee files.
 */
export function HrCompliancePage({ salesUser }: Props) {
  const [controls, setControls] = useState<HrComplianceControl[]>([]);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [scope, setScope] = useState<ScopeFilter>('all');
  const [area, setArea] = useState<string>('all');
  const [source, setSource] = useState<HrControlSource | 'all'>('all');
  const [status, setStatus] = useState<HrControlStatus | 'all'>('all');
  const [q, setQ] = useState('');

  const [title, setTitle] = useState('');
  const [entityId, setEntityId] = useState('');
  const [cadence, setCadence] = useState<HrComplianceCadence>('annual');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [newArea, setNewArea] = useState('Compliance');

  const refresh = useCallback(async () => {
    const [rows, ents] = await Promise.all([
      listComplianceControls({
        entityId: scope,
        area,
        source,
        status,
      }),
      listHrEntities(),
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
              : 'Failed to load HR compliance (run migration 0025 if controls are missing)',
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
    () => filtered.filter((c) => isControlOverdue(c)).length,
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
      await createComplianceControl({
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
    patch: Parameters<typeof updateComplianceControl>[1],
  ) {
    setError(null);
    if (patch.status) {
      setControls((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch, status: patch.status! } : c)),
      );
    }
    try {
      await updateComplianceControl(id, patch);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
      await refresh().catch(() => undefined);
    }
  }

  async function onMarkReviewed(item: HrComplianceControl) {
    setError(null);
    setControls((prev) =>
      prev.map((c) =>
        c.id === item.id
          ? {
              ...c,
              status: 'compliant',
              last_reviewed_at: new Date().toISOString().slice(0, 10),
            }
          : c,
      ),
    );
    try {
      await markHrControlReviewed(item);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Mark reviewed failed');
      await refresh().catch(() => undefined);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>HR compliance</h1>
          <p className="muted">
            Company-scoped audit matrix for Tage parent and each portfolio entity.
            Employee-level I-9s, handbook acks, and tenure docs live on{' '}
            <Link to="/sales/hr/employees">employee files</Link> — not here.
          </p>
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
              {HR_COMPLIANCE_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as HrControlSource | 'all')}
            >
              <option value="all">All sources</option>
              {HR_CONTROL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {HR_CONTROL_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as HrControlStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {HR_CONTROL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {HR_CONTROL_STATUS_LABELS[s]}
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
                <code>0025_hr_compliance_audit_and_employee_files.sql</code> to seed
                the audit.
              </p>
            ) : (
              <ul className="ops-compliance-list hr-control-list">
                {filtered.map((item) => {
                  const overdue = isControlOverdue(item);
                  const dueSoon = !overdue && isAuditControlDueSoon(item);
                  const open = expandedId === item.id;
                  return (
                    <li
                      key={item.id}
                      className={overdue ? 'overdue' : dueSoon ? 'due-soon' : undefined}
                    >
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
                            {HR_CONTROL_SOURCE_LABELS[
                              (item.source as HrControlSource) ?? 'manual'
                            ] ?? item.source}
                          </span>
                          {' · '}
                          {HR_COMPLIANCE_CADENCE_LABELS[item.cadence]}
                          {' · '}
                          {HR_CONTROL_STATUS_LABELS[item.status]}
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
                            onReviewed={() => onMarkReviewed(item)}
                            onUploaded={() => void refresh()}
                            onError={setError}
                          />
                        ) : null}
                      </div>
                      <AuditControlStatusActions
                        status={item.status}
                        completedAt={item.last_reviewed_at}
                        onMarkReviewed={() => onMarkReviewed(item)}
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
                  {HR_COMPLIANCE_AREAS.map((a) => (
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
                    setCadence(e.target.value as HrComplianceCadence)
                  }
                >
                  {HR_COMPLIANCE_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {HR_COMPLIANCE_CADENCE_LABELS[c]}
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
  item: HrComplianceControl;
  onSave: (patch: {
    owner_role?: string;
    next_due_at?: string | null;
    evidence_url?: string;
    evidence_notes?: string;
    notes?: string;
    status?: HrControlStatus;
    cadence?: HrComplianceCadence;
  }) => void;
  onReviewed: () => Promise<void>;
  onUploaded: () => void;
  onError: (msg: string | null) => void;
}) {
  const [owner, setOwner] = useState(item.owner_role);
  const [due, setDue] = useState(item.next_due_at ?? '');
  const [cadence, setCadence] = useState<HrComplianceCadence>(item.cadence);
  const [evidenceUrl, setEvidenceUrl] = useState(item.evidence_url);
  const [evidenceNotes, setEvidenceNotes] = useState(item.evidence_notes ?? '');
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<HrControlStatus>(item.status);
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
      const result = await uploadHrControlEvidence({ control: item, file });
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
    const url = await getHrEvidenceSignedUrl(item.evidence_storage_path);
    if (url) window.open(url, '_blank', 'noopener,noreferrer');
    else onError('Could not open attached evidence');
  }

  return (
    <form
      className="form-grid hr-control-editor"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({
          owner_role: owner,
          next_due_at: due || null,
          evidence_url: evidenceUrl,
          evidence_notes: evidenceNotes,
          notes,
          status,
          cadence,
        });
      }}
    >
      {item.description ? (
        <p className="muted small full">{item.description}</p>
      ) : null}
      <label>
        Owner
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
          onChange={(e) => setStatus(e.target.value as HrControlStatus)}
        >
          {HR_CONTROL_STATUSES.map((s) => (
            <option key={s} value={s}>
              {HR_CONTROL_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Review frequency
        <select
          className="input"
          value={cadence}
          onChange={(e) => setCadence(e.target.value as HrComplianceCadence)}
        >
          {HR_COMPLIANCE_CADENCES.map((c) => (
            <option key={c} value={c}>
              {HR_COMPLIANCE_CADENCE_LABELS[c]}
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
        />
      </label>
      <label className="full">
        Evidence notes
        <input
          className="input"
          value={evidenceNotes}
          onChange={(e) => setEvidenceNotes(e.target.value)}
          placeholder="Where samples live, last inspection, gaps…"
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
      <div className="muted small full">
        Applicability: parent {item.applies_to_parent ? 'yes' : 'no'} · entities{' '}
        {item.applies_to_entities ? 'yes' : 'no'}
        {item.control_key ? ` · key ${item.control_key}` : ''}
        {' · '}
        {item.last_reviewed_at
          ? `Last reviewed ${formatDate(item.last_reviewed_at)}`
          : 'Not yet reviewed'}
      </div>
      <div className="form-actions">
        <button type="submit" className="btn">
          Save tracking
        </button>
        <button
          type="button"
          className="btn primary"
          onClick={() => void onReviewed()}
        >
          {item.status === 'compliant' ? 'Completed' : 'Mark reviewed (roll due)'}
        </button>
      </div>
    </form>
  );
}
