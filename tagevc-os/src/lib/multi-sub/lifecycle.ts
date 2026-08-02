/** Central identity lifecycle (P5) — joiner / mover / leaver orchestration. */

import {
  baseLifecycleChecklist,
  type LifecycleChecklistItem,
  type LifecycleKind,
  type LifecycleStepStatus,
} from '@/lib/multi-sub/lifecycle-defaults';
import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { mergePartnerLifecycleItems } from '@/lib/partners/lifecycle-hooks';

export const MS_P5_CONTRACT_VERSION = 'ms-p5-v1' as const;

export type {
  LifecycleChecklistItem,
  LifecycleKind,
  LifecycleStepStatus,
};

export function defaultLifecycleChecklist(
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  const entity = resolveCanonicalEntityId(entityId) ?? 'ENT-FIRM';
  const base = baseLifecycleChecklist(kind, entityId);
  return mergePartnerLifecycleItems(base, kind, entity);
}

export function leaverRevokeOrder(): string[] {
  return [
    'revoke_portal',
    'revoke_messaging',
    'revoke_ticketing',
    'offboarding_checklist',
    'evidence_pack',
  ];
}

export function assertLeaverRevokeFirst(
  completedStepIds: string[],
): { ok: true } | { ok: false; error: string } {
  const order = leaverRevokeOrder();
  for (let i = 1; i < order.length; i++) {
    const step = order[i];
    const prior = order[i - 1];
    if (completedStepIds.includes(step) && !completedStepIds.includes(prior)) {
      return {
        ok: false,
        error: `Leaver revoke-first violated: ${step} before ${prior}`,
      };
    }
  }
  return { ok: true };
}

export type LifecycleControlCenterSummary = {
  open: number;
  in_progress: number;
  needs_retry: number;
  completed: number;
  failed_steps: number;
  money_auto_approve: false;
  contract_version: typeof MS_P5_CONTRACT_VERSION;
};

export function summarizeLifecycleRuns(
  runs: Array<{ status: string; checklist?: LifecycleChecklistItem[] }>,
): LifecycleControlCenterSummary {
  const summary: LifecycleControlCenterSummary = {
    open: 0,
    in_progress: 0,
    needs_retry: 0,
    completed: 0,
    failed_steps: 0,
    money_auto_approve: false,
    contract_version: MS_P5_CONTRACT_VERSION,
  };
  for (const r of runs) {
    if (r.status === 'open') summary.open += 1;
    else if (r.status === 'in_progress') summary.in_progress += 1;
    else if (r.status === 'needs_retry') summary.needs_retry += 1;
    else if (r.status === 'completed') summary.completed += 1;
    for (const item of r.checklist ?? []) {
      if (item.status === 'failed' || item.status === 'retrying') {
        summary.failed_steps += 1;
      }
    }
  }
  return summary;
}
