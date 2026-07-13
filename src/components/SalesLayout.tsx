import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AuditTracker } from './AuditTracker';
import type { SalesUser } from '../lib/types';
import { logAuditEvent } from '../lib/audit';
import { signOut } from '../lib/auth';
import { activePortalForPath, getPortalDefinition } from '../lib/portals';
import './sales.css';

type Props = {
  salesUser: SalesUser;
};

export function SalesLayout({ salesUser }: Props) {
  const location = useLocation();
  const activeSlug = activePortalForPath(
    location.pathname,
    location.search,
    salesUser,
  );
  const activeDef = activeSlug ? getPortalDefinition(activeSlug) : undefined;
  const navItems = activeDef?.nav ?? [];
  const onCalendar = location.pathname.startsWith('/sales/calendar');
  const onPicker =
    location.pathname === '/sales' ||
    location.pathname === '/sales/' ||
    location.pathname.startsWith('/sales/admin');
  const showBackToPortals = !onPicker;

  async function onSignOut() {
    await logAuditEvent({
      eventType: 'logout',
      path: location.pathname,
      user: salesUser,
    });
    await signOut();
  }

  return (
    <div className="sales-shell">
      <AuditTracker salesUser={salesUser} />
      <header className="sales-header">
        <Link to="/sales" className="sales-brand">
          <div className="sales-mark">T</div>
          <div>
            <div className="sales-brand-name">Tage Venture Capital</div>
            <div className="sales-brand-sub">
              {activeDef?.name ??
                (onCalendar ? 'Calendar' : onPicker ? 'Portals' : 'Workspace')}
            </div>
          </div>
        </Link>
        <nav className="sales-nav">
          {showBackToPortals ? (
            <Link to="/sales" className="sales-nav-switch">
              ← Portals
            </Link>
          ) : null}
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/sales/content'}
              className={({ isActive }) => {
                const prefix = item.matchPrefix ?? item.to;
                // Content hub should not stay active on /blog or /social children
                if (item.to === '/sales/content') {
                  return isActive ? 'active' : '';
                }
                const match =
                  isActive ||
                  location.pathname === prefix ||
                  location.pathname.startsWith(`${prefix}/`);
                return match ? 'active' : '';
              }}
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink
            to="/sales/calendar"
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            Calendar
          </NavLink>
          {salesUser.role === 'admin' && onPicker ? (
            <>
              <NavLink
                to="/sales/admin/portals"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Assignments
              </NavLink>
              <NavLink
                to="/sales/admin/email"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Email
              </NavLink>
              <NavLink
                to="/sales/admin/audit"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Audit log
              </NavLink>
            </>
          ) : null}
        </nav>
        <div className="sales-user">
          <span>{salesUser.full_name || salesUser.email}</span>
          <button type="button" className="btn ghost" onClick={() => void onSignOut()}>
            Sign out
          </button>
        </div>
      </header>
      <main className="sales-main">
        <Outlet />
      </main>
    </div>
  );
}
