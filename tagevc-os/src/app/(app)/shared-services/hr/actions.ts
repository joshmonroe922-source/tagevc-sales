'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  PHASE57_HR_IT_CONTRACT_VERSION,
  type HrItHardeningPhase57Report,
} from '@/lib/shared-services/hr-it-hardening-phase57';
import {
  approveHrItHighRiskPhase57,
  getHrItHardeningPhase57Report,
  proposeHrItHighRiskPhase57,
  recordHrItEscalationPhase57,
  refreshHrItHardeningPhase57,
} from '@/lib/shared-services/hr-it-hardening-phase57-server';
import { guardPermission } from '@/lib/rbac/session';

export type HrItPhase57ActionResult =
  | {
      ok: true;
      breaker_auto_closed: false;
      access_revoke_executed: false;
      dual_approve_required: true;
      contract_version: typeof PHASE57_HR_IT_CONTRACT_VERSION;
      report: HrItHardeningPhase57Report;
      data?: Record<string, unknown>;
    }
  | {
      ok: false;
      breaker_auto_closed: false;
      access_revoke_executed: false;
      dual_approve_required: true;
      contract_version: typeof PHASE57_HR_IT_CONTRACT_VERSION;
      error: string;
      report: HrItHardeningPhase57Report;
    };

function revalidateHrIt(entityId?: string | null) {
  revalidatePath('/shared-services/hr');
  revalidatePath('/shared-services/it/assets');
  revalidatePath('/shared-services');
  if (entityId) revalidatePath(`/entities/${entityId}`);
}

export async function refreshHrItHardeningPhase57Action(
  entityId?: string | null,
): Promise<HrItPhase57ActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    const { emptyHrItHardeningPhase57Report } = await import(
      '@/lib/shared-services/hr-it-hardening-phase57'
    );
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: gate.error,
      report: emptyHrItHardeningPhase57Report(entityId ?? null),
    };
  }
  const result = await refreshHrItHardeningPhase57({
    actorId: gate.profile.id,
    entityId: entityId ?? null,
  });
  revalidateHrIt(entityId);
  if (!result.ok) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: result.error,
      report: result.report,
    };
  }
  return {
    ok: true,
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
    report: result.report,
    data: result.summary,
  };
}

const proposeSchema = z.object({
  entityId: z.string().nullable().optional(),
  actionKind: z.enum([
    'breaker_close',
    'access_revoke_execute',
    'offboarding_force_complete',
    'onboarding_force_complete',
    'other_high_risk',
  ]),
  summary: z.string().min(2).max(500),
});

export async function proposeHrItHighRiskPhase57Action(
  input: z.infer<typeof proposeSchema>,
): Promise<HrItPhase57ActionResult> {
  const gate = await guardPermission('write:shared_services');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    const { emptyHrItHardeningPhase57Report } = await import(
      '@/lib/shared-services/hr-it-hardening-phase57'
    );
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: gate.error,
      report: emptyHrItHardeningPhase57Report(entityId),
    };
  }
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid high-risk payload',
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  const result = await proposeHrItHighRiskPhase57({
    entityId,
    actionKind: parsed.data.actionKind,
    summary: parsed.data.summary,
    proposedBy: gate.profile.id,
  });
  revalidateHrIt(entityId);
  if (!result.ok) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: result.error,
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  return {
    ok: true,
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
    report: await getHrItHardeningPhase57Report({ entityId }),
    data: result.data,
  };
}

const approveSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
  entityId: z.string().nullable().optional(),
});

export async function approveHrItHighRiskPhase57Action(
  input: z.infer<typeof approveSchema>,
): Promise<HrItPhase57ActionResult> {
  const gate = await guardPermission('write:shared_services');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    const { emptyHrItHardeningPhase57Report } = await import(
      '@/lib/shared-services/hr-it-hardening-phase57'
    );
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: gate.error,
      report: emptyHrItHardeningPhase57Report(entityId),
    };
  }
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid approval payload',
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  const result = await approveHrItHighRiskPhase57({
    proposalId: parsed.data.proposalId,
    actorId: gate.profile.id,
    decision: parsed.data.decision,
  });
  revalidateHrIt(entityId);
  if (!result.ok) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: result.error,
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  return {
    ok: true,
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
    report: await getHrItHardeningPhase57Report({ entityId }),
    data: result.data,
  };
}

const escalationSchema = z.object({
  entityId: z.string().nullable().optional(),
  escalationKind: z.enum([
    'inbox_stale',
    'run_aging',
    'revocation_pending',
    'breaker_aging',
    'manual',
  ]),
  title: z.string().min(2).max(240),
  status: z.enum(['open', 'acknowledged', 'escalated', 'resolved_observe']),
  referenceId: z.string().nullable().optional(),
});

export async function recordHrItEscalationPhase57Action(
  input: z.infer<typeof escalationSchema>,
): Promise<HrItPhase57ActionResult> {
  const gate = await guardPermission('write:shared_services');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    const { emptyHrItHardeningPhase57Report } = await import(
      '@/lib/shared-services/hr-it-hardening-phase57'
    );
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: gate.error,
      report: emptyHrItHardeningPhase57Report(entityId),
    };
  }
  const parsed = escalationSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid escalation payload',
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  const result = await recordHrItEscalationPhase57({
    ...parsed.data,
    entityId,
    actorId: gate.profile.id,
  });
  revalidateHrIt(entityId);
  if (!result.ok) {
    return {
      ok: false,
      breaker_auto_closed: false,
      access_revoke_executed: false,
      dual_approve_required: true,
      contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
      error: result.error,
      report: await getHrItHardeningPhase57Report({ entityId }),
    };
  }
  return {
    ok: true,
    breaker_auto_closed: false,
    access_revoke_executed: false,
    dual_approve_required: true,
    contract_version: PHASE57_HR_IT_CONTRACT_VERSION,
    report: await getHrItHardeningPhase57Report({ entityId }),
    data: result.data,
  };
}
