import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  advanceProspectToOnboarding,
  completeChecklist,
  createEmployeeActivity,
  createEmployeeDocument,
  formatDate,
  getEmployee,
  listChecklistItems,
  listChecklistsForEmployee,
  listEmployeeActivities,
  listEmployeeDocuments,
  listHrEntities,
  startChecklist,
  updateChecklistItemStatus,
  updateEmployee,
} from '../lib/hrApi';
import {
  HR_ACTIVITY_TYPE_LABELS,
  HR_CHECKLIST_KIND_LABELS,
  HR_DOC_CATEGORIES,
  HR_DOC_CATEGORY_LABELS,
  HR_DOC_KIND_LABELS,
  HR_DOC_KINDS,
  HR_EMPLOYMENT_STATUSES,
  HR_EMPLOYMENT_STATUS_LABELS,
  HR_ITEM_SCOPE_LABELS,
  HR_ITEM_STATUSES,
  HR_ITEM_STATUS_LABELS,
  HR_SYSTEM_HOOK_LABELS,
  type HrChecklistItem,
  type HrChecklistKind,
  type HrDocCategory,
  type HrDocKind,
  type HrEmployee,
  type HrEmployeeActivity,
  type HrEmployeeDocument,
  type HrEmploymentStatus,
  type HrItemScope,
  type HrItemStatus,
  type HrOnboardingChecklist,
  type HrSystemHook,
} from '../lib/hrTypes';
import type { OpsEntity } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

type FileTab = 'overview' | 'talent_acquisition' | 'onboarding' | 'tenure' | 'offboarding';

