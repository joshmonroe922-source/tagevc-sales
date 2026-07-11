import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listEntities, listUpcomingCompliance } from '../lib/opsApi';
import type { OpsComplianceItem, OpsEntity } from '../lib/opsTypes';
import {
  formatDate,
  isComplianceDueSoon,
  isComplianceOverdue,
  OPS_ENTITY_STATUS_LABELS,
  OPS_ENTITY_TYPE_LABELS,
} from '../lib/opsTypes';

export function OpsHubPage() {
  const [entities, setEntities] = useState<OpsEntity[]>([]);
  const [compliance, setCompliance] = useState<OpsComplianceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const [ents, comps] = await Promise.all([
          listEntities(),
          listUpcomingCompliance(),
        ]);
        if (!mounted) return;
        setEntities(ents);
        setCompliance(comps);
      } catch (err) {
        if (!mounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load Entity Ops');
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  const overdueCount = useMemo(
    () => compliance.filter((c) => isComplianceOverdue(c)).length,
    [compliance],
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Entity Ops</h1>
          <p className="muted">
            Portfolio entities — checklists, folders, and compliance renewals.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/ops/entities/new" className="btn primary">
            New entity
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && !error ? (
        <div className="detail-grid ops-hub-grid">
          <section className="panel">
            <div className="panel-head">
              <h2>Entities</h2>
              <span className="muted small">{entities.length}</span>
            </div>
            {entities.length === 0 ? (
              <p className="muted">
                No entities yet.{' '}
                <Link to="/sales/ops/entities/new">Start a business</Link> or acquire one
                with a checklist template.
              </p>
            ) : (
              <ul className="ops-entity-list">
                {entities.map((ent) => (
                  <li key={ent.id}>
                    <Link to={`/sales/ops/entities/${ent.id}`} className="ops-entity-row">
                      <div>
                        <div className="ops-entity-name">{ent.name}</div>
                        <div className="muted small">
                          {OPS_ENTITY_TYPE_LABELS[ent.entity_type]} ·{' '}
                          {OPS_ENTITY_STATUS_LABELS[ent.status]}
                          {ent.jurisdiction ? ` · ${ent.jurisdiction}` : ''}
                          {ent.sales_leads
                            ? ` · Deal: ${ent.sales_leads.name}`
                            : ''}
                        </div>
                      </div>
                      <span className="muted small">{formatDate(ent.updated_at)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="panel">
            <div className="panel-head">
              <h2>Compliance — next due</h2>
              {overdueCount > 0 ? (
                <span className="warn-text small">{overdueCount} overdue</span>
              ) : (
                <span className="muted small">Sorted by due date</span>
              )}
            </div>
            {compliance.length === 0 ? (
              <p className="muted">
                No upcoming compliance items. Add licenses and filings on an entity detail
                page.
              </p>
            ) : (
              <ul className="ops-compliance-list">
                {compliance.map((item) => {
                  const overdue = isComplianceOverdue(item);
                  const soon = isComplianceDueSoon(item);
                  return (
                    <li
                      key={item.id}
                      className={overdue ? 'overdue' : soon ? 'due-soon' : ''}
                    >
                      <div>
                        <Link
                          to={`/sales/ops/entities/${item.entity_id}`}
                          className="ops-compliance-title"
                        >
                          {item.title}
                        </Link>
                        <div className="muted small">
                          {item.ops_entities?.name ?? 'Entity'} · {item.cadence}
                        </div>
                      </div>
                      <span
                        className={
                          overdue ? 'warn-text' : soon ? 'gold-text' : 'muted'
                        }
                      >
                        {formatDate(item.next_due_at)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </>
  );
}
