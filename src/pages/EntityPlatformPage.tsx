import { useState } from 'react';
import { PortfolioEntityShell } from '../components/PortfolioEntityShell';
import { platformLinksForEntity } from '../lib/portfolioEntity';
import { openTalentDeskWithSso } from '../lib/talentDeskSso';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

export function EntityPlatformPage({ salesUser: _salesUser }: Props) {
  return (
    <PortfolioEntityShell section="platform">
      {(entity) => <PlatformLinks entity={entity} />}
    </PortfolioEntityShell>
  );
}

function PlatformLinks({
  entity,
}: {
  entity: {
    id: string;
    name: string;
    slug: string | null;
    website_url: string;
  };
}) {
  const links = platformLinksForEntity(entity);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSso(path: string) {
    setBusy(true);
    setError(null);
    try {
      await openTalentDeskWithSso(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SSO failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel recruit619-section">
      <div className="panel-head">
        <h2>Platform</h2>
        <span className="muted small">{entity.name}</span>
      </div>
      <p className="muted">
        Operating platform for this entity. Recruiters and managers for Recruit
        619 use Recruiting Desk (TalentDesk), not Manage Portfolio tabs.
      </p>
      {error ? <div className="banner error">{error}</div> : null}
      <ul className="recruit619-roadmap">
        {links.map((link) => (
          <li key={`${link.label}-${link.href}`}>
            <strong>{link.label}</strong>
            <div className="muted small">{link.description}</div>
            <div className="recruit619-actions" style={{ marginTop: '0.5rem' }}>
              {link.talentDeskSso ? (
                <button
                  type="button"
                  className="btn primary"
                  disabled={busy}
                  onClick={() => void onSso(link.ssoPath ?? '/placement')}
                >
                  {busy ? 'Opening…' : 'Log into Recruiting Desk (SSO)'}
                </button>
              ) : link.href === '#' ? (
                <span className="muted">No URL configured</span>
              ) : (
                <a
                  className="btn primary"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open
                </a>
              )}
              {link.href !== '#' ? (
                <a
                  className="btn"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.href}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
