import { Link } from 'react-router-dom';
import { PortalTasksPanel } from '../components/PortalTasksPanel';
import type { SalesUser } from '../lib/types';

type Props = { salesUser: SalesUser };

/** Administrative shared-services home (shell — audit modules ship later). */
export function AdministrativeOverviewPage({ salesUser }: Props) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>Administrative</h1>
          <p className="muted">
            Office operations, facilities, vendors, and general admin for Tage parent and each
            subsidiary. Signed in as {salesUser.email}.
          </p>
        </div>
        <div className="page-actions">
          <Link to="/sales/administrative/tickets" className="btn primary">
            Tickets
          </Link>
          <Link to="/sales" className="btn ghost">
            All portals
          </Link>
        </div>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h2>Workspaces</h2>
        </div>
        <ul className="ops-compliance-list">
          <li>
            <div>
              <Link className="ops-compliance-title" to="/sales/administrative/controls">
                Plan &amp; audit
              </Link>
              <div className="muted small">
                Parent + each subsidiary — office ops, facilities, vendors, records, and review
                cadence. <span className="portal-card-badge">Soon</span>
              </div>
            </div>
          </li>
          <li>
            <div>
              <Link className="ops-compliance-title" to="/sales/administrative/tasks">
                Open tasks
              </Link>
              <div className="muted small">
                Incomplete controls → assignable administrative tasks (sync to portal To Do).{' '}
                <span className="portal-card-badge">Soon</span>
              </div>
            </div>
          </li>
          <li>
            <div>
              <Link className="ops-compliance-title" to="/sales/administrative/tickets">
                Tickets
              </Link>
              <div className="muted small">
                General / admin helpdesk queue for facilities, vendors, and office requests.
              </div>
            </div>
          </li>
        </ul>
      </section>

      <PortalTasksPanel portalSlug="administrative" />
    </>
  );
}
