'use client';

/**
 * Portable AppTopBar — Menu (phone) + Alerts + Create Ticket split (Tage pattern).
 * Copy into subsidiary `help-desk-shell.tsx`. Pass portal-specific Alerts
 * and Create Ticket controls as children or swap the imports.
 *
 * Phone (< md): pass `mobileNav` = MobileNavDrawer wrapping AppSidebar variant="panel".
 * Visual order: Create Ticket | Alerts | Menu (Menu far right) via order-*.
 * Desktop (md+): Alerts | Create Ticket; leave mobileNav; keep sticky left AppSidebar.
 */
import type { ReactNode } from 'react';

export function AppTopBarShell({
  alerts,
  createTicket,
  mobileNav,
}: {
  alerts: ReactNode;
  createTicket: ReactNode;
  /** Phone-only Menu drawer (`md:hidden`). */
  mobileNav?: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
      {mobileNav ? <div className="order-3 md:order-1">{mobileNav}</div> : null}
      <div className="order-2 md:order-2">{alerts}</div>
      <div className="order-1 md:order-3">{createTicket}</div>
    </div>
  );
}
