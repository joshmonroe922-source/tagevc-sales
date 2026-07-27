import { describe, expect, it } from 'vitest';
import {
  canManageDocumentAcl,
  canViewDocumentForRole,
  canViewFullDocumentLibrary,
  canViewLibraryFolderForRole,
  resolveDocumentVisibleRoles,
} from '@/lib/documents/visibility';
import type { AppRole } from '@/lib/types/roles';

describe('document library role ACL', () => {
  it('gives Visionary/Admin full library + ACL management', () => {
    expect(canViewFullDocumentLibrary('visionary')).toBe(true);
    expect(canViewFullDocumentLibrary('admin')).toBe(true);
    expect(canViewFullDocumentLibrary('associate')).toBe(false);
    expect(canManageDocumentAcl('visionary')).toBe(true);
    expect(canManageDocumentAcl('service_lead')).toBe(false);
  });

  it('restricts 05_HR by default but not open folders', () => {
    expect(canViewLibraryFolderForRole('associate', '05_HR')).toBe(false);
    expect(canViewLibraryFolderForRole('coo', '05_HR')).toBe(true);
    expect(canViewLibraryFolderForRole('associate', '02_Deal')).toBe(true);
    expect(canViewLibraryFolderForRole('visionary', '05_HR')).toBe(true);
  });

  it('honors per-file visible_roles over folder default', () => {
    const restricted = {
      folder: '02_Deal',
      visible_roles: ['counsel_ops' as const],
    };
    expect(resolveDocumentVisibleRoles(restricted)).toEqual(['counsel_ops']);
    expect(canViewDocumentForRole('associate', restricted)).toBe(false);
    expect(canViewDocumentForRole('counsel_ops', restricted)).toBe(true);
    expect(canViewDocumentForRole('admin', restricted)).toBe(true);

    const openOverride = {
      folder: '05_HR',
      visible_roles: [] as AppRole[],
    };
    expect(resolveDocumentVisibleRoles(openOverride)).toBeNull();
    expect(canViewDocumentForRole('associate', openOverride)).toBe(true);

    const inheritHr = { folder: '05_HR', visible_roles: null };
    expect(canViewDocumentForRole('associate', inheritHr)).toBe(false);
    expect(canViewDocumentForRole('service_lead', inheritHr)).toBe(true);
  });
});
