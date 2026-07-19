'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createTicket,
  resolveTicket,
  setDraftApproval,
} from '@/lib/data/ticket-store';
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';

export type TicketActionResult =
  | { ok: true; ticketId?: string; message?: string }
  | { ok: false; error: string };

const createSchema = z.object({
  title: z.string().min(3),
  description: z.string().optional(),
  desired_outcome: z.string().optional(),
  service: z.enum(SS_SERVICES),
  priority: z.enum(TICKET_PRIORITIES),
  requester_name: z.string().optional(),
  company_name: z.string().optional(),
  entity_id: z.string().optional(),
  links: z.string().optional(),
  sla_due_at: z.string().optional(),
});

function revalidateTickets(ticketId?: string) {
  revalidatePath('/shared-services');
  if (ticketId) revalidatePath(`/shared-services/tickets/${ticketId}`);
}

export async function createTicketAction(
  _prev: TicketActionResult | null,
  formData: FormData,
): Promise<TicketActionResult> {
  const parsed = createSchema.safeParse({
    title: formData.get('title'),
    description: formData.get('description') || undefined,
    desired_outcome: formData.get('desired_outcome') || undefined,
    service: formData.get('service'),
    priority: formData.get('priority'),
    requester_name: formData.get('requester_name') || undefined,
    company_name: formData.get('company_name') || undefined,
    entity_id: formData.get('entity_id') || undefined,
    links: formData.get('links') || undefined,
    sla_due_at: formData.get('sla_due_at') || undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const ticket = createTicket(parsed.data);
    revalidateTickets(ticket.ticket_id);
    return {
      ok: true,
      ticketId: ticket.ticket_id,
      message: `${ticket.ticket_id} → ${ticket.autonomy_band} (${ticket.confidence}%)`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function approveDraftAction(
  ticketId: string,
): Promise<TicketActionResult> {
  try {
    setDraftApproval(ticketId, 'approved');
    revalidateTickets(ticketId);
    return { ok: true, ticketId, message: 'Draft approved' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function rejectDraftAction(
  ticketId: string,
): Promise<TicketActionResult> {
  try {
    setDraftApproval(ticketId, 'rejected');
    revalidateTickets(ticketId);
    return { ok: true, ticketId, message: 'Draft rejected' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function resolveTicketAction(
  ticketId: string,
): Promise<TicketActionResult> {
  try {
    resolveTicket(ticketId);
    revalidateTickets(ticketId);
    return { ok: true, ticketId, message: 'Resolved' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
