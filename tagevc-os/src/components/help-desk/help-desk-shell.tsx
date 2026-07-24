'use client';

import {
  CreateTicketModalProvider,
  GlobalCreateTicketButton,
} from '@/components/help-desk/create-ticket-modal';

export function AppTopBar() {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
      <GlobalCreateTicketButton />
    </div>
  );
}

/** Provides Create Ticket modal context for the whole app shell. */
export function HelpDeskShell({ children }: { children: React.ReactNode }) {
  return <CreateTicketModalProvider>{children}</CreateTicketModalProvider>;
}
