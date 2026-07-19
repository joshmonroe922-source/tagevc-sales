import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ControlEvidenceEditor } from '../components/ControlEvidenceEditor';
import {
  createMarketingControl,
  formatDate,
  getMarketingEvidenceSignedUrl,
  isMarketingControlOverdue,
  listMarketingControls,
  listMarketingEntities,
  markMarketingControlReviewed,
  syncIncompleteMarketingTasksToTodo,
  updateMarketingControl,
  uploadMarketingControlEvidence,
} from '../lib/marketingApi';
import {
  MARKETING_AREAS,
  MARKETING_COMPLIANCE_CADENCES,
  MARKETING_COMPLIANCE_CADENCE_LABELS,
  MARKETING_CONTROL_SOURCE_LABELS,
  MARKETING_CONTROL_SOURCES,
  MARKETING_CONTROL_STATUS_LABELS,
  MARKETING_CONTROL_STATUSES,
  type MarketingComplianceCadence,
  type MarketingControl,
  type MarketingControlSource,
  type MarketingControlStatus,
} from '../lib/marketingTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';
import { AuditControlStatusActions } from '../components/AuditControlStatusActions';

type Props = { salesUser: SalesUser };
type ScopeFilter = 'all' | 'parent' | string;

/**
 * Marketing plan & audit matrix (parent + each portfolio entity).
 * Lives only under /sales/marketing — never on entity-detail pages.
 */
