import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { listEntities } from '../lib/opsApi';
import type { OpsEntity } from '../lib/opsTypes';
import { OPS_ENTITY_STATUS_LABELS, OPS_ENTITY_TYPE_LABELS } from '../lib/opsTypes';

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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const ents = await listEntities();
        if (!mounted) return;
        setEntities(sortPortfolioEntities(ents));
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Manage Portfolio</h1>
          <p className="muted">
            Companies assigned to you — open one for sales and operations (checklists and
            folders). Compliance lives under Legal.
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
        <section className="ops-portfolio-section">
          <div className="panel-head ops-portfolio-head">
            <h2>Companies</h2>
            <span className="muted small">{entities.length}</span>
          </div>
          {entities.length === 0 ? (
            <p className="muted">
              No companies assigned yet. Ask an admin to grant access, or{' '}
              <Link to="/sales/ops/entities/new?template=start-business">
                start a business
              </Link>{' '}
              /{' '}
              <Link to="/sales/ops/entities/new?template=acquire-business">
                acquire one
              </Link>{' '}
              (you keep access to entities you create).
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
      ) : null}

      <p className="muted small portal-todo-hint">
        Use <strong>Add To Do</strong> in the header to capture tasks in Microsoft To Do.
        Licenses and filings:{' '}
        <Link to="/sales/legal">Legal → Corporate audit</Link>.
      </p>
    </>
  );
}
