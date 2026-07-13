import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { listLeads } from '../lib/api';
import {
  createComplianceItem,
  createDocumentLink,
  getDocumentSignedUrl,
  getEntity,
  listChecklistItems,
  listComplianceForEntity,
  listDocuments,
  listFolders,
  markComplianceComplete,
  setChecklistItemStatus,
  updateComplianceItem,
  updateEntity,
  uploadDocument,
} from '../lib/opsApi';
import type {
  ChecklistStatus,
  ComplianceCadence,
  OpsChecklistItem,
  OpsComplianceItem,
  OpsDocument,
  OpsEntity,
  OpsEntityStatus,
  OpsFolder,
} from '../lib/opsTypes';
import {
  CHECKLIST_STATUS_LABELS,
  checklistProgress,
  COMPLIANCE_CADENCE_LABELS,
  COMPLIANCE_CADENCES,
  formatDate,
  isComplianceOverdue,
  OPS_ENTITY_STATUS_LABELS,
  OPS_ENTITY_STATUSES,
  OPS_ENTITY_TYPE_LABELS,
} from '../lib/opsTypes';
import type { SalesLead, SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityDetailPage({ salesUser }: Props) {
  const { id = '' } = useParams();
  const [entity, setEntity] = useState<OpsEntity | null>(null);
  const [checklist, setChecklist] = useState<OpsChecklistItem[]>([]);
  const [folders, setFolders] = useState<OpsFolder[]>([]);
  const [docs, setDocs] = useState<OpsDocument[]>([]);
  const [compliance, setCompliance] = useState<OpsComplianceItem[]>([]);
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [phaseFilter, setPhaseFilter] = useState<string>('all');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Doc form
  const [docTitle, setDocTitle] = useState('');
  const [docFolderId, setDocFolderId] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  // Compliance form
  const [compTitle, setCompTitle] = useState('');
  const [compCadence, setCompCadence] = useState<ComplianceCadence>('annual');
  const [compDue, setCompDue] = useState('');
  const [compNotes, setCompNotes] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    setError(null);
    const [ent, items, folds, documents, comps, dealList] = await Promise.all([
      getEntity(id),
      listChecklistItems(id),
      listFolders(id),
      listDocuments(id),
      listComplianceForEntity(id),
      listLeads(),
    ]);
    setEntity(ent);
    setChecklist(items);
    setFolders(folds);
    setDocs(documents);
    setCompliance(comps);
    setLeads(dealList);
  }, [id]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load entity');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const phases = useMemo(() => {
    const set = new Set(checklist.map((c) => c.phase));
    return ['all', ...Array.from(set)];
  }, [checklist]);

  const filteredChecklist = useMemo(() => {
    if (phaseFilter === 'all') return checklist;
    return checklist.filter((c) => c.phase === phaseFilter);
  }, [checklist, phaseFilter]);

  const progress = useMemo(() => checklistProgress(checklist), [checklist]);

  const docsByFolder = useMemo(() => {
    const map = new Map<string | null, OpsDocument[]>();
    for (const f of folders) map.set(f.id, []);
    map.set(null, []);
    for (const d of docs) {
      const key = d.folder_id && map.has(d.folder_id) ? d.folder_id : null;
      map.get(key)!.push(d);
    }
    return map;
  }, [docs, folders]);

  async function onStatusChange(status: OpsEntityStatus) {
    if (!entity) return;
    try {
      const updated = await updateEntity(entity.id, { status });
      setEntity(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function onLeadChange(leadId: string) {
    if (!entity) return;
    try {
      const updated = await updateEntity(entity.id, {
        lead_id: leadId || null,
      });
      setEntity(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update failed');
    }
  }

  async function onChecklistToggle(item: OpsChecklistItem) {
    const next: ChecklistStatus = item.status === 'done' ? 'todo' : 'done';
    try {
      await setChecklistItemStatus(item.id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checklist update failed');
    }
  }

  async function onChecklistStatus(itemId: string, status: ChecklistStatus) {
    try {
      await setChecklistItemStatus(itemId, status);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Checklist update failed');
    }
  }

  async function onAddDoc(e: FormEvent) {
    e.preventDefault();
    if (!entity) return;
    setInfo(null);
    setError(null);
    try {
      if (docFile) {
        const result = await uploadDocument({
          entity_id: entity.id,
          folder_id: docFolderId || null,
          title: docTitle || docFile.name,
          file: docFile,
          uploaded_by: salesUser.id,
        });
        if (!result.ok) {
          if (result.reason === 'storage_unavailable') {
            setInfo(
              'Storage bucket entity-docs is not configured yet. You can still link documents by URL below. See README for bucket setup.',
            );
          } else {
            setError(result.message);
          }
          return;
        }
      } else if (docUrl.trim()) {
        await createDocumentLink({
          entity_id: entity.id,
          folder_id: docFolderId || null,
          title: docTitle.trim() || docUrl.trim(),
          external_url: docUrl.trim(),
          uploaded_by: salesUser.id,
        });
      } else {
        setError('Choose a file or paste an external URL');
        return;
      }
      setDocTitle('');
      setDocUrl('');
      setDocFile(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document save failed');
    }
  }

  async function openDoc(doc: OpsDocument) {
    if (doc.external_url) {
      window.open(doc.external_url, '_blank', 'noopener,noreferrer');
      return;
    }
    if (doc.storage_path) {
      const url = await getDocumentSignedUrl(doc.storage_path);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else setInfo('Could not open file — check Storage bucket entity-docs.');
    }
  }

  async function onAddCompliance(e: FormEvent) {
    e.preventDefault();
    if (!entity || !compTitle.trim()) return;
    try {
      await createComplianceItem({
        entity_id: entity.id,
        title: compTitle.trim(),
        cadence: compCadence,
        next_due_at: compDue || null,
        notes: compNotes.trim(),
      });
      setCompTitle('');
      setCompDue('');
      setCompNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance create failed');
    }
  }

  if (loading) {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!entity) {
    return (
      <>
        <div className="banner error">
          {error ??
            'Entity not found or you do not have access. Ask an admin to assign this company.'}
        </div>
        <Link to="/sales/ops">Back to Manage Portfolio</Link>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to="/sales/ops">Manage Portfolio</Link> / {entity.name}
          </p>
          <h1>{entity.name}</h1>
          <p className="muted">
            {OPS_ENTITY_TYPE_LABELS[entity.entity_type]}
            {entity.jurisdiction ? ` · ${entity.jurisdiction}` : ''}
            {entity.formed_at ? ` · Formed ${formatDate(entity.formed_at)}` : ''}
            {entity.website_url ? (
              <>
                {' · '}
                <a href={entity.website_url} target="_blank" rel="noreferrer">
                  {(() => {
                    try {
                      return new URL(entity.website_url).hostname.replace(/^www\./, '');
                    } catch {
                      return entity.website_url;
                    }
                  })()}
                </a>
              </>
            ) : null}
          </p>
        </div>
        <div className="page-actions">
          <select
            className="select-inline"
            value={entity.status}
            onChange={(e) => void onStatusChange(e.target.value as OpsEntityStatus)}
          >
            {OPS_ENTITY_STATUSES.map((s) => (
              <option key={s} value={s}>
                {OPS_ENTITY_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {info ? <div className="banner warn">{info}</div> : null}

      <div className="ops-meta-bar panel">
        <label>
          <span className="muted small">Linked deal</span>
          <select
            value={entity.lead_id ?? ''}
            onChange={(e) => void onLeadChange(e.target.value)}
          >
            <option value="">— None —</option>
            {leads.map((lead) => (
              <option key={lead.id} value={lead.id}>
                {lead.name}
                {lead.company ? ` · ${lead.company}` : ''}
              </option>
            ))}
          </select>
        </label>
        {entity.sales_leads ? (
          <Link to={`/sales/deal-sourcing/leads/${entity.sales_leads.id}`} className="btn link">
            Open deal →
          </Link>
        ) : null}
        {entity.notes ? <p className="muted small ops-notes">{entity.notes}</p> : null}
      </div>

      <div className="detail-grid ops-detail-grid">
        {/* Checklist */}
        <section className="panel">
          <div className="panel-head">
            <h2>Checklist</h2>
            <span className="muted small">
              {progress.done}/{progress.total} ({progress.pct}%)
            </span>
          </div>
          <div className="progress-track" aria-hidden>
            <div className="progress-fill" style={{ width: `${progress.pct}%` }} />
          </div>
          <div className="seg phase-seg">
            {phases.map((p) => (
              <button
                key={p}
                type="button"
                className={phaseFilter === p ? 'active' : ''}
                onClick={() => setPhaseFilter(p)}
              >
                {p === 'all' ? 'All phases' : p}
              </button>
            ))}
          </div>
          {filteredChecklist.length === 0 ? (
            <p className="muted">No checklist items for this filter.</p>
          ) : (
            <ul className="task-list large ops-checklist">
              {filteredChecklist.map((item) => (
                <li
                  key={item.id}
                  className={item.status === 'done' ? 'done' : ''}
                >
                  <label className="task-check">
                    <input
                      type="checkbox"
                      checked={item.status === 'done'}
                      onChange={() => void onChecklistToggle(item)}
                    />
                    <span>
                      <span className="phase-tag">{item.phase}</span> {item.title}
                    </span>
                  </label>
                  <select
                    className="select-compact"
                    value={item.status}
                    onChange={(e) =>
                      void onChecklistStatus(
                        item.id,
                        e.target.value as ChecklistStatus,
                      )
                    }
                    aria-label="Status"
                  >
                    {(Object.keys(CHECKLIST_STATUS_LABELS) as ChecklistStatus[]).map(
                      (s) => (
                        <option key={s} value={s}>
                          {CHECKLIST_STATUS_LABELS[s]}
                        </option>
                      ),
                    )}
                  </select>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Folders + docs */}
        <section className="panel">
          <div className="panel-head">
            <h2>Folders & documents</h2>
            <span className="muted small">{docs.length} docs</span>
          </div>

          {folders.length === 0 ? (
            <p className="muted">No folders yet (run migration 0004 to seed defaults).</p>
          ) : (
            <ul className="ops-folder-list">
              {folders.map((folder) => {
                const folderDocs = docsByFolder.get(folder.id) ?? [];
                return (
                  <li key={folder.id} className="ops-folder">
                    <div className="ops-folder-name">
                      {folder.name}
                      <span className="muted small">{folderDocs.length}</span>
                    </div>
                    {folderDocs.length === 0 ? (
                      <p className="muted small">Empty</p>
                    ) : (
                      <ul className="ops-doc-list">
                        {folderDocs.map((doc) => (
                          <li key={doc.id}>
                            <button
                              type="button"
                              className="btn link"
                              onClick={() => void openDoc(doc)}
                            >
                              {doc.title}
                            </button>
                            <span className="muted small">
                              {doc.file_name || doc.external_url || 'link'}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {(docsByFolder.get(null) ?? []).length > 0 ? (
            <div className="ops-folder">
              <div className="ops-folder-name">Unfiled</div>
              <ul className="ops-doc-list">
                {(docsByFolder.get(null) ?? []).map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className="btn link"
                      onClick={() => void openDoc(doc)}
                    >
                      {doc.title}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <form className="form-stack compact" onSubmit={onAddDoc}>
            <h3 className="subhead">Add document</h3>
            <label>
              <span>Title</span>
              <input
                value={docTitle}
                onChange={(e) => setDocTitle(e.target.value)}
                placeholder="Articles of organization"
              />
            </label>
            <label>
              <span>Folder</span>
              <select
                value={docFolderId}
                onChange={(e) => setDocFolderId(e.target.value)}
              >
                <option value="">Unfiled</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Upload file</span>
              <input
                type="file"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              <span>Or external URL</span>
              <input
                value={docUrl}
                onChange={(e) => setDocUrl(e.target.value)}
                placeholder="https://…"
              />
            </label>
            <button type="submit" className="btn primary">
              Save document
            </button>
            <p className="muted small">
              Uploads require private Storage bucket <code>entity-docs</code>. Until then,
              use links.
            </p>
          </form>
        </section>

        {/* Compliance */}
        <section className="panel ops-compliance-panel">
          <div className="panel-head">
            <h2>Compliance</h2>
            <span className="muted small">Licenses & filings</span>
          </div>
          {compliance.length === 0 ? (
            <p className="muted">No compliance items yet.</p>
          ) : (
            <ul className="ops-compliance-list">
              {compliance.map((item) => (
                <li
                  key={item.id}
                  className={isComplianceOverdue(item) ? 'overdue' : ''}
                >
                  <div>
                    <div className="ops-compliance-title">{item.title}</div>
                    <div className="muted small">
                      {COMPLIANCE_CADENCE_LABELS[item.cadence]}
                      {item.last_completed_at
                        ? ` · Last done ${formatDate(item.last_completed_at)}`
                        : ''}
                      {!item.active ? ' · Inactive' : ''}
                    </div>
                  </div>
                  <div className="ops-compliance-actions">
                    <span
                      className={
                        isComplianceOverdue(item) ? 'warn-text' : 'muted'
                      }
                    >
                      {formatDate(item.next_due_at)}
                    </span>
                    {item.active ? (
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          void markComplianceComplete(item.id).then(refresh)
                        }
                      >
                        Mark done
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn ghost"
                      onClick={() =>
                        void updateComplianceItem(item.id, {
                          active: !item.active,
                        }).then(refresh)
                      }
                    >
                      {item.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <form className="form-stack compact" onSubmit={onAddCompliance}>
            <h3 className="subhead">Add compliance item</h3>
            <label>
              <span>Title</span>
              <input
                value={compTitle}
                onChange={(e) => setCompTitle(e.target.value)}
                placeholder="Annual report"
                required
              />
            </label>
            <label>
              <span>Cadence</span>
              <select
                value={compCadence}
                onChange={(e) =>
                  setCompCadence(e.target.value as ComplianceCadence)
                }
              >
                {COMPLIANCE_CADENCES.map((c) => (
                  <option key={c} value={c}>
                    {COMPLIANCE_CADENCE_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Next due</span>
              <input
                type="date"
                value={compDue}
                onChange={(e) => setCompDue(e.target.value)}
              />
            </label>
            <label>
              <span>Notes</span>
              <input
                value={compNotes}
                onChange={(e) => setCompNotes(e.target.value)}
              />
            </label>
            <button type="submit" className="btn primary">
              Add item
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
