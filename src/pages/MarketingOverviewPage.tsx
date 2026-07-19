import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getMarketingOverviewStats } from '../lib/marketingApi';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** External MarTech launch cards (no API keys in the portal — secrets stay on Desk/Vercel). */
const MARKETING_TOOLS = [
  {
    id: 'synthesia',
    name: 'Synthesia',
    href: 'https://app.synthesia.io',
    description:
      'AI avatar videos for training and marketing — open your Synthesia workspace to create and edit.',
  },
] as const;

/** Marketing shared-services home: plan & audit overview (not entity detail). */
export function MarketingOverviewPage({ salesUser }: Props) {
  const [stats, setStats] = useState<Awaited<
    ReturnType<typeof getMarketingOverviewStats>
  > | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const s = await getMarketingOverviewStats();
    setStats(s);
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
              : 'Failed to load Marketing overview (run migration 0028)',
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
          <h1>Marketing</h1>
          <p className="muted">
            Plan &amp; audit hygiene for Tage parent and each subsidiary — plus content
            ops. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/marketing/controls" className="btn primary">
            Plan &amp; audit
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
            <span>{stats.openTaskCount} open marketing tasks</span>
          </div>

          <section className="panel">
            <div className="panel-head">
              <h2>Workspaces</h2>
            </div>
            <ul className="ops-compliance-list">
              <li>
                <div>
                  <Link
                    className="ops-compliance-title"
                    to="/sales/marketing/controls"
                  >
                    Plan &amp; audit / controls
                  </Link>
                  <div className="muted small">
                    Parent + each subsidiary — strategy, brand, channels, budget, MarTech,
                    compliance, and review.
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/marketing/tasks">
                    Open tasks
                  </Link>
                  <div className="muted small">
                    Incomplete controls → assignable marketing tasks (sync to Tage ·
                    Marketing To Do).
                  </div>
                </div>
              </li>
              <li>
                <div>
                  <Link className="ops-compliance-title" to="/sales/content">
                    Content hub
                  </Link>
                  <div className="muted small">Blog and social content operations.</div>
                </div>
              </li>
            </ul>
          </section>
        </>
      ) : null}

      <section className="panel">
        <div className="panel-head">
          <h2>Tools</h2>
        </div>
        <ul className="ops-compliance-list">
          {MARKETING_TOOLS.map((tool) => (
            <li key={tool.id}>
              <div>
                <a
                  className="ops-compliance-title"
                  href={tool.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {tool.name}
                </a>
                <div className="muted small">{tool.description}</div>
              </div>
              <a
                className="btn"
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                Open
              </a>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
