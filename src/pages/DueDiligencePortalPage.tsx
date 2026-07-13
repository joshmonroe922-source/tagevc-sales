import { Link, Navigate } from 'react-router-dom';
import { getPortalDefinition, userHasPortal } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

const DD_CHECKLIST = [
  {
    area: 'Financial',
    items: ['Quality of earnings', 'Cap table & ownership', 'Runway and burn'],
  },
  {
    area: 'Legal & corporate',
    items: ['Entity docs & IP assignment', 'Material contracts', 'Litigation / compliance'],
  },
  {
    area: 'Product & technology',
    items: ['Architecture & security', 'Roadmap vs. claims', 'Key dependencies'],
  },
  {
    area: 'Market & commercial',
    items: ['TAM / competitive set', 'Customer concentration', 'Retention & pipeline'],
  },
  {
    area: 'Team & ops',
    items: ['Founder / leadership fit', 'Key-person risk', 'Hiring plan post-close'],
  },
] as const;

export function DueDiligencePortalPage({ salesUser }: Props) {
  const def = getPortalDefinition('due-diligence');

  if (!def) {
    return <Navigate to="/sales" replace />;
  }

  if (!userHasPortal(salesUser, 'due-diligence')) {
    return <Navigate to="/sales" replace />;
  }

  const hasDealSourcing = userHasPortal(salesUser, 'deal-sourcing');
  const hasMa = userHasPortal(salesUser, 'new-acquisition');

  return (
    <>
      <div className="page-header">
        <div>
          <p className="crumb">
            <Link to="/sales">Portals</Link> / {def.name}
          </p>
          <h1>{def.name}</h1>
          <p className="muted">{def.description}</p>
        </div>
        <div className="page-actions">
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <div className="portal-stub onboarding-portal">
        <p className="portal-stub-eyebrow">Deal workspace</p>
        <h2>Diligence checklist (placeholder)</h2>
        <p className="muted">
          Use this workspace while a deal moves from sourcing toward term sheet or close.
          Full deal-linked checklists and document rooms will land here; the outline below
          mirrors a typical VC diligence pass.
        </p>

        <ul className="dd-checklist">
          {DD_CHECKLIST.map((section) => (
            <li key={section.area} className="dd-checklist-section">
              <strong>{section.area}</strong>
              <ul>
                {section.items.map((item) => (
                  <li key={item}>
                    <label className="dd-check-row">
                      <input type="checkbox" disabled />
                      <span>{item}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>

        <div className="form-actions">
          {hasDealSourcing ? (
            <Link to="/sales/deal-sourcing/leads" className="btn primary">
              Open Deal Sourcing
            </Link>
          ) : null}
          {hasMa ? (
            <Link to="/sales/new-acquisition" className="btn ghost">
              New Mergers &amp; Acquisitions
            </Link>
          ) : null}
        </div>
      </div>
    </>
  );
}
