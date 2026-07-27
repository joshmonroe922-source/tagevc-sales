import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { ImpersonationBanner } from '@/components/layout/impersonation-banner';
import { LiveLookBanner } from '@/components/layout/live-look-banner';
import { TimezoneBootstrap } from '@/components/layout/timezone-bootstrap';
import { HelpDeskShell, AppTopBar } from '@/components/help-desk/help-desk-shell';
import { AppShellScrollLock } from '@/components/layout/app-shell-scroll-lock';
import { MessagePresenceHost } from '@/components/messaging/message-presence-host';
import { bootstrapDomainStores } from '@/lib/data/bootstrap';
import { listRoleSwitcherRoles } from '@/lib/rbac/impersonation';
import { getSessionContext } from '@/lib/rbac/session';
import { countMyUnreadNotifications } from '@/lib/data/activity';
import { getDesktopPrefsAction } from '@/app/(app)/notifications/inbox-actions';

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
  const [unread, desktopPrefs] = await Promise.all([
    countMyUnreadNotifications(),
    getDesktopPrefsAction(),
  ]);

  return (
    <HelpDeskShell>
      {/*
        Viewport-locked shell: sidebar stays pinned; only <main> scrolls.
        max-h + overflow-hidden prevent document scroll on long SSC lists.
      */}
      <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-background">
        <AppShellScrollLock />
        <TimezoneBootstrap />
        <AppSidebar
          role={session.profile.role}
          realRole={session.realRole}
          fullName={session.profile.full_name}
          email={session.profile.email}
          impersonatingAs={session.impersonatingAs}
          impersonatableRoles={canImpersonate ? listRoleSwitcherRoles() : []}
          liveLookActive={session.liveLookActive}
          entityId={session.profile.entity_id}
        />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <AppTopBar
            unreadCount={unread}
            desktopEnabled={desktopPrefs.desktopEnabled}
            soundEnabled={desktopPrefs.soundEnabled}
          />
          {session.liveLookTarget ? (
            <LiveLookBanner
              userName={session.liveLookTarget.fullName}
              userEmail={session.liveLookTarget.email}
              entityId={session.liveLookTarget.entityId}
            />
          ) : session.impersonatingAs ? (
            <ImpersonationBanner role={session.impersonatingAs} />
          ) : null}
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto max-w-6xl px-6 py-8 md:px-10">{children}</div>
          </main>
        </div>
        <Suspense fallback={null}>
          <MessagePresenceHost />
        </Suspense>
      </div>
    </HelpDeskShell>
  );
}
