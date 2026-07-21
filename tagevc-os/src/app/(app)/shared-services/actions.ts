'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  createTicket,
  resolveTicket,
  setDraftApproval,
} from '@/lib/data/ticket-store';
import { guardPermission } from '@/lib/rbac/session';
import { SS_SERVICES, TICKET_PRIORITIES } from '@/lib/types';
import {
  acknowledgeSloAlert,
  reassignSloAlert,
} from '@/lib/shared-services/operational-health';

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
  revalidatePath('/activity');
  revalidatePath('/command-center');
  if (ticketId) revalidatePath(`/shared-services/tickets/${ticketId}`);
}

export async function createTicketAction(
  _prev: TicketActionResult | null,
  formData: FormData,
): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
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
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
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
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
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
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  try {
    resolveTicket(ticketId);
    revalidateTickets(ticketId);
    return { ok: true, ticketId, message: 'Resolved' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function acknowledgeSloAlertAction(input: {
  alertId: string;
  rowVersion: number;
  note?: string;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      alertId: z.string().uuid(),
      rowVersion: z.number().int().nonnegative(),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid acknowledgement' };
  try {
    await acknowledgeSloAlert({
      ...parsed.data,
      actorId: gate.profile.id,
      expectedRowVersion: parsed.data.rowVersion,
    });
    revalidatePath('/shared-services');
    return { ok: true, message: 'Alert acknowledged' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function reassignSloAlertAction(input: {
  alertId: string;
  rowVersion: number;
  ownerId: string;
  note?: string;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      alertId: z.string().uuid(),
      rowVersion: z.number().int().nonnegative(),
      ownerId: z.string().uuid(),
      note: z.string().trim().max(500).optional(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid reassignment' };
  try {
    await reassignSloAlert({
      ...parsed.data,
      actorId: gate.profile.id,
      expectedRowVersion: parsed.data.rowVersion,
    });
    revalidatePath('/shared-services');
    return { ok: true, message: 'Alert reassigned' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}
