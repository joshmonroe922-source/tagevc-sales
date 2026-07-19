import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getLegalOverviewStats } from '../lib/legalApi';
import { listUpcomingCompliance } from '../lib/opsApi';
import { isComplianceOverdue } from '../lib/opsTypes';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Legal shared-services home: audit hygiene overview (not entity detail). */
export function LegalOverviewPage({ salesUser }: Props) {
  const [stats, setStats] = useState<Awaited<
    ReturnType<typeof getLegalOverviewStats>
  > | null>(null);
  const [filingOverdue, setFilingOverdue] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [s, filings] = await Promise.all([
      getLegalOverviewStats(),
      listUpcomingCompliance().catch(() => []),
    ]);
    setStats(s);
    setFilingOverdue(
      filings.filter((c) => c.active && isComplianceOverdue(c)).length,
    );
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
              : 'Failed to load Legal overview (run migration 0026)',
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
          <h1>Legal</h1>
          <p className="muted">
            Operational legal hygiene for Tage parent and each subsidiary — so staff Legal
            focuses on document review, disputes, and pressing matters. Signed in as{' '}
            {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/legal/controls" className="btn primary">
            Corporate audit
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
            <span>{stats.openTaskCount} open legal tasks</span>
            {filingOverdue > 0 ? (
              <span className="warn-text">{filingOverdue} filings overdue</span>
            ) : null}
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Workspaces</h2>
            </div>
            <ul className="ops-compliance-list">
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/legal/controls">
                    Corporate audit / controls
                  </Link>
                  <div className="muted small">
                    Parent + each subsidiary — formation, contracts, insurance, IP, privacy,
                    and more.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/legal/tasks">
                    Open tasks
                  </Link>
                  <div className="muted small">
                    Incomplete controls → assignable legal tasks (sync to Tage · Legal To Do).
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/legal/filings">
                    Filings & renewals
                  </Link>
                  <div className="muted small">
                    Cadenced licenses, annual reports, and renewals (existing ops compliance).
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/legal/contracts">
                    Contracts
                  </Link>
                  <div className="muted small">
                    Placeholder for contract review workflow (attorney queue).
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/legal/ra-notices">
                    Registered agent mail
                  </Link>
                  <div className="muted small">
                    URA / legal-notices inbox via Outlook — review and create Legal To Do.
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
