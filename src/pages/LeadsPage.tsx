import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAddTodo } from '../components/AddTodoProvider';
import {
  DealPartyFields,
  dealSnapshotsFromParty,
  emptyDealParty,
  type DealPartyValue,
} from '../components/DealPartyFields';
import {
  createLead,
  listLeads,
  mapNextOpenFollowUpByLead,
  SALES_TODO_SAVED_EVENT,
  updateLeadViaEdge,
} from '../lib/api';
import {
  leadContactEmail,
  leadContactName,
  leadContactPhone,
  writeLeadContactIdentity,
} from '../lib/contactsApi';
import { importanceLabel } from '../lib/msTaskUtils';
import { STAGE_GUIDANCE } from '../lib/stageGuidance';
import type { DealPath, LeadSource, LeadStage, SalesLead, SalesTask, SalesUser } from '../lib/types';
import {
  DEAL_PATH_LABELS,
  DEAL_PATH_THESES,
  DEAL_PATHS,
  formatDate,
  isTaskOverdue,
  KANBAN_COLUMNS,
  LEAD_SOURCES,
  SOURCE_LABELS,
  STAGE_LABELS,
} from '../lib/types';

type Props = { salesUser: SalesUser };

type Draft = {
  deal_path: DealPath;
  source: LeadSource;
  notes: string;
  party: DealPartyValue;
};

const emptyDraft = (): Draft => ({
  deal_path: 'launch',
  source: 'manual',
  notes: '',
  party: emptyDealParty(),
});

type IdentityField = 'name' | 'phone' | 'email';

function InlineIdentityCell({
  lead,
  field,
  value,
  createdBy,
  onSaved,
  onError,
}: {
  lead: SalesLead;
  field: IdentityField;
  value: string;
  createdBy: string;
  onSaved: (updated: SalesLead) => void;
  onError: (message: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value, lead.id]);

  async function commit() {
    const next = draft.trim();
    const prev = value.trim();
    if (next === prev) return;
    setSaving(true);
    try {
      const patch =
        field === 'name'
          ? { name: next }
          : field === 'phone'
            ? { phone: next }
            : { email: next };
      onSaved(await writeLeadContactIdentity(lead, patch, { createdBy }));
    } catch (err) {
      setDraft(value);
      onError(err instanceof Error ? err.message : 'Failed to update contact');
    } finally {
      setSaving(false);
    }
  }

  return (
    <input
      className="list-identity-input"
      type={field === 'email' ? 'email' : 'text'}
      value={draft}
      disabled={saving}
      aria-label={field === 'name' ? 'Name' : field === 'phone' ? 'number' : 'email'}
      placeholder={field === 'name' ? 'Name' : field === 'phone' ? 'Phone' : 'Email'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.currentTarget.blur();
        }
      }}
    />
  );
}

function FollowUpControl({
  lead,
  followUp,
  onOpen,
}: {
  lead: SalesLead;
  followUp: SalesTask | undefined;
  onOpen: (lead: SalesLead) => void;
}) {
  if (!followUp) {
    return (
      <button
        type="button"
        className="btn ghost lead-card-followup"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen(lead);
        }}
      >
        Follow Up / Next Action
      </button>
    );
  }

  const imp = (followUp.importance ?? 'normal').toString().toLowerCase();
  const showImp = imp === 'high' || imp === 'low';
  const overdue = isTaskOverdue(followUp);

  return (
    <div className="lead-card-followup lead-card-followup--scheduled">
      <button
        type="button"
        className="lead-card-followup-main"
        title="Add or edit follow-up"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen(lead);
        }}
      >
        <span className="lead-card-followup-title">{followUp.title}</span>
        <span className="lead-card-followup-meta">
          <span className={overdue ? 'warn-text' : undefined}>
            {followUp.due_at ? formatDate(followUp.due_at) : 'No due date'}
          </span>
          {showImp ? (
            <span className={`cal-task-importance imp-${imp}`}>{importanceLabel(imp)}</span>
          ) : null}
        </span>
      </button>
      <button
        type="button"
        className="btn ghost lead-card-followup-add"
        title="Add follow-up"
        aria-label="Add follow-up"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpen(lead);
        }}
      >
        Add
      </button>
    </div>
  );
}

