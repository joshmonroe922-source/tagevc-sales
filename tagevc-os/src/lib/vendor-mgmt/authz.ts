/**
 * Compatibility shim — prefer `@/lib/vendor-mgmt/permissions`.
 * Maps older permission key names used by parallel drafts.
 */

import type { AppRole } from '@/lib/types/roles';
import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import {
  VM_PERMISSION_MATRIX as BASE_MATRIX,
  osRoleToVmAdminRole,
  vmHasPermission,
  vmRequiresStepUp,
} from '@/lib/vendor-mgmt/permissions';
import type { AdminRoleId, VmPermissionKey as CanonicalKey } from '@/lib/vendor-mgmt/types';

export type VmAdminRoleId = AdminRoleId;

/** Legacy keys from earlier draft — normalize to workbook keys. */
export type VmPermissionKey =
  | CanonicalKey
  | 'login'
  | 'edit_contracts_usd'
  | 'view_audit';

function canonicalize(permission: VmPermissionKey): CanonicalKey {
  if (permission === 'login') return 'login_portal';
  if (permission === 'edit_contracts_usd') return 'edit_contracts';
  if (permission === 'view_audit') return 'view_audit_log';
  return permission;
}

export const VM_PERMISSION_MATRIX = BASE_MATRIX;

export function defaultVmRoleForOsRole(
  role: AppRole | string,
  _firmWide?: boolean,
): VmAdminRoleId {
  return osRoleToVmAdminRole(role);
}

export type VmAuthzContext = {
  roleId: VmAdminRoleId;
  entityScope: 'ALL' | string;
  email?: string | null;
};

export function canVm(
  ctx: VmAuthzContext,
  permission: VmPermissionKey,
  vendorEntityId?: string | null,
): boolean {
  const key = canonicalize(permission);
  if (!vmHasPermission(ctx.roleId, key)) return false;
  if (ctx.entityScope === 'ALL') return true;
  if (!vendorEntityId) return true;
  return ctx.entityScope === vendorEntityId;
}

export function buildVmAuthzFromSession(opts: {
  role: AppRole | string;
  entityId: string | null;
  email?: string | null;
  adminRoleId?: VmAdminRoleId | null;
  adminEntityScope?: string | null;
}): VmAuthzContext {
  const firmWide = isFirmWideAccess(opts.role as AppRole, opts.entityId);
  if (opts.adminRoleId && BASE_MATRIX[opts.adminRoleId]) {
    return {
      roleId: opts.adminRoleId,
      entityScope:
        (opts.adminEntityScope as 'ALL') ||
        (firmWide ? 'ALL' : opts.entityId || 'ALL'),
      email: opts.email,
    };
  }
  return {
    roleId: osRoleToVmAdminRole(opts.role),
    entityScope: firmWide ? 'ALL' : opts.entityId || 'ALL',
    email: opts.email,
  };
}

export function requiresStepUp(permission: VmPermissionKey): boolean {
  return vmRequiresStepUp(canonicalize(permission));
}
