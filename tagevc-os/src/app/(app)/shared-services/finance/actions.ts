'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import {
  PHASE55_FINANCE_CONTRACT_VERSION,
  type FinanceControlPlanePhase55Report,
} from '@/lib/shared-services/finance-control-plane-phase55';
import {
  approveFinanceWritebackPhase55,
  getFinanceControlPlanePhase55Report,
  proposeFinanceWritebackPhase55,
  recordFinanceCloseChecklistEventPhase55,
  refreshFinanceControlPlanePhase55,
} from '@/lib/shared-services/finance-control-plane-phase55-server';
import { guardPermission } from '@/lib/rbac/session';

export type FinancePhase55ActionResult =
  | {
      ok: true;
      money_auto_approve: false;
      ies_write_executed: false;
      contract_version: typeof PHASE55_FINANCE_CONTRACT_VERSION;
      report: FinanceControlPlanePhase55Report;
      data?: Record<string, unknown>;
    }
  | {
      ok: false;
      money_auto_approve: false;
      ies_write_executed: false;
      contract_version: typeof PHASE55_FINANCE_CONTRACT_VERSION;
      error: string;
      report: FinanceControlPlanePhase55Report;
    };

function revalidateFinance(entityId?: string | null) {
  revalidatePath('/shared-services/af/finance');
  revalidatePath('/shared-services');
  if (entityId) revalidatePath(`/entities/${entityId}`);
}

export async function refreshFinanceControlPlanePhase55Action(
  entityId?: string | null,
): Promise<FinancePhase55ActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    const { emptyFinanceControlPlanePhase55Report } = await import(
      '@/lib/shared-services/finance-control-plane-phase55'
    );
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: gate.error,
      report: emptyFinanceControlPlanePhase55Report(entityId ?? null),
    };
  }
  const result = await refreshFinanceControlPlanePhase55({
    actorId: gate.profile.id,
    entityId: entityId ?? null,
  });
  // Best-effort year-end pack seed (Phase 62); never blocks refresh.
  try {
    const { seedFinanceYearEndChecklistPhase62 } = await import(
      '@/lib/shared-services/hr-ops-phase62-server'
    );
    await seedFinanceYearEndChecklistPhase62({
      actorId: gate.profile.id,
      entityId: entityId ?? null,
    });
  } catch {
    // fail-soft
  }
  revalidateFinance(entityId);
  if (!result.ok) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: result.error,
      report: result.report,
    };
  }
  return {
    ok: true,
    money_auto_approve: false,
    ies_write_executed: false,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
    report: result.report,
    data: result.summary,
  };
}

const checklistSchema = z.object({
  entityId: z.string().nullable().optional(),
  closeKind: z.enum(['month_end', 'year_end']),
  periodKey: z.string().min(4).max(16),
  itemKey: z.string().min(2).max(64),
  itemLabel: z.string().min(2).max(200),
  status: z.enum(['open', 'in_progress', 'blocked', 'done', 'waived']),
});

export async function recordFinanceCloseChecklistPhase55Action(
  input: z.infer<typeof checklistSchema>,
): Promise<FinancePhase55ActionResult> {
  const gate = await guardPermission('write:shared_services');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    const { emptyFinanceControlPlanePhase55Report } = await import(
      '@/lib/shared-services/finance-control-plane-phase55'
    );
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: gate.error,
      report: emptyFinanceControlPlanePhase55Report(entityId),
    };
  }
  const parsed = checklistSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid checklist payload',
      report: await getFinanceControlPlanePhase55Report({ entityId }),
    };
  }
  const result = await recordFinanceCloseChecklistEventPhase55({
    ...parsed.data,
    entityId,
    actorId: gate.profile.id,
  });
  revalidateFinance(entityId);
  if (!result.ok) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: result.error,
      report: await getFinanceControlPlanePhase55Report({ entityId }),
    };
  }
  return {
    ok: true,
    money_auto_approve: false,
    ies_write_executed: false,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
    report: await getFinanceControlPlanePhase55Report({ entityId }),
    data: result.data,
  };
}

const proposeSchema = z.object({
  entityId: z.string().nullable().optional(),
  actionKind: z.enum([
    'ies_journal_adjustment',
    'ies_vendor_bill_note',
    'ies_ar_memo',
    'ies_close_flag',
    'ies_other_observe',
  ]),
  summary: z.string().min(2).max(500),
});

export async function proposeFinanceWritebackPhase55Action(
  input: z.infer<typeof proposeSchema>,
): Promise<FinancePhase55ActionResult> {
  const gate = await guardPermission('write:shared_services');
  const entityId = input.entityId ?? null;
  if (!gate.ok) {
    const { emptyFinanceControlPlanePhase55Report } = await import(
      '@/lib/shared-services/finance-control-plane-phase55'
    );
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: gate.error,
      report: emptyFinanceControlPlanePhase55Report(entityId),
    };
  }
  const parsed = proposeSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid write-back proposal',
      report: await getFinanceControlPlanePhase55Report({ entityId }),
    };
  }
  const result = await proposeFinanceWritebackPhase55({
    entityId,
    actionKind: parsed.data.actionKind,
    summary: parsed.data.summary,
    proposedBy: gate.profile.id,
  });
  revalidateFinance(entityId);
  if (!result.ok) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: result.error,
      report: await getFinanceControlPlanePhase55Report({ entityId }),
    };
  }
  return {
    ok: true,
    money_auto_approve: false,
    ies_write_executed: false,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
    report: await getFinanceControlPlanePhase55Report({ entityId }),
    data: result.data,
  };
}

const approveSchema = z.object({
  proposalId: z.string().uuid(),
  decision: z.enum(['approve', 'reject']),
});

export async function approveFinanceWritebackPhase55Action(
  input: z.infer<typeof approveSchema>,
): Promise<FinancePhase55ActionResult> {
  const gate = await guardPermission('write:shared_services');
  if (!gate.ok) {
    const { emptyFinanceControlPlanePhase55Report } = await import(
      '@/lib/shared-services/finance-control-plane-phase55'
    );
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: gate.error,
      report: emptyFinanceControlPlanePhase55Report(),
    };
  }
  const parsed = approveSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: parsed.error.issues[0]?.message ?? 'Invalid approval payload',
      report: await getFinanceControlPlanePhase55Report(),
    };
  }
  const result = await approveFinanceWritebackPhase55({
    proposalId: parsed.data.proposalId,
    actorId: gate.profile.id,
    decision: parsed.data.decision,
  });
  revalidateFinance();
  if (!result.ok) {
    return {
      ok: false,
      money_auto_approve: false,
      ies_write_executed: false,
      contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
      error: result.error,
      report: await getFinanceControlPlanePhase55Report(),
    };
  }
  return {
    ok: true,
    money_auto_approve: false,
    ies_write_executed: false,
    contract_version: PHASE55_FINANCE_CONTRACT_VERSION,
    report: await getFinanceControlPlanePhase55Report(),
    data: result.data,
  };
}
