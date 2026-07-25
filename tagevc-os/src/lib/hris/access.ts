/**
 * HRIS access helpers — compensation visibility + manager-owned steps.
 */

import type { AppRole } from '@/lib/types/roles';
import type { HrisProcessStep } from '@/lib/hris/types';

const COMP_ROLES = new Set<AppRole>([
  'visionary',
  'admin',
  'counsel_ops',
  'coo',
  'service_lead',
]);

const HRIS_HR_ROLES = new Set<AppRole>([
  'visionary',
  'admin',
  'coo',
  'counsel_ops',
  'service_lead',
]);

export function canViewHrisCompensation(role: AppRole): boolean {
  return COMP_ROLES.has(role);
}

/** Roles that may manage HRIS docs within entity scope (mirrors SQL is_hris_hr_role). */
export function isHrisHrRole(role: AppRole): boolean {
  return HRIS_HR_ROLES.has(role);
}

/**
 * Resolve employee id from hris-private object path.
 * New: {entity_id}/{employee_id}/...
 * Legacy: {employee_id}/...
 */
export function parseHrisStorageEmployeeId(path: string): string | null {
  const parts = path.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  const candidate = /^ENT-[A-Z0-9-]{1,32}$/.test(parts[0])
    ? parts[1]
    : parts[0];
  if (!candidate) return null;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      candidate,
    )
  ) {
    return null;
  }
  return candidate;
}

/** Pure ACL decision for vault access (mirrors SQL is_hris_employee_accessible). */
export function canAccessHrisEmployeeVault(input: {
  role: AppRole;
  profileId: string;
  employeeManagerProfileId: string | null;
  canAccessEntity: boolean;
}): boolean {
  if (input.role === 'visionary') return true;
  if (
    input.employeeManagerProfileId &&
    input.employeeManagerProfileId === input.profileId
  ) {
    return true;
  }
  if (isHrisHrRole(input.role) && input.canAccessEntity) return true;
  return false;
}

/** Manager-owned step roles (Hiring Manager / Manager). */
export function isManagerOwnedStep(step: Pick<HrisProcessStep, 'owner_role'>): boolean {
  const role = step.owner_role.toLowerCase();
  return (
    role.includes('hiring manager') ||
    role === 'manager' ||
    role.includes('direct manager')
  );
}

export function filterManagerVisibleSteps(
  steps: HrisProcessStep[],
): HrisProcessStep[] {
  return steps.filter(isManagerOwnedStep);
}
