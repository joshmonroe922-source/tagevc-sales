/**
 * Outstanding SS tickets for a function home (D10).
 */

import type { SsService, Ticket } from '@/lib/types';
import type { SscFunction } from '@/lib/shared-services/ssc-checklist/types';

export const SSC_FUNCTION_TO_SERVICE: Record<SscFunction, SsService> = {
  finance: 'Finance',
  hr: 'HR',
  it: 'IT',
  marketing: 'Marketing',
  legal: 'Legal',
};

export type SscOutstandingTicket = {
  ticket_id: string;
  title: string;
  status: string;
  priority: string;
  entity_id: string | null;
  company_name: string | null;
  href: string;
};

export function filterOutstandingTicketsForFunction(
  tickets: Ticket[],
  functionKey: SscFunction,
  entityId?: string | null,
): SscOutstandingTicket[] {
  const service = SSC_FUNCTION_TO_SERVICE[functionKey];
  return tickets
    .filter((t) => t.service === service)
    .filter((t) => t.status !== 'Closed' && t.status !== 'Resolved')
    .filter(
      (t) =>
        !entityId ||
        !t.entity_id ||
        t.entity_id === entityId ||
        t.entity_id === 'ENT-FIRM',
    )
    .map((t) => ({
      ticket_id: t.ticket_id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      entity_id: t.entity_id ?? null,
      company_name: t.company_name ?? null,
      href: `/shared-services/tickets/${t.ticket_id}`,
    }));
}
