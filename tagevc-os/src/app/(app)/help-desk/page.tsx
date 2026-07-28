import Link from 'next/link';
import { HelpDeskClient } from '@/components/help-desk/help-desk-client';
import { listScopedTickets } from '@/lib/data/pipeline-scope';
import { entityDisplayName } from '@/lib/entities/display-name';
import { isHelpDeskTicket } from '@/lib/help-desk/ticket-scope';
import { getSessionContext } from '@/lib/rbac/session';
import { classifyTicketSla } from '@/lib/shared-services/shared-services-inbox-phase54';
import { dueStatusLabel } from '@/lib/shared-services/due-status';

const ARCHIVE_DAYS = 30;

export default async function HelpDeskPage() {
  const session = await getSessionContext();
  const tickets = await listScopedTickets().catch(() => []);
  const cutoff = Date.now() - ARCHIVE_DAYS * 24 * 60 * 60 * 1000;

  // Help Desk = requester / portal tickets only (no SSC checklist, HRIS, AI doc work).
  const helpDeskOnly = tickets.filter(isHelpDeskTicket);

  const mine = helpDeskOnly.filter((t) => {
    const requester = (t.requester_name ?? '').toLowerCase();
    const me =
      (session?.profile.full_name ?? '').toLowerCase() ||
      (session?.profile.email ?? '').toLowerCase();
    if (me && requester && requester.includes(me.split('@')[0] ?? me)) {
      return true;
    }
    // Firm-wide viewers still see recent scoped help-desk tickets; personal filter soft
    return true;
  });

  const active = mine.filter((t) => {
    const created = Date.parse(t.created_at ?? '') || 0;
    const closed =
      t.status === 'Closed' || t.status === 'Resolved'
        ? Date.parse(t.updated_at ?? t.created_at ?? '') || created
        : 0;
    if (closed && closed < cutoff) return false;
    if (!closed && created && created < cutoff && t.status === 'Closed') {
      return false;
    }
    // Archive closed tickets older than 30 days off the default list
    if (
      (t.status === 'Closed' || t.status === 'Resolved') &&
      created > 0 &&
      created < cutoff
    ) {
      return false;
    }
    return true;
  });

  const rows = active
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, 100)
    .map((t) => ({
      ticket_id: t.ticket_id,
      title: t.title,
      service: t.service,
      priority: t.priority,
      status: t.status,
      company: entityDisplayName({
        company_name: t.company_name,
        entity_id: t.entity_id,
      }),
      due_status: dueStatusLabel(classifyTicketSla(t)),
      created_at: t.created_at,
      href: `/shared-services/tickets/${t.ticket_id}`,
    }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="text-xs font-medium tracking-[0.2em] text-muted-foreground uppercase">
          Help Desk
        </p>
        <h1 className="font-heading text-3xl font-semibold tracking-tight text-[#3a414f]">
          Help Desk
        </h1>
        <p className="max-w-2xl text-sm text-muted-foreground">
          Requester tickets only — Create Ticket and subsidiary portal intake.
          SSC checklist work and pipeline follow-ups live on{' '}
          <Link href="/to-do" className="underline underline-offset-2">
            To Do List
          </Link>
          . Closed tickets older than {ARCHIVE_DAYS} days are archived off this
          list. Full service inbox:{' '}
          <Link href="/shared-services" className="underline underline-offset-2">
            Shared Services
          </Link>
          .
        </p>
      </header>

      <HelpDeskClient tickets={rows} />
    </div>
  );
}
