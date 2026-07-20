import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { ImpersonationBanner } from '@/components/layout/impersonation-banner';
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
    <div className="flex min-h-screen bg-background">
      <AppSidebar
        role={session.profile.role}
        realRole={session.realRole}
        fullName={session.profile.full_name}
        email={session.profile.email}
        impersonatingAs={session.impersonatingAs}
        impersonatableRoles={canImpersonate ? listImpersonatableRoles() : []}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {session.impersonatingAs ? (
          <ImpersonationBanner role={session.impersonatingAs} />
        ) : null}
        <main className="min-w-0 flex-1 overflow-auto">
          <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">{children}</div>
        </main>
      </div>
    </div>
  );
}
