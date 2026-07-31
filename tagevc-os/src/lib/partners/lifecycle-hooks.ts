/**
 * Partner hooks injected into joiner / leaver checklists (scaffold only).
 */

import type { LifecycleChecklistItem, LifecycleKind } from '@/lib/multi-sub/lifecycle';
import { buildPartnerSpineProvisionPlan } from '@/lib/partners/provision';

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
