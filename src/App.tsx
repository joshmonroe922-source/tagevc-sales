import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { RequirePortal } from './components/RequirePortal';
import { SalesLayout } from './components/SalesLayout';
import { logAuditEvent } from './lib/audit';
import { fetchSalesUser, signOut } from './lib/auth';
import { postAuthHomePath } from './lib/portals';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { SalesUser } from './lib/types';
import { AdminAuditPage } from './pages/AdminAuditPage';
import { AdminEmailPage } from './pages/AdminEmailPage';
import { AdminPortalsPage } from './pages/AdminPortalsPage';
import { AccountDetailPage } from './pages/AccountDetailPage';
import { AccountsPage } from './pages/AccountsPage';
import { AutomationPage } from './pages/AutomationPage';
import { BlogEditorPage } from './pages/BlogEditorPage';
import { BlogPage } from './pages/BlogPage';
import { CalendarPage } from './pages/CalendarPage';
import { ContactDetailPage } from './pages/ContactDetailPage';
import { ContactsPage } from './pages/ContactsPage';
import { ContentHubPage } from './pages/ContentHubPage';
import { DueDiligencePortalPage } from './pages/DueDiligencePortalPage';
import { EntityDetailPage } from './pages/EntityDetailPage';
import { EntityNewPage } from './pages/EntityNewPage';
import { EntityLeadershipPage } from './pages/EntityLeadershipPage';
import { EntityThinkTankPage } from './pages/EntityThinkTankPage';
import { ThinkTankPage } from './pages/ThinkTankPage';
import { EntityFinancialPage } from './pages/EntityFinancialPage';
import { EntityKpisPage } from './pages/EntityKpisPage';
import { EntityPlatformPage } from './pages/EntityPlatformPage';
import { Recruit619ManagersPage } from './pages/Recruit619ManagersPage';
import { Recruit619RecruitersPage } from './pages/Recruit619RecruitersPage';
import { FilesPage } from './pages/FilesPage';
import { FinanceClosePage } from './pages/FinanceClosePage';
import { FinanceControlsPage } from './pages/FinanceControlsPage';
import { FinanceOverviewPage } from './pages/FinanceOverviewPage';
import { FinanceTasksPage } from './pages/FinanceTasksPage';
import { HrChecklistPage } from './pages/HrChecklistPage';
import { HrCompliancePage } from './pages/HrCompliancePage';
import { HrEmployeeDetailPage } from './pages/HrEmployeeDetailPage';
import { HrEmployeesPage } from './pages/HrEmployeesPage';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { LeadsPage } from './pages/LeadsPage';
import { LegalCompliancePage } from './pages/LegalCompliancePage';
import { LegalContractsPage } from './pages/LegalContractsPage';
import { LegalControlsPage } from './pages/LegalControlsPage';
import { LegalOverviewPage } from './pages/LegalOverviewPage';
import { LegalRaNoticesPage } from './pages/LegalRaNoticesPage';
import { LegalTasksPage } from './pages/LegalTasksPage';
import { LoginPage } from './pages/LoginPage';
import { OpsHubPage } from './pages/OpsHubPage';
import { OnboardingPortalPage } from './pages/OnboardingPortalPage';
import { PlannerPage } from './pages/PlannerPage';
import { PortalPickerPage } from './pages/PortalPickerPage';
import { PortalStubPage } from './pages/PortalStubPage';
import { ReportsPage } from './pages/ReportsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SocialPage } from './pages/SocialPage';
import { TasksPage } from './pages/TasksPage';
import { TeamsChatPage } from './pages/TeamsChatPage';
import { TodoPage } from './pages/TodoPage';
import { MeetingsPage } from './pages/MeetingsPage';
import { MailPage } from './pages/MailPage';
import { MarketingControlsPage } from './pages/MarketingControlsPage';
import { MarketingOverviewPage } from './pages/MarketingOverviewPage';
import { MarketingTasksPage } from './pages/MarketingTasksPage';
import { TechnologyControlsPage } from './pages/TechnologyControlsPage';
import { TechnologyOverviewPage } from './pages/TechnologyOverviewPage';
import { TechnologyTasksPage } from './pages/TechnologyTasksPage';
import { AdministrativeOverviewPage } from './pages/AdministrativeOverviewPage';
import { AdministrativeStubSectionPage } from './pages/AdministrativeStubSectionPage';
import { TicketDetailPage } from './pages/TicketDetailPage';
import { TicketsPage } from './pages/TicketsPage';
import { TodayPage } from './pages/TodayPage';

