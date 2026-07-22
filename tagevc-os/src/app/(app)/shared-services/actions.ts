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
import {
  requestSloRouteTest,
  requestSloSimulation,
  saveSloPolicyDraft,
  transitionSloPolicyDraft,
} from '@/lib/shared-services/slo-policy';

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

const policyDraftSchema = z.object({
  sourcePolicyId: z.string().uuid(),
  draftPolicyId: z.string().uuid().nullable().optional(),
  policyVersion: z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/),
  comparator: z.enum(['higher_bad', 'lower_bad']),
  warningThreshold: z.number().finite(),
  criticalThreshold: z.number().finite(),
  windowSeconds: z.number().int().min(60).max(2_592_000),
  evaluationIntervalSeconds: z.number().int().min(60).max(86_400),
  warningBreachBuckets: z.number().int().min(1).max(24),
  recoveryBuckets: z.number().int().min(1).max(24),
  webhookDestinationKeys: z.array(
    z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
  ).max(10),
  ownerId: z.string().uuid(),
  ownerEntityId: z.string().trim().max(100).nullable().optional(),
  ownerEffectiveAt: z.string().datetime(),
  ownerExpiresAt: z.string().datetime().nullable().optional(),
  replacementOwnerId: z.string().uuid().nullable().optional(),
  expectedRowVersion: z.number().int().nonnegative(),
});

export async function saveSloPolicyDraftAction(
  input: z.infer<typeof policyDraftSchema>,
): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = policyDraftSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid policy' };
  }
  try {
    await saveSloPolicyDraft({ ...parsed.data, actorId: gate.profile.id });
    revalidatePath('/shared-services');
    return { ok: true, message: 'Policy draft saved' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function transitionSloPolicyDraftAction(input: {
  policyId: string;
  rowVersion: number;
  transition: 'validate' | 'publish';
  ownerEffectiveAt?: string;
  ownerExpiresAt?: string | null;
  replacementOwnerId?: string | null;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    policyId: z.string().uuid(),
    rowVersion: z.number().int().nonnegative(),
    transition: z.enum(['validate', 'publish']),
    ownerEffectiveAt: z.string().datetime().optional(),
    ownerExpiresAt: z.string().datetime().nullable().optional(),
    replacementOwnerId: z.string().uuid().nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid policy transition' };
  try {
    await transitionSloPolicyDraft({
      policyId: parsed.data.policyId,
      expectedRowVersion: parsed.data.rowVersion,
      transition: parsed.data.transition,
      ownerEffectiveAt: parsed.data.ownerEffectiveAt,
      ownerExpiresAt: parsed.data.ownerExpiresAt,
      replacementOwnerId: parsed.data.replacementOwnerId,
      actorId: gate.profile.id,
    });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: parsed.data.transition === 'validate'
        ? 'Draft validated; a different publisher must approve it'
        : 'Policy published',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function requestSloSimulationAction(input: {
  idempotencyKey: string;
  draftPolicyId: string;
  entityIds: string[];
  startsAt: string;
  endsAt: string;
  maxBuckets: number;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    draftPolicyId: z.string().uuid(),
    entityIds: z.array(z.string().trim().min(1).max(100)).max(100),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    maxBuckets: z.number().int().min(1).max(2160),
  }).safeParse(input);
  if (!parsed.success || Date.parse(parsed.data.endsAt) <= Date.parse(parsed.data.startsAt)) {
    return { ok: false, error: 'Invalid simulation request' };
  }
  try {
    await requestSloSimulation({ ...parsed.data, actorId: gate.profile.id });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: 'COUNTERFACTUAL simulation queued; production state is unchanged',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function requestSloRouteTestAction(input: {
  idempotencyKey: string;
  entityId?: string | null;
  adapter: 'in_app_owner' | 'webhook';
  destinationKey: string;
  ownerId?: string | null;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    entityId: z.string().trim().max(100).nullable().optional(),
    adapter: z.enum(['in_app_owner', 'webhook']),
    destinationKey: z.string().regex(/^[a-z][a-z0-9_]{0,62}$/),
    ownerId: z.string().uuid().nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Invalid route test' };
  try {
    await requestSloRouteTest({ ...parsed.data, actorId: gate.profile.id });
    revalidatePath('/shared-services');
    return { ok: true, message: 'TEST route job queued; no incident was created' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}
