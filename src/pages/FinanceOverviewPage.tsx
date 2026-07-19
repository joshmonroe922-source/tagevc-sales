import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getFinanceOverviewStats } from '../lib/financeApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Accounting & Finance shared-services home (not entity detail). */
export function FinanceOverviewPage({ salesUser }: Props) {
  const [stats, setStats] = useState<Awaited<
    ReturnType<typeof getFinanceOverviewStats>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setStats(await getFinanceOverviewStats());
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
              : 'Failed to load Finance overview (run migration 0027)',
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
          <h1>Accounting &amp; Finance</h1>
          <p className="muted">
            Intuit Enterprise Suite controls and close hygiene for Tage parent and each
            subsidiary. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/finance/month-end" className="btn primary">
            Month End Close
          </Link>
          <Link to="/sales/finance/controls" className="btn ghost">
            Compliance
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
            <span>{stats.openTaskCount} open finance tasks</span>
            <span>{stats.openMonthCloseCount} month-end open</span>
            <span>{stats.openYearCloseCount} year-end open</span>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Workspaces</h2>
            </div>
            <ul className="ops-compliance-list">
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/finance/controls">
                    Compliance / controls
                  </Link>
                  <div className="muted small">
                    Parent + each subsidiary — AR/AP, banking, close, consolidation, budgets,
                    and Suite audit controls.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/finance/month-end">
                    Month End Close
                  </Link>
                  <div className="muted small">
                    Per-entity monthly close checklists — recon, accruals, statements, tax
                    estimates; mark done, attach evidence, roll to next month.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/finance/year-end">
                    Year End Close
                  </Link>
                  <div className="muted small">
                    Per-entity annual close — true-ups, tax pack, statutory readiness,
                    consolidation; roll to next year on complete.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/finance/tasks">
                    Open tasks
                  </Link>
                  <div className="muted small">
                    Incomplete controls → assignable finance tasks (sync to portal To Do).
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