type AuthState = 'loading' | 'guest' | 'authorized' | 'forbidden';

/** Old flat sales-app paths → Deal Sourcing portal. */
function RedirectLegacyLead() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/sales/deal-sourcing/leads/${id}`} replace />;
}

function Protected({
  authState,
  salesUser,
  forbiddenMessage,
}: {
  authState: AuthState;
  salesUser: SalesUser | null;
  forbiddenMessage: string | null;
}) {
  const location = useLocation();

  if (authState === 'loading') {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }

  if (authState !== 'authorized' || !salesUser) {
    return (
      <LoginPage
        forbiddenMessage={
          authState === 'forbidden'
            ? forbiddenMessage
            : !supabaseConfigured
              ? 'Supabase env vars missing — see README.'
              : null
        }
      />
    );
  }

  if (!location.pathname.startsWith('/sales')) {
    return <Navigate to="/sales" replace />;
  }

  const fallbackHome = postAuthHomePath(salesUser);

  return (
    <RequirePortal salesUser={salesUser}>
      <Routes>
        <Route element={<SalesLayout salesUser={salesUser} />}>
          <Route path="/sales" element={<PortalPickerPage salesUser={salesUser} />} />
          <Route path="/sales/admin/portals" element={<AdminPortalsPage salesUser={salesUser} />} />
          <Route path="/sales/admin/audit" element={<AdminAuditPage salesUser={salesUser} />} />
          <Route path="/sales/admin/email" element={<AdminEmailPage salesUser={salesUser} />} />
          {/* Global tools — all authenticated portal users (not portal-gated) */}
          <Route path="/sales/today" element={<TodayPage salesUser={salesUser} />} />
          <Route path="/sales/think-tank" element={<ThinkTankPage salesUser={salesUser} />} />
          <Route path="/sales/calendar" element={<CalendarPage salesUser={salesUser} />} />
          <Route path="/sales/todo" element={<TodoPage salesUser={salesUser} />} />
          <Route path="/sales/to-do" element={<Navigate to="/sales/todo" replace />} />
          <Route path="/sales/planner" element={<PlannerPage salesUser={salesUser} />} />
          <Route path="/sales/chat" element={<TeamsChatPage salesUser={salesUser} />} />
          <Route path="/sales/meetings" element={<MeetingsPage salesUser={salesUser} />} />
          <Route path="/sales/files" element={<FilesPage salesUser={salesUser} />} />
          <Route path="/sales/mail" element={<MailPage salesUser={salesUser} />} />
          <Route
            path="/sales/tickets"
            element={<TicketsPage salesUser={salesUser} mode="mine" />}
          />
          <Route
            path="/sales/tickets/:id"
            element={<TicketDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/admin/tickets"
            element={
              salesUser.role === 'admin' ? (
                <TicketsPage salesUser={salesUser} mode="admin-all" />
              ) : (
                <TicketsPage
                  salesUser={salesUser}
                  mode="queue"
                  category="admin"
                  title="General / Admin tickets"
                />
              )
            }
          />
          <Route path="/sales/portals/:slug" element={<PortalStubPage salesUser={salesUser} />} />

          {/* Deal Sourcing (former standalone sales platform) */}
          <Route
            path="/sales/deal-sourcing"
            element={<Navigate to="/sales/deal-sourcing/leads" replace />}
          />
          <Route
            path="/sales/deal-sourcing/leads"
            element={<LeadsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/leads/:id"
            element={<LeadDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/accounts"
            element={<AccountsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/accounts/:id"
            element={<AccountDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/contacts"
            element={<ContactsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/contacts/:id"
            element={<ContactDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/deal-sourcing/tasks"
            element={<TasksPage salesUser={salesUser} />}
          />
          <Route path="/sales/deal-sourcing/automation" element={<AutomationPage />} />

          {/* Legacy sales-app URLs */}
          <Route
            path="/sales/leads"
            element={<Navigate to="/sales/deal-sourcing/leads" replace />}
          />
          <Route path="/sales/leads/:id" element={<RedirectLegacyLead />} />
          <Route
            path="/sales/tasks"
            element={<Navigate to="/sales/deal-sourcing/tasks" replace />}
          />
          <Route
            path="/sales/automation"
            element={<Navigate to="/sales/deal-sourcing/automation" replace />}
          />

          <Route path="/sales/ops" element={<OpsHubPage />} />
          <Route path="/sales/ops/entities/new" element={<EntityNewPage salesUser={salesUser} />} />
          <Route
            path="/sales/ops/entities/:id/leadership"
            element={<EntityLeadershipPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/think-tank"
            element={<EntityThinkTankPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/financial"
            element={<EntityFinancialPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/kpis"
            element={<EntityKpisPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/platform"
            element={<EntityPlatformPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/recruiters"
            element={<Recruit619RecruitersPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id/managers"
            element={<Recruit619ManagersPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/ops/entities/:id"
            element={<EntityDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal"
            element={<LegalOverviewPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/controls"
            element={<LegalControlsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/tasks"
            element={<LegalTasksPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/filings"
            element={<LegalCompliancePage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/contracts"
            element={<LegalContractsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/ra-notices"
            element={<LegalRaNoticesPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/legal/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="legal"
              />
            }
          />
          <Route
            path="/sales/finance"
            element={<FinanceOverviewPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/finance/controls"
            element={<FinanceControlsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/finance/month-end"
            element={<FinanceClosePage salesUser={salesUser} periodType="month" />}
          />
          <Route
            path="/sales/finance/year-end"
            element={<FinanceClosePage salesUser={salesUser} periodType="year" />}
          />
          <Route
            path="/sales/finance/tasks"
            element={<FinanceTasksPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/finance/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="accounting-finance"
              />
            }
          />
          <Route path="/sales/hr" element={<Navigate to="/sales/hr/employees" replace />} />
          <Route
            path="/sales/hr/employees"
            element={<HrEmployeesPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/hr/employees/:id"
            element={<HrEmployeeDetailPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/hr/talent-acquisition"
            element={
              <HrChecklistPage salesUser={salesUser} kind="talent_acquisition" />
            }
          />
          <Route
            path="/sales/hr/onboarding"
            element={<HrChecklistPage salesUser={salesUser} kind="onboarding" />}
          />
          <Route
            path="/sales/hr/offboarding"
            element={<HrChecklistPage salesUser={salesUser} kind="offboarding" />}
          />
          <Route
            path="/sales/hr/compliance"
            element={<HrCompliancePage salesUser={salesUser} />}
          />
          <Route
            path="/sales/hr/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="human-resources"
              />
            }
          />
          <Route
            path="/sales/new-start-up"
            element={<OnboardingPortalPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/due-diligence"
            element={<DueDiligencePortalPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/new-acquisition"
            element={<OnboardingPortalPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/marketing"
            element={<MarketingOverviewPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/marketing/controls"
            element={<MarketingControlsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/marketing/tasks"
            element={<MarketingTasksPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/marketing/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="marketing"
              />
            }
          />
          <Route
            path="/sales/portals/marketing"
            element={<Navigate to="/sales/marketing" replace />}
          />
          <Route
            path="/sales/technology"
            element={<TechnologyOverviewPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/technology/controls"
            element={<TechnologyControlsPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/technology/tasks"
            element={<TechnologyTasksPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/technology/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="technology"
              />
            }
          />
          <Route
            path="/sales/portals/technology"
            element={<Navigate to="/sales/technology" replace />}
          />
          <Route
            path="/sales/administrative"
            element={<AdministrativeOverviewPage salesUser={salesUser} />}
          />
          <Route
            path="/sales/administrative/controls"
            element={
              <AdministrativeStubSectionPage salesUser={salesUser} section="controls" />
            }
          />
          <Route
            path="/sales/administrative/tasks"
            element={
              <AdministrativeStubSectionPage salesUser={salesUser} section="tasks" />
            }
          />
          <Route
            path="/sales/administrative/tickets"
            element={
              <TicketsPage
                salesUser={salesUser}
                mode="queue"
                category="admin"
                title="Administrative tickets"
              />
            }
          />
          <Route
            path="/sales/portals/administrative"
            element={<Navigate to="/sales/administrative" replace />}
          />
          <Route path="/sales/content" element={<ContentHubPage />} />
          <Route path="/sales/content/blog" element={<BlogPage salesUser={salesUser} />} />
          <Route path="/sales/content/blog/:id" element={<BlogEditorPage />} />
          <Route path="/sales/content/social" element={<SocialPage salesUser={salesUser} />} />
          <Route path="/sales/reports" element={<ReportsPage />} />
          <Route path="*" element={<Navigate to={fallbackHome} replace />} />
        </Route>
      </Routes>
    </RequirePortal>
  );
}

export default function App() {
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [salesUser, setSalesUser] = useState<SalesUser | null>(null);
  const [forbiddenMessage, setForbiddenMessage] = useState<string | null>(null);

  const resolveAuth = useCallback(async (session: Session | null) => {
    if (!session?.user.email) {
      setSalesUser(null);
      setAuthState('guest');
      return;
    }

    // Password recovery must keep the session so updateUser can run on /sales/reset-password.
    // Do not sign the user out for allowlist checks until after they leave that flow.
    if (window.location.pathname.startsWith('/sales/reset-password')) {
      setSalesUser(null);
      setAuthState('guest');
      return;
    }

    const user = await fetchSalesUser(session);
    if (!user) {
      await signOut();
      setSalesUser(null);
      setForbiddenMessage(
        'Your account is not authorized. Add your email to sales_users (see README seed notes).',
      );
      setAuthState('forbidden');
      return;
    }

    setForbiddenMessage(null);
    setSalesUser(user);
    setAuthState('authorized');
  }, []);

  useEffect(() => {
    if (!supabase) {
      setAuthState('guest');
      return;
    }

    let mounted = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      void resolveAuth(data.session);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user?.email) {
        const key = `audit_login_${session.user.id}`;
        try {
          if (!sessionStorage.getItem(key)) {
            sessionStorage.setItem(key, '1');
            void logAuditEvent({
              eventType: 'login',
              email: session.user.email,
              path: window.location.pathname,
              metadata: { auth_event: event },
            });
          }
        } catch {
          void logAuditEvent({
            eventType: 'login',
            email: session.user.email,
            path: window.location.pathname,
            metadata: { auth_event: event },
          });
        }
      }
      if (event === 'SIGNED_OUT' && session === null) {
        try {
          for (const k of Object.keys(sessionStorage)) {
            if (k.startsWith('audit_login_')) sessionStorage.removeItem(k);
          }
        } catch {
          /* ignore */
        }
      }
      void resolveAuth(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveAuth]);

  return (
    <Routes>
      <Route path="/sales/reset-password" element={<ResetPasswordPage />} />
      <Route
        path="*"
        element={
          <Protected
            authState={authState}
            salesUser={salesUser}
            forbiddenMessage={forbiddenMessage}
          />
        }
      />
    </Routes>
  );
}
