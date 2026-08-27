import { redirect } from 'next/navigation';
import { after } from 'next/server';
import { Suspense } from 'react';
import { AppSidebar } from '@/components/layout/app-sidebar';
import { EntityOsBanner } from '@/components/layout/entity-os-banner';
import { ImpersonationBanner } from '@/components/layout/impersonation-banner';
import { LiveLookBanner } from '@/components/layout/live-look-banner';
import { MobileNavDrawer } from '@/components/layout/mobile-nav-drawer';
import { TimezoneBootstrap } from '@/components/layout/timezone-bootstrap';
import { HelpDeskShell, AppTopBar } from '@/components/help-desk/help-desk-shell';
import { AppShellScrollLock } from '@/components/layout/app-shell-scroll-lock';
import { AppMain } from '@/components/layout/app-main';
import { MessagePresenceHost } from '@/components/messaging/message-presence-host';
import { CmdKPalette } from '@/components/crm/cmd-k';
import { bootstrapDomainStores } from '@/lib/data/bootstrap';
import {
  canSwitchEntityOs,
  entityOsLabel,
  listEntityOsOptions,
} from '@/lib/rbac/entity-os';
import { listRoleSwitcherRoles } from '@/lib/rbac/impersonation';
import { getSessionContext } from '@/lib/rbac/session';
import { countMyUnreadNotifications } from '@/lib/data/activity';
import { countPendingSuggestions } from '@/lib/spine/db/crud';
import { getActiveOrgSlug } from '@/lib/spine/auth/active-org-server';
import { getDesktopPrefsAction } from '@/app/(app)/notifications/inbox-actions';

export const dynamic = 'force-dynamic';

async function AppChromeTopBar({
  mobileNav,
}: {
  mobileNav: React.ReactNode;
}) {
  const [unread, desktopPrefs, suggestionCount, activeOrgSlug] =
    await Promise.all([
      countMyUnreadNotifications(),
      getDesktopPrefsAction(),
      countPendingSuggestions(),
      getActiveOrgSlug(),
    ]);
  return (
    <AppTopBar
      unreadCount={unread}
      suggestionCount={suggestionCount}
      activeOrgSlug={activeOrgSlug}
      desktopEnabled={desktopPrefs.desktopEnabled}
      soundEnabled={desktopPrefs.soundEnabled}
      mobileNav={mobileNav}
    />
  );
}

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

  // Warm in-memory stores after the shell paints. Pages that read a store
  // hydrate that collection on first use (see pipeline-scope).
  after(() => {
    void bootstrapDomainStores();
  });

  const canImpersonate = session.realRole === 'visionary';
  const canSwitchOs = canSwitchEntityOs({
    realRole: session.realRole,
    impersonatingAs: session.impersonatingAs,
    liveLookActive: session.liveLookActive,
  });

  const sidebarProps = {
    role: session.profile.role,
    realRole: session.realRole,
    fullName: session.profile.full_name,
    email: session.profile.email,
    jobTitle: session.profile.job_title ?? null,
    impersonatingAs: session.impersonatingAs,
    impersonatableRoles: canImpersonate ? listRoleSwitcherRoles() : [],
    liveLookActive: session.liveLookActive,
    entityId: session.profile.entity_id,
    entityOsOptions: canSwitchOs ? listEntityOsOptions() : [],
    activeEntityOs: session.activeEntityOs,
    canSwitchEntityOs: canSwitchOs,
  };

  return (
    <HelpDeskShell>
      {/*
        Viewport-locked shell: sidebar stays pinned on md+; only <main> scrolls.
        Below md the sidebar collapses into AppTopBar MobileNavDrawer.
        max-h + overflow-hidden prevent document scroll on long SSC lists.
      */}
      <div className="flex h-dvh max-h-dvh min-h-0 overflow-hidden bg-background">
        <AppShellScrollLock />
        <TimezoneBootstrap />
        <AppSidebar {...sidebarProps} />
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <Suspense
            fallback={
              <AppTopBar
                mobileNav={
                  <MobileNavDrawer>
                    <AppSidebar {...sidebarProps} variant="panel" />
                  </MobileNavDrawer>
                }
              />
            }
          >
            <AppChromeTopBar
              mobileNav={
                <MobileNavDrawer>
                  <AppSidebar {...sidebarProps} variant="panel" />
                </MobileNavDrawer>
              }
            />
          </Suspense>
          {session.liveLookTarget ? (
            <LiveLookBanner
              userName={session.liveLookTarget.fullName}
              userEmail={session.liveLookTarget.email}
              entityId={session.liveLookTarget.entityId}
            />
          ) : session.impersonatingAs ? (
            <ImpersonationBanner role={session.impersonatingAs} />
          ) : session.activeEntityOs ? (
            <EntityOsBanner label={entityOsLabel(session.activeEntityOs)} />
          ) : null}
          <AppMain>{children}</AppMain>
        </div>
        <Suspense fallback={null}>
          <MessagePresenceHost />
        </Suspense>
        <CmdKPalette />
      </div>
    </HelpDeskShell>
  );
}
