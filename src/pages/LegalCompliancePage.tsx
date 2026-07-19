import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent } from 'react';
import { Link } from 'react-router-dom';
import {
  createComplianceItem,
  listEntities,
  listUpcomingCompliance,
  markComplianceComplete,
  updateComplianceItem,
} from '../lib/opsApi';
import type { ComplianceCadence, OpsComplianceItem, OpsEntity } from '../lib/opsTypes';
import {
  COMPLIANCE_CADENCE_LABELS,
  COMPLIANCE_CADENCES,
  formatDate,
  isComplianceDueSoon,
  isComplianceOverdue,
} from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Shared-services Legal filings & renewals (ops_compliance_items) — not entity ops. */
export function LegalCompliancePage({ salesUser }: Props) {
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [compliance, setCompliance] = useState<OpsComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [compEntityId, setCompEntityId] = useState('');
  const [compTitle, setCompTitle] = useState('');
  const [compCadence, setCompCadence] = useState<ComplianceCadence>('annual');
  const [compDue, setCompDue] = useState('');
  const [compNotes, setCompNotes] = useState('');

  const refresh = useCallback(async () => {
    const [ents, comps] = await Promise.all([listEntities(), listUpcomingCompliance()]);
    setEntities(
      [...ents].sort((a, b) => a.name.localeCompare(b.name)),
    );
    setCompliance(comps);
    setCompEntityId((prev) => prev || (ents[0]?.id ?? ''));
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        await refresh();
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load compliance');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [refresh]);

  const overdueCount = useMemo(
    () =>
      compliance.filter((c) => c.active && isComplianceOverdue(c)).length,
    [compliance],
  );

  async function onAddCompliance(e: FormEvent) {
    e.preventDefault();
    if (!compEntityId || !compTitle.trim()) return;
    setError(null);
    try {
      await createComplianceItem({
        entity_id: compEntityId,
        title: compTitle,
        cadence: compCadence,
        next_due_at: compDue || null,
        notes: compNotes,
      });
      setCompTitle('');
      setCompDue('');
      setCompNotes('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Compliance create failed');
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Filings & renewals</h1>
          <p className="muted">
            Cadenced licenses, annual reports, and renewals across portfolio companies.
            Corporate audit controls live under{' '}
            <Link to="/sales/legal/controls">Corporate audit</Link>.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/legal/controls" className="btn ghost">
            Corporate audit
          </Link>
          <Link to="/sales/legal" className="btn ghost">
            Overview
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading ? (
        <>
          <section className="panel ops-compliance-hub">
            <div className="panel-head">
              <h2>Compliance — next due</h2>
              {overdueCount > 0 ? (
                <span className="warn-text small">{overdueCount} overdue</span>
              ) : (
                <span className="muted small">All entities · sorted by due date</span>
              )}
            </div>
            {compliance.length === 0 ? (
              <p className="muted">
                No upcoming compliance items. Add licenses and filings below.
              </p>
            ) : (
              <ul className="ops-compliance-list">
                {compliance.map((item) => {
                  const overdue = isComplianceOverdue(item);
                  const soon = isComplianceDueSoon(item);
                  return (
                    <li
                      key={item.id}
                      className={
                        !item.active
                          ? ''
                          : overdue
                            ? 'overdue'
                            : soon
                              ? 'due-soon'
                              : ''
                      }
                    >
                      <div>
                        <div className="ops-compliance-title">{item.title}</div>
                        <div className="muted small">
                          {item.ops_entities?.name ?? 'Entity'} ·{' '}
                          {COMPLIANCE_CADENCE_LABELS[item.cadence] ?? item.cadence}
                          {item.last_completed_at
                            ? ` · Last done ${formatDate(item.last_completed_at)}`
                            : ''}
                          {!item.active ? ' · Inactive' : ''}
                        </div>
                      </div>
                      <div className="ops-compliance-actions">
                        <span
                          className={
                            overdue ? 'warn-text' : soon ? 'gold-text' : 'muted'
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
                  );
                })}
              </ul>
            )}

            <form className="form-stack compact" onSubmit={onAddCompliance}>
              <h3 className="subhead">Add compliance item</h3>
              <label>
                <span>Company</span>
                <select
                  value={compEntityId}
                  onChange={(e) => setCompEntityId(e.target.value)}
                  required
                  disabled={entities.length === 0}
                >
                  {entities.length === 0 ? (
                    <option value="">No companies available</option>
                  ) : (
                    entities.map((ent) => (
                      <option key={ent.id} value={ent.id}>
                        {ent.name}
                      </option>
                    ))
                  )}
                </select>
              </label>
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
              <button
                type="submit"
                className="btn primary"
                disabled={!compEntityId || entities.length === 0}
              >
                Add item
              </button>
            </form>
          </section>

          <p className="muted small portal-todo-hint">
            Signed in as {salesUser.email}. Open legal tasks:{' '}
            <Link to="/sales/legal/tasks">/sales/legal/tasks</Link>.
          </p>
        </>
      ) : null}
    </>
  );
}
