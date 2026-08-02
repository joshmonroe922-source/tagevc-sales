/** Pure joiner/mover/leaver checklist defaults — safe for client bundles. */

import { resolveCanonicalEntityId } from '@/lib/multi-sub/entity-registry';

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

/** Base checklist without partner-hook merges (client-safe). */
export function baseLifecycleChecklist(
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  const entity = resolveCanonicalEntityId(entityId) ?? 'ENT-FIRM';
  if (kind === 'joiner') {
    return [
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
  }
  if (kind === 'mover') {
    return [
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
  }
  // leaver — revoke-first
  return [
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
