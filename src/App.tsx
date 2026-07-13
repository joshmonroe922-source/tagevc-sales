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
import { AutomationPage } from './pages/AutomationPage';
import { BlogEditorPage } from './pages/BlogEditorPage';
import { BlogPage } from './pages/BlogPage';
import { ContentHubPage } from './pages/ContentHubPage';
import { DueDiligencePortalPage } from './pages/DueDiligencePortalPage';
import { EntityDetailPage } from './pages/EntityDetailPage';
import { EntityNewPage } from './pages/EntityNewPage';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import { OpsHubPage } from './pages/OpsHubPage';
import { OnboardingPortalPage } from './pages/OnboardingPortalPage';
import { PortalPickerPage } from './pages/PortalPickerPage';
import { PortalStubPage } from './pages/PortalStubPage';
import { ReportsPage } from './pages/ReportsPage';
import { ResetPasswordPage } from './pages/ResetPasswordPage';
import { SocialPage } from './pages/SocialPage';
import { TasksPage } from './pages/TasksPage';

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
            path="/sales/ops/entities/:id"
            element={<EntityDetailPage salesUser={salesUser} />}
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
