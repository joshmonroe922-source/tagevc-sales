import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { ImpersonationBanner } from '@/components/layout/impersonation-banner';
import { TimezoneBootstrap } from '@/components/layout/timezone-bootstrap';
import { MessagePresenceHost } from '@/components/messaging/message-presence-host';
import { bootstrapDomainStores } from '@/lib/data/bootstrap';
import { listImpersonatableRoles } from '@/lib/rbac/impersonation';
import { getSessionContext } from '@/lib/rbac/session';

export const dynamic = 'force-dynamic';

export default async function AppShellLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSessionContext();
  if (!session) redirect('/login');
  if (!session.profile.active) {
    redirect('/login?error=auth&detail=Account%20inactive');
  }

  await bootstrapDomainStores();

  const canImpersonate = session.realRole === 'visionary';

  return (
    <div className="flex h-svh overflow-hidden bg-background">
      <TimezoneBootstrap />
      <AppSidebar
        role={session.profile.role}
        realRole={session.realRole}
        fullName={session.profile.full_name}
        email={session.profile.email}
        impersonatingAs={session.impersonatingAs}
        impersonatableRoles={canImpersonate ? listImpersonatableRoles() : []}
      />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {session.impersonatingAs ? (
          <ImpersonationBanner role={session.impersonatingAs} />
        ) : null}
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">{children}</div>
        </main>
      </div>
      <Suspense fallback={null}>
        <MessagePresenceHost />
      </Suspense>
    </div>
  );
}