export function MarketingControlsPage({ salesUser }: Props) {
  const [controls, setControls] = useState<MarketingControl[]>([]);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const [scope, setScope] = useState<ScopeFilter>('all');
  const [area, setArea] = useState<string>('all');
  const [source, setSource] = useState<MarketingControlSource | 'all'>('all');
  const [status, setStatus] = useState<MarketingControlStatus | 'all'>('all');
  const [q, setQ] = useState('');

  const [title, setTitle] = useState('');
  const [entityId, setEntityId] = useState('');
  const [cadence, setCadence] = useState<MarketingComplianceCadence>('annual');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [newArea, setNewArea] = useState('Strategy & Objectives');

  const refresh = useCallback(async () => {
    const [rows, ents] = await Promise.all([
      listMarketingControls({
        entityId: scope,
        area,
        source,
        status,
      }),
      listMarketingEntities(),
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
              : 'Failed to load marketing controls (run migration 0028)',
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
    () => filtered.filter((c) => isMarketingControlOverdue(c)).length,
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
      await createMarketingControl({
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
    patch: Parameters<typeof updateMarketingControl>[1],
  ) {
    setError(null);
    if (patch.status) {
      setControls((prev) =>
        prev.map((c) => (c.id === id ? { ...c, ...patch, status: patch.status! } : c)),
      );
    }
    try {
      await updateMarketingControl(id, patch);
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
      await markMarketingControlReviewed(id, salesUser.id);
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
      const result = await syncIncompleteMarketingTasksToTodo({
        salesUserId: salesUser.id,
      });
      setNotice(
        `Tasks ready: ${result.marketingCreated} new marketing task(s), ${result.todoCreated} pushed to Tage · Marketing To Do.`,
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
          <h1>Plan & audit</h1>
          <p className="muted">
            Plan &amp; audit controls for Tage parent and each subsidiary — set a separate
            next due date per company, attach evidence files, and sync incomplete items to
            Marketing tasks / To Do.
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
          <Link to="/sales/marketing/tasks" className="btn ghost">
            Open tasks
          </Link>
          <Link to="/sales/marketing" className="btn ghost">
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
              {MARKETING_AREAS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={source}
              onChange={(e) => setSource(e.target.value as MarketingControlSource | 'all')}
            >
              <option value="all">All sources</option>
              {MARKETING_CONTROL_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {MARKETING_CONTROL_SOURCE_LABELS[s]}
                </option>
              ))}
            </select>
            <select
              className="input"
              value={status}
              onChange={(e) => setStatus(e.target.value as MarketingControlStatus | 'all')}
            >
              <option value="all">All statuses</option>
              {MARKETING_CONTROL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {MARKETING_CONTROL_STATUS_LABELS[s]}
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
                <code>0028_marketing_plan_audit.sql</code> to seed the plan & audit.
              </p>
            ) : (
              <ul className="ops-compliance-list hr-control-list">
                {filtered.map((item) => {
                  const overdue = isMarketingControlOverdue(item);
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
                            {MARKETING_CONTROL_SOURCE_LABELS[
                              (item.source as MarketingControlSource) ?? 'manual'
                            ] ?? item.source}
                          </span>
                          {' · '}
                          {MARKETING_COMPLIANCE_CADENCE_LABELS[item.cadence]}
                          {' · '}
                          {MARKETING_CONTROL_STATUS_LABELS[item.status]}
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
                        {open ? (
                          <ControlEditor
                            item={item}
                            onSave={(patch) => void patchControl(item.id, patch)}
                            onUploaded={() => void refresh()}
                          />
                        ) : null}
                      </div>
                      <AuditControlStatusActions
                        status={item.status}
                        completedAt={item.last_reviewed_at}
                        reviewLabel="Mark reviewed"
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
                  {MARKETING_AREAS.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Review frequency
                <select
                  className="input"
                  value={cadence}
                  onChange={(e) =>
                    setCadence(e.target.value as MarketingComplianceCadence)
                  }
                >
                  {MARKETING_COMPLIANCE_CADENCES.map((c) => (
                    <option key={c} value={c}>
                      {MARKETING_COMPLIANCE_CADENCE_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Next due (this company)
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
  onUploaded,
}: {
  item: MarketingControl;
  onSave: (patch: {
    owner_role?: string;
    next_due_at?: string | null;
    cadence?: MarketingComplianceCadence;
    evidence_url?: string;
    evidence_notes?: string;
    notes?: string;
    status?: MarketingControlStatus;
  }) => void;
  onUploaded: () => void;
}) {
  const [owner, setOwner] = useState(item.owner_role);
  const [notes, setNotes] = useState(item.notes);
  const [status, setStatus] = useState<MarketingControlStatus>(item.status);
  const [due, setDue] = useState(item.next_due_at ?? '');
  const [freq, setFreq] = useState<MarketingComplianceCadence>(
    item.cadence || 'annual',
  );
  const [evidenceUrl, setEvidenceUrl] = useState(item.evidence_url);
  const [evidenceNotes, setEvidenceNotes] = useState(item.evidence_notes ?? '');
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  return (
    <div className="hr-control-editor">
      <div className="form-grid" style={{ marginBottom: 12 }}>
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
            onChange={(e) => setStatus(e.target.value as MarketingControlStatus)}
          >
            {MARKETING_CONTROL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {MARKETING_CONTROL_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label className="full">
          Notes
          <input
            className="input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </label>
      </div>
      <ControlEvidenceEditor
        value={{
          next_due_at: due,
          cadence: freq,
          evidence_url: evidenceUrl,
          evidence_notes: evidenceNotes,
          evidence_file_name: item.evidence_file_name || '',
          evidence_storage_path: item.evidence_storage_path || '',
        }}
        onChange={(patch) => {
          if (patch.next_due_at !== undefined) setDue(patch.next_due_at);
          if (patch.cadence !== undefined) {
            setFreq(patch.cadence as MarketingComplianceCadence);
          }
          if (patch.evidence_url !== undefined) setEvidenceUrl(patch.evidence_url);
          if (patch.evidence_notes !== undefined) setEvidenceNotes(patch.evidence_notes);
        }}
        uploading={uploading}
        uploadError={uploadError}
        evidenceReady={Boolean(item.evidence_storage_path)}
        onOpenEvidence={() => {
          void getMarketingEvidenceSignedUrl(item.evidence_storage_path).then((url) => {
            if (url) window.open(url, '_blank', 'noopener,noreferrer');
          });
        }}
        onUploadFile={async (file) => {
          setUploading(true);
          setUploadError(null);
          const result = await uploadMarketingControlEvidence({ control: item, file });
          setUploading(false);
          if (!result.ok) {
            setUploadError(result.message);
            throw new Error(result.message);
          }
          onUploaded();
        }}
      />
      <div className="form-actions">
        <button
          type="button"
          className="btn"
          onClick={() =>
            onSave({
              owner_role: owner,
              next_due_at: due || null,
              cadence: freq,
              evidence_url: evidenceUrl,
              evidence_notes: evidenceNotes,
              notes,
              status,
            })
          }
        >
          Save
        </button>
      </div>
    </div>
  );
}
