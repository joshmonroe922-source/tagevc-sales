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

function entityCardDesc(ent: OpsEntity): string {
  const parts = [
    OPS_ENTITY_TYPE_LABELS[ent.entity_type],
    OPS_ENTITY_STATUS_LABELS[ent.status],
  ];
  if (ent.jurisdiction) parts.push(ent.jurisdiction);
  if (ent.website_url) {
    try {
      parts.push(new URL(ent.website_url).hostname.replace(/^www\./, ''));
    } catch {
      parts.push(ent.website_url);
    }
  }
  return parts.join(' · ');
}

/** Portfolio companies (slugged operate) first, then by name. */
function sortPortfolioEntities(ents: OpsEntity[]): OpsEntity[] {
  return [...ents].sort((a, b) => {
    const aPort = a.slug ? 0 : 1;
    const bPort = b.slug ? 0 : 1;
    if (aPort !== bPort) return aPort - bPort;
    return a.name.localeCompare(b.name);
  });
}

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
        setEntities(sortPortfolioEntities(ents));
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
          <h1>Manage Portfolio</h1>
          <p className="muted">
            Portfolio companies — open one for checklists, folders, and compliance.
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
        <>
          <section className="ops-portfolio-section">
            <div className="panel-head ops-portfolio-head">
              <h2>Companies</h2>
              <span className="muted small">{entities.length}</span>
            </div>
            {entities.length === 0 ? (
              <p className="muted">
                No companies yet.{' '}
                <Link to="/sales/ops/entities/new?template=start-business">
                  Start a business
                </Link>{' '}
                or{' '}
                <Link to="/sales/ops/entities/new?template=acquire-business">
                  acquire one
                </Link>{' '}
                with a checklist template.
              </p>
            ) : (
              <div className="portal-grid">
                {entities.map((ent) => (
                  <Link
                    key={ent.id}
                    to={`/sales/ops/entities/${ent.id}`}
                    className="portal-card"
                  >
                    <div className="portal-card-top">
                      <span className="portal-card-name">{ent.name}</span>
                      {ent.slug ? (
                        <span className="portal-card-badge">Portfolio</span>
                      ) : null}
                    </div>
                    <p className="portal-card-desc">{entityCardDesc(ent)}</p>
                    <span className="portal-card-cta">Open →</span>
                  </Link>
                ))}
              </div>
            )}
          </section>

          <section className="panel ops-compliance-hub">
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
                No upcoming compliance items. Add licenses and filings on a company
                detail page.
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
        </>
      ) : null}
    </>
  );
}
