'use client';

import type { ReactNode } from 'react';

import {
  CreateTicketModalProvider,
  GlobalCreateTicketButton,
} from '@/components/help-desk/create-ticket-modal';
import { NotificationsBell } from '@/components/layout/notifications-bell';
import { SuggestionBell } from '@/components/crm/suggestion-bell';
import { AppTopBarShell } from '@/lib/platform/shell/app-top-bar';

export function AppTopBar({
  unreadCount = 0,
  desktopEnabled = false,
  soundEnabled = false,
  mobileNav,
  suggestionCount = 0,
}: {
  unreadCount?: number;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
  /** Phone Menu drawer (md:hidden). Desktop keeps the left sidebar. */
  mobileNav?: ReactNode;
  suggestionCount?: number;
}) {
  return (
    <AppTopBarShell
      mobileNav={mobileNav}
      extras={<SuggestionBell initialCount={suggestionCount} />}
      alerts={
        <NotificationsBell
          initialUnread={unreadCount}
          desktopEnabled={desktopEnabled}
          soundEnabled={soundEnabled}
        />
      }
      createTicket={<GlobalCreateTicketButton />}
    />
  );
}

/** Provides Create Ticket modal context for the whole app shell. */
export function HelpDeskShell({ children }: { children: React.ReactNode }) {
  return <CreateTicketModalProvider>{children}</CreateTicketModalProvider>;
}
