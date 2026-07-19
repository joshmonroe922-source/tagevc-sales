import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { AddTodoProvider, useAddTodo } from './AddTodoProvider';
import { CreateTicketProvider, useCreateTicket } from './CreateTicketProvider';
import { AuditTracker } from './AuditTracker';
import { RingCentralWidget } from './RingCentralWidget';
import type { SalesUser } from '../lib/types';
import { logAuditEvent } from '../lib/audit';
import { signOut } from '../lib/auth';
import { activePortalForPath, getPortalDefinition } from '../lib/portals';
import { countMyUnread } from '../lib/ticketsApi';
import { useTeamsChatDesktopAlerts } from '../lib/useTeamsChatDesktopAlerts';
import { useMailDesktopAlerts } from '../lib/useMailDesktopAlerts';
import { useWorkDesktopAlerts } from '../lib/useWorkDesktopAlerts';
import './sales.css';

type Props = {
  salesUser: SalesUser;
};

/** Josh-only master/admin home — SharePoint doc lives in his personal OneDrive. */
const VC_FORMATION_CHECKLIST_URL =
  'https://netorgft15674001-my.sharepoint.com/personal/joshmonroe_tagevc_com1/_layouts/15/doc.aspx?sourcedoc={78d9f5e4-a231-49ae-b900-e4a8ffb1a131}&action=edit';

