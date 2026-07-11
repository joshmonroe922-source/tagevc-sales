import { NavLink, Outlet } from 'react-router-dom';
import type { SalesUser } from '../lib/types';
import { signOut } from '../lib/auth';
import './sales.css';

type Props = {
  salesUser: SalesUser;
};

export function SalesLayout({ salesUser }: Props) {
  return (
    <div className="sales-shell">
      <header className="sales-header">
        <div className="sales-brand">
          <div className="sales-mark">T</div>
          <div>
            <div className="sales-brand-name">Tage Venture Capital</div>
            <div className="sales-brand-sub">Deal sourcing</div>
          </div>
        </div>
        <nav className="sales-nav">
          <NavLink to="/sales/leads" className={({ isActive }) => (isActive ? 'active' : '')}>
            Deal flow
          </NavLink>
          <NavLink
            to="/sales/ops"
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            Entity Ops
          </NavLink>
          <NavLink to="/sales/tasks" className={({ isActive }) => (isActive ? 'active' : '')}>
            Follow-ups
          </NavLink>
          <NavLink to="/sales/content" className={({ isActive }) => (isActive ? 'active' : '')}>
            Content
          </NavLink>
          <NavLink to="/sales/automation" className={({ isActive }) => (isActive ? 'active' : '')}>
            Nurture
          </NavLink>
          <NavLink to="/sales/reports" className={({ isActive }) => (isActive ? 'active' : '')}>
            Deal flow reports
          </NavLink>
        </nav>
        <div className="sales-user">
          <span>{salesUser.full_name || salesUser.email}</span>
          <button type="button" className="btn ghost" onClick={() => void signOut()}>
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
