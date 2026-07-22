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
  exportSloSimulation,
  recordSloExportAuditAccess,
  proposeSloOwnerSuccession,
  archiveExpiredSloExportsPhase43,
  runSloOwnerSuccessionDrillPhase43,
  suggestSloOwnerHandoffsPhase44,
  resolveSloOwnerHandoffSuggestionPhase44,
  registerSloSimulationScenarioPhase44,
  replaySloSimulationScenarioPhase44,
  runSloNightlyScenarioReplayPhase45,
  generateSloOwnerHandoffDigestPhase45,
  runSloFirmWideNightlyReplayPhase46,
  publishSloOwnerHandoffDigestPhase46,
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

export async function exportSloSimulationAction(input: {
  idempotencyKey: string;
  simulationId: string;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    idempotencyKey: z.string().min(8).max(120).regex(/^[A-Za-z0-9._:-]+$/),
    simulationId: z.string().uuid(),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid simulation export request' };
  }
  try {
    await exportSloSimulation({ ...parsed.data, actorId: gate.profile.id });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: 'COUNTERFACTUAL signed metadata export recorded',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function recordSloExportAuditAccessAction(input: {
  exportId: string;
  accessType: 'listed' | 'viewed' | 'downloaded' | 'replayed';
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    exportId: z.string().uuid(),
    accessType: z.enum(['listed', 'viewed', 'downloaded', 'replayed']),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid export audit access request' };
  }
  try {
    await recordSloExportAuditAccess({
      actorId: gate.profile.id,
      exportId: parsed.data.exportId,
      accessType: parsed.data.accessType,
    });
    revalidatePath('/shared-services');
    return { ok: true, message: `Export ${parsed.data.accessType} access recorded` };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function proposeSloOwnerSuccessionAction(input: {
  policyId: string;
  entityId?: string | null;
  replacementOwnerId: string;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    policyId: z.string().uuid(),
    entityId: z.string().trim().max(100).nullable().optional(),
    replacementOwnerId: z.string().uuid(),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid succession proposal' };
  }
  try {
    await proposeSloOwnerSuccession({
      actorId: gate.profile.id,
      policyId: parsed.data.policyId,
      entityId: parsed.data.entityId,
      replacementOwnerId: parsed.data.replacementOwnerId,
    });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: 'Owner succession proposed via Phase 40 replacement fields',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function archiveExpiredSloExportsAction(): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  try {
    const result = (await archiveExpiredSloExportsPhase43({
      actorId: gate.profile.id,
      limit: 25,
    })) as { archived_count?: number; rows_deleted?: boolean };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Archived ${result.archived_count ?? 0} expired export(s) (metadata-only; rows retained)`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function runSloOwnerSuccessionDrillAction(input: {
  policyId: string;
  entityId?: string | null;
  candidateReplacementId: string;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    policyId: z.string().uuid(),
    entityId: z.string().trim().max(100).nullable().optional(),
    candidateReplacementId: z.string().uuid(),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid succession drill' };
  }
  try {
    const result = (await runSloOwnerSuccessionDrillPhase43({
      actorId: gate.profile.id,
      policyId: parsed.data.policyId,
      entityId: parsed.data.entityId,
      candidateReplacementId: parsed.data.candidateReplacementId,
    })) as { eligibility_ok?: boolean; live_succession_mutated?: boolean };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: result.eligibility_ok
        ? 'Succession drill recorded (eligible; live succession not mutated)'
        : 'Succession drill recorded (candidate not eligible; live succession not mutated)',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function suggestSloOwnerHandoffsAction(): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  try {
    const result = (await suggestSloOwnerHandoffsPhase44({
      warningDays: 30,
    })) as { suggested_count?: number };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Recorded ${result.suggested_count ?? 0} handoff suggestion(s) (not applied live)`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function resolveSloOwnerHandoffSuggestionAction(input: {
  suggestionId: string;
  status: 'accepted' | 'dismissed' | 'expired';
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    suggestionId: z.string().uuid(),
    status: z.enum(['accepted', 'dismissed', 'expired']),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid handoff resolution' };
  }
  try {
    await resolveSloOwnerHandoffSuggestionPhase44({
      actorId: gate.profile.id,
      suggestionId: parsed.data.suggestionId,
      status: parsed.data.status,
    });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Handoff suggestion ${parsed.data.status} (live succession not mutated)`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function registerSloSimulationScenarioAction(input: {
  name: string;
  windowStart: string;
  windowEnd: string;
  entityScope?: string[];
  draftPolicyHash: string;
  publishedPolicyHash?: string | null;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    name: z.string().trim().min(3).max(120),
    windowStart: z.string().datetime(),
    windowEnd: z.string().datetime(),
    entityScope: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
    draftPolicyHash: z.string().regex(/^[0-9a-f]{64}$/),
    publishedPolicyHash: z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .nullable()
      .optional(),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid simulation scenario' };
  }
  try {
    await registerSloSimulationScenarioPhase44({
      actorId: gate.profile.id,
      name: parsed.data.name,
      windowStart: parsed.data.windowStart,
      windowEnd: parsed.data.windowEnd,
      entityScope: parsed.data.entityScope ?? [],
      draftPolicyHash: parsed.data.draftPolicyHash,
      publishedPolicyHash: parsed.data.publishedPolicyHash,
    });
    revalidatePath('/shared-services');
    return { ok: true, message: 'Simulation scenario registered' };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function replaySloSimulationScenarioAction(input: {
  scenarioId: string;
  draftPolicyId?: string | null;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z.object({
    scenarioId: z.string().uuid(),
    draftPolicyId: z.string().uuid().nullable().optional(),
  }).safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'Invalid scenario replay' };
  }
  try {
    await replaySloSimulationScenarioPhase44({
      actorId: gate.profile.id,
      scenarioId: parsed.data.scenarioId,
      idempotencyKey: `ui:replay:${parsed.data.scenarioId}:${Date.now()}`,
      draftPolicyId: parsed.data.draftPolicyId,
    });
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: 'Scenario replay recorded (counterfactual; production alerts unchanged)',
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function runSloNightlyScenarioReplayAction(): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  try {
    const result = (await runSloNightlyScenarioReplayPhase45({
      actorId: gate.profile.id,
      limit: 50,
    })) as {
      status?: string;
      succeeded?: number;
      failed?: number;
      scenarios_claimed?: number;
    };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Nightly scenario replay ${result.status ?? 'completed'} · claimed ${result.scenarios_claimed ?? 0} · ok ${result.succeeded ?? 0} · failed ${result.failed ?? 0} (counterfactual)`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function generateSloOwnerHandoffDigestAction(input?: {
  digestQuarter?: string | null;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      digestQuarter: z
        .string()
        .regex(/^[0-9]{4}-Q[1-4]$/)
        .nullable()
        .optional(),
    })
    .safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: 'Invalid handoff digest quarter' };
  }
  try {
    const result = (await generateSloOwnerHandoffDigestPhase45({
      actorId: gate.profile.id,
      digestQuarter: parsed.data.digestQuarter,
    })) as {
      digest_quarter?: string;
      suggestion_count?: number;
      accepted_count?: number;
    };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Handoff digest ${result.digest_quarter ?? ''} · suggestions ${result.suggestion_count ?? 0} · accepted ${result.accepted_count ?? 0}`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function runSloFirmWideNightlyReplayAction(): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  try {
    const result = (await runSloFirmWideNightlyReplayPhase46({
      actorId: gate.profile.id,
    })) as {
      status?: string;
      succeeded?: number;
      failed?: number;
      scenarios_claimed?: number;
      material_risk_count?: number;
    };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Firm-wide nightly replay ${result.status ?? 'completed'} · claimed ${result.scenarios_claimed ?? 0} · material ${result.material_risk_count ?? 0} · ok ${result.succeeded ?? 0} · failed ${result.failed ?? 0} (counterfactual)`,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Failed' };
  }
}

export async function publishSloOwnerHandoffDigestAction(input?: {
  digestQuarter?: string | null;
  destinationKey?: string | null;
  recipientCount?: number;
}): Promise<TicketActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) return gate;
  const parsed = z
    .object({
      digestQuarter: z
        .string()
        .regex(/^[0-9]{4}-Q[1-4]$/)
        .nullable()
        .optional(),
      destinationKey: z
        .string()
        .regex(/^[a-z][a-z0-9_]{0,62}$/)
        .nullable()
        .optional(),
      recipientCount: z.number().int().min(0).max(100000).optional(),
    })
    .safeParse(input ?? {});
  if (!parsed.success) {
    return { ok: false, error: 'Invalid handoff digest publish input' };
  }
  try {
    const result = (await publishSloOwnerHandoffDigestPhase46({
      actorId: gate.profile.id,
      digestQuarter: parsed.data.digestQuarter,
      destinationKey: parsed.data.destinationKey,
      recipientCount: parsed.data.recipientCount ?? 0,
    })) as {
      digest_quarter?: string;
      publish_status?: string;
      recipient_count?: number;
      destination_key?: string;
    };
    revalidatePath('/shared-services');
    return {
      ok: true,
      message: `Handoff digest publish ${result.publish_status ?? 'published'} · ${result.digest_quarter ?? ''} · recipients ${result.recipient_count ?? 0} · dest ${result.destination_key ?? 'ops_alerts'}`,
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