function SalesHeaderActions({
  salesUser,
  unreadTickets,
  showFormationChecklist,
}: {
  salesUser: SalesUser;
  unreadTickets: number;
  showFormationChecklist: boolean;
}) {
  const { openAddTodo } = useAddTodo();
  const { openCreateTicket } = useCreateTicket();
  const location = useLocation();

  async function onSignOut() {
    await logAuditEvent({
      eventType: 'logout',
      path: location.pathname,
      user: salesUser,
    });
    await signOut();
  }

  return (
    <div className="sales-user">
      {showFormationChecklist ? (
        <a
          className="btn ghost"
          href={VC_FORMATION_CHECKLIST_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          VC Formation Checklist
        </a>
      ) : null}
      <button
        type="button"
        className="btn ghost sales-create-ticket"
        onClick={() => openCreateTicket()}
      >
        Create ticket
      </button>
      <button
        type="button"
        className="btn primary sales-add-todo"
        onClick={() => openAddTodo()}
      >
        Add To Do
      </button>
      <span className="sales-user-name">{salesUser.full_name || salesUser.email}</span>
      <button type="button" className="btn ghost" onClick={() => void onSignOut()}>
        Sign out
      </button>
      {unreadTickets > 0 ? (
        <span className="sales-ticket-unread-pill" title="Unread ticket updates">
          {unreadTickets}
        </span>
      ) : null}
    </div>
  );
}

export function SalesLayout({ salesUser }: Props) {
  const location = useLocation();
  const [navOpen, setNavOpen] = useState(false);
  const [unreadTickets, setUnreadTickets] = useState(0);
  useWorkDesktopAlerts(salesUser);
  useTeamsChatDesktopAlerts(salesUser);
  useMailDesktopAlerts(salesUser);
  const activeSlug = activePortalForPath(
    location.pathname,
    location.search,
    salesUser,
  );
  const activeDef = activeSlug ? getPortalDefinition(activeSlug) : undefined;
  const navItems = activeDef?.nav ?? [];
  const onToday = location.pathname.startsWith('/sales/today');
  const onThinkTank = location.pathname.startsWith('/sales/think-tank');
  const onCalendar = location.pathname.startsWith('/sales/calendar');
  const onTodo =
    location.pathname.startsWith('/sales/todo') ||
    location.pathname.startsWith('/sales/to-do');
  const onPlanner = location.pathname.startsWith('/sales/planner');
  const onChat = location.pathname.startsWith('/sales/chat');
  const onMeetings = location.pathname.startsWith('/sales/meetings');
  const onFiles = location.pathname.startsWith('/sales/files');
  const onMail = location.pathname.startsWith('/sales/mail');
  const onTickets = location.pathname.startsWith('/sales/tickets');
  const onAppSurface =
    onToday ||
    onThinkTank ||
    onCalendar ||
    onTodo ||
    onPlanner ||
    onChat ||
    onMeetings ||
    onFiles ||
    onMail ||
    onTickets;
  // Use `/sales/admin/` (trailing slash) so `/sales/administrative` is not treated as admin.
  const onPicker =
    location.pathname === '/sales' ||
    location.pathname === '/sales/' ||
    location.pathname === '/sales/admin' ||
    location.pathname.startsWith('/sales/admin/');
  const showBackToPortals = !onPicker;

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        const n = await countMyUnread(salesUser.id);
        if (mounted) setUnreadTickets(n);
      } catch {
        if (mounted) setUnreadTickets(0);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [salesUser.id, location.pathname]);

  const brandSub =
    activeDef?.name ??
    (onToday
      ? 'Today'
      : onThinkTank
        ? 'Think Tank'
        : onCalendar
          ? 'Calendar'
          : onTodo
            ? 'To Do'
            : onPlanner
              ? 'Planner'
              : onChat
                ? 'Teams chat'
                : onMeetings
                  ? 'Teams Meetings'
                  : onFiles
                    ? 'Files'
                    : onMail
                      ? 'Email'
                      : onTickets
                        ? 'Tickets'
                        : onPicker
                          ? 'Portals'
                          : 'Workspace');

  return (
    <AddTodoProvider salesUser={salesUser}>
      <CreateTicketProvider salesUser={salesUser}>
        <div className={`sales-shell${onAppSurface ? ' sales-shell--app' : ''}`}>
          <AuditTracker salesUser={salesUser} />
          <header className="sales-header">
            <Link to="/sales" className="sales-brand">
              <div className="sales-mark">T</div>
              <div>
                <div className="sales-brand-name">Tage Venture Capital</div>
                <div className="sales-brand-sub">{brandSub}</div>
              </div>
            </Link>
            <button
              type="button"
              className="sales-nav-toggle"
              aria-expanded={navOpen}
              aria-controls="sales-nav"
              onClick={() => setNavOpen((o) => !o)}
            >
              {navOpen ? 'Close' : 'Menu'}
            </button>
            <nav id="sales-nav" className={`sales-nav${navOpen ? ' open' : ''}`}>
              {showBackToPortals ? (
                <Link to="/sales" className="sales-nav-switch">
                  ← Portals
                </Link>
              ) : null}
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end === true || item.to === '/sales/content'}
                  className={({ isActive }) => {
                    if (item.end === true || item.to === '/sales/content') {
                      return isActive ? 'active' : '';
                    }
                    const prefix = item.matchPrefix ?? item.to;
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
                to="/sales/today"
                className={({ isActive }) => (isActive || onToday ? 'active' : '')}
              >
                Today
              </NavLink>
              <NavLink
                to="/sales/think-tank"
                className={({ isActive }) => (isActive || onThinkTank ? 'active' : '')}
              >
                Think Tank
              </NavLink>
              <NavLink
                to="/sales/mail"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Email
              </NavLink>
              <NavLink
                to="/sales/calendar"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Calendar
              </NavLink>
              <NavLink
                to="/sales/todo"
                className={({ isActive }) => (isActive || onTodo ? 'active' : '')}
              >
                To Do
              </NavLink>
              <NavLink
                to="/sales/tickets"
                className={({ isActive }) => (isActive || onTickets ? 'active' : '')}
              >
                My tickets
                {unreadTickets > 0 ? (
                  <span className="nav-badge">{unreadTickets}</span>
                ) : null}
              </NavLink>
              <NavLink
                to="/sales/planner"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Planner
              </NavLink>
              <NavLink
                to="/sales/chat"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Chat
              </NavLink>
              <NavLink
                to="/sales/meetings"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Teams Meetings
              </NavLink>
              <NavLink
                to="/sales/files"
                className={({ isActive }) => (isActive ? 'active' : '')}
              >
                Files
              </NavLink>
              {salesUser.role === 'admin' && onPicker ? (
                <>
                  <NavLink
                    to="/sales/admin/tickets"
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    Ticket inbox
                  </NavLink>
                  <NavLink
                    to="/sales/admin/email"
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    Email Analytics
                  </NavLink>
                  <NavLink
                    to="/sales/admin/portals"
                    className={({ isActive }) => (isActive ? 'active' : '')}
                  >
                    Assignments
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
            <SalesHeaderActions
              salesUser={salesUser}
              unreadTickets={unreadTickets}
              showFormationChecklist={salesUser.role === 'admin' && onPicker}
            />
          </header>
          <main className="sales-main">
            <Outlet />
          </main>
          <RingCentralWidget salesUser={salesUser} />
        </div>
      </CreateTicketProvider>
    </AddTodoProvider>
  );
}
