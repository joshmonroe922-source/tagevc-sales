/**
 * Workbook Portal_Admin_Access matrix × OS session roles.
 * Deny by default. Entity scope: ALL | entity_id.
 */

import type { AppRole } from '@/lib/types/roles';
import type {
  AdminRoleId,
  VmPermissionKey,
} from '@/lib/vendor-mgmt/types';

export const VM_PERMISSION_MATRIX: Record<
  AdminRoleId,
  Record<VmPermissionKey, boolean>
> = {
  'AR-SUPER': {
    login_portal: true,
    view_vendors: true,
    create_vendor: true,
    edit_vendor: true,
    archive_vendor: true,
    edit_contracts: true,
    manage_seats: true,
    approve_renewal: true,
    manage_products: true,
    manage_role_rules: true,
    manage_employees: true,
    manage_admins: true,
    view_audit_log: true,
    export_data: true,
  },
  'AR-VEND': {
    login_portal: true,
    view_vendors: true,
    create_vendor: true,
    edit_vendor: true,
    archive_vendor: true,
    edit_contracts: true,
    manage_seats: true,
    approve_renewal: false,
    manage_products: true,
    manage_role_rules: false,
    manage_employees: false,
    manage_admins: false,
    view_audit_log: true,
    export_data: true,
  },
  'AR-FIN': {
    login_portal: true,
    view_vendors: true,
    create_vendor: false,
    edit_vendor: false,
    archive_vendor: false,
    edit_contracts: true,
    manage_seats: false,
    approve_renewal: true,
    manage_products: false,
    manage_role_rules: false,
    manage_employees: false,
    manage_admins: false,
    view_audit_log: true,
    export_data: true,
  },
  'AR-IT': {
    login_portal: true,
    view_vendors: true,
    create_vendor: false,
    edit_vendor: true,
    archive_vendor: false,
    edit_contracts: false,
    manage_seats: true,
    approve_renewal: false,
    manage_products: true,
    manage_role_rules: true,
    manage_employees: false,
    manage_admins: false,
    view_audit_log: true,
    export_data: true,
  },
  'AR-HR': {
    login_portal: true,
    view_vendors: true,
    create_vendor: false,
    edit_vendor: false,
    archive_vendor: false,
    edit_contracts: false,
    manage_seats: true,
    approve_renewal: false,
    manage_products: false,
    manage_role_rules: false,
    manage_employees: true,
    manage_admins: false,
    view_audit_log: true,
    export_data: false,
  },
  'AR-VIEW': {
    login_portal: true,
    view_vendors: true,
    create_vendor: false,
    edit_vendor: false,
    archive_vendor: false,
    edit_contracts: false,
    manage_seats: false,
    approve_renewal: false,
    manage_products: false,
    manage_role_rules: false,
    manage_employees: false,
    manage_admins: false,
    view_audit_log: false,
    export_data: true,
  },
  'AR-ENT': {
    login_portal: true,
    view_vendors: true,
    create_vendor: true,
    edit_vendor: true,
    archive_vendor: true,
    edit_contracts: true,
    manage_seats: true,
    approve_renewal: true,
    manage_products: true,
    manage_role_rules: true,
    manage_employees: true,
    manage_admins: false,
    view_audit_log: true,
    export_data: true,
  },
};

/** Map OS AppRole → workbook admin role for portal gates. */
export function osRoleToVmAdminRole(role: AppRole | string | null): AdminRoleId {
  switch (role) {
    case 'visionary':
    case 'think_tank':
    case 'admin':
    case 'coo':
      return 'AR-SUPER';
    case 'ssc_it':
      return 'AR-IT';
    case 'ssc_finance':
      return 'AR-FIN';
    case 'ssc_hr':
      return 'AR-HR';
    case 'sub_lead':
    case 'service_lead':
      return 'AR-ENT';
    case 'partner':
    case 'counsel_ops':
      return 'AR-VEND';
    default:
      return 'AR-VIEW';
  }
}

export function vmHasPermission(
  adminRole: AdminRoleId,
  permission: VmPermissionKey,
): boolean {
  return VM_PERMISSION_MATRIX[adminRole]?.[permission] === true;
}

export function vmCanAccessEntityScope(opts: {
  adminRole: AdminRoleId;
  scope: string; // ALL | entity_id
  targetEntityId: string;
  firmWide: boolean;
  profileEntityId: string | null;
}): boolean {
  if (opts.firmWide || opts.adminRole === 'AR-SUPER') return true;
  if (opts.scope === 'ALL') return true;
  if (opts.scope === opts.targetEntityId) return true;
  if (
    opts.adminRole === 'AR-ENT' &&
    opts.profileEntityId &&
    opts.profileEntityId === opts.targetEntityId
  ) {
    return true;
  }
  return opts.profileEntityId === opts.targetEntityId;
}

/** Step-up MFA required for contract $ edits / renewal approval (workbook). */
export function vmRequiresStepUp(permission: VmPermissionKey): boolean {
  return permission === 'edit_contracts' || permission === 'approve_renewal';
}
