/**
 * Session gate for Vendor Management — OS RBAC + workbook permission matrix.
 * OS gate: read:shared_services (Finance / HR / IT / firm roles).
 * Fine-grained: AR-* matrix from Portal_Admin_Access.
 */

import { isFirmWideAccess } from '@/lib/rbac/entity-scope';
import { getSessionContext } from '@/lib/rbac/session';
import { roleHasPermission, type AppRole } from '@/lib/types/roles';
import {
  osRoleToVmAdminRole,
  vmCanAccessEntityScope,
  vmHasPermission,
  vmRequiresStepUp,
} from '@/lib/vendor-mgmt/permissions';
import type { AdminRoleId, VmPermissionKey } from '@/lib/vendor-mgmt/types';

export type VmSession = {
  email: string | null;
  role: AppRole | string;
  adminRole: AdminRoleId;
  firmWide: boolean;
  profileEntityId: string | null;
  /** Effective filter entity — null means all (firm-wide). */
  filterEntityId: string | null;
  /** True when permission needs step-up MFA (contract $ / renewal approve). */
  needsStepUp: boolean;
};

function canAccessVendorMgmtOs(role: AppRole | string): boolean {
  // Shared Services desk roles (Finance/HR/IT/…) + firm operators with IT assets.
  return (
    roleHasPermission(role as AppRole, 'read:shared_services') ||
    roleHasPermission(role as AppRole, 'read:it_assets')
  );
}

export async function requireVmSession(
  permission: VmPermissionKey = 'view_vendors',
): Promise<VmSession> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error('Forbidden');
  if (ctx.liveLookActive) throw new Error('Live Look is read-only');

  const role = ctx.profile.role;
  if (!canAccessVendorMgmtOs(role)) {
    throw new Error('Forbidden');
  }

  const adminRole = osRoleToVmAdminRole(role);
  const firmWide = isFirmWideAccess(
    ctx.profile.role,
    ctx.profile.entity_id,
    ctx.activeEntityOs,
  );
  const profileEntityId = ctx.profile.entity_id ?? null;

  if (!vmHasPermission(adminRole, 'login_portal')) {
    throw new Error('Vendor Management portal login denied');
  }
  if (!vmHasPermission(adminRole, permission)) {
    throw new Error(`Missing Vendor Management permission: ${permission}`);
  }

  return {
    email: ctx.profile.email ?? null,
    role,
    adminRole,
    firmWide,
    profileEntityId,
    filterEntityId: firmWide ? null : profileEntityId,
    needsStepUp: vmRequiresStepUp(permission),
  };
}

export function vmSessionCanEntity(
  session: VmSession,
  targetEntityId: string,
): boolean {
  return vmCanAccessEntityScope({
    adminRole: session.adminRole,
    scope: session.firmWide ? 'ALL' : (session.profileEntityId ?? ''),
    targetEntityId,
    firmWide: session.firmWide,
    profileEntityId: session.profileEntityId,
  });
}

export function vmCanWrite(
  session: VmSession,
  permission: VmPermissionKey,
): boolean {
  return vmHasPermission(session.adminRole, permission);
}
