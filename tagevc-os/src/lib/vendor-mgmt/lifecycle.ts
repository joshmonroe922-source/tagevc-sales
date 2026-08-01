/**
 * Onboard / offboard / transfer — birthright + revoke rules from workbook.
 */

import {
  createLifecycleCase,
  deactivateAdminByEmpId,
  listRoleProducts,
  revokeAllEntitlements,
  setEntitlement,
  upsertEmployee,
  appendAuditEvent,
  getVmSettings,
  listEmployees,
} from '@/lib/vendor-mgmt/repo';
import type { VmEmployee } from '@/lib/vendor-mgmt/types';

function caseId(prefix: string, empId: string): string {
  return `${prefix}-${empId}-${Date.now().toString(36)}`;
}

/** Assign birthright products for Active employee role. */
export async function applyBirthrightForEmployee(
  emp: VmEmployee,
): Promise<number> {
  if (emp.status !== 'Active' || !emp.role_id) return 0;
  const rules = await listRoleProducts(emp.role_id);
  let n = 0;
  for (const r of rules) {
    if (!r.is_birthright) continue;
    const ok = await setEntitlement(emp.id, r.product_id, true, 'birthright');
    if (ok) n += 1;
  }
  return n;
}

/**
 * Terminate employee: zero entitlements, deactivate linked portal admin,
 * open offboard case.
 */
export async function terminateEmployee(
  empId: string,
  actorEmail?: string | null,
): Promise<{
  ok: boolean;
  revoked: number;
  adminsDeactivated: number;
  caseId: string | null;
}> {
  const employees = await listEmployees();
  const emp = employees.find((e) => e.id === empId);
  if (!emp) {
    return { ok: false, revoked: 0, adminsDeactivated: 0, caseId: null };
  }

  const updated = await upsertEmployee({
    ...emp,
    status: 'Terminated',
  });
  if (!updated) {
    return { ok: false, revoked: 0, adminsDeactivated: 0, caseId: null };
  }

  const revoked = await revokeAllEntitlements(empId);
  const adminsDeactivated = await deactivateAdminByEmpId(empId);
  const lc = await createLifecycleCase({
    id: caseId('OFF', empId),
    emp_id: empId,
    event: 'Offboard',
    role_id: emp.role_id,
    entity_id: emp.entity_id,
    notes: 'Auto-created on terminate',
  });

  await appendAuditEvent({
    actor_email: actorEmail ?? null,
    action: 'employee.offboard',
    entity_id: emp.entity_id,
    object_type: 'employee',
    object_id: empId,
    field: 'status',
    old_value: 'Active',
    new_value: 'Terminated',
  });
  await appendAuditEvent({
    actor_email: actorEmail ?? null,
    action: 'license.bulk_revoke',
    entity_id: emp.entity_id,
    object_type: 'employee',
    object_id: empId,
    new_value: String(revoked),
  });

  return {
    ok: true,
    revoked,
    adminsDeactivated,
    caseId: lc?.id ?? null,
  };
}

export async function onboardEmployee(
  emp: VmEmployee,
  actorEmail?: string | null,
): Promise<{ assigned: number; caseId: string | null }> {
  const assigned = await applyBirthrightForEmployee(emp);
  const lc = await createLifecycleCase({
    id: caseId('ON', emp.id),
    emp_id: emp.id,
    event: 'Onboard',
    role_id: emp.role_id,
    entity_id: emp.entity_id,
  });
  await appendAuditEvent({
    actor_email: actorEmail ?? null,
    action: 'employee.create',
    entity_id: emp.entity_id,
    object_type: 'employee',
    object_id: emp.id,
  });
  await appendAuditEvent({
    actor_email: actorEmail ?? null,
    action: 'license.provision',
    entity_id: emp.entity_id,
    object_type: 'employee',
    object_id: emp.id,
    new_value: String(assigned),
  });
  return { assigned, caseId: lc?.id ?? null };
}

/** DB offboard alias. Pure planner lives in normalize.applyOffboardRevoke. */
export const revokeEmployeeAccess = terminateEmployee;

/** Plan birthright product IDs for a role (hire) — DB-backed. */
export async function planBirthrightProductIds(roleId: string): Promise<string[]> {
  const rules = await listRoleProducts(roleId);
  return rules.filter((r) => r.is_birthright).map((r) => r.product_id);
}

export async function transferEmployeeRole(
  empId: string,
  newRoleId: string,
  actorEmail?: string | null,
): Promise<{ added: number; removed: number; caseId: string | null }> {
  const employees = await listEmployees();
  const emp = employees.find((e) => e.id === empId);
  if (!emp) return { added: 0, removed: 0, caseId: null };

  const oldRole = emp.role_id;
  await upsertEmployee({ ...emp, role_id: newRoleId });

  const oldRules = oldRole ? await listRoleProducts(oldRole) : [];
  const newRules = await listRoleProducts(newRoleId);
  const oldSet = new Set(
    oldRules.filter((r) => r.is_birthright).map((r) => r.product_id),
  );
  const newSet = new Set(
    newRules.filter((r) => r.is_birthright).map((r) => r.product_id),
  );

  let removed = 0;
  let added = 0;
  for (const pid of oldSet) {
    if (!newSet.has(pid)) {
      if (await setEntitlement(empId, pid, false)) removed += 1;
    }
  }
  for (const pid of newSet) {
    if (!oldSet.has(pid)) {
      if (await setEntitlement(empId, pid, true, 'birthright')) added += 1;
    }
  }

  const lc = await createLifecycleCase({
    id: caseId('TR', empId),
    emp_id: empId,
    event: 'Transfer',
    role_id: newRoleId,
    entity_id: emp.entity_id,
  });

  await appendAuditEvent({
    actor_email: actorEmail ?? null,
    action: 'employee.transfer',
    entity_id: emp.entity_id,
    object_type: 'employee',
    object_id: empId,
    field: 'role_id',
    old_value: oldRole,
    new_value: newRoleId,
  });

  void getVmSettings();
  return { added, removed, caseId: lc?.id ?? null };
}
