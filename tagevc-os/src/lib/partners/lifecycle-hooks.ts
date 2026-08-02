/**
 * Partner hooks injected into joiner / leaver checklists (scaffold only).
 */

import type {
  LifecycleChecklistItem,
  LifecycleKind,
} from '@/lib/multi-sub/lifecycle-defaults';
import {
  runPartnerLifecycleHook,
  type AdapterResult,
} from '@/lib/partners/adapters';
import { buildPartnerSpineProvisionPlan } from '@/lib/partners/provision';
import {
  joinerPartnerHooks,
  leaverPartnerHooks,
} from '@/lib/partners/registry';
import { recordPartnerEvent } from '@/lib/partners/repo';

function uniqueHooks(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

export function partnerLifecycleChecklistItems(
  kind: LifecycleKind,
  entityId: string | null | undefined,
): LifecycleChecklistItem[] {
  const entity = entityId?.trim() || 'ENT-FIRM';
  const plan = buildPartnerSpineProvisionPlan(entity);
  const catalogHooks =
    kind === 'leaver'
      ? leaverPartnerHooks(entity)
      : kind === 'joiner'
        ? joinerPartnerHooks(entity)
        : [];
  const spineHooks =
    kind === 'leaver'
      ? plan.lifecycle_hooks.leaver
      : kind === 'joiner'
        ? plan.lifecycle_hooks.joiner
        : [];
  const hooks = uniqueHooks([...spineHooks, ...catalogHooks]);

  return hooks.map((id) => ({
    id: `partner_${id}`,
    label: humanizePartnerHook(id),
    status: 'pending',
  }));
}

function humanizePartnerHook(id: string): string {
  const map: Record<string, string> = {
    partner_spine_enablements_ensure:
      'Ensure partner spine enablements for home entity',
    marketing_presence_slots_ensure:
      'Ensure Marketing presence slots (GBP · GA4 · LinkedIn Company)',
    gusto_employee_stub_if_internal: 'Gusto payroll stub (internal hire)',
    provision_gusto_employee: 'Gusto employee provision (stub)',
    terminate_gusto_employee: 'Gusto terminate / off-cycle stub',
    dialpad_user_stub_if_phone: 'Dialpad user provision stub',
    provision_dialpad_user: 'Dialpad user provision (stub)',
    revoke_dialpad_user: 'Revoke Dialpad access (stub)',
    pending_verified_first_if_required:
      'Verified First screening if role requires',
    docusign_template_scope_note: 'DocuSign template scope note for entity',
    dialpad_revoke_stub: 'Revoke Dialpad access (stub)',
    gusto_terminate_stub: 'Gusto terminate / off-cycle stub',
    marketing_presence_editor_revoke_stub:
      'Revoke Marketing presence editor access (stub)',
    revoke_google_business_managers_if_sole:
      'Revoke Google Business managers if sole admin',
    revoke_linkedin_company_admin_if_sole:
      'Revoke LinkedIn Company admin if sole editor',
    apollo_user_revoke_stub: 'Revoke Apollo seat (stub)',
    ensure_dialpad_office: 'Ensure Dialpad office binding (entity create)',
    seed_screening_entity_defaults:
      'Seed Verified First screening defaults (entity create)',
    enable_mybasepay_if_recruiting:
      'Enable MyBasePay for recruiting entity (entity create)',
    ensure_apollo_workspace_binding:
      'Ensure Apollo workspace binding (entity create)',
    ensure_gusto_company_binding:
      'Ensure Gusto company binding (entity create)',
    ensure_docusign_account_binding:
      'Ensure DocuSign account binding (entity create)',
    ensure_linkedin_recruiter_seat_pool:
      'Ensure LinkedIn Recruiter seat pool (entity create)',
    ensure_appcast_employer_binding:
      'Ensure Appcast employer binding (entity create)',
    ensure_google_business_location_slot:
      'Ensure Google Business location slot (entity create)',
    ensure_ga4_property_binding: 'Ensure GA4 property binding (entity create)',
    ensure_linkedin_company_page_binding:
      'Ensure LinkedIn Company page binding (entity create)',
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
  const status =
    'status' in result && result.status
      ? result.status
      : result.ok && 'dryRun' in result && result.dryRun
        ? 'dry_run'
        : result.ok
          ? 'live_ok'
          : 'failed';
  await recordPartnerEvent({
    partner_key: 'apollo',
    entity_id: input.entityId,
    kind: 'provision',
    external_id: hookId,
    status: status === 'live_ok' ? 'processed' : status === 'failed' ? 'failed' : 'ignored',
    payload: {
      hook: hookId,
      ok: result.ok,
      status,
      dry_run: 'dryRun' in result ? result.dryRun : undefined,
      live_complete: status === 'live_ok',
      message: result.ok ? result.message : result.error,
    },
  });
  return result;
}
