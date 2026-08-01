import { describe, expect, it } from 'vitest';
import { VM_PERMISSION_MATRIX } from '@/lib/vendor-mgmt/permissions';
import { osRoleToVmAdminRole, vmHasPermission } from '@/lib/vendor-mgmt/permissions';

describe('offboard / admin permission contract', () => {
  it('Entity Owner cannot manage admins; Super can', () => {
    expect(vmHasPermission('AR-ENT', 'manage_admins')).toBe(false);
    expect(vmHasPermission('AR-SUPER', 'manage_admins')).toBe(true);
  });

  it('IT cannot edit contracts $; Finance can approve renewals', () => {
    expect(vmHasPermission('AR-IT', 'edit_contracts')).toBe(false);
    expect(vmHasPermission('AR-FIN', 'approve_renewal')).toBe(true);
    expect(vmHasPermission('AR-VEND', 'approve_renewal')).toBe(false);
  });

  it('maps OS roles onto workbook admin roles', () => {
    expect(osRoleToVmAdminRole('visionary')).toBe('AR-SUPER');
    expect(osRoleToVmAdminRole('ssc_it')).toBe('AR-IT');
    expect(osRoleToVmAdminRole('ssc_finance')).toBe('AR-FIN');
    expect(osRoleToVmAdminRole('ssc_hr')).toBe('AR-HR');
    expect(osRoleToVmAdminRole('sub_lead')).toBe('AR-ENT');
  });

  it('permission matrix has all seven roles', () => {
    expect(Object.keys(VM_PERMISSION_MATRIX).sort()).toEqual(
      [
        'AR-ENT',
        'AR-FIN',
        'AR-HR',
        'AR-IT',
        'AR-SUPER',
        'AR-VEND',
        'AR-VIEW',
      ].sort(),
    );
  });
});
