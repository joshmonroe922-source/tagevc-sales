/**
 * Birthright entitlement materialize / revoke (sheet 05 §4 / P2).
 * Extends Vendor Management role_products — no parallel entitlement store.
 */

import { createPersistClient } from '@/lib/supabase/persist-client';
import { writeIdentityAudit } from '@/lib/identity/audit';

export type EntitlementJobResult = {
  ok: boolean;
  assigned?: number;
  revoked?: number;
  detail: string;
};

async function ensureVmEmployee(payload: {
  employee_id: string;
  entity_id: string;
  name?: string;
  role_id?: string | null;
}): Promise<void> {
  const sb = await createPersistClient();
  const { data: existing } = await sb
    .from('vm_employees')
    .select('id')
    .eq('id', payload.employee_id)
    .maybeSingle();
  if (existing) return;

  await sb.from('vm_employees').upsert(
    {
      id: payload.employee_id,
      name: payload.name || `HRIS ${payload.employee_id.slice(0, 8)}`,
      entity_id: payload.entity_id,
      role_id: payload.role_id ?? null,
      status: 'Active',
    },
    { onConflict: 'id' },
  );
}

export async function handleEntitlementMaterialize(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  primary_role_id: string;
  secondary_role_ids?: string[];
  hired?: { legal_first_name?: string; legal_last_name?: string };
}): Promise<EntitlementJobResult> {
  const sb = await createPersistClient();
  const name = payload.hired
    ? `${payload.hired.legal_first_name ?? ''} ${payload.hired.legal_last_name ?? ''}`.trim()
    : undefined;

  await ensureVmEmployee({
    employee_id: payload.employee_id,
    entity_id: payload.entity_id,
    name,
    role_id: payload.primary_role_id,
  });

  const roleIds = [
    payload.primary_role_id,
    ...(payload.secondary_role_ids ?? []),
  ].filter(Boolean);

  const { data: rules } = await sb
    .from('vm_role_products')
    .select('product_id, is_birthright, entity_id, byod_allowed')
    .in('role_id', roleIds);

  const products = (rules ?? []).filter((r) => {
    if (!r.is_birthright) return false;
    if (r.entity_id && r.entity_id !== payload.entity_id) return false;
    return true;
  });

  let assigned = 0;
  for (const p of products) {
    const { error } = await sb.from('vm_entitlements').upsert(
      {
        emp_id: payload.employee_id,
        product_id: p.product_id,
        assigned: true,
        source: 'birthright',
        entity_id: payload.entity_id,
        correlation_id: payload.correlation_id,
        provision_status: 'provisioned',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'emp_id,product_id' },
    );
    if (!error) {
      assigned += 1;
      await writeIdentityAudit({
        action: 'entitlement_assign',
        entity_id: payload.entity_id,
        employee_id: payload.employee_id,
        correlation_id: payload.correlation_id,
        case_id: payload.case_id,
        title: `Birthright granted ${p.product_id}`,
        object_type: 'entitlement',
        object_id: p.product_id,
        source_system: 'orchestrator',
      });
    }
  }

  return {
    ok: true,
    assigned,
    detail: `Materialized ${assigned} birthright entitlements`,
  };
}

export async function handleEntitlementRevokeAll(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
}): Promise<EntitlementJobResult> {
  const sb = await createPersistClient();
  const { data: rows } = await sb
    .from('vm_entitlements')
    .select('product_id')
    .eq('emp_id', payload.employee_id)
    .eq('assigned', true);

  await sb
    .from('vm_entitlements')
    .update({
      assigned: false,
      provision_status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('emp_id', payload.employee_id);

  await sb
    .from('vm_employees')
    .update({ status: 'Terminated' })
    .eq('id', payload.employee_id);

  const revoked = rows?.length ?? 0;
  await writeIdentityAudit({
    action: 'entitlement_revoke',
    entity_id: payload.entity_id,
    employee_id: payload.employee_id,
    correlation_id: payload.correlation_id,
    case_id: payload.case_id,
    title: `Revoked ${revoked} entitlements`,
    after: { revoked },
    source_system: 'orchestrator',
  });

  return { ok: true, revoked, detail: `Revoked ${revoked}` };
}
