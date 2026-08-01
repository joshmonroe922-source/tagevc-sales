/**
 * Partner hooks injected into joiner / leaver checklists (scaffold only).
 */

import type { LifecycleChecklistItem, LifecycleKind } from '@/lib/multi-sub/lifecycle';
import {
  runPartnerLifecycleHook,
  type AdapterResult,
} from '@/lib/partners/adapters';
import { buildPartnerSpineProvisionPlan } from '@/lib/partners/provision';
import { recordPartnerEvent } from '@/lib/partners/repo';

export function partnerLifecycleChecklistItems(
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  const entity = entityId?.trim() || 'ENT-FIRM';
  const plan = buildPartnerSpineProvisionPlan(entity);
  const hooks =
    kind === 'leaver'
      ? plan.lifecycle_hooks.leaver
      : kind === 'joiner'
        ? plan.lifecycle_hooks.joiner
        : [];

  return hooks.map((id) => ({
    id: `partner_${id}`,
    label: humanizePartnerHook(id),
    status: 'pending',
  }));
}

function humanizePartnerHook(id: string): string {
  const map: Record<string, string> = {
    partner_spine_enablements_ensure: 'Ensure partner spine enablements for home entity',
    marketing_presence_slots_ensure:
      'Ensure Marketing presence slots (GBP · GA4 · LinkedIn Company)',
    gusto_employee_stub_if_internal: 'Gusto payroll stub (internal hire)',
    dialpad_user_stub_if_phone: 'Dialpad user provision stub',
    docusign_template_scope_note: 'DocuSign template scope note for entity',
    dialpad_revoke_stub: 'Revoke Dialpad access (stub)',
    gusto_terminate_stub: 'Gusto terminate / off-cycle stub',
    marketing_presence_editor_revoke_stub:
      'Revoke Marketing presence editor access (stub)',
    apollo_user_revoke_stub: 'Revoke Apollo seat (stub)',
  };
  return map[id] ?? id.replace(/_/g, ' ');
}

export function mergePartnerLifecycleItems(
  base: LifecycleChecklistItem[],
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  if (kind !== 'joiner' && kind !== 'leaver') return base;
  const extras = partnerLifecycleChecklistItems(kind, entityId);
  const seen = new Set(base.map((b) => b.id));
  return [...base, ...extras.filter((e) => !seen.has(e.id))];
}


/** Mark/run a partner_* checklist item via fail-closed adapters + event bus. */
export async function completePartnerLifecycleHook(input: {
  checklistItemId: string;
  entityId: string;
  email?: string;
  userExternalId?: string;
}): Promise<AdapterResult> {
  const hookId = input.checklistItemId.startsWith('partner_')
    ? input.checklistItemId
    : `partner_${input.checklistItemId}`;
  const result = await runPartnerLifecycleHook(hookId, {
    entityId: input.entityId,
    email: input.email,
    userExternalId: input.userExternalId,
  });
  await recordPartnerEvent({
    partner_key: 'apollo',
    entity_id: input.entityId,
    kind: 'provision',
    external_id: hookId,
    payload: {
      hook: hookId,
      ok: result.ok,
      dry_run: 'dryRun' in result ? result.dryRun : undefined,
      message: result.ok ? result.message : result.error,
    },
  });
  return result;
}
