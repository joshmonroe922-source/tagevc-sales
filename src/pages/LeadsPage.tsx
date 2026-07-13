import { useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createLead, listLeads, updateLeadViaEdge } from '../lib/api';
import type { DealPath, LeadSource, LeadStage, SalesLead, SalesUser } from '../lib/types';
import {
  DEAL_PATH_LABELS,
  DEAL_PATH_THESES,
  DEAL_PATHS,
  KANBAN_COLUMNS,
  LEAD_SOURCES,
  SOURCE_LABELS,
  STAGE_LABELS,
} from '../lib/types';

type Props = { salesUser: SalesUser };

type Draft = {
  name: string;
  email: string;
  phone: string;
  company: string;
  deal_path: DealPath;
  source: LeadSource;
  notes: string;
};

const emptyDraft = (): Draft => ({
  name: '',
  email: '',
  phone: '',
  company: '',
  deal_path: 'launch',
  source: 'manual',
  notes: '',
});

export function LeadsPage({ salesUser }: Props) {
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [view, setView] = useState<'kanban' | 'list'>('kanban');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      setLeads(await listLeads());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load deal flow');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
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
    try {
      await createLead({
        ...draft,
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
                <span>{STAGE_LABELS[col]}</span>
                <span className="count">{byColumn[col]?.length ?? 0}</span>
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
                      {lead.name}
                    </Link>
                    <div className="lead-card-meta">{lead.company || 'No company'}</div>
                    <div className="lead-card-foot">{DEAL_PATH_LABELS[lead.deal_path]}</div>
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
                <th>Name</th>
                <th>Company</th>
                <th>Path</th>
                <th>Stage</th>
                <th>Source</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {leads.map((lead) => (
                <tr key={lead.id}>
                  <td>
                    <Link to={`/sales/deal-sourcing/leads/${lead.id}`}>{lead.name}</Link>
                    <div className="muted small">{lead.email || '—'}</div>
                  </td>
                  <td>{lead.company || '—'}</td>
                  <td>{DEAL_PATH_LABELS[lead.deal_path]}</td>
                  <td>
                    <span className="stage-pill">{STAGE_LABELS[lead.stage]}</span>
                  </td>
                  <td>{SOURCE_LABELS[lead.source]}</td>
                  <td>{new Date(lead.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
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
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h2>New deal</h2>
            <form className="stack-form" onSubmit={(e) => void onCreate(e)}>
              <div className="form-grid">
                <label>
                  Founder / contact
                  <input
                    required
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </label>
                <label>
                  Company
                  <input
                    value={draft.company}
                    onChange={(e) => setDraft({ ...draft, company: e.target.value })}
                  />
                </label>
                <label>
                  Email
                  <input
                    type="email"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </label>
                <label>
                  Phone
                  <input
                    value={draft.phone}
                    onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                  />
                </label>
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
    </>
  );
}
