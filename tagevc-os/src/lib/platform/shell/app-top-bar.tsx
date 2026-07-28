'use client';

/**
 * Portable AppTopBar — Alerts + Create Ticket split (Tage pattern).
 * Copy into subsidiary `help-desk-shell.tsx`. Pass portal-specific Alerts
 * and Create Ticket controls as children or swap the imports.
 */
import type { ReactNode } from 'react';

export function AppTopBarShell({
  alerts,
  createTicket,
}: {
  alerts: ReactNode;
  createTicket: ReactNode;
}) {
  return (
    <div className="flex h-12 shrink-0 items-center justify-end gap-2 border-b border-border bg-background/90 px-4 backdrop-blur">
      {alerts}
      {createTicket}
    </div>
  );
}
