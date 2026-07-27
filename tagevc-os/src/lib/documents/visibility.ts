import type { DocumentRecord } from '@/lib/types';
import type { EntityDocFolder } from '@/lib/types/enums';
import { APP_ROLES, APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

/** Roles that always see the whole Document Library (bypass role ACL). */
export const FULL_LIBRARY_ROLES: readonly AppRole[] = [
  'visionary',
  'admin',
] as const;

/**
 * Folder defaults when a file has no explicit `visible_roles`.
 * `null` = open to anyone with document module access (still entity-scoped).
 */
export const FOLDER_DEFAULT_VISIBLE_ROLES: Record<
  EntityDocFolder,
  readonly AppRole[] | null
> = {
  '01_Corporate': null,
  '02_Deal': null,
  '03_DD': null,
  '04_Financials': null,
  /** Employment / PII — restricted by default. */
  '05_HR': [
    'coo',
    'service_lead',
    'counsel_ops',
    'ssc_hr',
    'ssc_legal',
  ],
  '06_Ops': null,
  '07_Signed': null,
};

export function canViewFullDocumentLibrary(
  role: AppRole | null | undefined,
): boolean {
  if (!role) return false;
  return FULL_LIBRARY_ROLES.includes(role);
}

/** Visionary / Admin set per-file (and upload) role ACL. */
export function canManageDocumentAcl(
  role: AppRole | null | undefined,
): boolean {
  return canViewFullDocumentLibrary(role);
}

export function isEntityDocFolder(folder: string): folder is EntityDocFolder {
  return folder in FOLDER_DEFAULT_VISIBLE_ROLES;
}

/**
 * Effective role allow-list for a document.
 * - `null` → open (no role filter beyond module + entity scope)
 * - non-empty → only listed roles (+ full-library bypass)
 */
export function resolveDocumentVisibleRoles(
  doc: Pick<DocumentRecord, 'folder' | 'visible_roles'>,
): readonly AppRole[] | null {
  if (doc.visible_roles != null) {
    return doc.visible_roles.length > 0 ? doc.visible_roles : null;
  }
  if (isEntityDocFolder(doc.folder)) {
    return FOLDER_DEFAULT_VISIBLE_ROLES[doc.folder];
  }
  return null;
}

export function canViewDocumentForRole(
  role: AppRole | null | undefined,
  doc: Pick<DocumentRecord, 'folder' | 'visible_roles'>,
): boolean {
  if (!role) return false;
  if (canViewFullDocumentLibrary(role)) return true;
  const allowed = resolveDocumentVisibleRoles(doc);
  if (!allowed) return true;
  return allowed.includes(role);
}

export function canViewLibraryFolderForRole(
  role: AppRole | null | undefined,
  folder: EntityDocFolder,
): boolean {
  if (!role) return false;
  if (canViewFullDocumentLibrary(role)) return true;
  const allowed = FOLDER_DEFAULT_VISIBLE_ROLES[folder];
  if (!allowed) return true;
  return allowed.includes(role);
}

/** Default roles to materialize on upload into a restricted folder. */
export function defaultVisibleRolesForFolder(
  folder: EntityDocFolder,
): AppRole[] | null {
  const def = FOLDER_DEFAULT_VISIBLE_ROLES[folder];
  return def ? [...def] : null;
}

export function formatVisibleRolesLabel(
  roles: readonly AppRole[] | null | undefined,
): string {
  if (!roles || roles.length === 0) return 'All roles (open)';
  return roles.map((r) => APP_ROLE_LABELS[r] ?? r).join(', ');
}

export function libraryViewModeLabel(role: AppRole | null | undefined): {
  mode: 'full' | 'filtered';
  title: string;
  detail: string;
} {
  if (canViewFullDocumentLibrary(role)) {
    return {
      mode: 'full',
      title: 'Whole library view',
      detail:
        'Visionary and Admin see every company folder and file, including role-restricted items (e.g. 05 HR).',
    };
  }
  return {
    mode: 'filtered',
    title: 'Role-filtered view',
    detail:
      'You see documents for your company scope that your role is allowed to open. Restricted folders (like 05 HR) stay hidden unless your role is listed.',
  };
}

/** Parse checkbox group from FormData; `undefined` = inherit folder default. */
export function parseVisibleRolesFormData(
  formData: FormData,
  field = 'visible_roles',
): AppRole[] | undefined {
  const raw = formData
    .getAll(field)
    .filter((v): v is string => typeof v === 'string');
  if (raw.length === 0) return undefined;
  const allowed = new Set<string>(APP_ROLES);
  return raw.filter((r): r is AppRole => allowed.has(r));
}
