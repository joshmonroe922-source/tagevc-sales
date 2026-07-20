'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  convertLeadToDeal,
  createLead,
  recordIcDecision,
  submitIcForReview,
  updateDealExecStage,
  updateDealTaskStatus,
  updateLeadStage,
  updateTaskStatus,
} from '@/lib/data/deal-flow-store';
import { guardPermission } from '@/lib/rbac/session';
import { isBreakGlassExecStage } from '@/lib/rbac/impersonation';
import {
  EXEC_STAGES,
  IC_DECISIONS,
  PIPELINE_STAGES,
  PRIORITIES,
  TASK_STATUSES,
} from '@/lib/types';

const createLeadSchema = z.object({
  company_name: z.string().min(1, 'Company is required'),
  website: z.string().optional(),
  sector: z.string().optional(),
  source: z.string().min(1, 'Source is required'),
  source_detail: z.string().optional(),
  owner: z.string().min(1, 'Owner is required'),
  priority: z.enum(PRIORITIES).optional(),
  raise_stage: z.string().optional(),
  check_size_k: z.coerce.number().optional(),
  location: z.string().optional(),
  notes: z.string().optional(),
  related_entity_id: z.string().optional(),
});

function revalidateDealFlow(
  leadId?: string,
  dealId?: string,
  relatedEntityId?: string | null,
) {
  revalidatePath('/deal-flow');
  revalidatePath('/deal-flow/vc');
  revalidatePath('/deal-flow/vc/intake');
  revalidatePath('/deal-flow/vc/deals');
  revalidatePath('/deal-flow/vc/ic');
  revalidatePath('/command-center');
  revalidatePath('/activity');
  revalidatePath('/entities');
  if (leadId) revalidatePath(`/deal-flow/vc/leads/${leadId}`);
  if (dealId) revalidatePath(`/deal-flow/vc/deals/${dealId}`);
  if (relatedEntityId) revalidatePath(`/entities/${relatedEntityId}`);
}

export type ActionResult =
  | { ok: true; leadId?: string; dealId?: string; message?: string }
  | { ok: false; error: string };

export async function createLeadAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;

  const relatedRaw = formData.get('related_entity_id');
  const parsed = createLeadSchema.safeParse({
    company_name: formData.get('company_name'),
    website: formData.get('website') || undefined,
    sector: formData.get('sector') || undefined,
    source: formData.get('source') || undefined,
    source_detail: formData.get('source_detail') || undefined,
    owner: formData.get('owner') || undefined,
    priority: formData.get('priority') || undefined,
    raise_stage: formData.get('raise_stage') || undefined,
    check_size_k: formData.get('check_size_k') || undefined,
    location: formData.get('location') || undefined,
    notes: formData.get('notes') || undefined,
    related_entity_id:
      typeof relatedRaw === 'string' && relatedRaw.trim()
        ? relatedRaw.trim()
        : undefined,
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid' };
  }
  try {
    const lead = createLead(parsed.data);
    revalidateDealFlow(lead.lead_id, undefined, lead.related_entity_id);
    return { ok: true, leadId: lead.lead_id, message: `Created ${lead.lead_id}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function changeLeadStageAction(
  leadId: string,
  stage: string,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  if (!(PIPELINE_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Invalid stage' };
  }
  try {
    const { spawned } = updateLeadStage(
      leadId,
      stage as (typeof PIPELINE_STAGES)[number],
    );
    revalidateDealFlow(leadId);
    return {
      ok: true,
      leadId,
      message:
        spawned.length > 0
          ? `Moved to ${stage}; spawned ${spawned.length} task(s)`
          : `Moved to ${stage}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function setTaskStatusAction(
  taskId: string,
  status: string,
  leadId: string,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'Invalid status' };
  }
  try {
    updateTaskStatus(taskId, status as (typeof TASK_STATUSES)[number]);
    revalidateDealFlow(leadId);
    return { ok: true, leadId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function convertLeadToDealAction(
  leadId: string,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  try {
    const deal = convertLeadToDeal(leadId);
    revalidateDealFlow(leadId, deal.deal_id);
    return {
      ok: true,
      leadId,
      dealId: deal.deal_id,
      message: `Opened ${deal.deal_id}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function changeDealExecStageAction(
  dealId: string,
  stage: string,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  if (!(EXEC_STAGES as readonly string[]).includes(stage)) {
    return { ok: false, error: 'Invalid exec stage' };
  }
  if (isBreakGlassExecStage(stage)) {
    const wireGate = await guardPermission('action:wire');
    if (!wireGate.ok) return wireGate;
  }
  try {
    const { spawned } = updateDealExecStage(
      dealId,
      stage as (typeof EXEC_STAGES)[number],
    );
    revalidateDealFlow(undefined, dealId);
    return {
      ok: true,
      dealId,
      message:
        spawned.length > 0
          ? `Moved to ${stage}; spawned ${spawned.length} task(s)`
          : `Moved to ${stage}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function setDealTaskStatusAction(
  taskId: string,
  status: string,
  dealId: string,
): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  if (!(TASK_STATUSES as readonly string[]).includes(status)) {
    return { ok: false, error: 'Invalid status' };
  }
  try {
    updateDealTaskStatus(taskId, status as (typeof TASK_STATUSES)[number]);
    revalidateDealFlow(undefined, dealId);
    return { ok: true, dealId };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function submitIcAction(dealId: string): Promise<ActionResult> {
  const gate = await guardPermission('write:vc_pipeline');
  if (!gate.ok) return gate;
  try {
    submitIcForReview(dealId);
    revalidateDealFlow(undefined, dealId);
    revalidatePath('/deal-flow/vc/ic');
    return { ok: true, dealId, message: 'Submitted to IC queue' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}

export async function recordIcDecisionAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const gate = await guardPermission('action:ic_vote');
  if (!gate.ok) return gate;
  const icId = String(formData.get('ic_id') ?? '');
  const decision = String(formData.get('decision') ?? '');
  if (!(IC_DECISIONS as readonly string[]).includes(decision)) {
    return { ok: false, error: 'Invalid decision' };
  }
  try {
    const review = recordIcDecision({
      icId,
      decision: decision as (typeof IC_DECISIONS)[number],
      conditions: String(formData.get('conditions') ?? '') || undefined,
      recommendation: String(formData.get('recommendation') ?? '') || undefined,
      actor: String(formData.get('actor') ?? '') || undefined,
    });
    revalidateDealFlow(undefined, review.deal_id);
    revalidatePath('/deal-flow/vc/ic');
    return {
      ok: true,
      dealId: review.deal_id,
      message: `IC ${decision}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Failed' };
  }
}
