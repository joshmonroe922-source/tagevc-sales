import { sendPlatformEmail } from '@/lib/platform-email/send';
import type { Ticket } from '@/lib/types';

export const TECH_SUPPORT_TICKET_EMAIL = 'techsupport@tagevc.com';

const TAGE_TICKETS_BASE = 'https://app.tagevc.com/shared-services/tickets';

export function buildNewTicketNotice(ticket: Pick<
  Ticket,
  | 'ticket_id'
  | 'title'
  | 'description'
  | 'desired_outcome'
  | 'service'
  | 'priority'
  | 'requester_name'
  | 'company_name'
  | 'entity_id'
  | 'links'
  | 'source_system'
  | 'source_ref'
>) {
  const href = `${TAGE_TICKETS_BASE}/${encodeURIComponent(ticket.ticket_id)}`;
  const lines = [
    `Ticket: ${ticket.ticket_id}`,
    `Title: ${ticket.title}`,
    `Company: ${ticket.company_name ?? '—'}`,
    `Entity: ${ticket.entity_id ?? '—'}`,
    `Service: ${ticket.service}`,
    `Priority: ${ticket.priority}`,
    `Requester: ${ticket.requester_name ?? '—'}`,
    ticket.source_system ? `Source: ${ticket.source_system}` : null,
    ticket.source_ref ? `Source ref: ${ticket.source_ref}` : null,
    '',
    ticket.description?.trim() || '(no description)',
    ticket.desired_outcome?.trim()
      ? `\nDesired outcome:\n${ticket.desired_outcome.trim()}`
      : null,
    ticket.links?.trim() ? `\nLinks:\n${ticket.links.trim()}` : null,
    '',
    `Open: ${href}`,
  ].filter((line) => line !== null);

  const text = lines.join('\n');
  return {
    to: TECH_SUPPORT_TICKET_EMAIL,
    subject: `[${ticket.priority}] ${ticket.ticket_id} · ${ticket.title}`,
    text,
    html: text
      .split('\n')
      .map((line) => {
        const escaped = line
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;');
        if (line.startsWith('Open: ')) {
          return `<p><a href="${href}">${escaped}</a></p>`;
        }
        return `<p>${escaped || '<br/>'}</p>`;
      })
      .join(''),
    href,
  };
}

/** Fail-soft copy of every new Help Desk ticket to tech support. */
export async function notifyTechSupportOfNewTicket(
  ticket: Ticket,
): Promise<void> {
  if (process.env.NODE_ENV === 'test') return;

  const notice = buildNewTicketNotice(ticket);
  const result = await sendPlatformEmail({
    channel: 'system',
    entityId: ticket.entity_id ?? 'ENT-FIRM',
    to: [notice.to],
    subject: notice.subject,
    bodyHtml: notice.html,
    bodyText: notice.text,
    source: 'system',
    track: false,
    activityModule: 'shared_services',
    refType: 'ticket',
    refId: ticket.ticket_id,
    tags: { kind: 'help_desk_ticket_notice' },
  });
  if (!result.ok) {
    console.warn('[ticket-notice] email skipped:', result.error);
  }
}
