/**
 * Help Desk queue = requester / portal tickets only.
 * SSC checklist work, HRIS cadence, and AI doc follow-ups stay on To Do List
 * or Shared Services — not `/help-desk`.
 */

export const HELP_DESK_SOURCE_REF = 'help_desk';

/** Provenance refs that must never appear on Help Desk. */
export const NON_HELP_DESK_SOURCE_REFS = new Set([
  'ssc_checklist',
  'hris_escalate',
  'ai_document',
]);

export type HelpDeskTicketLike = {
  title: string;
  description?: string | null;
  requester_name?: string | null;
  links?: string | null;
  ai_generated?: boolean;
  source_doc_id?: string | null;
  source_ref?: string | null;
};

function requesterKey(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase();
}

/**
 * True when a ticket belongs on Help Desk (Create Ticket / subsidiary intake).
 * False for SSC overdue escalations, HRIS cadence, AI doc follow-ups, etc.
 */
export function isHelpDeskTicket(ticket: HelpDeskTicketLike): boolean {
  const ref = ticket.source_ref?.trim() || null;
  if (ref === HELP_DESK_SOURCE_REF) return true;
  if (ref && NON_HELP_DESK_SOURCE_REFS.has(ref)) return false;

  const title = ticket.title.trim();
  if (title.startsWith('[SSC overdue]')) return false;
  if (title.startsWith('[HRIS overdue]')) return false;
  if (title.startsWith('[AI]')) return false;

  const requester = requesterKey(ticket.requester_name);
  if (requester === 'ssc automation' || requester === 'hris cadence') {
    return false;
  }

  const links = ticket.links ?? '';
  if (links.includes('/shared-services/checklists')) return false;

  const description = ticket.description ?? '';
  if (
    description.includes(
      'Auto-escalated from Shared Services Center checklist',
    )
  ) {
    return false;
  }

  if (ticket.ai_generated && ticket.source_doc_id) return false;

  return true;
}
