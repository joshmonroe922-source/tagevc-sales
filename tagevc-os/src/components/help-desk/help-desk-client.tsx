'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { LocalDateTime } from '@/components/ui/local-datetime';
import { EmptyState } from '@/components/ui/empty-state';

export type HelpDeskTicketRow = {
  ticket_id: string;
  title: string;
  service: string;
  priority: string;
  status: string;
  company: string;
  due_status: string;
  created_at: string;
  href: string;
};

export function HelpDeskClient({ tickets }: { tickets: HelpDeskTicketRow[] }) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your tickets</CardTitle>
          <CardDescription>
            Help Desk tickets only — SSC checklist and pipeline tasks stay on To
            Do List. Closed items older than 30 days are archived off this list.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {tickets.length === 0 ? (
            <EmptyState
              title="No open tickets in view"
              description="Create a ticket from any page with the Create Ticket button. SSC and follow-up work is on To Do List."
            />
          ) : (
            tickets.map((t) => (
              <Link
                key={t.ticket_id}
                href={t.href}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-foreground">
                    {t.title}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.company} · {t.service} ·{' '}
                    <LocalDateTime value={t.created_at} variant="date" />
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline">{t.status}</Badge>
                  <Badge variant="secondary">{t.due_status}</Badge>
                  <Badge variant="outline">{t.priority}</Badge>
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
