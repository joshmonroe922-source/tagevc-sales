'use client';

import { APP_ROLES, APP_ROLE_LABELS, type AppRole } from '@/lib/types/roles';

/** Multi-select role ACL checkboxes for upload / ACL editor forms. */
export function DocumentVisibilityFields({
  name = 'visible_roles',
  defaultRoles,
  showInheritHint = true,
}: {
  name?: string;
  defaultRoles?: AppRole[] | null;
  showInheritHint?: boolean;
}) {
  const selected = new Set(defaultRoles ?? []);
  return (
    <fieldset className="space-y-2 sm:col-span-2">
      <legend className="text-sm font-medium text-[#3a414f]">
        Visible to roles
      </legend>
      {showInheritHint ? (
        <p className="text-xs text-muted-foreground">
          Leave all unchecked to inherit the folder default (05 HR is
          restricted; other folders are open). Visionary and Admin always see
          the whole library. Only Visionary / Admin can set ACL.
        </p>
      ) : null}
      <div className="grid gap-1.5 sm:grid-cols-2">
        {APP_ROLES.filter((r) => r !== 'visionary' && r !== 'admin').map(
          (role) => (
            <label
              key={role}
              className="flex items-center gap-2 text-sm text-[#3a414f]"
            >
              <input
                type="checkbox"
                name={name}
                value={role}
                defaultChecked={selected.has(role)}
                className="size-3.5 rounded border-input"
              />
              {APP_ROLE_LABELS[role]}
            </label>
          ),
        )}
      </div>
    </fieldset>
  );
}
