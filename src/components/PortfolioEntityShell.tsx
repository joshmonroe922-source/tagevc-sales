import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { PortfolioEntityNav } from './PortfolioEntityNav';
import { getEntity } from '../lib/opsApi';
import type { OpsEntity } from '../lib/opsTypes';
import type { PortfolioEntitySection } from '../lib/portfolioEntity';

type Props = {
  section: PortfolioEntitySection;
  children: (entity: OpsEntity) => ReactNode;
};

const SECTION_LABELS: Record<PortfolioEntitySection, string> = {
  overview: 'Overview',
  leadership: 'Leadership',
  'think-tank': 'Think Tank',
  financial: 'Financial',
  kpis: 'KPIs',
  platform: 'Platform',
};

/** Shared header + section nav for any Manage Portfolio entity. */
export function PortfolioEntityShell({ section, children }: Props) {
  const { id = '' } = useParams();
  const [entity, setEntity] = useState<OpsEntity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      if (!id) return;
      setLoading(true);
      setError(null);
      try {
        const ent = await getEntity(id);
        if (!mounted) return;
        setEntity(ent);
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load entity');
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [id]);

  if (loading) {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (!entity) {
    return (
      <>
        <div className="banner error">
          {error ?? 'Entity not found or you do not have access.'}
        </div>
        <Link to="/sales/ops">Back to Manage Portfolio</Link>
      </>
    );
  }

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to="/sales/ops">Manage Portfolio</Link> /{' '}
            <Link to={`/sales/ops/entities/${entity.id}`}>{entity.name}</Link>
            {section !== 'overview' ? (
              <>
                {' '}
                / {SECTION_LABELS[section]}
              </>
            ) : null}
          </p>
          <h1>{entity.name}</h1>
          <p className="muted">
            Portfolio company · Leadership, Think Tank, Financial, KPIs, and Platform
          </p>
        </div>
      </div>

      {error ? <div className="banner error">{error}</div> : null}

      <PortfolioEntityNav entityId={entity.id} active={section} />

      {children(entity)}
    </>
  );
}
