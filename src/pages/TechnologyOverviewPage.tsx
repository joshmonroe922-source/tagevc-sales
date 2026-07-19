import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getTechnologyOverviewStats } from '../lib/technologyApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Technology shared-services home (not entity detail). */
export function TechnologyOverviewPage({ salesUser }: Props) {
  const [stats, setStats] = useState<Awaited<
    ReturnType<typeof getTechnologyOverviewStats>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStats(await getTechnologyOverviewStats());
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
          setError(
            err instanceof Error
              ? err.message
              : 'Failed to load Technology overview (run migration 0029)',
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

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Technology</h1>
          <p className="muted">
            Hybrid IT controls, Suite integrations, and security hygiene for Tage parent and each
            subsidiary. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/technology/controls" className="btn primary">
            Compliance / controls
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}
      {loading ? <p className="muted">Loading…</p> : null}

      {!loading && stats ? (
        <>
          <div className="hr-compliance-stats muted small">
            <span>{stats.controlCount} controls</span>
            <span>{stats.parentCount} parent</span>
            <span>{stats.entityCount} subsidiary rows</span>
            {stats.openCount > 0 ? (
              <span className="warn-text">{stats.openCount} open</span>
            ) : null}
            {stats.gapCount > 0 ? (
              <span className="warn-text">{stats.gapCount} gaps</span>
            ) : null}
            {stats.overdueCount > 0 ? (
              <span className="warn-text">{stats.overdueCount} overdue</span>
            ) : null}
            <span>{stats.openTaskCount} open technology tasks</span>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Workspaces</h2>
            </div>
            <ul className="ops-compliance-list">
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/technology/controls">
                    Compliance / controls
                  </Link>
                  <div className="muted small">
                    Parent + each subsidiary — Strategy, infra, apps, data, security, support,
                    and Suite/integration controls.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/technology/tasks">
                    Open tasks
                  </Link>
                  <div className="muted small">
                    Incomplete controls → assignable technology tasks (sync to portal To Do).
                  </div>
                </div>
              </li>
            </ul>
          </section>
        </>
      ) : null}
    </>
  );
}