/** Per-employee digital file — center of HR ops (separate from company compliance matrix). */
export function HrEmployeeDetailPage({ salesUser }: Props) {
  const { id } = useParams<{ id: string }>();
  const [employee, setEmployee] = useState<HrEmployee | null>(null);
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [checklists, setChecklists] = useState<HrOnboardingChecklist[]>([]);
  const [documents, setDocuments] = useState<HrEmployeeDocument[]>([]);
  const [activities, setActivities] = useState<HrEmployeeActivity[]>([]);
  const [selectedChecklistId, setSelectedChecklistId] = useState<string | null>(null);
  const [items, setItems] = useState<HrChecklistItem[]>([]);
  const [tab, setTab] = useState<FileTab>('overview');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [noteBody, setNoteBody] = useState('');
  const [docTitle, setDocTitle] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [docCategory, setDocCategory] = useState<HrDocCategory>('tenure');
  const [docKind, setDocKind] = useState<HrDocKind>('link');
  const [docNotes, setDocNotes] = useState('');

  const refresh = useCallback(async () => {
    if (!id) return;
    const [emp, lists, docs, acts, ents] = await Promise.all([
      getEmployee(id),
      listChecklistsForEmployee(id),
      listEmployeeDocuments(id),
      listEmployeeActivities(id),
      listHrEntities().catch(() => [] as OpsEntity[]),
    ]);
    setEmployee(emp);
    setChecklists(lists);
    setDocuments(docs);
    setActivities(acts);
    setEntities([...ents].sort((a, b) => a.name.localeCompare(b.name)));
    setSelectedChecklistId((prev) => {
      if (prev && lists.some((c) => c.id === prev)) return prev;
      return lists[0]?.id ?? null;
    });
  }, [id]);

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
              : 'Failed to load employee file (run migration 0025 if tables are missing)',
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
    if (!selectedChecklistId) {
      setItems([]);
      return;
    }
    let mounted = true;
    void (async () => {
      try {
        const next = await listChecklistItems(selectedChecklistId);
        if (mounted) setItems(next);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load checklist items');
        }
      }
    })();
    return () => {
      mounted = false;
    };
  }, [selectedChecklistId]);

  useEffect(() => {
    const listsForTab =
      tab === 'talent_acquisition'
        ? checklists.filter((c) => c.kind === 'talent_acquisition')
        : tab === 'onboarding'
          ? checklists.filter((c) => c.kind === 'onboarding')
          : tab === 'offboarding'
            ? checklists.filter((c) => c.kind === 'offboarding')
            : [];
    if (listsForTab.length === 0) return;
    setSelectedChecklistId((prev) => {
      if (prev && listsForTab.some((c) => c.id === prev)) return prev;
      return listsForTab[0]?.id ?? null;
    });
  }, [tab, checklists]);

  const talentLists = useMemo(
    () => checklists.filter((c) => c.kind === 'talent_acquisition'),
    [checklists],
  );
  const onboardingLists = useMemo(
    () => checklists.filter((c) => c.kind === 'onboarding'),
    [checklists],
  );
  const offboardingLists = useMemo(
    () => checklists.filter((c) => c.kind === 'offboarding'),
    [checklists],
  );
  const tenureDocs = useMemo(
    () => documents.filter((d) => d.category === 'tenure' || d.category === 'other'),
    [documents],
  );
  const onboardingDocs = useMemo(
    () => documents.filter((d) => d.category === 'onboarding' || d.category === 'compliance'),
    [documents],
  );
  const offboardingDocs = useMemo(
    () => documents.filter((d) => d.category === 'offboarding'),
    [documents],
  );

  async function onSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      await updateEmployee(
        employee.id,
        {
          full_name: employee.full_name,
          work_email: employee.work_email,
          personal_email: employee.personal_email,
          role_title: employee.role_title,
          department: employee.department,
          employment_status: employee.employment_status,
          entity_id: employee.entity_id,
          start_date: employee.start_date,
          end_date: employee.end_date,
          manager_name: employee.manager_name,
          location: employee.location,
          notes: employee.notes,
        },
        { created_by: salesUser.id, activity_note: 'Profile fields saved' },
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  async function onStartKind(kind: HrChecklistKind) {
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      const { checklist } = await startChecklist({
        employee_id: employee.id,
        kind,
        created_by: salesUser.id,
      });
      setSelectedChecklistId(checklist.id);
      if (kind === 'talent_acquisition') setTab('talent_acquisition');
      else if (kind === 'onboarding') setTab('onboarding');
      else setTab('offboarding');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start checklist');
    } finally {
      setBusy(false);
    }
  }

  async function onAdvanceToOnboarding() {
    if (!employee) return;
    setBusy(true);
    setError(null);
    try {
      const result = await advanceProspectToOnboarding({
        employee_id: employee.id,
        created_by: salesUser.id,
      });
      setSelectedChecklistId(result.onboarding.checklist.id);
      setTab('onboarding');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not advance to onboarding');
    } finally {
      setBusy(false);
    }
  }

  async function onItemStatus(itemId: string, status: HrItemStatus) {
    setError(null);
    try {
      await updateChecklistItemStatus(itemId, status);
      if (selectedChecklistId) {
        setItems(await listChecklistItems(selectedChecklistId));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Item update failed');
    }
  }

  async function onCompleteChecklist() {
    if (!selectedChecklistId) return;
    setBusy(true);
    setError(null);
    try {
      await completeChecklist(selectedChecklistId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Complete failed');
    } finally {
      setBusy(false);
    }
  }

  async function onAddNote(e: FormEvent) {
    e.preventDefault();
    if (!employee || !noteBody.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createEmployeeActivity({
        employee_id: employee.id,
        activity_type: 'note',
        title: 'Tenure note',
        body: noteBody,
        created_by: salesUser.id,
      });
      setNoteBody('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Note failed');
    } finally {
      setBusy(false);
    }
  }

  async function onAddDocument(e: FormEvent) {
    e.preventDefault();
    if (!employee || !docTitle.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createEmployeeDocument({
        employee_id: employee.id,
        title: docTitle,
        category: docCategory,
        doc_kind: docKind,
        file_url: docUrl,
        notes: docNotes,
        created_by: salesUser.id,
      });
      setDocTitle('');
      setDocUrl('');
      setDocNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Document add failed');
    } finally {
      setBusy(false);
    }
  }

  const selectedChecklist = checklists.find((c) => c.id === selectedChecklistId) ?? null;

  if (loading) return <p className="muted">Loading employee file…</p>;
  if (!employee) {
    return (
      <>
        {error ? <div className="banner error">{error}</div> : null}
        <p className="muted">Employee not found.</p>
        <Link to="/sales/hr/employees" className="btn ghost">
          Back to directory
        </Link>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="muted small">
            <Link to="/sales/hr/employees">Employees</Link> / employee file
          </p>
          <h1>{employee.full_name}</h1>
          <p className="muted">
            {employee.role_title || 'No title'}
            {' · '}
            {employee.ops_entities?.name ?? 'Tage parent'}
            {' · '}
            {HR_EMPLOYMENT_STATUS_LABELS[employee.employment_status]}
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/hr/compliance" className="btn ghost">
            Company compliance
          </Link>
          <Link to="/sales/hr/employees" className="btn ghost">
            Directory
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <div className="hr-file-tabs" role="tablist">
        {(
          [
            ['overview', 'Overview'],
            ['talent_acquisition', 'Talent acquisition'],
            ['onboarding', 'Onboarding'],
            ['tenure', 'Tenure'],
            ['offboarding', 'Offboarding'],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            className={tab === key ? 'btn' : 'btn ghost'}
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' ? (
        <div className="hr-file-grid">
          <section className="panel">
            <h2 className="subhead">Profile</h2>
            <form className="form-grid" onSubmit={(e) => void onSaveProfile(e)}>
              <label>
                Full name
                <input
                  className="input"
                  required
                  value={employee.full_name}
                  onChange={(e) =>
                    setEmployee({ ...employee, full_name: e.target.value })
                  }
                />
              </label>
              <label>
                Status
                <select
                  className="input"
                  value={employee.employment_status}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      employment_status: e.target.value as HrEmploymentStatus,
                    })
                  }
                >
                  {HR_EMPLOYMENT_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {HR_EMPLOYMENT_STATUS_LABELS[s]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Work email
                <input
                  className="input"
                  type="email"
                  value={employee.work_email}
                  onChange={(e) =>
                    setEmployee({ ...employee, work_email: e.target.value })
                  }
                />
              </label>
              <label>
                Personal email
                <input
                  className="input"
                  type="email"
                  value={employee.personal_email}
                  onChange={(e) =>
                    setEmployee({ ...employee, personal_email: e.target.value })
                  }
                />
              </label>
              <label>
                Role / title
                <input
                  className="input"
                  value={employee.role_title}
                  onChange={(e) =>
                    setEmployee({ ...employee, role_title: e.target.value })
                  }
                />
              </label>
              <label>
                Department
                <input
                  className="input"
                  value={employee.department}
                  onChange={(e) =>
                    setEmployee({ ...employee, department: e.target.value })
                  }
                />
              </label>
              <label>
                Company
                <select
                  className="input"
                  value={employee.entity_id ?? ''}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      entity_id: e.target.value || null,
                    })
                  }
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
                Manager
                <input
                  className="input"
                  value={employee.manager_name}
                  onChange={(e) =>
                    setEmployee({ ...employee, manager_name: e.target.value })
                  }
                />
              </label>
              <label>
                Location
                <input
                  className="input"
                  value={employee.location}
                  onChange={(e) =>
                    setEmployee({ ...employee, location: e.target.value })
                  }
                />
              </label>
              <label>
                Start date
                <input
                  className="input"
                  type="date"
                  value={employee.start_date ?? ''}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      start_date: e.target.value || null,
                    })
                  }
                />
              </label>
              <label>
                End date
                <input
                  className="input"
                  type="date"
                  value={employee.end_date ?? ''}
                  onChange={(e) =>
                    setEmployee({
                      ...employee,
                      end_date: e.target.value || null,
                    })
                  }
                />
              </label>
              <label className="full">
                File notes
                <textarea
                  className="input"
                  rows={3}
                  value={employee.notes}
                  onChange={(e) =>
                    setEmployee({ ...employee, notes: e.target.value })
                  }
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn" disabled={busy}>
                  Save profile
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <h2 className="subhead">Lifecycle snapshot</h2>
            <ul className="hr-meta-list">
              <li>
                Talent acquisition: {talentLists.length}
                {talentLists[0] ? ` (${talentLists[0].status})` : ''}
              </li>
              <li>
                Onboarding checklists: {onboardingLists.length}
                {onboardingLists[0]
                  ? ` (${onboardingLists[0].status})`
                  : ''}
              </li>
              <li>
                Offboarding checklists: {offboardingLists.length}
                {offboardingLists[0]
                  ? ` (${offboardingLists[0].status})`
                  : ''}
              </li>
              <li>Documents in file: {documents.length}</li>
              <li>Activity entries: {activities.length}</li>
            </ul>
            <div className="form-actions" style={{ marginTop: '1rem', flexWrap: 'wrap' }}>
              {employee.employment_status === 'prospect' || talentLists.length === 0 ? (
                <button
                  type="button"
                  className="btn ghost"
                  disabled={busy}
                  onClick={() => void onStartKind('talent_acquisition')}
                >
                  {talentLists.length ? 'Restart talent checklist' : 'Start talent acquisition'}
                </button>
              ) : null}
              {employee.employment_status === 'prospect' ? (
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => void onAdvanceToOnboarding()}
                >
                  Offer accepted → Onboarding
                </button>
              ) : null}
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void onStartKind('onboarding')}
              >
                Start onboarding
              </button>
              <button
                type="button"
                className="btn ghost"
                disabled={busy}
                onClick={() => void onStartKind('offboarding')}
              >
                Start offboarding
              </button>
            </div>
            <p className="muted small" style={{ marginTop: '0.75rem' }}>
              Prospects use the talent acquisition checklist. After offer acceptance, advance to
              start the Signent/TAGE onboarding template. Company audit matrix:{' '}
              <Link to="/sales/hr/compliance">HR → Compliance</Link>.
            </p>
          </section>

          <section className="panel hr-file-span">
            <h2 className="subhead">Recent activity</h2>
            {activities.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <ul className="hr-activity-list">
                {activities.slice(0, 12).map((a) => (
                  <li key={a.id}>
                    <div className="hr-list-title">{a.title}</div>
                    <div className="muted small">
                      {HR_ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}
                      {' · '}
                      {formatDate(a.occurred_at.slice(0, 10))}
                      {a.status ? ` · ${a.status}` : ''}
                    </div>
                    {a.body ? <p className="small">{a.body}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}

      {tab === 'talent_acquisition' || tab === 'onboarding' || tab === 'offboarding' ? (
        <ChecklistPanel
          kind={tab}
          lists={
            tab === 'talent_acquisition'
              ? talentLists
              : tab === 'onboarding'
                ? onboardingLists
                : offboardingLists
          }
          docs={
            tab === 'offboarding'
              ? offboardingDocs
              : onboardingDocs
          }
          selectedId={selectedChecklistId}
          selected={selectedChecklist}
          items={items}
          busy={busy}
          showAdvance={
            tab === 'talent_acquisition' &&
            employee.employment_status === 'prospect'
          }
          onSelect={setSelectedChecklistId}
          onStart={() => void onStartKind(tab)}
          onItemStatus={onItemStatus}
          onComplete={() => void onCompleteChecklist()}
          onAdvance={() => void onAdvanceToOnboarding()}
        />
      ) : null}

      {tab === 'tenure' ? (
        <div className="hr-file-grid">
          <section className="panel">
            <h2 className="subhead">Add tenure note</h2>
            <form onSubmit={(e) => void onAddNote(e)}>
              <label className="full">
                Note
                <textarea
                  className="input"
                  rows={3}
                  required
                  value={noteBody}
                  onChange={(e) => setNoteBody(e.target.value)}
                  placeholder="Reviews, coaching, schedule changes, incidents…"
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn" disabled={busy}>
                  Log note
                </button>
              </div>
            </form>
          </section>

          <section className="panel">
            <h2 className="subhead">Add document / acknowledgment</h2>
            <form className="form-grid" onSubmit={(e) => void onAddDocument(e)}>
              <label>
                Title
                <input
                  className="input"
                  required
                  value={docTitle}
                  onChange={(e) => setDocTitle(e.target.value)}
                />
              </label>
              <label>
                Category
                <select
                  className="input"
                  value={docCategory}
                  onChange={(e) => setDocCategory(e.target.value as HrDocCategory)}
                >
                  {HR_DOC_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {HR_DOC_CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Kind
                <select
                  className="input"
                  value={docKind}
                  onChange={(e) => setDocKind(e.target.value as HrDocKind)}
                >
                  {HR_DOC_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {HR_DOC_KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                URL / path
                <input
                  className="input"
                  value={docUrl}
                  onChange={(e) => setDocUrl(e.target.value)}
                  placeholder="https://… or vault path"
                />
              </label>
              <label className="full">
                Notes
                <input
                  className="input"
                  value={docNotes}
                  onChange={(e) => setDocNotes(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button type="submit" className="btn" disabled={busy}>
                  Add to file
                </button>
              </div>
            </form>
          </section>

          <section className="panel hr-file-span">
            <h2 className="subhead">Tenure documents</h2>
            <DocumentList docs={tenureDocs} />
          </section>

          <section className="panel hr-file-span">
            <h2 className="subhead">Full activity log</h2>
            {activities.length === 0 ? (
              <p className="muted">No activity yet.</p>
            ) : (
              <ul className="hr-activity-list">
                {activities.map((a) => (
                  <li key={a.id}>
                    <div className="hr-list-title">{a.title}</div>
                    <div className="muted small">
                      {HR_ACTIVITY_TYPE_LABELS[a.activity_type] ?? a.activity_type}
                      {' · '}
                      {formatDate(a.occurred_at.slice(0, 10))}
                      {a.system_hook
                        ? ` · hook ${HR_SYSTEM_HOOK_LABELS[a.system_hook as HrSystemHook] ?? a.system_hook}`
                        : ''}
                    </div>
                    {a.body ? <p className="small">{a.body}</p> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}

function DocumentList({ docs }: { docs: HrEmployeeDocument[] }) {
  if (docs.length === 0) {
    return <p className="muted">No documents in this section yet.</p>;
  }
  return (
    <ul className="hr-list">
      {docs.map((d) => (
        <li key={d.id}>
          <div>
            <div className="hr-list-title">
              {d.file_url ? (
                <a href={d.file_url} target="_blank" rel="noreferrer">
                  {d.title}
                </a>
              ) : (
                d.title
              )}
            </div>
            <div className="muted small">
              {HR_DOC_CATEGORY_LABELS[d.category]} · {HR_DOC_KIND_LABELS[d.doc_kind]}
              {d.related_control_key ? ` · control ${d.related_control_key}` : ''}
              {' · '}
              {formatDate(d.created_at.slice(0, 10))}
            </div>
            {d.notes ? <p className="small">{d.notes}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

function ChecklistPanel({
  kind,
  lists,
  docs,
  selectedId,
  selected,
  items,
  busy,
  showAdvance,
  onSelect,
  onStart,
  onItemStatus,
  onComplete,
  onAdvance,
}: {
  kind: HrChecklistKind;
  lists: HrOnboardingChecklist[];
  docs: HrEmployeeDocument[];
  selectedId: string | null;
  selected: HrOnboardingChecklist | null;
  items: HrChecklistItem[];
  busy: boolean;
  showAdvance?: boolean;
  onSelect: (id: string) => void;
  onStart: () => void;
  onItemStatus: (id: string, status: HrItemStatus) => void;
  onComplete: () => void;
  onAdvance?: () => void;
}) {
  const label = HR_CHECKLIST_KIND_LABELS[kind];
  return (
    <div className="hr-file-grid">
      <section className="panel">
        <div className="panel-head">
          <h2>{label} checklists</h2>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {showAdvance && onAdvance ? (
              <button type="button" className="btn" disabled={busy} onClick={onAdvance}>
                Offer accepted → Onboarding
              </button>
            ) : null}
            <button type="button" className="btn ghost" disabled={busy} onClick={onStart}>
              Start new
            </button>
          </div>
        </div>
        {lists.length === 0 ? (
          <p className="muted">No {label.toLowerCase()} run yet.</p>
        ) : (
          <ul className="hr-list">
            {lists.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`hr-list-pick${selectedId === c.id ? ' active' : ''}`}
                  onClick={() => onSelect(c.id)}
                >
                  <span className="hr-list-title">
                    {c.template_slug || label}
                  </span>
                  <span className="muted small">
                    {c.status}
                    {c.started_at
                      ? ` · ${formatDate(c.started_at.slice(0, 10))}`
                      : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>{selected ? `${label} items` : 'Select a checklist'}</h2>
          {selected && selected.status !== 'complete' ? (
            <button
              type="button"
              className="btn ghost"
              disabled={busy}
              onClick={onComplete}
            >
              Mark complete
            </button>
          ) : selected?.status === 'complete' && selected.completed_at ? (
            <span className="muted small">
              Completed {formatDate(selected.completed_at)}
            </span>
          ) : null}
        </div>
        {!selected ? (
          <p className="muted">Pick a checklist run to see items and hooks.</p>
        ) : (
          <ul className="hr-list">
            {items.map((item) => (
              <li key={item.id}>
                <div>
                  <div className="hr-list-title">{item.title}</div>
                  <div className="muted small">
                    {item.category}
                    {item.scope
                      ? ` · ${HR_ITEM_SCOPE_LABELS[item.scope as HrItemScope] ?? item.scope}`
                      : ''}
                    {item.system_hook
                      ? ` · ${HR_SYSTEM_HOOK_LABELS[item.system_hook] ?? item.system_hook}`
                      : ''}
                    {item.assignee_hint ? ` · ${item.assignee_hint}` : ''}
                    {item.status === 'done' && item.completed_at
                      ? ` · Completed ${formatDate(item.completed_at)}`
                      : ''}
                  </div>
                </div>
                <select
                  className="input"
                  value={item.status}
                  onChange={(e) =>
                    onItemStatus(item.id, e.target.value as HrItemStatus)
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
        )}
      </section>

      <section className="panel hr-file-span">
        <h2 className="subhead">{label} documents & acknowledgments</h2>
        <DocumentList docs={docs} />
      </section>
    </div>
  );
}
