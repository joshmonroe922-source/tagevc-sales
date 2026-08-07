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

/** Resolve VM employee id — prefer HRIS projection link created by orchestrator. */
async function resolveVmEmployeeId(payload: {
  employee_id: string;
  entity_id: string;
  name?: string;
  role_id?: string | null;
}): Promise<string> {
  const sb = await createPersistClient();
  const { data: hris } = await sb
    .from('os_hris_employees')
    .select('vm_employee_id, full_name')
    .eq('id', payload.employee_id)
    .maybeSingle();

  const vmEmpId =
    (hris?.vm_employee_id as string | null) ||
    `VM-${payload.employee_id.replace(/-/g, '').slice(0, 12)}`;

  await sb.from('vm_employees').upsert(
    {
      id: vmEmpId,
      name:
        payload.name ||
        (hris?.full_name as string | undefined) ||
        `HRIS ${payload.employee_id.slice(0, 8)}`,
      entity_id: payload.entity_id,
      role_id: payload.role_id ?? null,
      status: 'Active',
    },
    { onConflict: 'id' },
  );

  if (!hris?.vm_employee_id) {
    await sb
      .from('os_hris_employees')
      .update({ vm_employee_id: vmEmpId })
      .eq('id', payload.employee_id);
  }

  return vmEmpId;
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

  const vmEmpId = await resolveVmEmployeeId({
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
        emp_id: vmEmpId,
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
  const vmEmpId = await resolveVmEmployeeId({
    employee_id: payload.employee_id,
    entity_id: payload.entity_id,
  });
  const { data: rows } = await sb
    .from('vm_entitlements')
    .select('product_id')
    .eq('emp_id', vmEmpId)
    .eq('assigned', true);

  await sb
    .from('vm_entitlements')
    .update({
      assigned: false,
      provision_status: 'revoked',
      updated_at: new Date().toISOString(),
    })
    .eq('emp_id', vmEmpId);

  await sb
    .from('vm_employees')
    .update({ status: 'Terminated' })
    .eq('id', vmEmpId);

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

/**
 * Mover delta: rematerialize birthright for new roles, revoke products no longer entitled.
 */
export async function handleEntitlementRematerialize(payload: {
  employee_id: string;
  entity_id: string;
  case_id: string;
  correlation_id: string;
  primary_role_id: string;
  secondary_role_ids?: string[];
}): Promise<EntitlementJobResult> {
  const sb = await createPersistClient();
  const vmEmpId = await resolveVmEmployeeId({
    employee_id: payload.employee_id,
    entity_id: payload.entity_id,
    role_id: payload.primary_role_id,
  });

  const roleIds = [
    payload.primary_role_id,
    ...(payload.secondary_role_ids ?? []),
  ].filter(Boolean);

  const { data: rules } = await sb
    .from('vm_role_products')
    .select('product_id, is_birthright, entity_id')
    .in('role_id', roleIds);

  const wanted = new Set(
    (rules ?? [])
      .filter((r) => {
        if (!r.is_birthright) return false;
        if (r.entity_id && r.entity_id !== payload.entity_id) return false;
        return true;
      })
      .map((r) => r.product_id as string),
  );

  const { data: current } = await sb
    .from('vm_entitlements')
    .select('product_id, assigned')
    .eq('emp_id', vmEmpId);

  let assigned = 0;
  let revoked = 0;

  for (const row of current ?? []) {
    if (row.assigned && !wanted.has(row.product_id)) {
      await sb
        .from('vm_entitlements')
        .update({
          assigned: false,
          provision_status: 'revoked',
          updated_at: new Date().toISOString(),
        })
        .eq('emp_id', vmEmpId)
        .eq('product_id', row.product_id);
      revoked += 1;
      await writeIdentityAudit({
        action: 'entitlement_revoke',
        entity_id: payload.entity_id,
        employee_id: payload.employee_id,
        correlation_id: payload.correlation_id,
        case_id: payload.case_id,
        title: `Mover revoked ${row.product_id}`,
        object_type: 'entitlement',
        object_id: row.product_id,
        source_system: 'orchestrator',
      });
    }
  }

  for (const productId of wanted) {
    const { error } = await sb.from('vm_entitlements').upsert(
      {
        emp_id: vmEmpId,
        product_id: productId,
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
        title: `Mover granted ${productId}`,
        object_type: 'entitlement',
        object_id: productId,
        source_system: 'orchestrator',
      });
    }
  }

  await sb
    .from('vm_employees')
    .update({ role_id: payload.primary_role_id, entity_id: payload.entity_id })
    .eq('id', vmEmpId);

  return {
    ok: true,
    assigned,
    revoked,
    detail: `Mover delta: +${assigned} / -${revoked}`,
  };
}
