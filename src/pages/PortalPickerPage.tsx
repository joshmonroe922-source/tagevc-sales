import { Link } from 'react-router-dom';
import { getPortalDefinition } from '../lib/portals';
import type { SalesUser } from '../lib/types';

type Props = {
  salesUser: SalesUser;
};

export function PortalPickerPage({ salesUser }: Props) {
  const portals = salesUser.portals ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1>Portals</h1>
          <p className="muted">
            Choose a workspace. You only see portals you have been assigned to.
          </p>
        </div>
        {salesUser.role === 'admin' ? (
          <div className="page-actions">
            <Link to="/sales/calendar" className="btn ghost">
              Calendar
            </Link>
            <Link to="/sales/admin/portals" className="btn ghost">
              Manage assignments
            </Link>
            <Link to="/sales/admin/email" className="btn ghost">
              Email analytics
            </Link>
            <Link to="/sales/admin/audit" className="btn ghost">
              Audit log
            </Link>
          </div>
        ) : (
          <div className="page-actions">
            <Link to="/sales/calendar" className="btn ghost">
              Calendar
            </Link>
          </div>
        )}
      </div>

      {portals.length === 0 ? (
        <div className="empty">
          <p>No portals are assigned to your account yet.</p>
          <p className="muted">Ask an admin to grant access under Manage assignments.</p>
        </div>
      ) : (
        <div className="portal-grid">
          {portals.map((portal) => {
            const def = getPortalDefinition(portal.slug);
            const to = def?.homePath ?? `/sales/portals/${portal.slug}`;
            const stub = def?.stub ?? true;
            return (
              <Link key={portal.id} to={to} className="portal-card">
                <div className="portal-card-top">
                  <span className="portal-card-name">{portal.name}</span>
                  {stub ? <span className="portal-card-badge">Soon</span> : null}
                </div>
                <p className="portal-card-desc">{portal.description || def?.description}</p>
                <span className="portal-card-cta">Open →</span>
              </Link>
            );
          })}
        </div>
      )}
    </>
  );
}
