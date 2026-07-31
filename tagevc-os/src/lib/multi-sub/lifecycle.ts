/** Central identity lifecycle (P5) — joiner / mover / leaver orchestration. */

import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';
import { mergePartnerLifecycleItems } from '@/lib/partners/lifecycle-hooks';

export const MS_P5_CONTRACT_VERSION = 'ms-p5-v1' as const;

export type LifecycleKind = 'joiner' | 'mover' | 'leaver';

export type LifecycleStepStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'failed'
  | 'skipped'
  | 'retrying';

export type LifecycleChecklistItem = {
  id: string;
  label: string;
  status: LifecycleStepStatus;
};

export function defaultLifecycleChecklist(
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  const entity = resolveCanonicalEntityId(entityId) ?? 'ENT-FIRM';
  let base: LifecycleChecklistItem[];
  if (kind === 'joiner') {
    base = [
      { id: 'profile_create', label: 'Create/update Tage profile', status: 'pending' },
      {
        id: 'home_entity_role',
        label: `Set home entity + role (${entity})`,
        status: 'pending',
      },
      {
        id: 'provision_messaging',
        label: 'Provision messaging membership + default channels',
        status: 'pending',
      },
      {
        id: 'provision_ticketing',
        label: 'Scope ticketing to home entity',
        status: 'pending',
      },
      {
        id: 'onboarding_checklist',
        label: 'IT onboarding checklist (hardware/license/MDM)',
        status: 'pending',
      },
      {
        id: 'microsoft_groups',
        label: 'Microsoft Entra group assign',
        status: 'pending',
      },
    ];
  } else if (kind === 'mover') {
    base = [
      { id: 'update_entity_role', label: 'Update entity + role', status: 'pending' },
      {
        id: 'rescope_messaging',
        label: 'Re-scope messaging memberships',
        status: 'pending',
      },
      {
        id: 'rescope_ticketing',
        label: 'Re-scope ticketing visibility',
        status: 'pending',
      },
      {
        id: 'microsoft_groups',
        label: 'Update Microsoft Entra groups',
        status: 'pending',
      },
    ];
  } else {
    // leaver — revoke-first
    base = [
      {
        id: 'revoke_portal',
        label: 'Revoke portal/SSO access (first)',
        status: 'pending',
      },
      {
        id: 'revoke_messaging',
        label: 'Deprovision messaging memberships',
        status: 'pending',
      },
      {
        id: 'revoke_ticketing',
        label: 'Revoke ticketing write scope',
        status: 'pending',
      },
      {
        id: 'offboarding_checklist',
        label: 'IT offboarding (MDM wipe / licenses)',
        status: 'pending',
      },
      {
        id: 'evidence_pack',
        label: 'Capture leaver evidence pack',
        status: 'pending',
      },
    ];
  }
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
