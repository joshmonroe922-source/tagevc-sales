import { useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { SalesLayout } from './components/SalesLayout';
import { fetchSalesUser, signOut } from './lib/auth';
import { supabase, supabaseConfigured } from './lib/supabase';
import type { SalesUser } from './lib/types';
import { AutomationPage } from './pages/AutomationPage';
import { BlogEditorPage } from './pages/BlogEditorPage';
import { BlogPage } from './pages/BlogPage';
import { ContentHubPage } from './pages/ContentHubPage';
import { EntityDetailPage } from './pages/EntityDetailPage';
import { EntityNewPage } from './pages/EntityNewPage';
import { LeadDetailPage } from './pages/LeadDetailPage';
import { LeadsPage } from './pages/LeadsPage';
import { LoginPage } from './pages/LoginPage';
import { OpsHubPage } from './pages/OpsHubPage';
import { ReportsPage } from './pages/ReportsPage';
import { SocialPage } from './pages/SocialPage';
import { TasksPage } from './pages/TasksPage';

type AuthState = 'loading' | 'guest' | 'authorized' | 'forbidden';

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
    return <Navigate to="/sales/leads" replace />;
  }

  return (
    <Routes>
      <Route element={<SalesLayout salesUser={salesUser} />}>
        <Route path="/sales" element={<Navigate to="/sales/leads" replace />} />
        <Route path="/sales/leads" element={<LeadsPage salesUser={salesUser} />} />
        <Route path="/sales/leads/:id" element={<LeadDetailPage salesUser={salesUser} />} />
        <Route path="/sales/ops" element={<OpsHubPage />} />
        <Route path="/sales/ops/entities/new" element={<EntityNewPage salesUser={salesUser} />} />
        <Route
          path="/sales/ops/entities/:id"
          element={<EntityDetailPage salesUser={salesUser} />}
        />
        <Route path="/sales/tasks" element={<TasksPage salesUser={salesUser} />} />
        <Route path="/sales/content" element={<ContentHubPage />} />
        <Route path="/sales/content/blog" element={<BlogPage salesUser={salesUser} />} />
        <Route path="/sales/content/blog/:id" element={<BlogEditorPage />} />
        <Route path="/sales/content/social" element={<SocialPage salesUser={salesUser} />} />
        <Route path="/sales/automation" element={<AutomationPage />} />
        <Route path="/sales/reports" element={<ReportsPage />} />
        <Route path="*" element={<Navigate to="/sales/leads" replace />} />
      </Route>
    </Routes>
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
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void resolveAuth(session);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [resolveAuth]);

  return (
    <Protected
      authState={authState}
      salesUser={salesUser}
      forbiddenMessage={forbiddenMessage}
    />
  );
}
