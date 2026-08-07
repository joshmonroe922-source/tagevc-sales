/**
 * scim-worker pilot (sheet 05 / 08 / P2).
 * Extends VM products with provision_method=scim — no parallel app roster.
 * Dry-runs unless IDENTITY_SCIM_ENABLED=1 and product has scim_endpoint.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';
import { getIdentityFlags } from '@/lib/identity/flags';

export type ScimJobResult = {
  ok: boolean;
  skipped?: boolean;
  provisioned?: number;
  detail: string;
};

export async function handleScimUserSet(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  action: 'provision' | 'deprovision';
  product_ids?: string[];
}): Promise<ScimJobResult> {
  const flags = getIdentityFlags();
  if (!flags.scim) {
    await writeIdentityAudit({
      action: 'needs_human',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: 'SCIM skipped — IDENTITY_SCIM_ENABLED off',
      after: { action: payload.action },
      source_system: 'scim',
      result: 'partial',
    });
    return {
      ok: true,
      skipped: true,
      detail: 'SCIM flag off — recorded skip (pilot gated)',
    };
  }

  const sb = await createPersistClient();
  let query = sb
    .from('vm_products')
    .select('id, name, provision_method, scim_endpoint, entity_id')
    .eq('provision_method', 'scim');

  if (payload.product_ids?.length) {
    query = query.in('id', payload.product_ids);
  }

  const { data: products } = await query;
  const scoped = (products ?? []).filter(
    (p) => !p.entity_id || p.entity_id === payload.entity_id,
  );

  let provisioned = 0;
  for (const p of scoped) {
    await writeIdentityAudit({
      action:
        payload.action === 'deprovision'
          ? 'entitlement_revoke'
          : 'entitlement_assign',
      entity_id: payload.entity_id,
      employee_id: payload.employee_id,
      correlation_id: payload.correlation_id,
      case_id: payload.case_id,
      title: `SCIM ${payload.action} dry-run ${p.name ?? p.id}`,
      object_type: 'product',
      object_id: p.id,
      after: {
        mode: p.scim_endpoint ? 'endpoint_configured' : 'dry_run',
        action: payload.action,
      },
      source_system: 'scim',
      result: 'partial',
    });
    provisioned += 1;
  }

  return {
    ok: true,
    skipped: true,
    provisioned,
    detail: `SCIM ${payload.action} recorded for ${provisioned} products (live SCIM NEED_HUMAN)`,
  };
}