export function LeadsPage({ salesUser }: Props) {
  const { openAddTodo } = useAddTodo();
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [followUpsByLead, setFollowUpsByLead] = useState<Record<string, SalesTask>>({});
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  function followUpDeal(lead: SalesLead) {
    const name = leadContactName(lead) || lead.name;
    const company = lead.sales_accounts?.name || lead.company;
    openAddTodo({
      leadId: lead.id,
      dealName: company ? `${name} · ${company}` : name,
    });
  }

  async function refreshFollowUps() {
    try {
      setFollowUpsByLead(await mapNextOpenFollowUpByLead());
    } catch {
      /* board still usable without follow-up chips */
    }
  }

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [nextLeads, followUps] = await Promise.all([
        listLeads(),
        mapNextOpenFollowUpByLead().catch(() => ({}) as Record<string, SalesTask>),
      ]);
      setLeads(nextLeads);
      setFollowUpsByLead(followUps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal flow');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  useEffect(() => {
    const onSaved = () => {
      void refreshFollowUps();
    };
    window.addEventListener(SALES_TODO_SAVED_EVENT, onSaved);
    return () => window.removeEventListener(SALES_TODO_SAVED_EVENT, onSaved);
  }, []);

  const byColumn = useMemo(() => {
    const map: Record<string, SalesLead[]> = {};
    for (const col of KANBAN_COLUMNS) map[col] = [];
    for (const lead of leads) {
      const col = KANBAN_COLUMNS.includes(lead.stage as (typeof KANBAN_COLUMNS)[number])
        ? lead.stage
        : 'new';
      map[col].push(lead);
    }
    return map;
  }, [leads]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    if (!draft.party.contactId) {
      setError('Pick or add a contact before creating the deal.');
      return;
    }
    try {
      const snap = dealSnapshotsFromParty(draft.party);
      if (!snap.name) {
        setError('Contact needs a name.');
        return;
      }
      await createLead({
        ...snap,
        contact_id: snap.contact_id!,
        account_id: snap.account_id,
        deal_path: draft.deal_path,
        source: draft.source,
        notes: draft.notes,
        assigned_rep_id: salesUser.id,
      });
      setShowNew(false);
      setDraft(emptyDraft());
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  }

  async function moveLead(leadId: string, stage: LeadStage) {
    try {
      const updated = await updateLeadViaEdge(leadId, { stage });
      setLeads((prev) => prev.map((l) => (l.id === leadId ? updated : l)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Move failed');
      await refresh();
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Deal flow</h1>
          <p className="muted">
            Source and advance deals across Launch, Partner, and Exit theses.
          </p>
        </div>
        <div className="page-actions">
          <div className="seg">
            <button
              type="button"
              className={view === 'kanban' ? 'active' : ''}
              onClick={() => setView('kanban')}
            >
              Pipeline
            </button>
            <button
              type="button"
              className={view === 'list' ? 'active' : ''}
              onClick={() => setView('list')}
            >
              List
            </button>
          </div>
          <button type="button" className="btn primary" onClick={() => setShowNew(true)}>
            Add deal
          </button>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading deal flow…</p> : null}

      {!loading && view === 'kanban' && leads.length === 0 ? (
        <p className="muted">
          No deals in the pipeline yet. Add one or wire website intake for inbound founders.
        </p>
      ) : null}

      {!loading && view === 'kanban' && leads.length > 0 ? (
        <div className="kanban">
          {KANBAN_COLUMNS.map((col) => (
            <div
              key={col}
              className="kanban-col"
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                if (draggingId) void moveLead(draggingId, col);
                setDraggingId(null);
              }}
            >
              <div className="kanban-col-head">
                <div className="kanban-col-title">
                  <span>{STAGE_LABELS[col]}</span>
                  <span className="count">{byColumn[col]?.length ?? 0}</span>
                </div>
                <p className="kanban-col-tip" title={STAGE_GUIDANCE[col].focus}>
                  {STAGE_GUIDANCE[col].cardTip}
                </p>
              </div>
              <div className="kanban-cards">
                {(byColumn[col] ?? []).map((lead) => (
                  <div
                    key={lead.id}
                    className="lead-card"
                    draggable
                    onDragStart={() => setDraggingId(lead.id)}
                    onDragEnd={() => setDraggingId(null)}
                    style={{ cursor: 'grab' }}
                  >
                    <Link to={`/sales/deal-sourcing/leads/${lead.id}`} className="lead-card-name">
                      {leadContactName(lead) || lead.name}
                    </Link>
                    <div className="lead-card-meta">
                      {lead.sales_accounts?.name || lead.company || 'No account'}
                    </div>
                    <div className="lead-card-foot">
                      <span>{DEAL_PATH_LABELS[lead.deal_path]}</span>
                      <span className="lead-card-tip" title={STAGE_GUIDANCE[col].focus}>
                        {STAGE_GUIDANCE[col].decision}
                      </span>
                    </div>
                    <FollowUpControl
                      lead={lead}
                      followUp={followUpsByLead[lead.id]}
                      onOpen={followUpDeal}
                    />
                  </div>
                ))}
                {(byColumn[col] ?? []).length === 0 ? (
                  <p className="muted small">Drop deals here</p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!loading && view === 'list' ? (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Deal</th>
                <th>Account</th>
                <th>Name</th>
                <th>number</th>
                <th className="hide-sm">email</th>
                <th className="hide-sm">Path</th>
                <th>Stage</th>
                <th className="hide-sm">Source</th>
                <th className="hide-sm">Follow Up / Next Action</th>
                <th className="hide-sm">Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => {
                const followUp = followUpsByLead[lead.id];
                const name = leadContactName(lead);
                const phone = leadContactPhone(lead);
                const email = leadContactEmail(lead);
                return (
                  <tr key={lead.id}>
                    <td>
                      <Link to={`/sales/deal-sourcing/leads/${lead.id}`}>
                        {name || lead.name}
                      </Link>
                    </td>
                    <td>{lead.sales_accounts?.name || lead.company || '—'}</td>
                    <td>
                      <InlineIdentityCell
                        lead={lead}
                        field="name"
                        value={name}
                        createdBy={salesUser.id}
                        onSaved={(updated) =>
                          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
                        }
                        onError={setError}
                      />
                    </td>
                    <td>
                      <InlineIdentityCell
                        lead={lead}
                        field="phone"
                        value={phone}
                        createdBy={salesUser.id}
                        onSaved={(updated) =>
                          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
                        }
                        onError={setError}
                      />
                    </td>
                    <td className="hide-sm">
                      <InlineIdentityCell
                        lead={lead}
                        field="email"
                        value={email}
                        createdBy={salesUser.id}
                        onSaved={(updated) =>
                          setLeads((prev) => prev.map((l) => (l.id === updated.id ? updated : l)))
                        }
                        onError={setError}
                      />
                    </td>
                    <td className="hide-sm">{DEAL_PATH_LABELS[lead.deal_path]}</td>
                    <td>
                      <span className="stage-pill">{STAGE_LABELS[lead.stage]}</span>
                    </td>
                    <td className="hide-sm">{SOURCE_LABELS[lead.source]}</td>
                    <td className="hide-sm">
                      {followUp ? (
                        <div className="list-followup">
                          <div className="list-followup-title">{followUp.title}</div>
                          <div className={`muted small ${isTaskOverdue(followUp) ? 'warn-text' : ''}`}>
                            {followUp.due_at ? formatDate(followUp.due_at) : 'No due date'}
                          </div>
                        </div>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="hide-sm">{new Date(lead.created_at).toLocaleDateString()}</td>
                    <td>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() => followUpDeal(lead)}
                      >
                        {followUp ? 'Add' : 'Follow Up / Next Action'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {leads.length === 0 ? (
            <p className="muted" style={{ padding: '1rem' }}>
              No deals in the pipeline yet. Add one or wire website intake for inbound founders.
            </p>
          ) : null}
        </div>
      ) : null}

      {showNew ? (
        <div className="modal-backdrop" onClick={() => setShowNew(false)}>
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h2>New deal</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <DealPartyFields
                value={draft.party}
                createdBy={salesUser.id}
                requireContact
                onChange={(party) => setDraft({ ...draft, party })}
              />
              <div className="form-grid">
                <label>
                  Thesis / path
                  <select
                    value={draft.deal_path}
                    onChange={(e) =>
                      setDraft({ ...draft, deal_path: e.target.value as DealPath })
                    }
                  >
                    {DEAL_PATHS.map((p) => (
                      <option key={p} value={p}>
                        {DEAL_PATH_LABELS[p]} — {DEAL_PATH_THESES[p]}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Source
                  <select
                    value={draft.source}
                    onChange={(e) =>
                      setDraft({ ...draft, source: e.target.value as LeadSource })
                    }
                  >
                    {LEAD_SOURCES.map((s) => (
                      <option key={s} value={s}>
                        {SOURCE_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="full">
                  Notes
                  <textarea
                    value={draft.notes}
                    onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                  />
                </label>
              </div>
              <div className="modal-actions">
                <button type="button" className="btn ghost" onClick={() => setShowNew(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn primary">
                  Create
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <p className="muted small portal-todo-hint">
        Use <strong>Add To Do</strong> in the header, or <strong>Follow Up / Next Action</strong> on
        a deal card, to capture tasks in Microsoft To Do.
      </p>
    </>
  );
}
