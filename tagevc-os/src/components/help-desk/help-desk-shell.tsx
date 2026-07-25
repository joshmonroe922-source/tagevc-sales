'use client';

import {
  CreateTicketModalProvider,
  GlobalCreateTicketButton,
} from '@/components/help-desk/create-ticket-modal';
import { NotificationsBell } from '@/components/layout/notifications-bell';

export function AppTopBar({
  unreadCount = 0,
  desktopEnabled = false,
  soundEnabled = false,
}: {
  unreadCount?: number;
  desktopEnabled?: boolean;
  soundEnabled?: boolean;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
      <NotificationsBell
        initialUnread={unreadCount}
        desktopEnabled={desktopEnabled}
        soundEnabled={soundEnabled}
      />
      <GlobalCreateTicketButton />
    </div>
  );
}

/** Provides Create Ticket modal context for the whole app shell. */
export function HelpDeskShell({ children }: { children: React.ReactNode }) {
  return <CreateTicketModalProvider>{children}</CreateTicketModalProvider>;
}
